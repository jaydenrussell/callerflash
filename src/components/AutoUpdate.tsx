import { useState } from 'react';
import {
  Download, RefreshCw, Clock,
  Shield, GitBranch, Package, ArrowRight,
  ExternalLink, GitCommit, ChevronDown,
  Check, X as XIcon, ShieldCheck, FileLock, Key, Bell
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  verifyUpdateArtifact,
  parseGithubRelease,
  type VerificationResult,
} from '../security/updateVerifier';

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

const releaseHistory = [
  {
    version: 'v1.4.2',
    date: '2025-12-15',
    current: true,
    notes: [
      'Fixed clipboard auto-copy on Windows 11 23H2',
      'Improved toast rendering performance',
      'Added Acuity Scheduler integration hints',
    ],
  },
  {
    version: 'v1.4.1',
    date: '2025-11-28',
    current: false,
    notes: [
      'Added configurable toast border radius',
      'Fixed SIP re-registration timer',
      'Improved NAT traversal detection',
    ],
  },
  {
    version: 'v1.4.0',
    date: '2025-11-10',
    current: false,
    notes: [
      'Full toast notification customization',
      'New diagnostics panel with export',
      'Support for TLS encryption',
      'Dark mode improvements',
    ],
  },
  {
    version: 'v1.3.0',
    date: '2025-10-01',
    current: false,
    notes: [
      'Auto-update from GitHub releases',
      'Call history export to CSV',
      'Multiple SIP provider preset selection',
    ],
  },
];

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing';

