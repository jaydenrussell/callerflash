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
  updateChannel: 'stable' | 'beta' | 'nightly';
  githubRepo: string;
  releaseNotes: string;
  downloadProgress: number;
  isDownloading: boolean;
  isInstalling: boolean;
}

export type TabId = 'dashboard' | 'calls' | 'settings' | 'toast' | 'diagnostics' | 'update' | 'about';

interface PersistedUiSettings {
  appPreferences?: Partial<AppPreferences>;
  toastDragPosition?: { x: number; y: number } | null;
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
};

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
};

const defaultAppPreferences: AppPreferences = {
  startWithWindows: false,
  startMinimized: false,
  ...persistedUi.appPreferences,
};

const defaultUpdateInfo: UpdateInfo = {
  currentVersion: '1.4.2',
  latestVersion: '1.4.2',
  updateAvailable: false,
  lastChecked: null,
  autoUpdate: true,
  updateChannel: 'stable',
  githubRepo: 'https://github.com/callerflash/callerflash-sip-client',
  releaseNotes: '',
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
  setSipConfig: (config) => set((s) => ({ sipConfig: { ...s.sipConfig, ...config } })),
  setSipConnected: (connected) => set({ sipConnected: connected }),
  setSipRegistered: (registered) => set({ sipRegistered: registered }),

  toastConfig: defaultToastConfig,
  setToastConfig: (config) => set((s) => ({ toastConfig: { ...s.toastConfig, ...config } })),

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
  setUpdateInfo: (info) => set((s) => ({ updateInfo: { ...s.updateInfo, ...info } })),

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
