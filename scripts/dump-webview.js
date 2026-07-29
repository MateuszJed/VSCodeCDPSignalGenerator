#!/usr/bin/env node
/**
 * dump-webview.js
 *
 * Builds a DiagramScope for a target XML file (with project index if available)
 * and prints the complete block-diagram webview HTML to stdout.
 *
 * Usage:
 *   node scripts/dump-webview.js <xmlFilePath>
 *
 * Requires the extension to be compiled (out/).
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const [, , xmlFile] = process.argv;
if (!xmlFile) {
  console.error('Usage: node dump-webview.js <xmlFile>');
  process.exit(1);
}

const extDir = path.join(__dirname, '..');

// Stub out 'vscode' before requiring any extension code that imports it
const Module = require('module');
const origLoad = Module._load;
Module._load = function(req, parent, isMain) {
  if (req === 'vscode') { return { window: {}, commands: {}, workspace: {}, EventEmitter: function(){} }; }
  return origLoad.call(this, req, parent, isMain);
};

const { buildDiagramScope }    = require(path.join(extDir, 'out/routing/core/diagramBuilder'));
const { CdpProjectIndexer }    = require(path.join(extDir, 'out/routing/core/cdpProjectIndexer'));
const { BlockDiagramPanel }    = require(path.join(extDir, 'out/routing/vscode/blockDiagramPanel'));

async function main() {
  const indexer = new CdpProjectIndexer();
  // Walk up from the XML file to find the project root (heuristic: contains systems/ dir)
  let rootDir = path.dirname(xmlFile);
  for (let i = 0; i < 8; i++) {
    const parent = path.dirname(rootDir);
    if (parent === rootDir) { break; }
    const systemsDir = path.join(parent, 'systems');
    if (fs.existsSync(systemsDir) && fs.statSync(systemsDir).isDirectory()) {
      rootDir = parent; break;
    }
    rootDir = parent;
  }
  let index = null;
  try { index = await indexer.buildIndex([rootDir]); } catch(e) { /* use null index */ }

  const text  = fs.readFileSync(xmlFile, 'utf8');
  const scope = buildDiagramScope(xmlFile, text, index);
  const panel = Object.create(BlockDiagramPanel.prototype);
  const html  = panel.buildHtml(scope);
  process.stdout.write(html);
  process.stderr.write('dump-webview: ' + scope.scopePath + '  nodes=' + scope.nodes.length + '  edges=' + scope.edges.length + '\n');
}

main().catch(e => { process.stderr.write('dump-webview error: ' + e.message + '\n'); process.exit(1); });
