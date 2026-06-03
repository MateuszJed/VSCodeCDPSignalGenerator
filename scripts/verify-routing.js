#!/usr/bin/env node
// scripts/verify-routing.js
// Bootstrap: compile extension + CLI + VSIX, then delegate to the compiled CLI.
//
// Usage:
//   node scripts/verify-routing.js <workspace-path>
//   npm run verify-routing -- /path/to/project
//   npm run verify-routing:golden

'use strict';

const path       = require('path');
const { execSync, spawnSync } = require('child_process');
const fs         = require('fs');

const EXTENSION_DIR = path.resolve(__dirname, '..');
const CLI_JS        = path.join(EXTENSION_DIR, 'out', 'routing', 'cli', 'verifyRouting.js');

const workspacePath = process.argv[2];
if (!workspacePath) {
  console.error('Usage: node scripts/verify-routing.js <workspace-path>');
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────────
// Step 1 – Compile extension + CLI + package VSIX
// The CLI in src/routing/cli/verifyRouting.ts also calls buildAll() for its
// own report's build-log, but we need the JS to exist first.
// ────────────────────────────────────────────────────────────────────────────
const steps = [
  { label: 'Compile extension (tsc)', cmd: 'npx tsc -p .', cwd: EXTENSION_DIR },
  { label: 'Compile CLI (tsc)',       cmd: 'npm run compile', cwd: path.join(EXTENSION_DIR, 'cli') },
  { label: 'Package VSIX',           cmd: 'npx @vscode/vsce package --no-dependencies --allow-missing-repository', cwd: EXTENSION_DIR },
];

let buildOk = true;
for (const step of steps) {
  console.log(`  Building: ${step.label}...`);
  try {
    execSync(step.cmd, {
      cwd: step.cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const msg = ((e.stdout || '') + '\n' + (e.stderr || '')).trim() || String(e);
    console.error(`    FAILED: ${step.label}`);
    console.error(`    ${msg.split('\n')[0]}`);
    buildOk = false;
  }
}

if (!buildOk) {
  console.error('\nBuild failed. Cannot run routing verification.');
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────────
// Step 2 – Delegate to compiled CLI (which also handles report + folder)
// Pass --no-build to skip second buildAll inside the CLI (already done above)
// ────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(CLI_JS)) {
  console.error(`Compiled CLI not found: ${CLI_JS}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [CLI_JS, workspacePath, '--no-build'],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
