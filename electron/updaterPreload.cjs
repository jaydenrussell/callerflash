// CallerFlash updater preload
// Exposes only the updater status bridge required by the dedicated
// updater helper window.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('callerflashUpdater', {
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});
