import { useState } from 'react';
import {
  Server, Lock, Globe, Headphones, Save, RotateCcw,
  ChevronDown, Shield, Wifi, Eye, EyeOff, Power,
  Minimize2, AppWindow, ShieldCheck
} from 'lucide-react';
import { useAppStore, type SipConfig } from '../store/useAppStore';
import { sanitizeSipServer } from '../security/secretRedactor';

interface ProviderOption {
  value: string;
  label: string;
}

interface ProviderGroup {
  label: string;
  options: ProviderOption[];
}

const sipProviders: ProviderGroup[] = [
  {
    label: 'Custom',
    options: [
      { value: '__custom__', label: 'Custom SIP Server…' },
    ],
  },
  {
    label: 'VoIP.ms',
    options: [
      { value: 'atlanta1.voip.ms', label: 'Atlanta 1 (atlanta1.voip.ms)' },
      { value: 'atlanta2.voip.ms', label: 'Atlanta 2 (atlanta2.voip.ms)' },
      { value: 'chicago1.voip.ms', label: 'Chicago 1 (chicago1.voip.ms)' },
      { value: 'chicago2.voip.ms', label: 'Chicago 2 (chicago2.voip.ms)' },
      { value: 'dallas1.voip.ms', label: 'Dallas 1 (dallas1.voip.ms)' },
      { value: 'dallas2.voip.ms', label: 'Dallas 2 (dallas2.voip.ms)' },
      { value: 'denver1.voip.ms', label: 'Denver (denver1.voip.ms)' },
      { value: 'houston1.voip.ms', label: 'Houston (houston1.voip.ms)' },
      { value: 'losangeles1.voip.ms', label: 'Los Angeles (losangeles1.voip.ms)' },
      { value: 'montreal1.voip.ms', label: 'Montreal 1 (montreal1.voip.ms)' },
      { value: 'montreal2.voip.ms', label: 'Montreal 2 (montreal2.voip.ms)' },
      { value: 'newyork1.voip.ms', label: 'New York 1 (newyork1.voip.ms)' },
      { value: 'newyork2.voip.ms', label: 'New York 2 (newyork2.voip.ms)' },
      { value: 'seattle1.voip.ms', label: 'Seattle (seattle1.voip.ms)' },
      { value: 'toronto1.voip.ms', label: 'Toronto 1 (toronto1.voip.ms)' },
      { value: 'toronto2.voip.ms', label: 'Toronto 2 (toronto2.voip.ms)' },
      { value: 'vancouver1.voip.ms', label: 'Vancouver (vancouver1.voip.ms)' },
    ],
  },
  {
    label: 'Twilio',
    options: [
      { value: 'sip.twilio.com', label: 'Twilio Global (sip.twilio.com)' },
    ],
  },
  {
    label: 'Telnyx',
    options: [
      { value: 'sip.telnyx.com', label: 'Telnyx Global (sip.telnyx.com)' },
    ],
  },
  {
    label: 'Bandwidth',
    options: [
      { value: 'gw.bandwidth.com', label: 'Bandwidth Gateway (gw.bandwidth.com)' },
    ],
  },
  {
    label: 'Vonage / Nexmo',
    options: [
      { value: 'sip.nexmo.com', label: 'Vonage / Nexmo (sip.nexmo.com)' },
    ],
  },
  {
    label: 'Plivo',
    options: [
      { value: 'phone.plivo.com', label: 'Plivo (phone.plivo.com)' },
    ],
  },
  {
    label: 'Flowroute',
    options: [
      { value: 'sip.flowroute.com', label: 'Flowroute (sip.flowroute.com)' },
    ],
  },
  {
    label: 'Anveo',
    options: [
      { value: 'sip.anveo.com', label: 'Anveo (sip.anveo.com)' },
    ],
  },
  {
    label: 'CallCentric',
    options: [
      { value: 'callcentric.com', label: 'CallCentric (callcentric.com)' },
    ],
  },
  {
    label: 'Sipgate',
    options: [
      { value: 'sipgate.com', label: 'Sipgate (sipgate.com)' },
      { value: 'sipgate.co.uk', label: 'Sipgate UK (sipgate.co.uk)' },
    ],
  },
  {
    label: 'OnSIP',
    options: [
      { value: 'sip.onsip.com', label: 'OnSIP (sip.onsip.com)' },
    ],
  },
  {
    label: '8x8',
    options: [
      { value: 'sip.8x8.com', label: '8x8 (sip.8x8.com)' },
    ],
  },
  {
    label: 'RingCentral',
    options: [
      { value: 'sip.ringcentral.com', label: 'RingCentral (sip.ringcentral.com)' },
    ],
  },
];

