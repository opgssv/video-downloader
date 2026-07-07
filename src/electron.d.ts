export interface IElectronAPI {
  analyzeUrl: (url: string, referer?: string, cookie?: string) => Promise<any>;
  downloadVideo: (downloadId: string, formatId: string, url: string, referer?: string, customTitle?: string, cookie?: string) => Promise<any>;
  cancelDownload: (downloadId: string) => Promise<any>;
  getDownloadPath: () => Promise<string>;
  getConfig: () => Promise<any>;
  getHistory: () => Promise<any[]>;
  getQueue: () => Promise<any[]>;
  updateQueue: (queue: any[]) => Promise<void>;
  updateConfig: (config: any) => Promise<void>;
  selectDownloadPath: () => Promise<string | null>;
  quitApp: () => void;
  onDownloadProgress: (callback: (progress: any) => void) => (() => void);
  onFromExtension: (callback: (url: string, originalUrl?: string, title?: string, cookie?: string) => void) => (() => void);
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
