import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  analyzeUrl: (url: string, useCookies: boolean, referer?: string) => ipcRenderer.invoke('analyze-url', url, useCookies, referer),
  downloadVideo: (downloadId: string, formatId: string, url: string, useCookies: boolean, referer?: string, customTitle?: string) => ipcRenderer.invoke('download-video', downloadId, formatId, url, useCookies, referer, customTitle),
  cancelDownload: (downloadId: string) => ipcRenderer.invoke('cancel-download', downloadId),
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  selectDownloadPath: () => ipcRenderer.invoke('select-download-path'),
  onDownloadProgress: (callback: (progress: any) => void) => ipcRenderer.on('download-progress', (_event, value) => callback(value)),
  onFromExtension: (callback: (url: string, originalUrl?: string, title?: string) => void) => ipcRenderer.on('from-extension', (_event, url, originalUrl, title) => callback(url, originalUrl, title)),
});
