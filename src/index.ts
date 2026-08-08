import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, dialog, powerSaveBlocker } from 'electron';
import { execFile, spawn, exec, spawn as spawnChild } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import http from 'http';

const execFilePromise = util.promisify(execFile);
// --- Path Configuration for Distribution ---
const isDev = !app.isPackaged;
// In dev: project root, In production: resources folder
const baseDir = isDev ? app.getAppPath() : process.resourcesPath;
const binPath = path.join(baseDir, 'bin');

// Add bin directory to system PATH dynamically for yt-dlp to find ffmpeg
if (fs.existsSync(binPath)) {
  process.env.PATH = `${binPath}${path.delimiter}${process.env.PATH}`;
}

// Always use relative path to bin/yt-dlp.exe
const YTDLP_PATH = path.join(binPath, 'yt-dlp.exe');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const HISTORY_PATH = path.join(app.getPath('userData'), 'history.json');
const QUEUE_PATH = path.join(app.getPath('userData'), 'queue.json');
const PROTOCOL = 'video-downloader';

let mainWindow: BrowserWindow | null = null;
const currentConfig = loadConfig();
const currentHistory = loadHistory();
let currentQueue = loadQueue();
const activeDownloads = new Map<string, { process: any, outputPath: string }>();
let psbId: number | null = null;

// ... (config loading/saving remains same)

// --- Queue Management ---
interface QueueItem {
  downloadId: string;
  formatId: string;
  url: string;
  referer?: string;
  title: string;
  status: 'downloading' | 'completed' | 'failed' | 'cancelled';
}

function loadQueue(): QueueItem[] {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load queue', e);
  }
  return [];
}

function saveQueue(queue: QueueItem[]) {
  try {
    // Only save unfinished or recently failed items to keep queue clean
    const filtered = queue.filter(item => item.status !== 'completed');
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(filtered));
  } catch (e) {
    console.error('Failed to save queue', e);
  }
}


// --- Helper to manage Power Save Blocker ---
function updatePowerSaveBlocker() {
  if (activeDownloads.size > 0) {
    if (psbId === null) {
      psbId = powerSaveBlocker.start('prevent-app-suspension');
    }
  } else {
    if (psbId !== null) {
      powerSaveBlocker.stop(psbId);
      psbId = null;
    }
  }
}

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

function loadConfig() {
  const defaults = { 
    downloadPath: app.getPath('downloads'),
    width: 1200,
    height: 900,
    autoRemoveCompleted: false,
    autoQuitOnFinish: false
  };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...defaults, ...saved };
    }
  } catch (e) {
    console.error('Failed to load config', e);
  }
  return defaults;
}

function saveConfig(config: any) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save config', e);
  }
}

// --- History Management ---
interface HistoryEntry {
  title: string;
  timestamp: number;
}

function loadHistory(): HistoryEntry[] {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      let history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
      // Cleanup: 30 days (30 * 24 * 60 * 60 * 1000 ms)
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      history = history.filter((entry: HistoryEntry) => (now - entry.timestamp) < thirtyDaysMs);
      return history;
    }
  } catch (e) {
    console.error('Failed to load history', e);
  }
  return [];
}

function saveHistory(history: HistoryEntry[]) {
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history));
  } catch (e) {
    console.error('Failed to save history', e);
  }
}

function addToHistory(title: string) {
  currentHistory.unshift({ title, timestamp: Date.now() });
  // Keep history manageable (e.g., max 1000 entries) even within 30 days
  if (currentHistory.length > 1000) currentHistory.length = 1000;
  saveHistory(currentHistory);
}

// --- Protocol Handling ---
function handleProtocolUrl(rawUrl: string) {
  if (!rawUrl || !mainWindow) return;
  try {
    // Standard URL parser might lowercase hostname, which can break some stream URLs
    // We'll use a more reliable string splitting approach for our custom protocol
    const urlString = rawUrl.replace(`${PROTOCOL}://`, '');
    const [targetPart, queryPart] = urlString.split('?');
    
    const targetUrl = decodeURIComponent(targetPart);
    let originalUrl: string | undefined;
    let title: string | undefined;

    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      originalUrl = params.get('originalUrl') || undefined;
      title = params.get('title') || undefined;
    }
    
    if (targetUrl) {
      mainWindow.webContents.send('from-extension', targetUrl, originalUrl, title);
    }
  } catch (e) {
    console.error('Failed to parse protocol URL', e);
  }
}

