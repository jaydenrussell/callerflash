import { create } from 'zustand';
import { redactMessage, redactKeyedValue } from '../security/secretRedactor';

const UI_STORAGE_KEY = 'callerflash-ui-settings';

export interface SipConfig {
  server: string;
  port: number;
  username: string;
  password: string;
  authUsername: string;
  protocol: 'UDP' | 'TCP' | 'TLS';
  codec: string;
  stunServer: string;
  registerExpiry: number;
}

export interface ToastConfig {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  backgroundColor: string;
  accentColor: string;
  duration: number;
  position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  soundEnabled: boolean;
  autoCopyToClipboard: boolean;
  showCallerName: boolean;
  showTimestamp: boolean;
  maxWidth: number;
  borderRadius: number;
  opacity: number;
}

export interface AppPreferences {
  startWithWindows: boolean;
  startMinimized: boolean;
}

export interface CallRecord {
  id: string;
  callerNumber: string;
  callerName: string;
  timestamp: Date;
  duration: number;
  direction: 'inbound' | 'outbound';
  status: 'answered' | 'missed' | 'rejected';
}

export interface DiagnosticLog {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'success';
  category: 'SIP' | 'TOAST' | 'UPDATE' | 'SYSTEM';
  message: string;
  details?: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  lastChecked: Date | null;
  autoUpdate: boolean;
  autoDownload: boolean;
  updateChannel: 'stable' | 'beta' | 'nightly';
  updateCheckFrequency: 'off' | 'daily' | 'weekly' | 'monthly';
  githubRepo: string;
  releaseNotes: string;
  releasePageUrl: string;
  downloadProgress: number;
  isDownloading: boolean;
  isInstalling: boolean;
}

export type TabId = 'dashboard' | 'calls' | 'settings' | 'preferences' | 'toast' | 'diagnostics' | 'update' | 'about';

interface PersistedUiSettings {
  appPreferences?: Partial<AppPreferences>;
  toastDragPosition?: { x: number; y: number } | null;
  updateCheckFrequency?: 'off' | 'daily' | 'weekly' | 'monthly';
  lastCheckedAt?: string; // ISO date — Date isn't serializable through JSON
  updateChannel?: 'stable' | 'beta' | 'nightly';
  autoUpdate?: boolean;
  autoDownload?: boolean;
  toastConfig?: Partial<ToastConfig>;
  releasePageUrl?: string;
  sipConfig?: Partial<SipConfig>;
  sipPasswordEncrypted?: string;
  lastRunVersion?: string;
}

function loadPersistedUiSettings(): PersistedUiSettings {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(UI_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePersistedUiSettings(settings: PersistedUiSettings) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures in demo mode
  }
}

interface AppState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;

  sipConnected: boolean;
  sipRegistered: boolean;
  sipConfig: SipConfig;
  setSipConfig: (config: Partial<SipConfig>) => void;
  setSipConnected: (connected: boolean) => void;
  setSipRegistered: (registered: boolean) => void;
  isConnecting: boolean;
  setIsConnecting: (connecting: boolean) => void;
  connectSip: () => void;
  disconnectSip: () => void;

  toastConfig: ToastConfig;
  setToastConfig: (config: Partial<ToastConfig>) => void;

  appPreferences: AppPreferences;
  setAppPreferences: (prefs: Partial<AppPreferences>) => void;
  isMinimized: boolean;
  setIsMinimized: (minimized: boolean) => void;

  callHistory: CallRecord[];
  addCallRecord: (record: CallRecord) => void;
  clearCallHistory: () => void;

  activeToasts: CallRecord[];
  addToast: (record: CallRecord) => void;
  removeToast: (id: string) => void;

  diagnosticLogs: DiagnosticLog[];
  addDiagnosticLog: (log: Omit<DiagnosticLog, 'id' | 'timestamp'>) => void;
  clearDiagnosticLogs: () => void;

  updateInfo: UpdateInfo;
  setUpdateInfo: (info: Partial<UpdateInfo>) => void;

  toastDragPosition: { x: number; y: number } | null;
  setToastDragPosition: (pos: { x: number; y: number } | null) => void;

  clipboardText: string;
  setClipboardText: (text: string) => void;
}

const persistedUi = loadPersistedUiSettings();

