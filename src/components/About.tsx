import {
  Phone, ExternalLink, Shield,
  Code, BookOpen, Zap, GitBranch
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

export function About() {
  const { updateInfo } = useAppStore();

  return (
    <div className="space-y-5 animate-fade-in">
      {/* App Header */}
      <div className="bg-win-surface rounded-xl border border-win-border p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-win-accent to-blue-600 flex items-center justify-center shadow-lg shadow-win-accent/20 flex-shrink-0">
            <Phone className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-win-text">CallerFlash</h2>
              <span className="px-2 py-0.5 bg-win-accent/15 text-win-accent rounded-full text-xs font-semibold">
                v{updateInfo.currentVersion}
              </span>
              <span className="px-2 py-0.5 bg-win-success/15 text-win-success rounded-full text-xs font-semibold">
                MIT
              </span>
            </div>
            <p className="text-xs text-win-text-secondary">
              SIP-compliant client with toast notifications for any standard SIP provider
            </p>
          </div>
          <a
            href={updateInfo.githubRepo}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-win-card hover:bg-win-surface-hover rounded-lg text-sm font-medium text-win-text-secondary transition-colors border border-win-border flex-shrink-0"
          >
            <GithubIcon className="w-4 h-4" />
            GitHub
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Features Grid */}
      <div>
        <h3 className="text-sm font-semibold text-win-text mb-3">Features</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <FeatureCard
            icon={<Phone className="w-4 h-4" />}
            title="Universal SIP Support"
            description="Standard SIP protocol over UDP, TCP, or TLS. Works with any compliant SIP provider."
            color="#60cdff"
          />
          <FeatureCard
            icon={<Zap className="w-4 h-4" />}
            title="Toast Notifications"
            description="Native-style toast notifications with caller ID display. Fully customizable appearance."
            color="#f59e0b"
          />
          <FeatureCard
            icon={<Shield className="w-4 h-4" />}
            title="Clipboard Auto-Copy"
            description="Automatically copies the caller number to your clipboard for instant paste anywhere."
            color="#6ccb5f"
          />
          <FeatureCard
            icon={<Code className="w-4 h-4" />}
            title="Full Customization"
            description="Customize toast font size, family, colors, duration, position, border radius, and opacity."
            color="#a78bfa"
          />
          <FeatureCard
            icon={<GitBranch className="w-4 h-4" />}
            title="Auto Update"
            description="Built-in auto-update from GitHub releases. Choose between stable, beta, or nightly channels."
            color="#34d399"
          />
          <FeatureCard
            icon={<BookOpen className="w-4 h-4" />}
            title="Full Diagnostics"
            description="SIP, toast, and system diagnostics with detailed logging, export, and real-time monitoring."
            color="#f472b6"
          />
        </div>
      </div>

      {/* Tech Stack */}
      <div className="bg-win-surface rounded-xl border border-win-border p-4">
        <h3 className="text-sm font-semibold text-win-text mb-3 flex items-center gap-2">
          <Code className="w-4 h-4 text-win-accent" />
          Technology Stack
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {[
            { name: 'Electron', desc: 'Desktop runtime' },
            { name: 'React', desc: 'UI framework' },
            { name: 'TypeScript', desc: 'Type safety' },
            { name: 'Tailwind CSS', desc: 'Styling' },
            { name: 'JsSIP / SIP.js', desc: 'SIP protocol' },
            { name: 'electron-updater', desc: 'Auto updates' },
            { name: 'node-notifier', desc: 'OS notifications' },
            { name: 'Zustand', desc: 'State management' },
          ].map((tech) => (
            <div key={tech.name} className="px-3 py-2 bg-win-card rounded-lg border border-win-border/50">
              <p className="text-xs font-medium text-win-text">{tech.name}</p>
              <p className="text-xs text-win-text-tertiary">{tech.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description, color }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <div className="bg-win-surface rounded-xl border border-win-border p-4 hover:border-win-border-light transition-colors">
      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {icon}
        </div>
        <h4 className="text-sm font-semibold text-win-text">{title}</h4>
      </div>
      <p className="text-xs text-win-text-tertiary leading-relaxed">{description}</p>
    </div>
  );
}
