# Contributing to CallerFlash

Thanks for contributing! Please read this before opening a PR.

## Development

```bash
# Clone
git clone https://github.com/callerflash/callerflash-sip-client.git
cd callerflash-sip-client

# Install
npm install

# Dev server (hot reload)
npm run dev

# Build production bundle
npm run build

# Build Windows 64-bit installer (requires local Node 20 + Windows)
npm run electron:build
```

## Branch Workflow

| Branch | Purpose |
|--------|---------|
| `main` / `nightly` | Bleeding-edge dev — PRs land here first |
| `beta` | Feature-freeze — bug fixes only |
| `stable` | Production — tagged releases |

See [`docs/BRANCHES.md`](docs/BRANCHES.md) for the full branching strategy.

## PR Checklist

- [ ] `npm run build` passes locally
- [ ] All diagnostic log calls use the sanitized `addDiagnosticLog` (no raw credential logging)
- [ ] Any new dependency is pinned to an exact version in `package.json`
- [ ] The PR targets the `main` branch (not `stable` or `beta`)

## Security

If you discover a vulnerability, **do not open a public issue.** Email `security@callerflash.app` or use GitHub's [private vulnerability reporting](../../security/advisories/new).

See [`SECURITY.md`](SECURITY.md) for the full threat model and cryptographic verification procedures.