const defaultSipConfig: SipConfig = {
  server: 'atlanta1.voip.ms',
  port: 5060,
  username: '',
  password: '',
  authUsername: '',
  protocol: 'UDP',
  codec: 'G.711u',
  stunServer: 'stun.l.google.com',
  registerExpiry: 300,
  ...(persistedUi.sipConfig || {}),
};

const defaultAppPreferences: AppPreferences = {
  startWithWindows: false,
  startMinimized: false,
  ...persistedUi.appPreferences,
};

// __APP_VERSION__ and __APP_REPO__ are injected by Vite at build time
// from package.json (see vite.config.ts). Using the live values means
// Sidebar / About / AutoUpdate header always show the actual running
// version, not a stale string. Persisted UI choices hydrate from
// localStorage so channel, autoUpdate, frequency, and the last-check
// timestamp all survive restarts.

// Hydrate toastConfig from localStorage so font/colors/position
// chosen by the user are restored after an app restart or update.
const defaultToastConfig: ToastConfig = {
  fontSize: 16,
  fontFamily: 'Inter',
  textColor: '#ffffff',
  backgroundColor: '#1a1a2e',
  accentColor: '#60cdff',
  duration: 8,
  position: 'top-right',
  soundEnabled: true,
  autoCopyToClipboard: true,
  showCallerName: true,
  showTimestamp: true,
  maxWidth: 420,
  borderRadius: 12,
  opacity: 95,
  ...(persistedUi.toastConfig ?? {}),
};

