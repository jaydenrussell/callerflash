// CallerFlash — Preload (runs in isolated context, bridges main ↔ renderer)
// Only exposes the MINIMUM surface to the renderer via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('callerflash', {
  // ── Window controls ─────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    hideToTray: () => ipcRenderer.send('window:hide-to-tray'),
    show: () => ipcRenderer.send('window:show'),
  },

  // ── Secure credential storage (DPAPI) ───────────────────────────
  safeStorage: {
    encrypt: (plaintext) => ipcRenderer.invoke('safe-storage:encrypt', plaintext),
    decrypt: (base64Cipher) => ipcRenderer.invoke('safe-storage:decrypt', base64Cipher),
  },

  // ── External links (gated by allow-list in main) ────────────────
  shell: {
    openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  },

  // ── Auto-updater ────────────────────────────────────────────────
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.send('updater:install'),
    setChannel: (channel) => ipcRenderer.send('updater:set-channel', channel),
    onStatus: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
  },

  // ── Platform info ───────────────────────────────────────────────
  platform: {
    isElectron: true,
    arch: process.arch,
    version: process.env.npm_package_version || '0.0.0',
  },
});
