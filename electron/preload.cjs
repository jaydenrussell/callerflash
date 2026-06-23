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
    // Subscribe to events pushed from main when the tray restores or
    // re-hides the window. Returns an unsubscribe function.
    onRestoredFromTray: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('window:restored-from-tray', handler);
      return () => ipcRenderer.removeListener('window:restored-from-tray', handler);
    },
    onHiddenToTray: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('window:hidden-to-tray', handler);
      return () => ipcRenderer.removeListener('window:hidden-to-tray', handler);
    },
  },

  // ── Tray sync ───────────────────────────────────────────────────
  // Push the current SIP status label to main so the tray tooltip
  // and "SIP: …" menu item reflect reality (Connected / Registered / Offline).
  tray: {
    setSipStatus: (status) => ipcRenderer.send('tray:set-sip-status', status),
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
