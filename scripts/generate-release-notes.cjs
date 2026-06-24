#!/usr/bin/env node
/**
 * CallerFlash — Release notes generator.
 *
 * Reads commits since the previous tag of the given channel, classifies
 * each by Conventional Commit prefix (feat/fix/refactor/...), and emits
 * a clean changelog in the order:
 *
 *   ⚠️ Breaking Changes  →  Added  →  Enhanced  →  Changed
 *   →  Fixed  →  Performance  →  Documentation  →  Maintenance
 *
 * Usage:
 *   node scripts/generate-release-notes.cjs <channel> <version> <output>
 *   node scripts/generate-release-notes.cjs stable 1.5.0 release-notes.md
 *
 * The workflow calls this with the channel + resolved version from the
 * route job, then attaches the output as the GitHub Release body.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

const channel = (process.argv[2] || 'stable').toLowerCase();
const version = process.argv[3] || '0.0.0';
const outFile = process.argv[4] || 'release-notes.md';

// Conventional-commit prefix → display category
const CATEGORY = {
  feat:  'Added',
  'feat!':  'Breaking',
  enhance: 'Enhanced',
  fix:   'Fixed',
  perf:  'Performance',
  refactor: 'Changed',
  docs:  'Documentation',
  style: 'Changed',
  test:  'Testing',
  build: 'Build',
  ci:    'Build',
  chore: 'Maintenance',
  revert: 'Reverted',
};

const DISPLAY_ORDER = [
  'Breaking', 'Added', 'Enhanced', 'Changed',
  'Fixed', 'Performance', 'Documentation',
  'Maintenance', 'Testing', 'Build', 'Reverted',
];

const BREAKING_RE = /^BREAKING[ -]CHANGE:\s*(.+)$/im;

function git(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** Find the last tag of the given channel, or any tag as a fallback. */
function getLastTag(ch) {
  const tags = git("git tag --list 'v*' --sort=-version:refname")
    .split('\n').filter(Boolean);
  if (tags.length === 0) return null;
  if (ch === 'nightly') return tags.find((t) => t.includes('-nightly.')) || tags[0];
  if (ch === 'beta')     return tags.find((t) => t.includes('-beta.')) || tags[0];
  // stable
  return tags.find((t) => !t.includes('-nightly.') && !t.includes('-beta.')) || tags[0];
}

function getCommitsSince(ref, max = 25) {
  const range = ref ? `${ref}..HEAD` : `HEAD~${max}`;
  const format = '%H%n%s%n%b%n__END__';
  const out = git(`git log ${range} --pretty=format:'${format}' --no-merges -n ${max}`);
  if (!out) return [];
  return out.split('__END__\n').filter(Boolean).map((block) => {
    const [hash, subject, ...bodyLines] = block.split('\n');
    return {
      hash: (hash || '').slice(0, 7),
      subject: (subject || '').trim(),
      body: bodyLines.join('\n').trim(),
    };
  });
}

function categorize(commit) {
  // Match Conventional Commits: type(scope)?!: subject
  const m = commit.subject.match(/^([a-zA-Z][a-zA-Z0-9]*)(?:\([^)]*\))?(!?):\s+(.+)$/);
  if (m) {
    const [, type, bang, desc] = m;
    const key = bang ? `${type}!` : type;
    const category = CATEGORY[key] || CATEGORY[type] || 'Changed';
    return { category, description: desc.trim() };
  }
  return { category: 'Changed', description: commit.subject };
}

function render(commits, ver, ch) {
  const grouped = new Map();
  const breaking = [];

  for (const c of commits) {
    if (!c.subject) continue;
    const { category, description } = categorize(c);
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push({ hash: c.hash, description });

    const m = c.body && c.body.match(BREAKING_RE);
    if (m) breaking.push({ hash: c.hash, text: m[1].trim() });
  }

  const lines = [];
  lines.push(`**Channel:** \`${ch}\`  ·  **Date:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  if (breaking.length > 0) {
    lines.push('## ⚠️  Breaking Changes');
    lines.push('');
    for (const b of breaking) lines.push(`- ${b.text} (\`${b.hash}\`)`);
    lines.push('');
  }

  const ordered = [...grouped.keys()].sort(
    (a, b) => {
      const ai = DISPLAY_ORDER.indexOf(a);
      const bi = DISPLAY_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }
  );

  for (const cat of ordered) {
    if (cat === 'Breaking') continue;
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;
    lines.push(`## ${cat}`);
    lines.push('');
    for (const item of items) {
      const desc = item.description.replace(/\.\s*$/, '');
      lines.push(`- ${desc} (\`${item.hash}\`)`);
    }
    lines.push('');
  }

  if (commits.length === 0 || grouped.size === 0) {
    lines.push('_No user-visible changes since the previous release of this channel._');
    lines.push('');
  }

  return lines.join('\n');
}

const sinceTag = getLastTag(channel);
// Cap to 25 — beyond that the release notes become a wall of text.
// Encourage writing Conventional Commits so the categories are useful.
const MAX_COMMITS = 25;
const commits = sinceTag
  ? getCommitsSince(sinceTag, MAX_COMMITS)
  : getCommitsSince(null, MAX_COMMITS);
const md = render(commits, version, channel);

// Append a "Full changelog" link pointing at the compare view so readers
// can drill into older commits without us dumping them all into the body.
let compareUrl = '';
try {
  const remote = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
  // Normalize ssh:// or git@github.com: → https://github.com/
  const https = remote
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '');
  if (sinceTag && https) compareUrl = `${https}/compare/${sinceTag}...HEAD`;
} catch { /* no remote configured locally */ }

const footer = compareUrl ? `\n---\n\n[Full changelog](${compareUrl})\n` : '';
const output = md + footer;

if (outFile === '-') {
  process.stdout.write(output);
} else {
  fs.writeFileSync(outFile, output);
  process.stderr.write(
    `[generate-release-notes] channel=${channel} version=${version} since=${sinceTag || '(none)'} commits=${commits.length}\n`
  );
}