export function AutoUpdate() {
  const { updateInfo, setUpdateInfo, addDiagnosticLog } = useAppStore();
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  // Local phase tracker. `idle` means no check has run this session;
  // `ready` means a verified update is downloaded and waiting for the
  // user to click "Restart to Install".
  const [phase, setPhase] = useState<UpdatePhase>('idle');

  /**
   * One-click flow: fetch metadata, run the verification pipeline, and
   * if approved, automatically download the binary. The user does NOT
   * need a separate "Download" step — when ready, they get an "Install"
   * button. Matches Discord/Slack-style UX: never silently install.
   */
  const handleCheckAndDownload = async () => {
    setPhase('checking');
    setVerification(null);
    addDiagnosticLog({
      level: 'info',
      category: 'UPDATE',
      message: 'Checking GitHub releases for updates…',
      details: `Repository: ${updateInfo.githubRepo}\nChannel: ${updateInfo.updateChannel}`,
    });

    try {
      // 1. Fetch latest matching release from GitHub.
      const repoPath = updateInfo.githubRepo.replace(/^https?:\/\/github\.com\//, '');
      const apiUrl = `https://api.github.com/repos/${repoPath}/releases?per_page=10`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      let releases: Array<{
        tag_name: string;
        published_at: string;
        prerelease: boolean;
        body: string;
        html_url: string;
        assets: Array<{ name: string; browser_download_url: string }>;
      }>;
      try {
        const response = await fetch(apiUrl, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
        releases = await response.json();
      } finally {
        clearTimeout(timeoutId);
      }

      // 2. Pick the most recent release matching the channel.
      const candidate = releases.find((r) =>
        updateInfo.updateChannel === 'stable' ? !r.prerelease : true
      );

      if (!candidate) {
        addDiagnosticLog({ level: 'success', category: 'UPDATE', message: 'No releases found for this channel.' });
        setUpdateInfo({
          updateAvailable: false,
          lastChecked: new Date(),
          latestVersion: updateInfo.currentVersion,
        });
        setPhase('idle');
        return;
      }

      const artifact = parseGithubRelease(candidate);
      if (!artifact) {
        addDiagnosticLog({
          level: 'warning',
          category: 'UPDATE',
          message: `Release ${candidate.tag_name} is missing required assets (binary, SHA256SUMS, .sig)`,
        });
        setPhase('idle');
        return;
      }

      // Stash the release URL so we can open it in the system browser.
      setUpdateInfo({ releasePageUrl: candidate.html_url });

      // 3. Run the full verification pipeline.
      addDiagnosticLog({
        level: 'info',
        category: 'UPDATE',
        message: `Verifying release v${artifact.version} against pinned public key…`,
      });
      const result = await verifyUpdateArtifact(artifact, updateInfo.updateChannel, updateInfo.currentVersion);
      setVerification(result);
      for (const step of result.steps) {
        addDiagnosticLog({
          level: step.passed ? 'success' : 'error',
          category: 'UPDATE',
          message: `Verification: ${step.name} — ${step.passed ? 'PASS' : 'FAIL'}`,
          details: step.detail,
        });
      }

      if (!result.approved) {
        addDiagnosticLog({
          level: 'error',
          category: 'UPDATE',
          message: `Update v${artifact.version} REJECTED by verification — refusing to install`,
        });
        setUpdateInfo({
          updateAvailable: false,
          lastChecked: new Date(),
          latestVersion: updateInfo.currentVersion,
        });
        setPhase('idle');
        return;
      }

      addDiagnosticLog({
        level: 'success',
        category: 'UPDATE',
        message: `Update v${artifact.version} verified — starting download`,
      });

      // 4. Auto-download. In the production Electron build this is
      //    electron-updater doing the actual file transfer + signature
      //    verification; here in the demo we simulate progress.
      setUpdateInfo({
        latestVersion: artifact.version,
        updateAvailable: true,
        lastChecked: new Date(),
        releaseNotes: artifact.notes || 'See GitHub for release notes.',
      });
      setPhase('downloading');
      setUpdateInfo({ isDownloading: true, downloadProgress: 0 });

      await new Promise<void>((resolve) => {
        let pct = 0;
        const tick = () => {
          pct = Math.min(pct + 8 + Math.random() * 12, 100);
          setUpdateInfo({ downloadProgress: pct });
          if (pct >= 100) {
            resolve();
          } else {
            setTimeout(tick, 200);
          }
        };
        setTimeout(tick, 200);
      });

      setUpdateInfo({ isDownloading: false, downloadProgress: 100 });
      setPhase('ready');
      addDiagnosticLog({
        level: 'success',
        category: 'UPDATE',
        message: `Update v${artifact.version} downloaded and verified — ready to install`,
      });

      // 5. Notify via system tray (Electron-only; no-op in web demo).
      try {
        await window.callerflash?.notify?.show?.(
          'Update ready to install',
          `v${artifact.version} is downloaded. Click "Restart to Install" to apply.`
        );
      } catch {
        // Ignore — web demo has no notification backend.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      addDiagnosticLog({ level: 'error', category: 'UPDATE', message: `Update check failed: ${message}` });
      setPhase('idle');
    }
  };

  /**
   * Apply the downloaded update. In the production Electron build this
   * calls electron-updater's `quitAndInstall()` (which restarts the
   * app to apply the patch). In the demo we simulate.
   */
  const handleInstall = () => {
    setPhase('installing');
    setUpdateInfo({ isInstalling: true });
    addDiagnosticLog({
      level: 'info',
      category: 'UPDATE',
      message: `Installing update v${updateInfo.latestVersion}…`,
    });

    setTimeout(() => {
      setUpdateInfo({
        isInstalling: false,
        currentVersion: updateInfo.latestVersion,
        updateAvailable: false,
        downloadProgress: 0,
      });
      setPhase('idle');
      addDiagnosticLog({
        level: 'success',
        category: 'UPDATE',
        message: `Update installed successfully! Now running v${updateInfo.latestVersion}`,
      });
    }, 1500);
  };

  const openReleasePage = () => {
    const url = updateInfo.releasePageUrl || `${updateInfo.githubRepo}/releases`;
    if (window.callerflash?.shell?.openExternal) {
      window.callerflash.shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const isBusy = phase === 'checking' || phase === 'downloading' || phase === 'installing';

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-win-text">Updates</h2>
          <p className="text-xs text-win-text-secondary mt-1">
            Check for new releases and install them when you're ready
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openReleasePage}
            className="flex items-center gap-2 px-3.5 py-2 bg-win-surface hover:bg-win-surface-hover text-win-text-secondary rounded-lg text-sm transition-colors border border-win-border"
          >
            <GithubIcon className="w-4 h-4" />
            View releases
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Current Version Card */}
      <div className="bg-win-surface rounded-xl border border-win-border p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-win-accent/20 to-blue-600/20 flex items-center justify-center border border-win-accent/20">
              <Package className="w-7 h-7 text-win-accent" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-win-text">CallerFlash</h3>
                <span className="px-2 py-0.5 bg-win-accent/15 text-win-accent rounded-full text-xs font-semibold">
                  v{updateInfo.currentVersion}
                </span>
              </div>
              <p className="text-xs text-win-text-secondary mt-0.5">
                {phase === 'ready'
                  ? `Update v${updateInfo.latestVersion} ready to install`
                  : updateInfo.updateAvailable
                  ? `Update available: v${updateInfo.latestVersion}`
                  : 'You are running the latest version'}
              </p>
              {updateInfo.lastChecked && (
                <p className="text-xs text-win-text-tertiary mt-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Last checked: {updateInfo.lastChecked.toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Main action button — changes based on phase. */}
            {phase === 'ready' ? (
              <button
                onClick={handleInstall}
                disabled={isBusy}
                className="flex items-center gap-2 px-4 py-2 bg-win-success hover:bg-win-success/85 text-black rounded-lg text-sm font-semibold transition-colors border border-win-success/30 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Restart to Install
              </button>
            ) : (
              <button
                onClick={handleCheckAndDownload}
                disabled={isBusy}
                className="flex items-center gap-2 px-4 py-2 bg-win-accent hover:bg-win-accent-hover text-black rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${phase === 'checking' || phase === 'downloading' ? 'animate-spin' : ''}`} />
                {phase === 'checking' ? 'Checking…'
                  : phase === 'downloading' ? 'Downloading…'
                  : phase === 'installing' ? 'Installing…'
                  : 'Check for Updates'}
              </button>
            )}
          </div>
        </div>

        {/* Ready-to-install banner with bell + tray notification hint */}
        {phase === 'ready' && (
          <div className="mt-5 pt-5 border-t border-win-border">
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-win-success/10 border border-win-success/20">
              <div className="w-9 h-9 rounded-lg bg-win-success/20 flex items-center justify-center flex-shrink-0">
                <Bell className="w-4 h-4 text-win-success" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-win-success">Update ready</p>
                <p className="text-xs text-win-text-secondary leading-relaxed mt-0.5">
                  v{updateInfo.latestVersion} was downloaded and verified. A tray notification was sent.
                  Click <span className="font-semibold">Restart to Install</span> to apply it now, or do it later —
                  the app never updates silently in the background.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Verification Audit Panel */}
        {verification && (
          <div className={`mt-5 pt-5 border-t border-win-border`}>
            <div className="flex items-center gap-2 mb-3">
              {verification.approved ? (
                <ShieldCheck className="w-4 h-4 text-win-success" />
              ) : (
                <XIcon className="w-4 h-4 text-win-error" />
              )}
              <h3 className="text-sm font-semibold text-win-text">
                Verification {verification.approved ? 'Passed' : 'Failed'}
              </h3>
            </div>
            <div className="space-y-1.5">
              {verification.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-win-card border border-win-border/50">
                  {step.passed ? (
                    <Check className="w-3.5 h-3.5 text-win-success flex-shrink-0 mt-0.5" />
                  ) : (
                    <XIcon className="w-3.5 h-3.5 text-win-error flex-shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-win-text">{step.name}</p>
                    <p className="text-xs text-win-text-tertiary">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Download Progress */}
        {(phase === 'downloading' || phase === 'installing') && (
          <div className="mt-5 pt-5 border-t border-win-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-win-text">
                {phase === 'installing' ? 'Installing update…' : 'Downloading update…'}
              </p>
              <span className="text-sm font-bold text-win-accent">
                {Math.round(updateInfo.downloadProgress)}%
              </span>
            </div>
            <div className="h-2 bg-win-card rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-win-accent to-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${updateInfo.downloadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Release Notes */}
        {updateInfo.updateAvailable && updateInfo.releaseNotes && phase !== 'downloading' && phase !== 'installing' && (
          <div className="mt-5 pt-5 border-t border-win-border">
            <button
              onClick={() => setShowReleaseNotes(!showReleaseNotes)}
              className="flex items-center gap-2 text-sm font-medium text-win-text-secondary hover:text-win-text transition-colors"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showReleaseNotes ? 'rotate-180' : ''}`} />
              Release Notes for v{updateInfo.latestVersion}
            </button>
            {showReleaseNotes && (
              <pre className="mt-3 text-xs text-win-text-secondary bg-win-card rounded-lg p-3 border border-win-border/50 whitespace-pre-wrap">
                {updateInfo.releaseNotes}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-win-surface rounded-xl border border-win-border p-5">
          <h3 className="text-sm font-semibold text-win-text mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-win-accent" />
            Update Settings
          </h3>
          <div className="space-y-3">
            <div
              className="flex items-center justify-between p-3 rounded-lg bg-win-card border border-win-border/50 hover:border-win-border cursor-pointer transition-colors"
              onClick={() => setUpdateInfo({ autoUpdate: !updateInfo.autoUpdate })}
            >
              <div>
                <p className="text-sm font-medium text-win-text">Notify on update available</p>
                <p className="text-xs text-win-text-tertiary">Tray notification + in-app banner when a new version is verified. Never installs silently.</p>
              </div>
              <div className={`w-10 h-[22px] rounded-full transition-colors relative ${
                updateInfo.autoUpdate ? 'bg-win-accent' : 'bg-win-border'
              }`}>
                <div className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  updateInfo.autoUpdate ? 'translate-x-[21px]' : 'translate-x-[3px]'
                }`} />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-win-card border border-win-border/50">
              <p className="text-xs font-medium text-win-text-secondary mb-2">Update Channel</p>
              <div className="flex gap-2">
                {['stable', 'beta', 'nightly'].map((channel) => (
                  <button
                    key={channel}
                    onClick={() => setUpdateInfo({ updateChannel: channel as any })}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      updateInfo.updateChannel === channel
                        ? 'bg-win-accent/20 text-win-accent border border-win-accent/30'
                        : 'bg-win-surface text-win-text-secondary hover:bg-win-surface-hover border border-win-border'
                    }`}
                  >
                    <GitBranch className="w-3 h-3 mx-auto mb-1" />
                    {channel.charAt(0).toUpperCase() + channel.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-win-card border border-win-border/50">
              <p className="text-xs font-medium text-win-text-secondary mb-2">GitHub Repository</p>
              <div className="flex items-center gap-2">
                <GithubIcon className="w-4 h-4 text-win-text-tertiary" />
                <code className="text-xs text-win-accent flex-1 truncate">
                  {updateInfo.githubRepo}
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="bg-win-surface rounded-xl border border-win-border p-5">
          <h3 className="text-sm font-semibold text-win-text mb-4 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-win-success" />
            Update Security
          </h3>
          <div className="space-y-3">
            <SecurityRow
              icon={<FileLock className="w-4 h-4 text-win-accent" />}
              title="Authenticode Code Signing"
              status="Required at install time by Windows SmartScreen"
            />
            <SecurityRow
              icon={<ShieldCheck className="w-4 h-4 text-win-success" />}
              title="SHA-256 Checksum"
              status="Verified against SHA256SUMS attached to each release"
            />
            <SecurityRow
              icon={<Key className="w-4 h-4 text-win-warning" />}
              title="Ed25519 Detached Signature"
              status="Pinned public key embedded in app binary"
            />
            <SecurityRow
              icon={<Shield className="w-4 h-4 text-win-accent" />}
              title="HTTPS + Host Allow-list"
              status="github.com, api.github.com, objects.githubusercontent.com"
            />
            <SecurityRow
              icon={<Shield className="w-4 h-4 text-win-accent" />}
              title="Version Monotonicity"
              status="Refuses to install a release older than current"
            />
            <details className="text-xs text-win-text-tertiary group">
              <summary className="cursor-pointer hover:text-win-text-secondary select-none">
                How to verify a release manually
              </summary>
              <pre className="mt-2 p-3 bg-win-card rounded-lg border border-win-border/50 overflow-x-auto leading-relaxed">{`# 1. Download the .sig and SHA256SUMS from the GitHub release
curl -LO https://github.com/.../CallerFlash-Setup-1.5.0.exe.sig
curl -LO https://github.com/.../SHA256SUMS

# 2. Verify the detached signature against the pinned key
openssl pkeyutl -verify -rawin -pubin \\
  -inkey <(echo $CALLERFLASH_RELEASE_PUB | base64 -d) \\
  -in SHA256SUMS \\
  -sigfile CallerFlash-Setup-1.5.0.exe.sig

# 3. Verify the SHA-256 matches what you downloaded
sha256sum -c SHA256SUMS --ignore-missing`}</pre>
            </details>
          </div>
        </div>

        {/* Release History */}
        <div className="bg-win-surface rounded-xl border border-win-border p-5">
          <h3 className="text-sm font-semibold text-win-text mb-4 flex items-center gap-2">
            <GitCommit className="w-4 h-4 text-win-accent" />
            Release History
          </h3>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {releaseHistory.map((release) => (
              <div
                key={release.version}
                className={`p-3 rounded-lg border transition-colors ${
                  release.current
                    ? 'bg-win-accent/5 border-win-accent/20'
                    : 'bg-win-card border-win-border/50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-win-text">{release.version}</span>
                    {release.current && (
                      <span className="px-1.5 py-0.5 bg-win-accent/15 text-win-accent rounded text-xs font-semibold">
                        CURRENT
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-win-text-tertiary">{release.date}</span>
                </div>
                <ul className="space-y-1">
                  {release.notes.map((note, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-win-text-secondary">
                      <ArrowRight className="w-3 h-3 text-win-text-tertiary mt-0.5 flex-shrink-0" />
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SecurityRow({
  icon,
  title,
  status,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-win-card border border-win-border/50">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-win-text">{title}</p>
        <p className="text-xs text-win-text-tertiary">{status}</p>
      </div>
    </div>
  );
}
