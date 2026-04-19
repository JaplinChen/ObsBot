import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('knowpipe', {
  saveConfig: (config: Record<string, string>) =>
    ipcRenderer.invoke('save-config', config),
  findVaults: () =>
    ipcRenderer.invoke('find-vaults'),
  testToken: (token: string) =>
    ipcRenderer.invoke('test-token', token),
  openFolderDialog: () =>
    ipcRenderer.invoke('open-folder-dialog'),
});