const defaultUpdateInfo: UpdateInfo = {
  currentVersion: __APP_VERSION__,
  latestVersion: __APP_VERSION__,
  updateAvailable: false,
  lastChecked: persistedUi.lastCheckedAt ? new Date(persistedUi.lastCheckedAt) : null,
  autoUpdate: persistedUi.autoUpdate ?? true,
  autoDownload: persistedUi.autoDownload ?? true,
  updateChannel: persistedUi.updateChannel ?? 'stable',
  updateCheckFrequency: persistedUi.updateCheckFrequency ?? 'daily',
  githubRepo: __APP_REPO__,
  releaseNotes: '',
  releasePageUrl: persistedUi.releasePageUrl ?? '',
  downloadProgress: 0,
  isDownloading: false,
  isInstalling: false,
};

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),

  sipConnected: false,
  sipRegistered: false,
  sipConfig: defaultSipConfig,
  setSipConfig: (config) => set((s) => {
    const next = { ...s.sipConfig, ...config };
    
    // Asynchronously encrypt the password and save to localStorage
    if (window.callerflash?.safeStorage?.encrypt) {
      window.callerflash.safeStorage.encrypt(next.password || '').then((encrypted) => {
        savePersistedUiSettings({
          ...loadPersistedUiSettings(),
          sipConfig: { ...next, password: '' },
          sipPasswordEncrypted: encrypted || '',
        });
      });
    } else {
      // In web dev mode, just save the password as plain text
      savePersistedUiSettings({
        ...loadPersistedUiSettings(),
        sipConfig: next,
      });
    }

    return { sipConfig: next };
  }),
  setSipConnected: (connected) => set({ sipConnected: connected }),
  setSipRegistered: (registered) => set({ sipRegistered: registered }),
  isConnecting: false,
  setIsConnecting: (connecting) => set({ isConnecting: connecting }),
  connectSip: () => {
    const s = useAppStore.getState();
    if (s.sipConnected || s.isConnecting) return;
    
    s.setIsConnecting(true);
    s.addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Initiating SIP connection…' });
    
    if (window.callerflash?.sip?.connect) {
      window.callerflash.sip.connect(s.sipConfig).then((res) => {
        if (!res.success) {
          useAppStore.setState({ isConnecting: false });
        } else {
          useAppStore.setState({ sipConnected: true });
          s.addDiagnosticLog({ level: 'success', category: 'SIP', message: 'Connection established to ' + s.sipConfig.server });
        }
      });
    } else {
      // Mock behavior for web browser dev fallback
      setTimeout(() => {
        useAppStore.setState({ sipConnected: true });
        s.addDiagnosticLog({ level: 'success', category: 'SIP', message: 'TCP connection established on port 5060' });
        
        setTimeout(() => {
          useAppStore.setState({ sipRegistered: true, isConnecting: false });
          s.addDiagnosticLog({ level: 'success', category: 'SIP', message: 'REGISTER 200 OK (expires=300s)' });
          s.addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Ready for incoming calls' });
        }, 1200);
      }, 800);
    }
  },
  disconnectSip: () => {
    const s = useAppStore.getState();
    if (!s.sipConnected) return;
    
    if (window.callerflash?.sip?.disconnect) {
      window.callerflash.sip.disconnect();
    }

    s.setSipConnected(false);
    s.setSipRegistered(false);
    s.setIsConnecting(false);
    s.addDiagnosticLog({ level: 'warning', category: 'SIP', message: 'SIP disconnected by user' });
  },

  toastConfig: defaultToastConfig,
  setToastConfig: (config) => set((s) => {
    const next = { ...s.toastConfig, ...config };
    // Persist so visual customizations survive restarts/updates.
    savePersistedUiSettings({
      ...loadPersistedUiSettings(),
      toastConfig: next,
      appPreferences: s.appPreferences,
      toastDragPosition: s.toastDragPosition,
    });
    return { toastConfig: next };
  }),

  appPreferences: defaultAppPreferences,
  setAppPreferences: (prefs) => set((s) => {
    const nextPreferences = { ...s.appPreferences, ...prefs };
    savePersistedUiSettings({
      appPreferences: nextPreferences,
      toastDragPosition: s.toastDragPosition,
    });
    return { appPreferences: nextPreferences };
  }),
  isMinimized: defaultAppPreferences.startMinimized,
  setIsMinimized: (minimized) => set({ isMinimized: minimized }),

  callHistory: [],
  addCallRecord: (record) => set((s) => ({ callHistory: [record, ...s.callHistory].slice(0, 500) })),
  clearCallHistory: () => set({ callHistory: [] }),

  activeToasts: [],
  addToast: (record) => set((s) => ({ activeToasts: [...s.activeToasts, record] })),
  removeToast: (id) => set((s) => ({ activeToasts: s.activeToasts.filter((t) => t.id !== id) })),

  diagnosticLogs: [],
  addDiagnosticLog: (log) => set((s) => {
    // Single chokepoint for sanitizing log content. Strips credentials,
    // auth headers, JWTs, and long hex blobs so they never reach disk,
    // screen-share, or exported .log files.
    const sanitized: Omit<DiagnosticLog, 'id' | 'timestamp'> = {
      ...log,
      message: redactMessage(log.message),
      details: log.details
        ? redactKeyedValue('details', redactMessage(log.details))
        : log.details,
    };
    return {
      diagnosticLogs: [
        { ...sanitized, id: crypto.randomUUID(), timestamp: new Date() },
        ...s.diagnosticLogs,
      ].slice(0, 1000),
    };
  }),
  clearDiagnosticLogs: () => set({ diagnosticLogs: [] }),

  updateInfo: defaultUpdateInfo,
  setUpdateInfo: (info) => set((s) => {
    const next = { ...s.updateInfo, ...info };
    // Persist every user-configurable field so settings survive
    // app restarts AND in-app updates. Transient fields (download
    // progress, install state, releaseNotes text) are intentionally
    // not persisted — they're rebuilt on each session.
    savePersistedUiSettings({
      ...loadPersistedUiSettings(),
      appPreferences: s.appPreferences,
      toastDragPosition: s.toastDragPosition,
      updateChannel: next.updateChannel,
      autoUpdate: next.autoUpdate,
      autoDownload: next.autoDownload,
      updateCheckFrequency: next.updateCheckFrequency,
      lastCheckedAt: next.lastChecked ? next.lastChecked.toISOString() : undefined,
      releasePageUrl: next.releasePageUrl || undefined,
    });
    return { updateInfo: next };
  }),

  toastDragPosition: persistedUi.toastDragPosition ?? null,
  setToastDragPosition: (pos) => set((s) => {
    savePersistedUiSettings({
      appPreferences: s.appPreferences,
      toastDragPosition: pos,
    });
    return { toastDragPosition: pos };
  }),

  clipboardText: '',
  setClipboardText: (text) => set({ clipboardText: text }),
}));

// Asynchronously decrypt the SIP password on app boot
if (typeof window !== 'undefined' && window.callerflash?.safeStorage?.decrypt && persistedUi.sipPasswordEncrypted) {
  window.callerflash.safeStorage.decrypt(persistedUi.sipPasswordEncrypted).then((decrypted) => {
    if (decrypted) {
      useAppStore.setState((s) => ({
        sipConfig: {
          ...s.sipConfig,
          password: decrypted,
        }
      }));
    }
  });
}
