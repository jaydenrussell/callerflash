// CallerFlash updater preload
// Exposes only the updater status/progress bridge required by the
// dedicated updater window renderer.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('callerflashUpdater', {
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },
  onVersion: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:version', handler);
    return () => ipcRenderer.removeListener('updater:version', handler);
  },
});
