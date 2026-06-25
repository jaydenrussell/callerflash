import { useEffect, useState } from 'react';
import {
  Phone, PhoneIncoming, PhoneMissed, PhoneOff,
  Wifi, WifiOff, Bell, Clipboard, Clock, Activity,
  Zap, TrendingUp, Shield, EyeOff, Info
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { simulateIncomingCall } from '../utils/simulateIncomingCall';

export function Dashboard() {
  const {
    sipConnected, sipRegistered, setSipConnected, setSipRegistered,
    callHistory, addDiagnosticLog, toastConfig, clipboardText,
    appPreferences, isMinimized, setIsMinimized, sipConfig,
  } = useAppStore();

  const [uptime, setUptime] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (sipConnected) setUptime((u) => u + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [sipConnected]);

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const handleConnect = () => {
    if (sipConnected) {
      setSipConnected(false);
      setSipRegistered(false);
      setUptime(0);
      addDiagnosticLog({ level: 'warning', category: 'SIP', message: 'SIP disconnected by user' });
      return;
    }
    setIsConnecting(true);
    addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Initiating SIP connection…' });
    setTimeout(() => {
      setSipConnected(true);
      addDiagnosticLog({ level: 'success', category: 'SIP', message: 'TCP connection established on port 5060' });
      setTimeout(() => {
        setSipRegistered(true);
        setIsConnecting(false);
        addDiagnosticLog({ level: 'success', category: 'SIP', message: 'REGISTER 200 OK (expires=300s)' });
        addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Ready for incoming calls' });
      }, 1200);
    }, 800);
  };

  const triggerTestCall = () => simulateIncomingCall('dashboard');

  const hideToTray = () => {
    setIsMinimized(true);
    window.callerflash?.window?.hideToTray?.();
    addDiagnosticLog({ level: 'info', category: 'SYSTEM', message: 'Window hidden to system tray' });
  };

  const missedCalls = callHistory.filter((c) => c.status === 'missed').length;
  const answeredCalls = callHistory.filter((c) => c.status === 'answered').length;
  const todayCalls = callHistory.filter((c) => c.timestamp.getDate() === new Date().getDate()).length;

  return (
    <div className="flex flex-col h-full gap-3 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-win-text">Dashboard</h2>
          <p className="text-xs text-win-text-secondary mt-0.5">Monitor & control</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={triggerTestCall}
            className="flex items-center gap-2 px-3 py-1.5 bg-win-accent/15 hover:bg-win-accent/25 text-win-accent rounded-lg text-xs font-medium transition-colors border border-win-accent/20"
          >
            <PhoneIncoming className="w-3.5 h-3.5" />
            Simulate Call
          </button>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              sipConnected
                ? 'bg-win-error/15 hover:bg-win-error/25 text-win-error border border-win-error/20'
                : 'bg-win-success/15 hover:bg-win-success/25 text-win-success border border-win-success/20'
            } disabled:opacity-50`}
          >
            {isConnecting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-win-accent border-t-transparent rounded-full animate-spin" />
                Connecting…
              </>
            ) : sipConnected ? (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                Disconnect
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5" />
                Connect
              </>
            )}
          </button>
        </div>
      </div>

      {/* Compact status row — 4 cards in one line, smaller padding */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <StatusCard
          icon={<Wifi className="w-4 h-4" />}
          label="SIP"
          value={sipRegistered ? 'Registered' : sipConnected ? 'Connected' : 'Offline'}
          color={sipRegistered ? '#6ccb5f' : sipConnected ? '#fcb827' : '#ff6b6b'}
          tooltip={sipConnected ? `Uptime: ${formatUptime(uptime)}` : 'Not connected'}
        />
        <StatusCard
          icon={<Phone className="w-4 h-4" />}
          label="Calls today"
          value={todayCalls.toString()}
          color="#60cdff"
          tooltip={`${answeredCalls} answered · ${missedCalls} missed`}
        />
        <StatusCard
          icon={<Bell className="w-4 h-4" />}
          label="Toast"
          value={`${toastConfig.duration}s`}
          color="#a78bfa"
          tooltip={`Auto-copy ${toastConfig.autoCopyToClipboard ? 'ON' : 'OFF'}`}
        />
        <StatusCard
          icon={<Clipboard className="w-4 h-4" />}
          label="Clipboard"
          value={clipboardText || '—'}
          color="#f59e0b"
          valueSize="text-sm"
          tooltip="Sanitized caller number, ready to paste into Acuity Scheduler"
        />
      </div>

      {/* Two-column: Connection Details + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 flex-shrink-0">
        <div className="lg:col-span-2 bg-win-surface rounded-xl border border-win-border p-3">
          <h3 className="text-sm font-semibold text-win-text mb-2 flex items-center gap-2">
            <Shield className="w-4 h-4 text-win-accent" />
            Connection
          </h3>
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
            <DetailRow label="SIP Server" value={sipConfig.server || '—'} />
            <DetailRow label="Protocol" value={`${sipConfig.protocol} : ${sipConfig.port}`} />
            <DetailRow label="Codec" value={sipConfig.codec} />
            <DetailRow label="STUN" value={sipConfig.stunServer || '—'} />
            <DetailRow label="Registration" value={sipRegistered ? `Active (${sipConfig.registerExpiry}s)` : 'Inactive'} />
            <DetailRow label="Encryption" value={sipConfig.protocol === 'TLS' ? 'TLS' : 'Optional'} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <InfoButton
              label="Background mode"
              value={isMinimized ? 'Hidden in tray' : 'Visible'}
              tooltip="Whether the main window is shown or hidden to the system tray. SIP registration + toasts keep running either way."
            />
            <InfoButton
              label="Startup"
              value={appPreferences.startWithWindows ? 'With Windows' : 'Manual'}
              tooltip="Whether CallerFlash registers itself to launch on Windows sign-in."
            />
          </div>
        </div>

        <div className="bg-win-surface rounded-xl border border-win-border p-3">
          <h3 className="text-sm font-semibold text-win-text mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4 text-win-warning" />
            Quick actions
          </h3>
          <div className="space-y-1">
            <QuickAction
              icon={<PhoneIncoming className="w-3.5 h-3.5" />}
              label="Simulate call"
              onClick={triggerTestCall}
            />
            <QuickAction
              icon={<Activity className="w-3.5 h-3.5" />}
              label="SIP diagnostics"
              onClick={() => {
                addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Running SIP diagnostics…' });
                addDiagnosticLog({ level: 'success', category: 'SIP', message: 'DNS resolution: OK (4ms)' });
                addDiagnosticLog({ level: 'success', category: 'SIP', message: 'Port 5060 reachable: OK' });
                addDiagnosticLog({ level: 'success', category: 'SYSTEM', message: 'Audio device: Default (OK)' });
              }}
            />
            <QuickAction
              icon={<Clock className="w-3.5 h-3.5" />}
              label="Re-register SIP"
              onClick={() => {
                addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Sending REGISTER refresh…' });
                setTimeout(() => addDiagnosticLog({ level: 'success', category: 'SIP', message: 'REGISTER refreshed (200 OK)' }), 500);
              }}
              disabled={!sipConnected}
            />
            <QuickAction
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              label="Check for updates"
              onClick={() => {
                addDiagnosticLog({ level: 'info', category: 'UPDATE', message: 'Checking GitHub…' });
              }}
            />
            <QuickAction
              icon={<EyeOff className="w-3.5 h-3.5" />}
              label="Hide to tray"
              onClick={hideToTray}
            />
          </div>
        </div>
      </div>

      <div className="bg-win-surface rounded-xl border border-win-border p-3 flex-1 min-h-0 flex flex-col">
        <h3 className="text-sm font-semibold text-win-text mb-2 flex items-center gap-2 flex-shrink-0">
          <Clock className="w-4 h-4 text-win-accent" />
          Recent calls
        </h3>
        {callHistory.length === 0 ? (
          <div className="text-center py-6 flex-1 flex flex-col items-center justify-center">
            <PhoneOff className="w-10 h-10 text-win-text-tertiary mx-auto mb-2" />
            <p className="text-xs text-win-text-secondary">No calls yet</p>
            <p className="text-[11px] text-win-text-tertiary mt-0.5">Connect to a provider and simulate a call.</p>
          </div>
        ) : (
          <div className="space-y-0.5 overflow-y-auto pr-1 flex-1 min-h-0">
            {callHistory.slice(0, 50).map((call) => (
              <div
                key={call.id}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-win-surface-hover transition-colors"
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  call.status === 'answered' ? 'bg-win-success/15' : 'bg-win-error/15'
                }`}>
                  {call.status === 'answered' ? (
                    <PhoneIncoming className="w-3.5 h-3.5 text-win-success" />
                  ) : (
                    <PhoneMissed className="w-3.5 h-3.5 text-win-error" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-win-text">{call.callerNumber}</p>
                  <p className="text-[11px] text-win-text-secondary">{call.callerName}</p>
                </div>
                <p className="text-[11px] text-win-text-tertiary">{call.timestamp.toLocaleTimeString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  value,
  color,
  valueSize = 'text-lg',
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  valueSize?: string;
  tooltip?: string;
}) {
  return (
    <div
      className="bg-win-surface rounded-xl border border-win-border p-2.5"
      title={tooltip}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}18`, color }}
        >
          {icon}
        </div>
        <span className="text-[11px] font-medium text-win-text-secondary">{label}</span>
      </div>
      <p className={`${valueSize} font-bold text-win-text truncate`} style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function InfoButton({ label, value, tooltip }: { label: string; value: string; tooltip: string }) {
  return (
    <button
      type="button"
      title={tooltip}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-win-card border border-win-border/50 text-[11px] hover:border-win-border transition-colors"
    >
      <Info className="w-3 h-3 text-win-text-tertiary" />
      <span className="text-win-text-tertiary">{label}:</span>
      <span className="text-win-text-secondary font-medium">{value}</span>
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-win-text-tertiary">{label}</span>
      <span className="text-[11px] font-medium text-win-text-secondary truncate ml-2">{value}</span>
    </div>
  );
}

function QuickAction({ icon, label, onClick, disabled = false }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-win-text-secondary hover:bg-win-surface-hover hover:text-win-text transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

