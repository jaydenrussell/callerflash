import {
  LayoutDashboard, Phone, Settings, Bell, Activity,
  RefreshCw, Info, Wifi, WifiOff
} from 'lucide-react';
import { useAppStore, type TabId } from '../store/useAppStore';
import { cn } from '../utils/cn';

const navItems: { id: TabId; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'calls', label: 'Call History', icon: Phone },
  { id: 'settings', label: 'SIP Settings', icon: Settings },
  { id: 'toast', label: 'Toast Config', icon: Bell },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { id: 'update', label: 'Updates', icon: RefreshCw },
  { id: 'about', label: 'About', icon: Info },
];

interface SidebarProps {
  collapsed: boolean;
}

export function Sidebar({ collapsed }: SidebarProps) {
  const { activeTab, setActiveTab, sipConnected, sipRegistered } = useAppStore();

  if (collapsed) {
    return (
      <div className="w-14 min-w-14 bg-win-card border-r border-win-border flex flex-col h-full">
        {/* Compact App Header */}
        <div className="px-3 py-4 border-b border-win-border flex justify-center">
          <div
            className="w-8 h-8 rounded-lg bg-gradient-to-br from-win-accent to-blue-600 flex items-center justify-center shadow-lg"
            title="CallerFlash"
          >
            <Phone className="w-4 h-4 text-white" />
          </div>
        </div>

        {/* Compact Status */}
        <div className="px-3 py-3 border-b border-win-border flex justify-center">
          <div
            className={cn(
              'w-2.5 h-2.5 rounded-full',
              sipConnected && sipRegistered ? 'bg-win-success' :
                sipConnected ? 'bg-win-warning' : 'bg-win-error'
            )}
            title={sipConnected && sipRegistered ? 'Registered' : sipConnected ? 'Connecting' : 'Offline'}
          />
        </div>

        {/* Icon-only Nav */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={item.label}
                className={cn(
                  'w-full flex items-center justify-center px-2 py-2.5 rounded-lg transition-all duration-150',
                  isActive
                    ? 'bg-win-accent/15 text-win-accent border border-win-accent/20'
                    : 'text-win-text-secondary hover:bg-win-surface-hover hover:text-win-text border border-transparent'
                )}
              >
                <Icon className="w-[18px] h-[18px]" />
              </button>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div className="w-56 min-w-56 bg-win-card border-r border-win-border flex flex-col h-full">
      {/* App Header */}
      <div className="p-4 border-b border-win-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-win-accent to-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
            <Phone className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-win-text tracking-tight truncate">CallerFlash</h1>
            <p className="text-xs text-win-text-secondary truncate">SIP Client</p>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="px-3 py-3 border-b border-win-border">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-win-surface">
          {sipConnected ? (
            <Wifi className="w-4 h-4 text-win-success flex-shrink-0" />
          ) : (
            <WifiOff className="w-4 h-4 text-win-error flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-win-text truncate">
              {sipConnected ? 'Connected' : 'Disconnected'}
            </p>
            <p className="text-xs text-win-text-tertiary truncate">
              {sipRegistered ? 'Registered' : sipConnected ? 'Registering...' : 'Offline'}
            </p>
          </div>
          <div className={cn(
            'w-2.5 h-2.5 rounded-full flex-shrink-0',
            sipConnected && sipRegistered ? 'bg-win-success' :
              sipConnected ? 'bg-win-warning' : 'bg-win-error'
          )} />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-win-accent/15 text-win-accent border border-win-accent/20'
                  : 'text-win-text-secondary hover:bg-win-surface-hover hover:text-win-text border border-transparent'
              )}
            >
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Version */}
      <div className="p-3 border-t border-win-border">
        <p className="text-xs text-win-text-tertiary text-center truncate">
          v1.4.2 • MIT
        </p>
        <p className="text-xs text-win-text-tertiary text-center mt-0.5 truncate">
          Open Source on GitHub
        </p>
      </div>
    </div>
  );
}
