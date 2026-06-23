# CallerFlash

**SIP client with toast notifications — works with any standard SIP provider.**

[![CI](https://github.com/jaydenrussell/callerflash/actions/workflows/ci.yml/badge.svg)](https://github.com/jaydenrussell/callerflash/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jaydenrussell/callerflash?include_prereleases&label=latest)](https://github.com/jaydenrussell/callerflash/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## Features

- **Universal SIP Support** — Standard SIP protocol over UDP, TCP, or TLS
- **Toast Notifications** — Native Windows 11-style notifications with caller ID, fully customizable
- **Clipboard Auto-Copy** — Automatically copies caller number for instant paste into Acuity Scheduler
- **Full Diagnostics** — SIP, toast, and system logging with export
- **Auto Update** — GitHub-based update channels (stable, beta, nightly) with SHA-256 + Ed25519 verification
- **Start Minimized** — Background mode monitors calls while the window stays hidden

## Download

Get the latest installer from the **[Releases](https://github.com/jaydenrussell/callerflash/releases)** page.

| Channel | Description |
|---------|-------------|
| **Stable** | Production-ready, 7-day soak before release |
| **Beta** | Feature preview, pre-release |
| **Nightly** | Bleeding edge, built from every push to `main` |

## Development

```bash
git clone https://github.com/jaydenrussell/callerflash.git
cd callerflash
npm install
npm run dev        # Start dev server
npm run build      # Production build
npm run electron:build  # Package Windows 64-bit .exe
```

Requires **Node.js ≥ 24** and **Windows** for packaging.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch strategy and PR guidelines.

## Security

See [SECURITY.md](SECURITY.md) for the full threat model, update verification procedures, and vulnerability reporting.

## License

[MIT](LICENSE) — Free and open source.
