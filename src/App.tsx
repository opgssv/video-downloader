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
  // Extra fields for resuming
  url?: string;
  referer?: string;
}

interface AnalyzedItem {
  id: string;
  url: string;
  referer?: string;
  title: string;
  formats: VideoFormat[];
  isLoading: boolean;
  error: string | null;
  isDuplicate: boolean;
  autoDownloadTriggered?: boolean;
}

function App() {
  const [url, setUrl] = useState('');
  const [analyzedItems, setAnalyzedItems] = useState<AnalyzedItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [downloadPath, setDownloadPath] = useState('');
  const [autoRemoveCompleted, setAutoRemoveCompleted] = useState(false);
  const [autoQuitOnFinish, setAutoQuitOnFinish] = useState(false);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  
  const historyRef = useRef(history);
  const analyzedItemsRef = useRef(analyzedItems);
  
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { analyzedItemsRef.current = analyzedItems; }, [analyzedItems]);

  // Keep track of options in refs so the progress listener can access their latest values
  const autoRemoveRef = useRef(autoRemoveCompleted);
  const autoQuitRef = useRef(autoQuitOnFinish);

  useEffect(() => {
    autoRemoveRef.current = autoRemoveCompleted;
    if (isConfigLoaded) {
      window.electronAPI.updateConfig({ autoRemoveCompleted });
    }
  }, [autoRemoveCompleted, isConfigLoaded]);

  useEffect(() => {
    autoQuitRef.current = autoQuitOnFinish;
    if (isConfigLoaded) {
      window.electronAPI.updateConfig({ autoQuitOnFinish });
    }
  }, [autoQuitOnFinish, isConfigLoaded]);

  // Persistence: Save queue whenever downloads state changes
  useEffect(() => {
    if (isConfigLoaded) {
      window.electronAPI.updateQueue(downloads);
    }
  }, [downloads, isConfigLoaded]);

  const fetchHistory = useCallback(async () => {
    const data = await window.electronAPI.getHistory();
    setHistory(data);
  }, []);

  const handleDownloadWithId = useCallback(async (format: VideoFormat, itemTitle: string, itemId: string) => {
    const tempDownloadId = `${format.format_id}-${Date.now()}`;
    const targetUrl = format.sourceUrl || '';
    const targetReferer = format.sourceReferer;
    
    const newItem: DownloadItem = {
      downloadId: tempDownloadId,
      formatId: format.format_id,
      title: itemTitle,
      percentage: 0,
      speed: 'Waiting...',
      eta: 'N/A',
      totalSize: formatBytes(format.filesize),
      status: 'downloading',
      url: targetUrl,
      referer: targetReferer
    };
    
    setDownloads((prev) => [newItem, ...prev]);
    setAnalyzedItems(prev => prev.filter(item => item.id !== itemId));

    const result = await window.electronAPI.downloadVideo(tempDownloadId, format.format_id, targetUrl, targetReferer, itemTitle);

    if (result.success && result.downloadId) {
      setDownloads((prev) => 
        prev.map((item) => 
          item.downloadId === tempDownloadId ? { ...item, downloadId: result.downloadId } : item
        )
      );
      fetchHistory();
    } else if (!result.success) {
      setDownloads((prev) => 
        prev.map((item) => 
          item.downloadId === tempDownloadId ? { ...item, status: 'failed' } : item
        )
      );
    }
  }, [fetchHistory]);

  // Logic to re-trigger a download for resuming
  const resumeDownload = useCallback(async (item: DownloadItem) => {
    if (!item.url) return;
    
    // Reset status to downloading to show UI activity
    setDownloads(prev => prev.map(d => d.downloadId === item.downloadId ? { ...d, status: 'downloading', speed: 'Resuming...' } : d));
    
    const result = await window.electronAPI.downloadVideo(item.downloadId, item.formatId, item.url, item.referer, item.title);
    
    if (result.success) {
      fetchHistory();
    } else {
      setDownloads(prev => prev.map(d => d.downloadId === item.downloadId ? { ...d, status: 'failed' } : d));
    }
  }, [fetchHistory]);

  const handleAnalyze = useCallback(async (targetUrl?: string, overrideReferer?: string, manualTitle?: string) => {
    const finalUrl = targetUrl || url;
    if (!finalUrl) return;

    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const newItem: AnalyzedItem = {
      id,
      url: finalUrl,
      referer: overrideReferer,
      title: manualTitle || '',
      formats: [],
      isLoading: true,
      error: null,
      isDuplicate: false
    };

    setAnalyzedItems(prev => [newItem, ...prev]);
    if (!targetUrl) setUrl(''); 

    const result = await window.electronAPI.analyzeUrl(finalUrl, overrideReferer);

    setAnalyzedItems(prev => prev.map(item => {
      if (item.id !== id) return item;

      if (!result.success) {
        return { ...item, isLoading: false, error: result.error || 'Analysis failed' };
      }

      const ytDlpTitle = result.data.title;
      const genericTitles = ['playlist', 'video', 'index', 'downloaded video', 'media', 'stream', 'output', 'original', 'download'];
      const isYtDlpTitleGeneric = !ytDlpTitle || genericTitles.includes(ytDlpTitle.toLowerCase());
      
      const baselineTitle = item.title;
      const isBaselineGeneric = !baselineTitle || genericTitles.includes(baselineTitle.toLowerCase());

      let finalTitle = 'Downloaded Video';
      if (isBaselineGeneric && !isYtDlpTitleGeneric) {
        finalTitle = ytDlpTitle;
      } else if (baselineTitle) {
        finalTitle = baselineTitle;
      } else if (!isYtDlpTitleGeneric) {
        finalTitle = ytDlpTitle;
      }

      const isDuplicate = historyRef.current.some(h => h.title.toLowerCase() === finalTitle.toLowerCase());

      let filteredFormats = result.data.formats.map((f: any) => ({
        ...f,
        sourceUrl: finalUrl,
        sourceReferer: overrideReferer
      })).filter(
        (f: any) => f.filesize || (f.protocol && (f.protocol.includes('m3u8') || f.protocol.includes('dash')))
      );

      if (filteredFormats.length === 0) {
        filteredFormats = result.data.formats.map((f: any) => ({
          ...f,
          sourceUrl: finalUrl,
          sourceReferer: overrideReferer
        })).filter((f: any) => f.resolution && f.resolution !== 'multiple');
      }
      
      if (filteredFormats.length === 0) {
        filteredFormats = result.data.formats.map((f: any) => ({
          ...f,
          sourceUrl: finalUrl,
          sourceReferer: overrideReferer
        }));
      }

      return {
        ...item,
        isLoading: false,
        title: finalTitle,
        formats: filteredFormats,
        isDuplicate
      };
    }));
  }, [url, history]);

  // Use a Ref to store the latest handleAnalyze for the IPC listener
  const handleAnalyzeRef = useRef(handleAnalyze);
  useEffect(() => { handleAnalyzeRef.current = handleAnalyze; }, [handleAnalyze]);

  // Effect to handle Auto-Download safety
  useEffect(() => {
    const itemToAutoDownload = analyzedItems.find(item => 
      !item.isLoading && !item.error && item.formats.length === 1 && !item.autoDownloadTriggered
    );
    
    if (itemToAutoDownload) {
      // Mark as triggered immediately to prevent loop
      setAnalyzedItems(prev => prev.map(i => i.id === itemToAutoDownload.id ? { ...i, autoDownloadTriggered: true } : i));
      handleDownloadWithId(itemToAutoDownload.formats[0], itemToAutoDownload.title, itemToAutoDownload.id);
    }
  }, [analyzedItems, handleDownloadWithId]);

  useEffect(() => {
    window.electronAPI.getConfig().then(config => {
      setDownloadPath(config.downloadPath);
      setAutoRemoveCompleted(config.autoRemoveCompleted);
      setAutoQuitOnFinish(config.autoQuitOnFinish);
      
      // After config, load queue and resume
      window.electronAPI.getQueue().then(savedQueue => {
        setDownloads(savedQueue);
        setIsConfigLoaded(true); // Now we can sync back changes
        
        // Auto-resume unfinished ones
        savedQueue.forEach((item: DownloadItem) => {
          if (item.status === 'downloading') {
            resumeDownload(item);
          }
        });
      });
    });
    
    fetchHistory();

    // REGISTER LISTENERS ONCE WITH CLEANUP
    const unregisterProgress = window.electronAPI.onDownloadProgress((progress) => {
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

        let finalItems = next;
        if (autoRemoveRef.current && progress.status === 'completed') {
          finalItems = next.filter(item => item.downloadId !== progress.downloadId);
          isAnyStillDownloading = finalItems.some(i => i.status === 'downloading');
        }

        if (autoQuitRef.current && !isAnyStillDownloading && progress.status === 'completed') {
          setTimeout(() => {
            window.electronAPI.quitApp();
          }, 2000);
        }

        return finalItems;
      });
    });

    const unregisterExtension = window.electronAPI.onFromExtension((incomingUrl, originalUrl, incomingTitle) => {
      // Use Ref to avoid re-registering listener when handleAnalyze changes
      handleAnalyzeRef.current(incomingUrl, originalUrl, incomingTitle);
    });

    return () => {
      unregisterProgress();
      unregisterExtension();
    };
  }, [fetchHistory, resumeDownload]); // history/handleAnalyze no longer in dependencies


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
    if (e.key === 'Enter') {
      handleAnalyze();
    }
  };

  const removeItem = (id: string) => {
    setAnalyzedItems(prev => prev.filter(item => item.id !== id));
  };

  const updateItemTitle = (id: string, newTitle: string) => {
    setAnalyzedItems(prev => prev.map(item => item.id === id ? { ...item, title: newTitle } : item));
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes) return 'N/A';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  const fallbackTitle = 'Downloaded Video';

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
        />
        <button onClick={() => handleAnalyze()} disabled={url === ''}>
          Analyze
        </button>
      </div>

      {/* Cumulative Analysis Inbox */}
      <div className="analysis-inbox">
        {analyzedItems.map((item) => (
          <div key={item.id} className="analysis-card">
            <button className="close-card-btn" onClick={() => removeItem(item.id)}>×</button>
            {item.isLoading ? (
              <div className="card-loading">Analyzing {item.url}...</div>
            ) : item.error ? (
              <div className="card-error">Error: {item.error}</div>
            ) : (
              <>
                <div className="title-edit-container">
                  <label>File Name:</label>
                  <div className="title-input-wrapper">
                    <input 
                      type="text" 
                      className="title-edit-input" 
                      value={item.title} 
                      onChange={(e) => updateItemTitle(item.id, e.target.value)} 
                      placeholder="Enter file name"
                    />
                    {item.isDuplicate && <span className="duplicate-badge" title="최근 30일 이내에 다운로드한 적이 있는 제목입니다.">⚠️ 최근 다운로드됨</span>}
                  </div>
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
                      {item.formats.map((format) => (
                        <tr key={format.format_id}>
                          <td>{format.format_id}</td>
                          <td>{format.ext}</td>
                          <td>{format.resolution}</td>
                          <td>{formatBytes(format.filesize)}</td>
                          <td>
                            <button className="download-btn" onClick={() => handleDownloadWithId(format, item.title, item.id)}>Download</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

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
