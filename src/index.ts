import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, dialog, powerSaveBlocker } from 'electron';
import { execFile, spawn, execSync, spawn as spawnChild } from 'child_process';
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
const PROTOCOL = 'video-downloader';

let mainWindow: BrowserWindow | null = null;
const currentConfig = loadConfig();
const activeDownloads = new Map<string, any>();
let psbId: number | null = null;

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
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load config', e);
  }
  return { downloadPath: app.getPath('downloads') };
}

function saveConfig(config: any) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save config', e);
  }
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
    height: 600,
    width: 800,
    show: false, // Don't show until ready-to-show to avoid white flicker
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
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
const startLocalServer = () => {
  const server = http.createServer();
  
  server.on('request', (req: any, res: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
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

// --- Cookie Logic ---
function getEdgeCookiePath() {
  const baseEdgePath = path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/User Data');
  const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3'];
  const cookieSubPaths = ['Network/Cookies', 'Cookies'];

  for (const profile of profiles) {
    for (const subPath of cookieSubPaths) {
      const checkPath = path.join(baseEdgePath, profile, subPath);
      if (fs.existsSync(checkPath)) return checkPath;
    }
  }
  return null;
}

function createTempCookieFile(prefix: string): string | null {
  const edgeCookiePath = getEdgeCookiePath();
  if (!edgeCookiePath) return null;

  const tempPath = path.join(app.getPath('temp'), `${prefix}_cookies_${Date.now()}.db`);
  try {
    execSync(`cmd /c copy /y "${edgeCookiePath}" "${tempPath}"`, { stdio: 'ignore' });
    if (fs.existsSync(tempPath)) return tempPath;
  } catch (e) {
    console.error('Cookie copy failed', e);
  }
  return null;
}

// --- IPC Handlers ---
async function handleGetDownloadPath() {
  return currentConfig.downloadPath;
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

async function handleAnalyzeUrl(event: IpcMainInvokeEvent, url: string, useCookies: boolean, overrideReferer?: string) {
  let tempCookiePath: string | null = null;
  
  // Clean URL: remove trailing slash if it's a file-like URL (.m3u8/ -> .m3u8)
  let targetUrl = url.trim();
  if (targetUrl.toLowerCase().match(/\.(m3u8|mp4|mpd|m4v|ts)\/$/)) {
    targetUrl = targetUrl.slice(0, -1);
  }

  const buildArgs = (urlToAnalyze: string, advanced = false) => {
    const urlObject = new URL(urlToAnalyze);
    const origin = urlObject.origin;
    const referer = overrideReferer || (origin + '/');
    
    // Check if it's a direct media link (skipping heavy analysis)
    const isDirectMedia = urlToAnalyze.includes('.m3u8') || urlToAnalyze.includes('.mp4');

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
    ];

    if (useCookies && tempCookiePath) {
      args.unshift('--cookies', tempCookiePath);
    }

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
    if (useCookies) {
      tempCookiePath = createTempCookieFile('analyze');
    }

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
  } finally {
    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
      try { fs.unlinkSync(tempCookiePath); } catch (e) { /* ignore */ }
    }
  }
}

// Helper to sanitize filenames
function sanitizeFilename(filename: string) {
  return filename.replace(/[<>:"/\\|?*]/g, '_').trim();
}

async function handleDownloadVideo(event: IpcMainInvokeEvent, downloadId: string, formatId: string, url: string, useCookies: boolean, overrideReferer?: string, customTitle?: string) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return { success: false, error: 'No main window found.' };

  // Clean URL
  let targetUrl = url.trim();
  if (targetUrl.toLowerCase().match(/\.(m3u8|mp4|mpd|m4v|ts)\/$/)) {
    targetUrl = targetUrl.slice(0, -1);
  }

  // Determine output template
  let outputTemplate = path.join(currentConfig.downloadPath, '%(title)s.%(ext)s');
  if (customTitle) {
    const safeTitle = sanitizeFilename(customTitle);
    outputTemplate = path.join(currentConfig.downloadPath, `${safeTitle}.%(ext)s`);
  }

  let tempCookiePath: string | null = null;

  try {
    const urlObject = new URL(targetUrl);
    const origin = urlObject.origin;
    const referer = overrideReferer || (origin + '/');

    const args = [
      '-f', formatId,
      '-o', outputTemplate,
      '--no-part',
      '--no-continue',
      '--age-limit', '18',
      '--impersonate', 'edge',
      '--referer', referer,
      '--add-header', `Origin:${new URL(referer).origin}`,
      '--legacy-server-connect',
      '--socket-timeout', '60',
      '-4',
      // --- IDM-style Speed Optimizations ---
      '--concurrent-fragments', '5',      // Download 5 fragments at once (HLS/DASH)
      '--buffer-size', '1M',              // Larger buffer for faster throughput
      '--no-mtime',                       // Don't waste time sync-ing file modification time
      '--newline',                        // Output progress on new lines for faster parsing
    ];

    if (useCookies) {
      tempCookiePath = createTempCookieFile('dl');
      if (tempCookiePath) args.unshift('--cookies', tempCookiePath);
    }

    args.push(targetUrl);

    const ytdlp = spawn(YTDLP_PATH, args);
    activeDownloads.set(downloadId, ytdlp);
    updatePowerSaveBlocker();

    // Immediate feedback to UI
    window.webContents.send('download-progress', { 
      downloadId, formatId, percentage: 0, speed: 'Connecting...', eta: 'Calculating...' 
    });

    ytdlp.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      // Improved regex to capture [download] percentage of totalSize at speed ETA eta
      // Example: [download]  10.0% of 100.00MiB at 10.00MiB/s ETA 00:09
      // Example HLS: [download]   0.5% of ~1.51GiB at 12.34MiB/s ETA 02:00
      const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)% of\s+(~?\s*[\d.]+\S+)\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/);
      
      if (progressMatch) {
        const percentage = parseFloat(progressMatch[1]);
        const totalSize = progressMatch[2] || 'N/A';
        const speed = progressMatch[3] || 'N/A';
        const eta = progressMatch[4] || 'N/A';
        
        // Calculate downloaded size approximately if not directly provided
        // Most yt-dlp versions don't output "X MB of Y MB" in a single line, but we can derive it
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
        if (tempCookiePath && fs.existsSync(tempCookiePath)) {
          try { fs.unlinkSync(tempCookiePath); } catch (e) { /* ignore */ }
        }
        activeDownloads.delete(downloadId);
        updatePowerSaveBlocker();
        if (code === 0) {
          window.webContents.send('download-progress', { downloadId, formatId, percentage: 100, status: 'completed' });
          resolve({ success: true, downloadId });
        } else {
          resolve({ success: false, error: `Process exited with code ${code}`, downloadId });
        }
      });
    });

  } catch (error) {
    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
      try { fs.unlinkSync(tempCookiePath); } catch (e) { /* ignore */ }
    }
    activeDownloads.delete(downloadId);
    updatePowerSaveBlocker();
    return { success: false, error: (error as Error).message, downloadId };
  }
}

async function handleCancelDownload(event: IpcMainInvokeEvent, downloadId: string) {
  const ytdlp = activeDownloads.get(downloadId);
  if (ytdlp) {
    try {
      execSync(`taskkill /F /T /PID ${ytdlp.pid}`);
      activeDownloads.delete(downloadId);
      updatePowerSaveBlocker();
      return { success: true };
    } catch (e) {
      ytdlp.kill('SIGKILL');
      activeDownloads.delete(downloadId);
      updatePowerSaveBlocker();
      return { success: true };
    }
  }
  return { success: false, error: 'Process not found' };
}

// Global Handlers
ipcMain.handle('analyze-url', handleAnalyzeUrl);
ipcMain.handle('download-video', (event, downloadId, formatId, url, useCookies, referer, customTitle) => 
  handleDownloadVideo(event, downloadId, formatId, url, useCookies, referer, customTitle)
);
ipcMain.handle('cancel-download', handleCancelDownload);
ipcMain.handle('get-download-path', handleGetDownloadPath);
ipcMain.handle('select-download-path', handleSelectDownloadPath);

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
