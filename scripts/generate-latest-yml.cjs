#!/usr/bin/env node
/**
 * CallerFlash — Update-manifest generator.
 *
 * electron-builder's auto-generated `latest.yml` is unreliable across
 * versions (it's suppressed when `publish: null`, and on Windows the
 * path/casing can vary). This script generates the manifest deterministically
 * from the actual build artifacts in the release directory.
 *
 * Usage:
 *   node scripts/generate-latest-yml.cjs <release-dir> <version> [output-name] [channel]
 *
 * Example:
 *   node scripts/generate-latest-yml.cjs release 1.4.2-nightly.abc1234 latest.yml nightly
 *   node scripts/generate-latest-yml.cjs release 1.4.2-beta.1 beta.yml beta
 *   node scripts/generate-latest-yml.cjs release 1.5.0 latest.yml latest
 *
 * Output: JSON manifest in the same shape electron-updater reads.
 * Exit: 0 on success, 1 on error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const releaseDir = process.argv[2] || 'release';
const version = process.argv[3];
const outputName = process.argv[4] || 'latest.yml';
const channel = process.argv[5] || 'latest';

if (!version) {
  console.error('Usage: node generate-latest-yml.cjs <release-dir> <version> [output-name] [channel]');
  process.exit(1);
}

if (!fs.existsSync(releaseDir) || !fs.statSync(releaseDir).isDirectory()) {
  console.error(`Release directory not found: ${releaseDir}`);
  process.exit(1);
}

function sha512Base64(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha512').update(buf).digest('base64');
}

const files = [];
let mainExe = null;

for (const name of fs.readdirSync(releaseDir).sort()) {
  // Only consider the actual installer + its blockmap. Ignore SHA256SUMS,
  // .sig, and any pre-existing manifest files.
  if (!/\.(exe|blockmap)$/i.test(name)) continue;
  const full = path.join(releaseDir, name);
  const stat = fs.statSync(full);
  const entry = {
    url: name,
    sha512: sha512Base64(full),
    size: stat.size,
  };
  files.push(entry);
  if (name.toLowerCase().endsWith('.exe') && !name.toLowerCase().endsWith('.blockmap')) {
    mainExe = entry;
  }
}

if (!mainExe) {
  console.error(`No .exe found in ${releaseDir} — refusing to generate manifest`);
  process.exit(1);
}

const manifest = {
  version,
  files,
  path: mainExe.url,
  sha512: mainExe.sha512,
  releaseDate: new Date().toISOString(),
};

if (channel && channel !== 'latest') {
  manifest.channel = channel;
}

const outPath = path.join(releaseDir, outputName);
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`Generated ${outPath} (${files.length} files, version=${version}, channel=${channel})`);
