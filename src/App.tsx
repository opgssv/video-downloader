import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

interface VideoFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize?: number;
  format_note?: string;
  protocol?: string;
  // BIND source info to prevent state pollution during rapid consecutive downloads
  sourceUrl?: string;
  sourceReferer?: string;
}

interface DownloadItem {
  downloadId: string;
  formatId: string;
  title: string;
  percentage: number;
  speed: string;
  eta: string;
  totalSize: string;
  downloadedSize?: string;
  status: 'downloading' | 'completed' | 'failed' | 'cancelled';
}

function App() {
  const [url, setUrl] = useState('');
  const [formats, setFormats] = useState<VideoFormat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [downloadPath, setDownloadPath] = useState('');
  const [referer, setReferer] = useState<string | undefined>(undefined);
  const [autoRemoveCompleted, setAutoRemoveCompleted] = useState(false);
  const [autoQuitOnFinish, setAutoQuitOnFinish] = useState(false);
  
  // Use refs to keep track of the absolute latest URL and title to avoid stale closures in handleDownload
  const extensionTitleRef = useRef<string>('');
  const currentUrlRef = useRef<string>('');
  
  // Keep track of options in refs so the progress listener can access their latest values
  const autoRemoveRef = useRef(autoRemoveCompleted);
  const autoQuitRef = useRef(autoQuitOnFinish);

  useEffect(() => {
    autoRemoveRef.current = autoRemoveCompleted;
    window.electronAPI.updateConfig({ autoRemoveCompleted });
  }, [autoRemoveCompleted]);

  useEffect(() => {
    autoQuitRef.current = autoQuitOnFinish;
    window.electronAPI.updateConfig({ autoQuitOnFinish });
  }, [autoQuitOnFinish]);

  const handleAnalyze = useCallback(async (targetUrl?: string, overrideReferer?: string, manualTitle?: string) => {
    const finalUrl = targetUrl || url;
    if (targetUrl) currentUrlRef.current = targetUrl; // Update ref if incoming from extension
    
    const finalReferer = overrideReferer || referer;
    const initialTitle = manualTitle || extensionTitleRef.current;
    
    if (!finalUrl) {
      setError('Please enter a URL.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setFormats([]);
    
    // Set initial title from extension if available
    if (initialTitle) setTitle(initialTitle);

    const result = await window.electronAPI.analyzeUrl(finalUrl, finalReferer);

    setIsLoading(false);
    if (result.success) {
      const ytDlpTitle = result.data.title;
      const isGeneric = !ytDlpTitle || ['playlist', 'video', 'index', 'downloaded video'].includes(ytDlpTitle.toLowerCase());
      
      // Update title and ref only if yt-dlp has a specific name
      if (!isGeneric) {
        setTitle(ytDlpTitle);
        extensionTitleRef.current = ytDlpTitle;
      } else if (initialTitle) {
        setTitle(initialTitle);
        extensionTitleRef.current = initialTitle;
      } else if (!ytDlpTitle && !initialTitle) {
        const fallback = 'Downloaded Video';
        setTitle(fallback);
        extensionTitleRef.current = fallback;
      }

      let filteredFormats = result.data.formats.map((f: VideoFormat) => ({
        ...f,
        sourceUrl: finalUrl,
        sourceReferer: finalReferer
      })).filter(
        (f: VideoFormat) => f.filesize || (f.protocol && (f.protocol.includes('m3u8') || f.protocol.includes('dash')))
      );

      if (filteredFormats.length === 0) {
        filteredFormats = result.data.formats.map((f: VideoFormat) => ({
          ...f,
          sourceUrl: finalUrl,
          sourceReferer: finalReferer
        })).filter((f: VideoFormat) => f.resolution && f.resolution !== 'multiple');
      }
      
      if (filteredFormats.length === 0) {
        filteredFormats = result.data.formats.map((f: VideoFormat) => ({
          ...f,
          sourceUrl: finalUrl,
          sourceReferer: finalReferer
        }));
      }

      setFormats(filteredFormats);
    } else {
      setError(result.error || 'An unknown error occurred.');
    }
  }, [url, referer]); // Removed useCookies from dependencies

  useEffect(() => {
    window.electronAPI.getConfig().then(config => {
      setDownloadPath(config.downloadPath);
      setAutoRemoveCompleted(config.autoRemoveCompleted);
      setAutoQuitOnFinish(config.autoQuitOnFinish);
    });

    window.electronAPI.onDownloadProgress((progress) => {
      setDownloads((prev) => {
        let isAnyStillDownloading = false;
        const next = prev.map((item) => {
          const isTarget = item.downloadId === progress.downloadId;
          const newStatus = (isTarget && progress.status === 'completed') ? 'completed' : item.status;
          
          if (newStatus === 'downloading') isAnyStillDownloading = true;

          if (isTarget) {
            return {
              ...item,
              percentage: progress.percentage,
              speed: progress.speed,
              eta: progress.eta,
              totalSize: progress.totalSize || item.totalSize,
              downloadedSize: progress.downloadedSize || item.downloadedSize,
              status: newStatus,
            };
          }
          return item;
        });

        // 1. Auto-remove logic
        let finalItems = next;
        if (autoRemoveRef.current && progress.status === 'completed') {
          finalItems = next.filter(item => item.downloadId !== progress.downloadId);
          // Recalculate if anything is still downloading after removal
          isAnyStillDownloading = finalItems.some(i => i.status === 'downloading');
        }

        // 2. Auto-quit logic
        if (autoQuitRef.current && !isAnyStillDownloading && progress.status === 'completed') {
          setTimeout(() => {
            window.electronAPI.quitApp();
          }, 2000);
        }

        return finalItems;
      });
    });

    window.electronAPI.onFromExtension((incomingUrl: string, originalUrl?: string, incomingTitle?: string) => {
      setUrl(incomingUrl);
      currentUrlRef.current = incomingUrl; // Update ref immediately
      if (originalUrl) setReferer(originalUrl);
      if (incomingTitle) {
        extensionTitleRef.current = incomingTitle;
        setTitle(incomingTitle);
      }
      handleAnalyze(incomingUrl, originalUrl, incomingTitle);
    });
  }, [handleAnalyze]);

  const handleDownload = async (format: VideoFormat) => {
    const tempDownloadId = `${format.format_id}-${Date.now()}`;
    const currentTitle = title || extensionTitleRef.current || 'Downloaded Video';
    
    // CRITICAL: Use the BINDED URL and referer from the format object itself
    // to prevent downloading the "currently analyzed" video instead of the intended one.
    const targetUrl = format.sourceUrl || currentUrlRef.current || url;
    const targetReferer = format.sourceReferer || referer;
    
    const newItem: DownloadItem = {
      downloadId: tempDownloadId,
      formatId: format.format_id,
      title: currentTitle,
      percentage: 0,
      speed: 'Waiting...',
      eta: 'N/A',
      totalSize: formatBytes(format.filesize),
      status: 'downloading',
    };
    
    setDownloads((prev) => [newItem, ...prev]);

    // Pass the decoupled targetUrl and targetReferer
    const result = await window.electronAPI.downloadVideo(tempDownloadId, format.format_id, targetUrl, targetReferer, currentTitle);

    if (result.success && result.downloadId) {
      setDownloads((prev) => 
        prev.map((item) => 
          item.downloadId === tempDownloadId ? { ...item, downloadId: result.downloadId } : item
        )
      );
    } else if (!result.success) {
      setDownloads((prev) => 
        prev.map((item) => 
          item.downloadId === tempDownloadId ? { ...item, status: 'failed' } : item
        )
      );
      setError(`Failed to download ${format.format_id}: ${result.error}`);
    }
  };

  const handleCancel = async (downloadId: string) => {
    const result = await window.electronAPI.cancelDownload(downloadId);
    if (result.success) {
      setDownloads((prev) => 
        prev.map((item) => 
          item.downloadId === downloadId ? { ...item, status: 'cancelled', speed: 'Stopped', eta: 'Stopped' } : item
        )
      );
    }
  };

  const handleRemove = (downloadId: string) => {
    setDownloads((prev) => prev.filter((item) => item.downloadId !== downloadId));
  };

  const clearCompleted = () => {
    setDownloads((prev) => prev.filter((item) => item.status === 'downloading'));
  };

  const handleSelectPath = async () => {
    const newPath = await window.electronAPI.selectDownloadPath();
    if (newPath) {
      setDownloadPath(newPath);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleAnalyze();
    }
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes) return 'N/A';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  return (
    <div className="container">
      <h1>Video Downloader</h1>

      <div className="settings-section">
        <div className="path-settings">
          <div className="path-info">
            <label>Save to:</label>
            <span className="current-path" title={downloadPath}>{downloadPath || 'Loading...'}</span>
          </div>
          <button className="change-path-btn" onClick={handleSelectPath}>Change</button>
        </div>

        <div className="automation-settings">
          <label className="checkbox-label">
            <input 
              type="checkbox" 
              checked={autoRemoveCompleted} 
              onChange={(e) => setAutoRemoveCompleted(e.target.checked)} 
            />
            Auto-remove completed items
          </label>
          <label className="checkbox-label">
            <input 
              type="checkbox" 
              checked={autoQuitOnFinish} 
              onChange={(e) => setAutoQuitOnFinish(e.target.checked)} 
            />
            Auto-quit when all downloads finish
          </label>
        </div>
      </div>

      <div className="input-group">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter video URL"
          disabled={isLoading}
        />
        <button onClick={() => handleAnalyze()} disabled={isLoading}>
          {isLoading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* Main Analysis Results */}
      {title !== '' && (
        <div className="analysis-results">
          <div className="title-edit-container">
            <label>File Name:</label>
            <input 
              type="text" 
              className="title-edit-input" 
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
              placeholder="Enter file name"
            />
          </div>
          <div className="results">
            <table>
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Ext</th>
                  <th>Resolution</th>
                  <th>Size</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {formats.map((format) => (
                  <tr key={format.format_id}>
                    <td>{format.format_id}</td>
                    <td>{format.ext}</td>
                    <td>{format.resolution}</td>
                    <td>{formatBytes(format.filesize)}</td>
                    <td>
                      <button className="download-btn" onClick={() => handleDownload(format)}>Download</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Persistent Download Queue */}
      {downloads.length > 0 && (
        <div className="download-queue">
          <hr />
          <div className="queue-header">
            <h3>Download Queue</h3>
            <button className="clear-all-btn" onClick={clearCompleted}>Clear Completed</button>
          </div>
          <div className="queue-list">
            {downloads.map((item) => (
              <div key={item.downloadId} className={`queue-item ${item.status}`}>
                <div className="queue-info">
                  <span className="queue-title">{item.title}</span>
                  <span className="queue-details">
                    [{item.formatId}] {item.downloadedSize || '0B'} / {item.totalSize} ({item.percentage.toFixed(1)}%) • {item.speed} • {item.eta}
                  </span>
                </div>
                <div className="queue-progress-container">
                  <div className="queue-progress-bar" style={{ width: `${item.percentage}%` }}></div>
                  <span className="queue-percentage">{item.percentage.toFixed(1)}%</span>
                </div>
                <div className="queue-actions">
                  {item.status === 'downloading' && (
                    <button className="cancel-btn" onClick={() => handleCancel(item.downloadId)}>Cancel</button>
                  )}
                  {item.status !== 'downloading' && (
                    <button className="remove-btn" onClick={() => handleRemove(item.downloadId)}>×</button>
                  )}
                  {item.status === 'completed' && <span className="status-badge completed">Done</span>}
                  {item.status === 'cancelled' && <span className="status-badge cancelled">Stopped</span>}
                  {item.status === 'failed' && <span className="status-badge failed">Failed</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
