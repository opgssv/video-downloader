import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  analyzeUrl: (url: string, referer?: string, cookie?: string) => ipcRenderer.invoke('analyze-url', url, referer, cookie),
  downloadVideo: (downloadId: string, formatId: string, url: string, referer?: string, customTitle?: string, cookie?: string) => ipcRenderer.invoke('download-video', downloadId, formatId, url, referer, customTitle, cookie),
  cancelDownload: (downloadId: string) => ipcRenderer.invoke('cancel-download', downloadId),
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  getQueue: () => ipcRenderer.invoke('get-queue'),
  updateQueue: (queue: any[]) => ipcRenderer.invoke('update-queue', queue),
  updateConfig: (config: any) => ipcRenderer.invoke('update-config', config),
  selectDownloadPath: () => ipcRenderer.invoke('select-download-path'),
  quitApp: () => ipcRenderer.send('app-quit'),
  onDownloadProgress: (callback: (progress: any) => void) => {
    const listener = (_event: any, value: any) => callback(value);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  onFromExtension: (callback: (url: string, originalUrl?: string, title?: string, cookie?: string) => void) => {
    const listener = (_event: any, url: string, originalUrl?: string, title?: string, cookie?: string) => callback(url, originalUrl, title, cookie);
    ipcRenderer.on('from-extension', listener);
    return () => ipcRenderer.removeListener('from-extension', listener);
  },
});
