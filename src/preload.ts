import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  analyzeUrl: (url: string, referer?: string) => ipcRenderer.invoke('analyze-url', url, referer),
  downloadVideo: (downloadId: string, formatId: string, url: string, referer?: string, customTitle?: string) => ipcRenderer.invoke('download-video', downloadId, formatId, url, referer, customTitle),
  cancelDownload: (downloadId: string) => ipcRenderer.invoke('cancel-download', downloadId),
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (config: any) => ipcRenderer.invoke('update-config', config),
  selectDownloadPath: () => ipcRenderer.invoke('select-download-path'),
  quitApp: () => ipcRenderer.send('app-quit'),
  onDownloadProgress: (callback: (progress: any) => void) => ipcRenderer.on('download-progress', (_event, value) => callback(value)),
  onFromExtension: (callback: (url: string, originalUrl?: string, title?: string) => void) => ipcRenderer.on('from-extension', (_event, url, originalUrl, title) => callback(url, originalUrl, title)),
});