// Flat list of all known server values for membership checking
const knownServerValues = new Set(
  sipProviders.flatMap((g) => g.options.map((o) => o.value)).filter((v) => v !== '__custom__')
);

const codecs = ['G.711u', 'G.711a', 'G.729', 'GSM', 'iLBC', 'Opus', 'Speex'];

export function SipSettings() {
  const {
    sipConfig,
    setSipConfig,
    addDiagnosticLog,
    appPreferences,
    setAppPreferences,
  } = useAppStore();
  const [localConfig, setLocalConfig] = useState<SipConfig>({ ...sipConfig });
  const [showPassword, setShowPassword] = useState(false);
  const [saved, setSaved] = useState(false);

  // Custom mode is on if the current server isn't in the known list
  const isCustomServer = !knownServerValues.has(localConfig.server);
  const [customMode, setCustomMode] = useState(isCustomServer);

  const updateLocal = (updates: Partial<SipConfig>) => {
    setLocalConfig((prev) => ({ ...prev, ...updates }));
  };

  const handleServerSelect = (value: string) => {
    if (value === '__custom__') {
      setCustomMode(true);
      updateLocal({ server: '' });
    } else {
      setCustomMode(false);
      updateLocal({ server: value });
    }
  };

  const handleSave = () => {
    setSipConfig(localConfig);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    addDiagnosticLog({
      level: 'success',
      category: 'SIP',
      message: 'SIP configuration saved',
      details: `Server: ${localConfig.server}:${localConfig.port}, Protocol: ${localConfig.protocol}`,
    });
  };

  const handleReset = () => {
    const defaults: SipConfig = {
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
    setLocalConfig(defaults);
    setCustomMode(false);
    addDiagnosticLog({
      level: 'info',
      category: 'SIP',
      message: 'SIP configuration reset to defaults',
    });
  };

  const dropdownValue = customMode ? '__custom__' : localConfig.server;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-win-text">SIP Settings</h2>
          <p className="text-xs text-win-text-secondary mt-1">
            Configure your SIP provider connection parameters
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-3.5 py-2 bg-win-surface hover:bg-win-surface-hover text-win-text-secondary rounded-lg text-sm font-medium transition-colors border border-win-border"
          >
            <RotateCcw className="w-4 h-4" />
            Reset Defaults
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-win-accent hover:bg-win-accent-hover text-black rounded-lg text-sm font-semibold transition-colors"
          >
            <Save className="w-4 h-4" />
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Server Configuration */}
        <SettingsSection
          icon={<Server className="w-4 h-4" />}
          title="Server Configuration"
          description="SIP server address and connection settings"
        >
          <div className="space-y-4">
            <InputField label="SIP Provider">
              <div className="relative">
                <select
                  value={dropdownValue}
                  onChange={(e) => handleServerSelect(e.target.value)}
                  className="w-full px-3 py-2 bg-win-card border border-win-border rounded-lg text-sm text-win-text focus:outline-none focus:border-win-accent transition-colors appearance-none pr-10"
                >
                  {sipProviders.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-win-text-tertiary pointer-events-none" />
              </div>
            </InputField>

            <InputField
              label="SIP Server Address"
              hint={customMode ? 'enter any host or IP' : 'editable — type to override'}
            >
              <input
                type="text"
                value={localConfig.server}
                onChange={(e) => {
                  const safe = sanitizeSipServer(e.target.value);
                  // If sanitization rejected the input, keep the previous value
                  // and surface a warning instead of silently dropping it.
                  if (e.target.value.trim() && !safe) {
                    addDiagnosticLog({
                      level: 'warning',
                      category: 'SIP',
                      message: 'Rejected SIP server input — contains path, userinfo, or whitespace',
                    });
                    return;
                  }
                  updateLocal({ server: safe });
                  setCustomMode(!knownServerValues.has(safe));
                }}
                placeholder="sip.example.com"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="w-full px-3 py-2 bg-win-card border border-win-border rounded-lg text-sm text-win-text font-mono placeholder:text-win-text-tertiary focus:outline-none focus:border-win-accent transition-colors"
              />
            </InputField>

            <div className="grid grid-cols-2 gap-3">
              <InputField label="Port">
                <input
                  type="number"
                  value={localConfig.port}
                  onChange={(e) => updateLocal({ port: parseInt(e.target.value) || 5060 })}
                  className="w-full px-3 py-2 bg-win-card border border-win-border rounded-lg text-sm text-win-text focus:outline-none focus:border-win-accent transition-colors"
                />
              </InputField>
              <InputField label="Protocol">
                <div className="relative">
                  <select
                    value={localConfig.protocol}
                    onChange={(e) => updateLocal({ protocol: e.target.value as any })}
                    className="w-full px-3 py-2 bg-win-card border border-win-border rounded-lg text-sm text-win-text focus:outline-none focus:border-win-accent transition-colors appearance-none pr-10"
                  >
                    <option value="UDP">UDP</option>
                    <option value="TCP">TCP</option>
                    <option value="TLS">TLS (Encrypted)</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-win-text-tertiary pointer-events-none" />
                </div>
              </InputField>
            </div>

            <InputField label="Registration Expiry" hint="seconds">
              <input
                type="number"
                min={30}
                max={3600}
                value={localConfig.registerExpiry}
                onChange={(e) => updateLocal({ registerExpiry: parseInt(e.target.value) || 300 })}
                className="w-full px-3 py-2 bg-win-card border border-win-border rounded-lg text-sm text-win-text focus:outline-none focus:border-win-accent transition-colors"
              />
            </InputField>

            <div className="flex items-start gap-2 rounded-lg border border-win-success/20 bg-win-success/8 px-3 py-2">
              <ShieldCheck className="w-3.5 h-3.5 text-win-success flex-shrink-0 mt-0.5" />
              <p className="text-xs text-win-text-secondary leading-relaxed">
                Server inputs are sanitized — paths, credentials in the URI,
                and whitespace are stripped. Passwords are encrypted at rest
                (Windows DPAPI via Electron safeStorage in production).
              </p>
            </div>
          </div>
        </SettingsSection>

        {/* Authentication */}
        <SettingsSection
          icon={<Lock className="w-4 h-4" />}
          title="Authentication"
          description="SIP account credentials"
        >
          <div className="space-y-4">
            <InputField label="SIP Username" hint="account or sub-account ID">
              <input
                type="text"
                value={localConfig.username}
                onChange={(e) => updateLocal({ username: e.target.value })}
                placeholder="username"
                className="w-full px-3 py-2 bg-win-card border border-win-border rounded-lg text-sm text-win-text placeholder:text-win-text-tertiary focus:outline-none focus:border-win-accent transition-colors"
              />
            </InputField>

            <InputField label="Auth Username" hint="usually the same as SIP Username">
              <input
                type="text"
                value={localConfig.authUsername}
                onChange={(e) => updateLocal({ authUsername: e.target.value })}
                placeholder="username"
                className="w-full px-3 py-2 bg-win-card border border-win-border rounded-lg text-sm text-win-text placeholder:text-win-text-tertiary focus:outline-none focus:border-win-accent transition-colors"
              />
            </InputField>

            <InputField label="SIP Password">
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={localConfig.password}
                  onChange={(e) => updateLocal({ password: e.target.value })}
                  placeholder="••••••••"
                  name="sip-password"
                  autoComplete="off"
                  spellCheck={false}
                  data-private="true"
                  className="w-full px-3 py-2 pr-10 bg-win-card border border-win-border rounded-lg text-sm text-win-text placeholder:text-win-text-tertiary focus:outline-none focus:border-win-accent transition-colors"
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-win-text-tertiary hover:text-win-text transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </InputField>
          </div>
        </SettingsSection>

        {/* Audio / Codec */}
        <SettingsSection
          icon={<Headphones className="w-4 h-4" />}
          title="Audio & Codec"
          description="Preferred audio codec for calls"
        >
          <div className="space-y-4">
            <InputField label="Preferred Codec">
              <div className="relative">
                <select
                  value={localConfig.codec}
                  onChange={(e) => updateLocal({ codec: e.target.value })}
                  className="w-full px-3 py-2 bg-win-card border border-win-border rounded-lg text-sm text-win-text focus:outline-none focus:border-win-accent transition-colors appearance-none pr-10"
                >
                  {codecs.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-win-text-tertiary pointer-events-none" />
              </div>
            </InputField>
            <div className="bg-win-card rounded-lg p-3 border border-win-border/50">
              <p className="text-xs text-win-text-secondary mb-2">Codec Information</p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-win-text-tertiary">Bandwidth</span>
                  <span className="text-win-text-secondary">64 kbps</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-win-text-tertiary">Quality</span>
                  <span className="text-win-success">Excellent</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-win-text-tertiary">Latency</span>
                  <span className="text-win-text-secondary">~20ms</span>
                </div>
              </div>
            </div>
          </div>
        </SettingsSection>

        {/* NAT / STUN */}
        <SettingsSection
          icon={<Globe className="w-4 h-4" />}
          title="NAT Traversal"
          description="STUN server for NAT detection"
        >
          <div className="space-y-4">
            <InputField label="STUN Server">
              <input
                type="text"
                value={localConfig.stunServer}
                onChange={(e) => updateLocal({ stunServer: e.target.value })}
                placeholder="stun.l.google.com"
                className="w-full px-3 py-2 bg-win-card border border-win-border rounded-lg text-sm text-win-text font-mono placeholder:text-win-text-tertiary focus:outline-none focus:border-win-accent transition-colors"
              />
            </InputField>

            <div className="bg-win-card rounded-lg p-3 border border-win-border/50">
              <p className="text-xs text-win-text-secondary mb-2">NAT Status</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <Shield className="w-3 h-3 text-win-success" />
                  <span className="text-win-text-secondary">Symmetric NAT detected</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Wifi className="w-3 h-3 text-win-success" />
                  <span className="text-win-text-secondary">STUN binding successful</span>
                </div>
                <div className="flex justify-between text-xs mt-2">
                  <span className="text-win-text-tertiary">Public IP</span>
                  <span className="text-win-text-secondary font-mono">203.0.113.x</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-win-text-tertiary">Mapped Port</span>
                  <span className="text-win-text-secondary font-mono">5060</span>
                </div>
              </div>
            </div>
          </div>
        </SettingsSection>

        {/* Startup & Background */}
        <SettingsSection
          icon={<Power className="w-4 h-4" />}
          title="Startup & Background"
          description="Launch behavior and minimized background listener options"
        >
          <div className="space-y-3">
            <ToggleRow
              icon={<AppWindow className="w-4 h-4" />}
              label="Start with Windows"
              description="Register CallerFlash to launch automatically when Windows starts."
              value={appPreferences.startWithWindows}
              onToggle={() => {
                const next = !appPreferences.startWithWindows;
                setAppPreferences({ startWithWindows: next });
                addDiagnosticLog({
                  level: 'info',
                  category: 'SYSTEM',
                  message: next ? 'Start with Windows enabled' : 'Start with Windows disabled',
                });
              }}
            />
            <ToggleRow
              icon={<Minimize2 className="w-4 h-4" />}
              label="Start Minimized"
              description="Open directly into background mode on launch while still monitoring SIP calls."
              value={appPreferences.startMinimized}
              onToggle={() => {
                const next = !appPreferences.startMinimized;
                setAppPreferences({ startMinimized: next });
                addDiagnosticLog({
                  level: 'info',
                  category: 'SYSTEM',
                  message: next ? 'Start minimized enabled for next launch' : 'Start minimized disabled',
                });
              }}
            />

            <div className="rounded-lg border border-win-success/20 bg-win-success/8 p-3">
              <p className="text-xs font-semibold text-win-success">Background call listener stays active</p>
              <p className="mt-1 text-xs text-win-text-secondary leading-relaxed">
                When the app is minimized, SIP registration and incoming-call toast detection continue running.
                New calls still trigger toast notifications and clipboard auto-copy.
              </p>
            </div>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

function SettingsSection({ icon, title, description, children }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-win-surface rounded-xl border border-win-border p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-win-accent">{icon}</span>
        <h3 className="text-sm font-semibold text-win-text">{title}</h3>
      </div>
      <p className="text-xs text-win-text-tertiary mb-3">{description}</p>
      {children}
    </div>
  );
}

function InputField({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-win-text-secondary mb-1.5">
        {label}
        {hint && <span className="text-win-text-tertiary ml-1 font-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  value,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-lg border border-win-border/50 bg-win-card p-3 text-left transition-colors hover:border-win-border hover:bg-win-surface-hover"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-win-accent flex-shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-win-text">{label}</p>
          <p className="text-xs text-win-text-tertiary">{description}</p>
        </div>
      </div>
      <div className={`relative h-[22px] w-10 rounded-full transition-colors flex-shrink-0 ml-3 ${value ? 'bg-win-accent' : 'bg-win-border'}`}>
        <div className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
      </div>
    </button>
  );
}
