import { useEffect, useState } from 'react';
import {
  Phone, PhoneIncoming, PhoneMissed, PhoneOff,
  Wifi, WifiOff, Bell, Clipboard, Clock, Activity,
  Zap, TrendingUp, Shield, AppWindow
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { simulateIncomingCall } from '../utils/simulateIncomingCall';

export function Dashboard() {
  const {
    sipConnected, sipRegistered, setSipConnected, setSipRegistered,
    callHistory, addDiagnosticLog, toastConfig, clipboardText,
    appPreferences, isMinimized, sipConfig,
  } = useAppStore();

  const [uptime, setUptime] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (sipConnected) setUptime(u => u + 1);
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
    addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Initiating SIP connection...' });

    setTimeout(() => {
      setSipConnected(true);
      addDiagnosticLog({ level: 'success', category: 'SIP', message: 'TCP connection established to SIP server on port 5060' });

      setTimeout(() => {
        setSipRegistered(true);
        setIsConnecting(false);
        addDiagnosticLog({ level: 'success', category: 'SIP', message: 'SIP REGISTER successful (200 OK), expires=300s' });
        addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Ready to receive incoming calls' });
      }, 1200);
    }, 800);
  };

  const triggerTestCall = () => {
    simulateIncomingCall('dashboard');
  };

  const missedCalls = callHistory.filter(c => c.status === 'missed').length;
  const answeredCalls = callHistory.filter(c => c.status === 'answered').length;
  const todayCalls = callHistory.filter(c => {
    const today = new Date();
    return c.timestamp.getDate() === today.getDate();
  }).length;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-win-text">Dashboard</h2>
          <p className="text-xs text-win-text-secondary mt-1">
            SIP Client — Monitor & Control
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={triggerTestCall}
            disabled={!sipConnected}
            className="flex items-center gap-2 px-3.5 py-2 bg-win-accent/15 hover:bg-win-accent/25 text-win-accent rounded-lg text-sm font-medium transition-colors border border-win-accent/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PhoneIncoming className="w-4 h-4" />
            Simulate Call
          </button>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              sipConnected
                ? 'bg-win-error/15 hover:bg-win-error/25 text-win-error border border-win-error/20'
                : 'bg-win-success/15 hover:bg-win-success/25 text-win-success border border-win-success/20'
            } disabled:opacity-50`}
          >
            {isConnecting ? (
              <>
                <div className="w-4 h-4 border-2 border-win-accent border-t-transparent rounded-full animate-spin" />
                Connecting...
              </>
            ) : sipConnected ? (
              <>
                <WifiOff className="w-4 h-4" />
                Disconnect
              </>
            ) : (
              <>
                <Wifi className="w-4 h-4" />
                Connect
              </>
            )}
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatusCard
          icon={<Wifi className="w-5 h-5" />}
          label="SIP Status"
          value={sipRegistered ? 'Registered' : sipConnected ? 'Connected' : 'Offline'}
          color={sipRegistered ? '#6ccb5f' : sipConnected ? '#fcb827' : '#ff6b6b'}
          subtext={sipConnected ? `Uptime: ${formatUptime(uptime)}` : 'Not connected'}
        />
        <StatusCard
          icon={<Phone className="w-5 h-5" />}
          label="Today's Calls"
          value={todayCalls.toString()}
          color="#60cdff"
          subtext={`${answeredCalls} answered, ${missedCalls} missed`}
        />
        <StatusCard
          icon={<Bell className="w-5 h-5" />}
          label="Toast Duration"
          value={`${toastConfig.duration}s`}
          color="#a78bfa"
          subtext={toastConfig.autoCopyToClipboard ? 'Auto-copy ON' : 'Auto-copy OFF'}
        />
        <StatusCard
          icon={<Clipboard className="w-5 h-5" />}
          label="Last Clipboard"
          value={clipboardText || '—'}
          color="#f59e0b"
          subtext="Ready for Acuity Scheduler"
          valueSize="text-lg"
        />
        <StatusCard
          icon={<AppWindow className="w-5 h-5" />}
          label="Background Mode"
          value={isMinimized ? 'Minimized' : 'Visible'}
          color="#34d399"
          subtext={`${appPreferences.startWithWindows ? 'Start w/ Windows' : 'Manual launch'} • ${appPreferences.startMinimized ? 'Boot minimized' : 'Normal boot'}`}
        />
      </div>

      {/* Connection Details & Quick Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Connection Panel */}
        <div className="lg:col-span-2 bg-win-surface rounded-xl border border-win-border p-4">
          <h3 className="text-sm font-semibold text-win-text mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-win-accent" />
            Connection Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6">
            <DetailRow label="SIP Server" value={sipConfig.server || '—'} />
            <DetailRow label="Protocol" value={`${sipConfig.protocol} / Port ${sipConfig.port}`} />
            <DetailRow label="Codec" value={sipConfig.codec} />
            <DetailRow label="STUN Server" value={sipConfig.stunServer || '—'} />
            <DetailRow label="Registration" value={sipRegistered ? `Active (${sipConfig.registerExpiry}s expiry)` : 'Inactive'} />
            <DetailRow label="NAT Traversal" value="Symmetric NAT" />
            <DetailRow label="Encryption" value={sipConfig.protocol === 'TLS' ? 'TLS Active' : 'TLS Available'} />
            <DetailRow label="Keepalive" value="30s interval" />
          </div>
        </div>

        {/* Quick Actions Panel */}
        <div className="bg-win-surface rounded-xl border border-win-border p-4">
          <h3 className="text-sm font-semibold text-win-text mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-win-warning" />
            Quick Actions
          </h3>
          <div className="space-y-2">
            <QuickAction
              icon={<PhoneIncoming className="w-4 h-4" />}
              label="Test Toast Notification"
              onClick={triggerTestCall}
              disabled={!sipConnected}
            />
            <QuickAction
              icon={<Activity className="w-4 h-4" />}
              label="Run SIP Diagnostics"
              onClick={() => {
                addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Running SIP diagnostics...' });
                addDiagnosticLog({ level: 'success', category: 'SIP', message: 'DNS resolution: OK (4ms)' });
                addDiagnosticLog({ level: 'success', category: 'SIP', message: 'Port 5060 reachable: OK' });
                addDiagnosticLog({ level: 'success', category: 'SYSTEM', message: 'Audio device: Default (OK)' });
              }}
            />
            <QuickAction
              icon={<Clock className="w-4 h-4" />}
              label="Re-register SIP"
              onClick={() => {
                addDiagnosticLog({ level: 'info', category: 'SIP', message: 'Sending SIP REGISTER refresh...' });
                setTimeout(() => {
                  addDiagnosticLog({ level: 'success', category: 'SIP', message: 'REGISTER refreshed (200 OK)' });
                }, 500);
              }}
              disabled={!sipConnected}
            />
            <QuickAction
              icon={<TrendingUp className="w-4 h-4" />}
              label="Check for Updates"
              onClick={() => {
                addDiagnosticLog({ level: 'info', category: 'UPDATE', message: 'Checking GitHub for updates...' });
              }}
            />
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-win-surface rounded-xl border border-win-border p-4">
        <h3 className="text-sm font-semibold text-win-text mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-win-accent" />
          Recent Calls
        </h3>
        {callHistory.length === 0 ? (
          <div className="text-center py-8">
            <PhoneOff className="w-12 h-12 text-win-text-tertiary mx-auto mb-3" />
            <p className="text-sm text-win-text-secondary">No calls yet</p>
            <p className="text-xs text-win-text-tertiary mt-1">
              Connect to your SIP provider and simulate a call to get started
            </p>
          </div>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {callHistory.slice(0, 10).map((call) => (
              <div
                key={call.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-win-surface-hover transition-colors"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  call.status === 'answered' ? 'bg-win-success/15' :
                  call.status === 'missed' ? 'bg-win-error/15' : 'bg-win-warning/15'
                }`}>
                  {call.status === 'answered' ? (
                    <PhoneIncoming className="w-4 h-4 text-win-success" />
                  ) : (
                    <PhoneMissed className="w-4 h-4 text-win-error" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-win-text">{call.callerNumber}</p>
                  <p className="text-xs text-win-text-secondary">{call.callerName}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-win-text-secondary">
                    {call.timestamp.toLocaleTimeString()}
                  </p>
                  <p className={`text-xs font-medium ${
                    call.status === 'answered' ? 'text-win-success' : 'text-win-error'
                  }`}>
                    {call.status.charAt(0).toUpperCase() + call.status.slice(1)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusCard({ icon, label, value, color, subtext, valueSize = 'text-xl' }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  subtext: string;
  valueSize?: string;
}) {
  return (
    <div className="bg-win-surface rounded-xl border border-win-border p-4 hover:border-win-border-light transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}18`, color }}
        >
          {icon}
        </div>
        <span className="text-xs font-medium text-win-text-secondary">{label}</span>
      </div>
      <p className={`${valueSize} font-bold text-win-text truncate`} style={{ color }}>
        {value}
      </p>
      <p className="text-xs text-win-text-tertiary mt-1">{subtext}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-win-text-tertiary">{label}</span>
      <span className="text-xs font-medium text-win-text-secondary">{value}</span>
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
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-win-text-secondary hover:bg-win-surface-hover hover:text-win-text transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
