export interface IElectronAPI {
  analyzeUrl: (url: string, useCookies: boolean, referer?: string) => Promise<any>;
  downloadVideo: (downloadId: string, formatId: string, url: string, useCookies: boolean, referer?: string, customTitle?: string) => Promise<any>;
  cancelDownload: (downloadId: string) => Promise<any>;
  getDownloadPath: () => Promise<string>;
  selectDownloadPath: () => Promise<string | null>;
  onDownloadProgress: (callback: (progress: any) => void) => void;
  onFromExtension: (callback: (url: string, originalUrl?: string, title?: string) => void) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