// --- Single Instance Lock & Protocol Registration ---
function handleSquirrelEvent() {
  if (process.argv.length === 1) return false;
  const exeName = path.basename(process.execPath);
  const appFolder = path.resolve(process.env.LOCALAPPDATA, 'video_downloader_app');
  const updateExe = path.join(appFolder, 'Update.exe');

  const spawnUpdate = (args: string[]) => {
    try { spawnChild(updateExe, args, { detached: true }); } catch (e) { /* ignore */ }
  };

  const event = process.argv[1];
  switch (event) {
    case '--squirrel-install':
    case '--squirrel-updated':
      spawnUpdate(['--createShortcut', exeName]);
      app.setAsDefaultProtocolClient(PROTOCOL);
      setTimeout(app.quit, 1000);
      return true;
    case '--squirrel-uninstall':
      spawnUpdate(['--removeShortcut', exeName]);
      app.removeAsDefaultProtocolClient(PROTOCOL);
      setTimeout(app.quit, 1000);
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
  }
  return false;
}

if (handleSquirrelEvent()) {
  // Event handled, app will exit
} else if (require('electron-squirrel-startup')) {
  app.quit();
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // Register protocol for runtime/dev
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
      if (url) handleProtocolUrl(url);
    }
  });

  app.on('ready', () => {
    createWindow();
    startLocalServer();
    
    // Check if launched with protocol URL
    const initialUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (initialUrl && mainWindow) {
      mainWindow.webContents.on('did-finish-load', () => {
        handleProtocolUrl(initialUrl);
      });
    }
  });
}

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    height: currentConfig.height,
    width: currentConfig.width,
    show: false, // Don't show until ready-to-show to avoid white flicker
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Save window size when resized
  mainWindow.on('resize', () => {
    if (mainWindow) {
      const bounds = mainWindow.getBounds();
      currentConfig.width = bounds.width;
      currentConfig.height = bounds.height;
      saveConfig(currentConfig);
    }
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY).catch(err => {
    console.error('Failed to load URL:', err);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// --- Local Server for Edge Extension ---
// Store the current referer for surrit.com proxy requests
let currentSurritReferer = 'https://missav.com/';

const startLocalServer = () => {
  const server = http.createServer();
  
  server.on('request', (req: any, res: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Reverse proxy: yt-dlp requests segments from here, we fetch from surrit.com via curl
    if (req.method === 'GET' && req.url && req.url.startsWith('/proxy/')) {
      const encodedUrl = req.url.substring('/proxy/'.length);
      const segmentUrl = decodeURIComponent(encodedUrl);
      
      const curlArgs = [
        '-s', '-L',
        '-H', `Referer: ${currentSurritReferer}`,
        '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-H', 'Accept: */*',
        '--output', '-',  // write to stdout
        segmentUrl
      ];
      
      const curl = spawn('curl.exe', curlArgs);
      
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      curl.stdout.pipe(res);
      
      curl.stderr.on('data', (data: Buffer) => {
        // Suppress curl stderr progress
      });
      
      curl.on('close', (code: number) => {
        if (code !== 0) {
          console.error(`[Proxy] curl failed for segment: ${segmentUrl} (code ${code})`);
        }
        if (!res.writableEnded) {
          res.end();
        }
      });
      
      curl.on('error', (err: Error) => {
        console.error('[Proxy] curl spawn error:', err);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
      
      return;
    }

    // Serve the rewritten m3u8 playlist (segments point to /proxy/...)
    if (req.method === 'GET' && req.url === '/temp_playlist.m3u8') {
      const tempFilePath = path.join(app.getPath('userData'), 'temp_playlist.m3u8');
      if (fs.existsSync(tempFilePath)) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end(fs.readFileSync(tempFilePath));
      } else {
        res.writeHead(404);
        res.end('Playlist file not found');
      }
      return;
    }



    if (req.method === 'POST' && req.url === '/send-url') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.url && mainWindow) {
            mainWindow.webContents.send('from-extension', data.url, data.originalUrl, data.title);
            mainWindow.focus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(400);
            res.end('Missing URL or App not ready');
          }
        } catch (e) {
          res.writeHead(500);
          res.end('Invalid JSON');
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(8888, '127.0.0.1', () => {
    console.log('Local API server listening on http://127.0.0.1:8888');
  });
};

// Download surrit.com m3u8, rewrite segments to proxy URLs, save locally
async function downloadAndRewriteM3u8(url: string, referer: string): Promise<string | null> {
  try {
    // Store referer for proxy to use
    currentSurritReferer = referer;
    
    const { stdout } = await execFilePromise('curl.exe', [
      '-s', '-L',
      '-H', `Referer: ${referer}`,
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      url
    ]);
    
    if (!stdout || !stdout.includes('#EXTM3U')) {
      console.error('[M3U8 Rewrite] Failed to fetch valid m3u8 playlist via curl');
      return null;
    }
    
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    const lines = stdout.split(/\r?\n/);
    const rewrittenLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.length > 0 && !trimmed.startsWith('#')) {
        // Convert segment to absolute URL, then route through local proxy
        const absoluteUrl = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
        return 'http://127.0.0.1:8888/proxy/' + encodeURIComponent(absoluteUrl);
      }
      return line;
    });
    
    const tempFilePath = path.join(app.getPath('userData'), 'temp_playlist.m3u8');
    fs.writeFileSync(tempFilePath, rewrittenLines.join('\n'), 'utf-8');
    console.log('[M3U8 Rewrite] Saved proxy-routed playlist to:', tempFilePath);
    
    return 'http://127.0.0.1:8888/temp_playlist.m3u8';
  } catch (e) {
    console.error('[M3U8 Rewrite] Error:', e);
    return null;
  }
}
// --- IPC Handlers ---
async function handleGetDownloadPath() {
  return currentConfig.downloadPath;
}

async function handleGetConfig() {
  return currentConfig;
}

async function handleGetHistory() {
  return currentHistory;
}

async function handleGetQueue() {
  return currentQueue;
}

async function handleUpdateQueue(event: IpcMainInvokeEvent, queue: QueueItem[]) {
  currentQueue = queue;
  saveQueue(currentQueue);
}


async function handleUpdateConfig(event: IpcMainInvokeEvent, newConfig: any) {
  Object.assign(currentConfig, newConfig);
  saveConfig(currentConfig);
}

async function handleSelectDownloadPath(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(window!, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    currentConfig.downloadPath = result.filePaths[0];
    saveConfig(currentConfig);
    return currentConfig.downloadPath;
  }
  return null;
}

async function handleAnalyzeUrl(event: IpcMainInvokeEvent, url: string, overrideReferer?: string) {
  // Clean URL: remove trailing slash if it's a file-like URL (.m3u8/ -> .m3u8)
  let targetUrl = url.trim();
  if (targetUrl.toLowerCase().match(/\.(m3u8|mp4|mpd|m4v|webm|mkv|mov|mp3|m4a|aac|ogg|opus)\/$/)) {
    targetUrl = targetUrl.slice(0, -1);
  }

  // Intercept surrit.com HLS streams: download m3u8 via curl, rewrite segments to proxy URLs
  if (targetUrl.includes('surrit.com') && targetUrl.includes('.m3u8')) {
    const referer = overrideReferer || 'https://missav.com/';
    console.log('[M3U8 Proxy] Intercepting surrit.com playlist for analysis...');
    const localUrl = await downloadAndRewriteM3u8(targetUrl, referer);
    if (localUrl) {
      targetUrl = localUrl;
    }
  }

  console.log(`[API/analyze-url] Target: ${targetUrl}, Referer: ${overrideReferer}`);

  const buildArgs = (urlToAnalyze: string, advanced = false) => {
    const urlObject = new URL(urlToAnalyze);
    const origin = urlObject.origin;
    const referer = overrideReferer || (origin + '/');
    
    // Check if it's a direct media link (skipping heavy analysis)
    const isDirectMedia = /\.(m3u8|mpd|mp4|m4v|webm|mkv|mov|flv|avi|ogv|mp3|m4a|aac|ogg|opus|wav|flac)(?:$|[?#])/i.test(urlToAnalyze);

    const args = [
      '--dump-json',
      '--age-limit', '18',
      '--impersonate', 'edge',
      '--referer', referer,
      '--add-header', `Origin:${new URL(referer).origin}`,
      '--add-header', 'Accept-Language:ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      '--no-check-certificates',
      '--prefer-insecure',
      '--legacy-server-connect',
      '--socket-timeout', '60',
      '--no-playlist',
      '-4',
      '--no-cache-dir',
    ];

    // If it's already a direct media link, we don't need heavy format checking
    if (!isDirectMedia && advanced) {
      args.push('--geo-bypass', '--check-formats');
    } else if (isDirectMedia) {
      args.push('--no-check-certificates');
    }

    args.push(urlToAnalyze);
    return args;
  };

  try {
    const tryRun = async (currentArgs: string[]) => {
      const { stdout } = await execFilePromise(YTDLP_PATH, currentArgs);
      return JSON.parse(stdout);
    };

    try {
      return { success: true, data: await tryRun(buildArgs(targetUrl)) };
    } catch (e) {
      try {
        return { success: true, data: await tryRun(buildArgs(targetUrl, true)) };
      } catch (e2) {
        // SNI Bypass normalization for missav, mingky, etc.
        const normalizedUrl = targetUrl.replace(/(missav|mingky|fc2)\d+/i, '$1.com');
        if (normalizedUrl !== targetUrl && !targetUrl.includes('.m3u8')) {
          try {
            return { success: true, data: await tryRun(buildArgs(normalizedUrl, true)) };
          } catch (e3) {
            // Unnecessary try/catch removed by just throwing e2 if this fails
          }
        }
        throw e2;
      }
    }
  } catch (error) {
    let errorMessage = (error as Error).message;
    const connectionErrors = ['Connection was reset', 'curl: (35)', 'curl: (5)', 'Protocol error', 'Handshake failed', '10054', 'Aborted'];
    
    if (connectionErrors.some(err => errorMessage.includes(err))) {
      errorMessage = "⚠️ [SNI Block Detected] ⚠️\n" +
                      "This site is currently blocked by your ISP or Firewall.\n" +
                      "To fix this: Open the Edge Extension while playing the video and click one of the 'Detected Video URLs' (.m3u8) instead of the page URL.";
    } else if (errorMessage.includes('404')) {
      errorMessage = "⚠️ [Link Expired or Invalid] ⚠️\n" +
                      "The video link (404 Not Found) is no longer valid.\n" +
                      "This happens when a session expires. Please REFRESH the page, play the video again, and click the NEWLY detected URL in the extension.";
    } else if (errorMessage.includes('403')) {
      errorMessage = "⚠️ [Access Denied] ⚠️\n" +
                      "The server rejected the request (403 Forbidden).\n" +
                      "This usually means a Referer or Cookie is missing. Try analyzing again using the 'Detected URL' from the extension.";
    }
    return { success: false, error: errorMessage };
  }
}

// Helper to sanitize filenames
function sanitizeFilename(filename: string) {
  return filename.replace(/[<>:"/\\|?*]/g, '_').trim();
}

async function handleDownloadVideo(event: IpcMainInvokeEvent, downloadId: string, formatId: string, url: string, overrideReferer?: string, customTitle?: string) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return { success: false, error: 'No main window found.' };

  // Clean URL
  let targetUrl = url.trim();
  if (targetUrl.toLowerCase().match(/\.(m3u8|mp4|mpd|m4v|webm|mkv|mov|mp3|m4a|aac|ogg|opus)\/$/)) {
    targetUrl = targetUrl.slice(0, -1);
  }

  // Intercept surrit.com HLS streams for download too
  if (targetUrl.includes('surrit.com') && targetUrl.includes('.m3u8')) {
    const referer = overrideReferer || 'https://missav.com/';
    console.log('[M3U8 Proxy] Intercepting surrit.com playlist for download...');
    const localUrl = await downloadAndRewriteM3u8(targetUrl, referer);
    if (localUrl) {
      targetUrl = localUrl;
    }
  }

  console.log(`[API/download-video] ID: ${downloadId}, Target: ${targetUrl}, Format: ${formatId}, Referer: ${overrideReferer}`);

  // Determine output template and handle potential name collisions
  const commonExts = ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'flv', 'ogv', 'ts', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac'];
  let finalTitle = sanitizeFilename(customTitle || 'Downloaded Video');
  let counter = 1;

  // Paths
  const downloadDir = currentConfig.downloadPath;
  const tempDir = path.join(downloadDir, '.tmp');

  // Ensure .tmp folder exists for intermediate files
  if (!fs.existsSync(tempDir)) {
    try { fs.mkdirSync(tempDir, { recursive: true }); } catch (e) { /* ignore */ }
  }

  const isPathInUse = (title: string) => {
    // 1. Check physical files on disk in BOTH main and temp folders
    for (const ext of commonExts) {
      const pathsToCheck = [
        path.join(downloadDir, `${title}.${ext}`),
        path.join(downloadDir, `${title}.${ext}.part`),
        path.join(tempDir, `${title}.${ext}`),
        path.join(tempDir, `${title}.${ext}.part`),
        path.join(tempDir, `${title}.f${formatId}.${ext}`), // yt-dlp format specific temp
        path.join(tempDir, `${title}.${ext}.ytdl`)
      ];
      for (const p of pathsToCheck) {
        if (fs.existsSync(p)) return true;
      }
    }

    // 2. Check active downloads in the app's memory to prevent race conditions
    for (const item of activeDownloads.values()) {
      // item.outputPath is the final intended template
      const activeBase = path.basename(item.outputPath, path.extname(item.outputPath));
      if (activeBase.toLowerCase() === title.toLowerCase()) return true;
    }
    return false;
  };

  let testTitle = finalTitle;
  while (isPathInUse(testTitle)) {
    testTitle = `${finalTitle} (${counter})`;
    counter++;
  }
  finalTitle = testTitle;

  // Use Absolute Template pointing directly to .tmp directory
  const finalFilenameTemplate = `${finalTitle}.%(ext)s`;
  const absoluteTempTemplate = path.join(tempDir, finalFilenameTemplate);
  // Store the expected final base name for moving later
  const finalDestBasePath = path.join(downloadDir, finalTitle);

  try {
    const urlObject = new URL(targetUrl);
    const origin = urlObject.origin;
    const referer = overrideReferer || (origin + '/');
    const args = [
      '-f', formatId,
      '-o', absoluteTempTemplate,       // Force ALL downloads into .tmp
      '--age-limit', '18',
      '--impersonate', 'edge',
      '--referer', referer,
      '--add-header', `Origin:${new URL(referer).origin}`,
      '--legacy-server-connect',
      '--socket-timeout', '60',
      '-4',
      '--no-cache-dir',
      // ... Speed Optimizations ...
      '--concurrent-fragments', '5',
      '--buffer-size', '1M',
      '--no-mtime',
      '--newline',
    ];

    args.push(targetUrl);

    const ytdlp = spawn(YTDLP_PATH, args);
    
    // ...
    activeDownloads.set(downloadId, { process: ytdlp, outputPath: finalDestBasePath }); // store base path for collision check

    updatePowerSaveBlocker();
    
    // Add to history
    addToHistory(finalTitle);

    // Immediate feedback to UI
    window.webContents.send('download-progress', { 
      downloadId, formatId, percentage: 0, speed: 'Connecting...', eta: 'Calculating...' 
    });

    ytdlp.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)% of\s+(~?\s*[\d.]+\S+)\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/);
      
      if (progressMatch) {
        const percentage = parseFloat(progressMatch[1]);
        const totalSize = progressMatch[2] || 'N/A';
        const speed = progressMatch[3] || 'N/A';
        const eta = progressMatch[4] || 'N/A';
        
        let downloadedSize = '0B';
        try {
          const totalVal = parseFloat(totalSize.replace(/~|\s|[a-zA-Z]/g, ''));
          const unit = totalSize.match(/[a-zA-Z]+/)?.[0] || 'MiB';
          const calcDownloaded = (totalVal * percentage / 100).toFixed(2);
          downloadedSize = `${calcDownloaded}${unit}`;
        } catch (e) { /* ignore calculation error */ }

        window.webContents.send('download-progress', { 
          downloadId, formatId, percentage, totalSize, downloadedSize, speed, eta 
        });
      }
    });

    return new Promise((resolve) => {
      ytdlp.on('close', (code: number) => {
        activeDownloads.delete(downloadId);
        updatePowerSaveBlocker();
        
        if (code === 0) {
          // DOWNLOAD SUCCESS: Move the file from .tmp to the main folder
          try {
            // Find the actual file (since we don't know the exact extension %(ext)s resolved to)
            const tempFiles = fs.readdirSync(tempDir);
            for (const file of tempFiles) {
              if (file.startsWith(finalTitle + '.') && !file.endsWith('.part') && !file.endsWith('.ytdl')) {
                const oldPath = path.join(tempDir, file);
                const newPath = path.join(downloadDir, file);
                
                // If it somehow exists (e.g. user moved something manually), avoid crashing
                if (fs.existsSync(newPath)) {
                  fs.unlinkSync(newPath);
                }
                
                // Move it
                fs.renameSync(oldPath, newPath);
              }
            }
          } catch (moveError) {
            console.error('Error moving file from temp:', moveError);
          }

          window.webContents.send('download-progress', { downloadId, formatId, percentage: 100, status: 'completed' });
          resolve({ success: true, downloadId });
        } else {
          resolve({ success: false, error: `Process exited with code ${code}`, downloadId });
        }
      });
    });

  } catch (error) {
    activeDownloads.delete(downloadId);
    updatePowerSaveBlocker();
    return { success: false, error: (error as Error).message, downloadId };
  }
}

async function handleCancelDownload(event: IpcMainInvokeEvent, downloadId: string) {
  const item = activeDownloads.get(downloadId);
  if (item && item.process) {
    const ytdlp = item.process;
    try {
      exec(`taskkill /F /T /PID ${ytdlp.pid}`, (err: any) => {
        if (err) {
          try { ytdlp.kill('SIGKILL'); } catch (e) { /* ignore kill error */ }
        }
      });
      activeDownloads.delete(downloadId);
      updatePowerSaveBlocker();
      return { success: true };
    } catch (e) {
      try { ytdlp.kill('SIGKILL'); } catch (e) { /* ignore kill error */ }
      activeDownloads.delete(downloadId);
      updatePowerSaveBlocker();
      return { success: true };
    }
  }
  return { success: false, error: 'Process not found' };
}

// Global Handlers
ipcMain.handle('analyze-url', handleAnalyzeUrl);
ipcMain.handle('download-video', (event, downloadId, formatId, url, referer, customTitle) => 
  handleDownloadVideo(event, downloadId, formatId, url, referer, customTitle)
);
ipcMain.handle('cancel-download', handleCancelDownload);
ipcMain.handle('get-download-path', handleGetDownloadPath);
ipcMain.handle('get-config', handleGetConfig);
ipcMain.handle('get-history', handleGetHistory);
ipcMain.handle('get-queue', handleGetQueue);
ipcMain.handle('update-queue', handleUpdateQueue);
ipcMain.handle('update-config', handleUpdateConfig);
ipcMain.handle('select-download-path', handleSelectDownloadPath);
ipcMain.on('app-quit', () => {
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
