import { contextBridge, ipcRenderer } from 'electron';

export interface TinyCodeDesktopConfig {
  appName: string;
  version: string;
  serverUrl: string;
  rendererUrl: string;
  isPackaged: boolean;
}

export interface TinyCodeDesktopAPI {
  getConfig(): Promise<TinyCodeDesktopConfig>;
  openExternal(url: string): Promise<void>;
  retry(): Promise<void>;
  reload(): void;
  showAbout(): Promise<void>;
}

const api: TinyCodeDesktopAPI = {
  getConfig: () => ipcRenderer.invoke('desktop:get-config'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  retry: () => ipcRenderer.invoke('desktop:retry'),
  reload: () => ipcRenderer.send('desktop:reload'),
  showAbout: () => ipcRenderer.invoke('desktop:show-about'),
};

contextBridge.exposeInMainWorld('tinycodeDesktop', api);
