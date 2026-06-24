// Type declarations for the Electron preload bridge exposed via contextBridge.
// Mirrors the surface defined in `electron/preload.cjs`. Keeping this in sync
// with that file gives the renderer full type safety on `window.callerflash`.

export {};

declare global {
  interface CallerFlashWindowControls {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    hideToTray: () => void;
    show: () => void;
    /** Subscribe to tray→renderer "restored" event. Returns an unsubscribe fn. */
    onRestoredFromTray: (callback: () => void) => () => void;
    /** Subscribe to tray→renderer "hidden" event. Returns an unsubscribe fn. */
    onHiddenToTray: (callback: () => void) => () => void;
  }

  interface CallerFlashTrayApi {
    /** Push the current SIP status label to main so the tray tooltip stays in sync. */
    setSipStatus: (status: string) => void;
  }

  interface CallerFlashSafeStorageApi {
    encrypt: (plaintext: string) => Promise<string | null>;
    decrypt: (base64Cipher: string) => Promise<string | null>;
  }

  interface CallerFlashShellApi {
    openExternal: (url: string) => void;
  }

  interface CallerFlashNotifyApi {
    /** Show a native OS notification. No-op in web demo. */
    show: (title: string, body: string) => void;
  }

  type UpdateChannel = 'stable' | 'beta' | 'nightly';

  interface CallerFlashUpdaterStatus {
    status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'noop';
    message?: string;
    progress?: number;
  }

  interface CallerFlashUpdaterApi {
    check: () => Promise<CallerFlashUpdaterStatus>;
    download: () => Promise<CallerFlashUpdaterStatus>;
    install: () => void;
    setChannel: (channel: UpdateChannel) => void;
    onStatus: (callback: (data: CallerFlashUpdaterStatus) => void) => () => void;
  }

  interface CallerFlashPlatformInfo {
    isElectron: true;
    arch: string;
    version: string;
  }

  interface CallerFlashBridge {
    window: CallerFlashWindowControls;
    tray: CallerFlashTrayApi;
    safeStorage: CallerFlashSafeStorageApi;
    shell: CallerFlashShellApi;
    notify: CallerFlashNotifyApi;
    updater: CallerFlashUpdaterApi;
    platform: CallerFlashPlatformInfo;
  }

  interface Window {
    /**
     * The Electron preload bridge. Present only when running inside the
     * Electron renderer; in browser dev mode this is `undefined`.
     */
    callerflash?: CallerFlashBridge;
  }
}
