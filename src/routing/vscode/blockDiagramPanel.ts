/**
 * blockDiagramPanel.ts (vscode)
 *
 * VS Code WebView panel for the CDP XML Block Diagram Viewer.
 *
 * Phase 1: Read-only viewer.
 *   - Parses the active XML document live.
 *   - Shows same-level components as blocks with input/output pins.
 *   - Draws straight edges for internal routing connections.
 *   - Shows external routing values as labels next to pins.
 *   - Click on a block/pin navigates to the XML source location.
 *
 * Phase 2 (future): Modifier — graphical routing editing.
 */

import * as vscode from "vscode";
import * as path from "path";
import { CdpProjectIndex } from "../core/types";
import { buildDiagramScope } from "../core/diagramBuilder";
import { DiagramScope, DiagramNode, DiagramPin } from "../core/diagramModel";

// Message types sent from WebView → extension
interface WebViewMessage {
  type: "revealXml" | "openFile";
  filePath: string;
  line: number;
  character: number;
}

export class BlockDiagramPanel {
  static readonly viewType = "cdp.blockDiagram";
  private static instance: BlockDiagramPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private currentFilePath: string | undefined;
  private getIndex: () => CdpProjectIndex | null;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(
    context: vscode.ExtensionContext,
    getIndex: () => CdpProjectIndex | null
  ): void {
    if (BlockDiagramPanel.instance) {
      BlockDiagramPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      BlockDiagramPanel.instance.getIndex = getIndex;
      BlockDiagramPanel.instance.refreshFromActiveEditor();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      BlockDiagramPanel.viewType,
      "CDP Block Diagram",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );

    BlockDiagramPanel.instance = new BlockDiagramPanel(panel, context, getIndex);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    _context: vscode.ExtensionContext,
    getIndex: () => CdpProjectIndex | null
  ) {
    this.panel = panel;
    this.getIndex = getIndex;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Messages from the WebView
    this.panel.webview.onDidReceiveMessage(
      (msg: WebViewMessage) => {
        if (msg.type === "revealXml") {
          const uri = vscode.Uri.file(msg.filePath);
          const pos = new vscode.Position(msg.line, msg.character);
          vscode.window.showTextDocument(uri, {
            viewColumn: vscode.ViewColumn.One,
            selection: new vscode.Range(pos, pos),
            preserveFocus: false,
          });
        } else if (msg.type === "openFile") {
          vscode.window.showTextDocument(vscode.Uri.file(msg.filePath), {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
          });
        }
      },
      null,
      this.disposables
    );

    // Auto-refresh when the active editor changes to an XML file
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor?.document.fileName.endsWith(".xml")) {
          this.refreshFromDocument(editor.document);
        }
      },
      null,
      this.disposables
    );

    // Live refresh on text change (debounced)
    let liveTimer: ReturnType<typeof setTimeout> | undefined;
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (
          event.document.fileName.endsWith(".xml") &&
          event.document.uri.fsPath === this.currentFilePath
        ) {
          if (liveTimer) { clearTimeout(liveTimer); }
          liveTimer = setTimeout(() => this.refreshFromDocument(event.document), 300);
        }
      },
      null,
      this.disposables
    );

    this.refreshFromActiveEditor();
  }

  /** Refresh from whichever XML editor is currently active. */
  refreshFromActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.fileName.endsWith(".xml")) {
      this.refreshFromDocument(editor.document);
    } else {
      this.panel.webview.html = this.buildEmptyHtml(
        "Open an XML file to see the block diagram."
      );
    }
  }

  /** Rebuild diagram from the given document. */
  refreshFromDocument(document: vscode.TextDocument): void {
    this.currentFilePath = document.uri.fsPath;
    const index = this.getIndex();
    try {
      const scope = buildDiagramScope(document.uri.fsPath, document.getText(), index);
      this.panel.title = `CDP Diagram: ${scope.label}`;
      this.panel.webview.html = this.buildHtml(scope);
    } catch (err) {
      this.panel.webview.html = this.buildEmptyHtml(`Error building diagram: ${err}`);
    }
  }

  private dispose(): void {
    BlockDiagramPanel.instance = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
  }

  // ────────────────────────────────────────────────────────────────────────────
  // HTML generation
  // ────────────────────────────────────────────────────────────────────────────

  private buildEmptyHtml(message: string): string {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2em;color:#ccc;background:#1e1e1e">
      <p>${escapeHtml(message)}</p></body></html>`;
  }

  private buildHtml(scope: DiagramScope): string {
    const rawJson = JSON.stringify(scope);
    const safeJson = rawJson
      .replace(/&/g, '\\u0026')
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>CDP Block Diagram</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background:#1e1e1e; color:#d4d4d4; font-family:'Segoe UI',Tahoma,sans-serif; font-size:12px; overflow:hidden; }
#toolbar {
  display:flex; align-items:center; gap:6px; padding:4px 10px;
  background:#252526; border-bottom:1px solid #3c3c3c; height:32px; flex-shrink:0;
}
#toolbar button {
  background:#0e639c; color:#fff; border:none; border-radius:3px;
  padding:2px 10px; cursor:pointer; font-size:11px; height:22px;
}
#toolbar button:hover { background:#1177bb; }
#btn-dbg { background:#3d3d3d !important; }
#btn-dbg:hover { background:#505050 !important; }
#scope-label { flex:1; color:#9cdcfe; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-left:4px; }
#canvas-container {
  position:relative; width:100%; height:calc(100vh - 32px);
  overflow:hidden; cursor:grab; background:#1e1e1e;
}
#canvas-container.grabbing { cursor:grabbing; }
#diagram-root { position:absolute; top:0; left:0; transform-origin:top left; }
svg#edges-layer { position:absolute; top:0; left:0; pointer-events:none; overflow:visible; }

/* ── Node base ────────────────────────────────────────────────────────── */
.node {
  position:absolute; border:1px solid #444; border-radius:5px;
  background:#252526; display:flex; flex-direction:column;
  box-shadow:0 2px 8px rgba(0,0,0,.55);
}
.node:hover { border-color:#4fc3f7; z-index:10; }

/* ── Scope-boundary port block ───────────────────────────────────────── */
.node.port-block { border-color:#7a52c0; border-width:2px; }
.node.port-block:hover { border-color:#b180ff; }

/* ── Model/library block ─────────────────────────────────────────────── */
.node.model-library { border-color:#5a6f8f; }
.node.model-library .node-header { background:#2b3038; border-bottom-color:#5a6f8f; }
.node.model-library .node-header:hover { background:#333b46; }
.node.model-library .node-name { color:#c5e478; }
.node.model-library .node-type { color:#9fb7d7; }

/* ── Operator block ──────────────────────────────────────────────────── */
.node.operator { border-color:#8a7350; }
.node.operator .node-header { background:#332d24; border-bottom-color:#8a7350; }
.node.operator .node-header:hover { background:#3d3428; }
.node.operator .node-name { color:#d7ba7d; }

/* ── Node header ─────────────────────────────────────────────────────── */
.node-header {
  background:#2d2d30; border-bottom:1px solid #444; border-radius:5px 5px 0 0;
  padding:5px 9px; cursor:pointer; flex-shrink:0; min-height:38px;
}
.node.port-block .node-header { background:#2a1f3d; border-bottom-color:#7a52c0; }
.node-header:hover { background:#3a3d41; }
.node.port-block .node-header:hover { background:#362a4f; }
.node-name { font-weight:600; color:#c5e478; font-size:12px; white-space:normal; word-break:break-word; line-height:1.3; }
.node.port-block .node-name { color:#d7b6ff; }
.node-type { font-size:9px; color:#888; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.node.port-block .node-type { color:#a080c0; }

/* ── Node body and pin columns ───────────────────────────────────────── */
.node-body { display:flex; flex:1; }
.pins-col { display:flex; flex-direction:column; padding:3px 0; }
.pins-col.inputs  { border-right:1px solid #3c3c3c; }

/* ── Pin rows ─────────────────────────────────────────────────────────── */
.pin {
  position:relative; padding:2px 7px; min-height:22px;
  display:flex; align-items:flex-start; gap:4px;
  cursor:pointer;
}
.pin:hover { background:#2a2d2e; }
.inputs .pin  { flex-direction:row; }
.outputs .pin { flex-direction:row-reverse; text-align:right; }

.pin-dot {
  width:9px; height:9px; border-radius:50%; border:1px solid #555;
  flex-shrink:0; margin-top:5px;
}
/* Routing status colors */
.pin-dot.resolved-internal { background:#00bfff; border-color:#00bfff; }
.pin-dot.resolved-external { background:#4ec9b0; border-color:#4ec9b0; }
.pin-dot.model-inherited   { background:#d7ba7d; border-color:#d7ba7d; }
.pin-dot.unresolved        { background:#ff5722; border-color:#ff5722; }
.pin-dot.invalid           { background:#f44747; border-color:#f44747; }
.pin-dot.empty             { background:#555;    border-color:#555;    }
/* Port-like pin dot override */
.pin-dot.port-like         { background:#c586c0 !important; border-color:#d7b6ff !important; }

/* Pin name: allow wrapping, no ellipsis clipping */
.pin-name {
  color:#d4d4d4; font-size:11px;
  white-space:normal; word-break:break-word;
  line-height:1.3; flex:1; min-width:0;
}
.pin.port-pin .pin-name { color:#d7b6ff; }

/* Value text: only when name fits, else hidden */
.pin-value {
  font-size:9px; color:#5ba3d9; padding-left:3px;
  flex-shrink:0; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis;
  max-width:90px; align-self:flex-start; margin-top:5px;
}

/* ── External labels ─────────────────────────────────────────────────── */
.ext-label {
  position:absolute; font-size:9px; color:#6a9955; font-style:italic;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  pointer-events:auto; cursor:pointer;
  padding:1px 5px; border-radius:3px; height:20px; line-height:18px;
  background:#1a2a1a; border:1px solid #3a5a3a;
}
.ext-label:hover { background:#253525; border-color:#6a9955; color:#8dc88d; z-index:20; }
.ext-label.port-label { color:#a070c0; background:#1a1030; border-color:#5a3a80; font-style:normal; }
.ext-label.port-label:hover { background:#251840; border-color:#9060c0; color:#c586c0; }
/* Grouped label: slightly different style to hint it's a summary */
.ext-label.grouped { background:#1e2a1e; border-color:#4a7040; color:#7aaa70; font-style:normal; font-weight:600; cursor:help; }
.ext-label.grouped:hover { background:#263326; border-color:#8dc88d; color:#a0d898; z-index:20; }

/* ── VaconParameters footer row ──────────────────────────────────────── */
.node-vacon-footer {
  font-size:9px; color:#777; padding:3px 9px;
  border-top:1px solid #3c3c3c; font-style:italic; cursor:help;
  background:#1d1d20; border-radius:0 0 5px 5px; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis;
}
.node-vacon-footer:hover { background:#242428; color:#a0a0b0; }

/* ── Legend ──────────────────────────────────────────────────────────── */
.legend {
  position:fixed; bottom:8px; right:8px; background:#252526;
  border:1px solid #3c3c3c; border-radius:4px; padding:6px 10px;
  font-size:10px; z-index:100;
}
.legend-row { display:flex; align-items:center; gap:5px; margin:2px 0; color:#888; }
.legend-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }

/* ── Debug panel ─────────────────────────────────────────────────────── */
#dbg-panel {
  position:fixed; top:38px; right:8px; background:#0d1117;
  border:1px solid #4444ff; border-radius:4px; padding:8px 12px;
  font-family:monospace; font-size:10px; color:#9cdcfe; z-index:9999;
  max-width:480px; white-space:pre; display:none; line-height:1.5;
  max-height:80vh; overflow:auto;
}
#dbg-panel.visible { display:block; }

#empty-msg { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#555; font-size:13px; text-align:center; pointer-events:none; }
#js-status {
  position:fixed; top:38px; left:50%; transform:translateX(-50%);
  background:#3a1a00; border:1px solid #ff8800; border-radius:4px;
  padding:4px 14px; font-family:monospace; font-size:11px; color:#ff8800; z-index:9998;
}
</style>
</head>
<body>
<div id="toolbar">
  <button id="btn-fit">Fit</button>
  <button id="btn-reset">Reset</button>
  <button id="btn-dbg">Debug</button>
  <span id="scope-label"></span>
</div>
<div id="canvas-container">
  <div id="diagram-root"><svg id="edges-layer"></svg></div>
  <div id="empty-msg"></div>
</div>
<div id="dbg-panel"></div>
<div class="legend">
  <div class="legend-row"><div class="legend-dot" style="background:#00bfff"></div>Internal signal</div>
  <div class="legend-row"><div class="legend-dot" style="background:#c586c0"></div>Port / interface</div>
  <div class="legend-row"><div class="legend-dot" style="background:#4ec9b0"></div>External</div>
  <div class="legend-row"><div class="legend-dot" style="background:#d7ba7d"></div>Model</div>
  <div class="legend-row"><div class="legend-dot" style="background:#ff5722"></div>Unresolved</div>
  <div class="legend-row"><div class="legend-dot" style="background:#7a52c0"></div>Port block</div>
  <div class="legend-row"><div class="legend-dot" style="background:#9fb7d7"></div>Model/library block</div>
  <div class="legend-row"><div class="legend-dot" style="background:#d7ba7d; border:1px solid #8a7350"></div>Operator block</div>
</div>
<div id="js-status">JS not loaded</div>
<script type="application/json" id="diagram-data">${safeJson}</script>
<script>
(function() {
  document.getElementById('js-status').textContent = 'JS running\u2026';

  // ── Helpers ───────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function showError(phase, err) {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);' +
      'background:#2d0000;border:2px solid #f44747;border-radius:6px;padding:16px 20px;' +
      'font-family:monospace;color:#f44747;z-index:10000;max-width:85%;overflow:auto;max-height:50vh;';
    var msg = (err instanceof Error && err.stack) ? err.stack : String(err);
    box.innerHTML = '<b>Error [' + escHtml(phase) + ']:</b><br>' +
      '<pre style="white-space:pre-wrap;margin-top:8px;color:#ffa0a0;">' + escHtml(msg) + '</pre>';
    document.body.appendChild(box);
  }

  // ── Debug overlay ─────────────────────────────────────────────────────────
  var dbgEl = document.getElementById('dbg-panel');
  var _dbgVisible = false;
  document.getElementById('btn-dbg').addEventListener('click', function() {
    _dbgVisible = !_dbgVisible;
    dbgEl.classList.toggle('visible', _dbgVisible);
  });

  var _dbgScope = null, _dbgNodes = [], _dbgEdges = [];
  var _dbgScale = 1, _dbgTx = 0, _dbgTy = 0;
  var _dbgCanvasW = 0, _dbgCanvasH = 0;
  var _dbgLayerCount = 0, _dbgLayerX = '', _dbgMaxNW = 0, _dbgMaxNH = 0;
  var _dbgOverlaps = [], _dbgLayoutIter = 0, _dbgExtLabelW = 0;
  var _dbgPinNamesClipped = 0, _dbgPinNamesWrapped = 0, _dbgValuesHidden = 0;

  function dbgRefresh() {
    var ds = _dbgScope ? (_dbgScope.debugStats || {}) : {};
    var lines = [
      'label: '            + (_dbgScope ? (_dbgScope.label     || '?') : '?'),
      'scopePath: '        + (_dbgScope ? (_dbgScope.scopePath || '?') : '?'),
      'nodes: '            + _dbgNodes.length,
      'pins: '             + _dbgNodes.reduce(function(s,n){return s+n.pins.length;},0),
      'internalEdges: '    + _dbgEdges.length,
      'externalLabels: '   + (ds.externalLabels  !== undefined ? ds.externalLabels  : 0),
      'portLikePins: '     + (ds.portLikePinCount !== undefined ? ds.portLikePinCount : 0),
      'portBlocks: '       + (ds.portBlockCount   !== undefined ? ds.portBlockCount   : 0),
      'portEdges: '        + (ds.portEdgeCount    !== undefined ? ds.portEdgeCount    : 0),
      'topLevelPorts: '    + (ds.topLevelPortCount      !== undefined ? ds.topLevelPortCount      : 0),
      'inputPortsInverted:'+ (ds.topLevelInputPortCount !== undefined ? ds.topLevelInputPortCount : 0),
      'extLabelLeft: '     + (ds.topLevelInputPortsWithExternalLabelLeft !== undefined ? ds.topLevelInputPortsWithExternalLabelLeft : 0),
      '--- blockKinds ---',
    ];
    var bk = (ds.blockKindCounts && typeof ds.blockKindCounts === 'object') ? ds.blockKindCounts : {};
    var bkKeys = Object.keys(bk).sort();
    if (bkKeys.length === 0) {
      lines.push('  (none)');
    } else {
      for (var ki = 0; ki < bkKeys.length; ki++) {
        lines.push('  ' + bkKeys[ki] + ': ' + bk[bkKeys[ki]]);
      }
    }
    lines.push('--- elementOrigin ---');
    var eo = (ds.elementOriginCounts && typeof ds.elementOriginCounts === 'object') ? ds.elementOriginCounts : {};
    var eoKeys = Object.keys(eo).sort();
    if (eoKeys.length === 0) {
      lines.push('  (none)');
    } else {
      for (var eoi = 0; eoi < eoKeys.length; eoi++) {
        lines.push('  ' + eoKeys[eoi] + ': ' + eo[eoKeys[eoi]]);
      }
    }
    lines = lines.concat([
      '--- layout ---',
      'layers: '         + _dbgLayerCount,
      'layerX: '         + _dbgLayerX,
      'maxNodeW: '       + _dbgMaxNW + ' px',
      'maxNodeH: '       + _dbgMaxNH + ' px',
      'maxExtLabelW: '   + _dbgExtLabelW + ' px',
      'canvas: '         + Math.round(_dbgCanvasW) + ' x ' + Math.round(_dbgCanvasH),
      'scale: '          + _dbgScale.toFixed(3),
      'tx/ty: '          + Math.round(_dbgTx) + ' / ' + Math.round(_dbgTy),
      'layoutIter: '     + _dbgLayoutIter,
      'layoutOverlaps: ' + _dbgOverlaps.length,
      '--- visibility ---',
      'pinNamesClipped: '  + _dbgPinNamesClipped,
      'pinNamesWrapped: '  + _dbgPinNamesWrapped,
      'valuesHidden: '     + _dbgValuesHidden,
    ]);
    if (_dbgOverlaps.length > 0) {
      lines.push('--- overlaps (first 5) ---');
      for (var oi = 0; oi < Math.min(5, _dbgOverlaps.length); oi++) {
        lines.push('  ' + _dbgOverlaps[oi]);
      }
    }
    dbgEl.textContent = lines.join('\\n');
  }
  dbgRefresh();

  // ── Parse JSON ────────────────────────────────────────────────────────────
  var vscode, scope, nodes, edges;
  try { vscode = acquireVsCodeApi(); } catch(e) { showError('acquireVsCodeApi', e); return; }
  try {
    var _raw = document.getElementById('diagram-data').textContent || '{}';
    scope = JSON.parse(_raw);
    nodes = scope.nodes || [];
    edges = scope.edges || [];
    _dbgScope = scope; _dbgNodes = nodes; _dbgEdges = edges;
  } catch(e) { showError('JSON parse', e); return; }

  document.getElementById('js-status').style.display = 'none';
  document.getElementById('scope-label').textContent = scope.scopePath || scope.label || '';
  if (nodes.length === 0) {
    document.getElementById('empty-msg').textContent = 'No named components. Open a component XML file.';
    return;
  }

  // ── Text measurement ──────────────────────────────────────────────────────
  var _mc = null;
  function measureTxt(txt, fs) {
    if (!txt) { return 0; }
    if (!_mc) {
      try { _mc = document.createElement('canvas').getContext('2d'); } catch(e2) { _mc = null; }
    }
    if (_mc) {
      _mc.font = (fs || 11) + 'px "Segoe UI",Tahoma,sans-serif';
      return _mc.measureText(String(txt)).width;
    }
    // Conservative fallback: 7.5px per char for normal size, 6.5 for small
    return String(txt).length * (fs >= 11 ? 7.5 : 6.5);
  }

  // ── Value formatting ──────────────────────────────────────────────────────
  function fmtValue(v) {
    if (!v) { return ''; }
    var n = parseFloat(v);
    if (!isNaN(n)) {
      if (Number.isInteger(n)) { return String(n); }
      var s = n.toFixed(3).replace(/\\.?0+$/, '');
      return s;
    }
    if (v.length > 14) { return v.slice(0, 13) + '\u2026'; }
    return v;
  }

  // ── Port-like detection ───────────────────────────────────────────────────
  function isPortLikePin(pin) {
    return pin.isPortLike === true || pin.isScopeBoundaryPort === true;
  }

  // ── Pin sort order: ports first ───────────────────────────────────────────
  function pinSortKey(pin) {
    // 0 = scope boundary port, 1 = port-like, 2 = signal with routing,
    // 3 = signal no routing, 4 = parameter, 5 = other
    if (pin.isScopeBoundaryPort) { return 0; }
    if (pin.isPortLike)          { return 1; }
    var tag = (pin.attributeName || '').toLowerCase();
    if (pin.routing)             { return 2; }
    if (pin.value)               { return 3; }
    return 4;
  }
  function sortedPins(pins) {
    var a = pins.slice();
    a.sort(function(x, y) { return pinSortKey(x) - pinSortKey(y) || (x.pinName || '').localeCompare(y.pinName || ''); });
    return a;
  }

  // ── Layout constants ─────────────────────────────────────────────────────
  var MIN_NODE_W  = 280;
  var SOFT_MAX_W  = 700;
  var HARD_MAX_W  = 900;
  var HDR_H       = 44;
  var BODY_PAD_V  = 4;
  var BODY_PAD_H  = 10;  // per-column horizontal padding
  var DOT_W       = 9;   // dot diameter
  var DOT_GAP     = 5;   // gap between dot and text
  var SEP_W       = 1;   // separator between input/output columns
  var MIN_PIN_H   = 22;
  var WRAP_PIN_H  = 38;  // height for 2-line pin name
  var EXT_LABEL_W   = 360;
  var EXT_LABEL_H   = 20;
  var EXT_LABEL_GAP = 22;
  var VACON_FOOTER_H = 22; // height of the VaconParameters summary footer
  var MIN_LAYER_GAP = 60;
  var MIN_ROW_GAP   = 16;
  var CANVAS_PAD    = 40;
  _dbgExtLabelW = EXT_LABEL_W;

  // ── External label helpers ────────────────────────────────────────────────

  /**
   * Shorten an external label string to maxChars, preserving whole dot-separated
   * path segments (never cuts in the middle of a segment).
   */
  function shortenExtLabel(s, maxChars) {
    if (!s) { return ''; }
    maxChars = maxChars || 58;
    if (s.length <= maxChars) { return s; }
    var segs = s.split('.');
    var out = segs[segs.length - 1]; // always keep at least the last segment
    for (var i = segs.length - 2; i >= 0; i--) {
      var cand = segs.slice(i).join('.');
      if (cand.length > maxChars - 1) { break; } // -1 for '…'
      out = cand;
    }
    return '\u2026' + out;
  }

  /**
   * Build a tooltip string for a single pin's external routing.
   */
  function buildExtPinTip(pin) {
    var lines = [];
    if (pin.pinName) { lines.push('pin: ' + pin.pinName); }
    if (pin.routing) { lines.push('routing: ' + pin.routing); }
    if (pin.externalLabel && pin.externalLabel !== pin.routing) {
      lines.push('resolved: ' + pin.externalLabel);
    }
    if (pin.elementOrigin && pin.elementOrigin !== 'xml-configured') {
      lines.push('origin: ' + pin.elementOrigin);
    }
    return lines.join('\\n');
  }

  /**
   * Group external label entries by common CDP path prefix.
   * Port-like pins are never grouped.
   * Groups of size >= 2 sharing a common prefix of depth >= 2 are summarised.
   *
   * Returns an array of render descriptors:
   *   { displayText, tooltip, lx, ly, isPortLbl, isGrouped,
   *     repPin, repDp, isInp, routingStatus }
   */
  function groupExtLabelEntries(entries) {
    var result = [];
    var used = new Array(entries.length).fill(false);

    for (var i = 0; i < entries.length; i++) {
      if (used[i]) { continue; }
      var e = entries[i];
      var lbl = e.pin.externalLabel || '';
      var lx = e.isInp ? e.dp.x - EXT_LABEL_GAP - EXT_LABEL_W : e.dp.x + EXT_LABEL_GAP;

      // Port-like: never group
      if (isPortLikePin(e.pin)) {
        used[i] = true;
        result.push({ displayText: shortenExtLabel(lbl), tooltip: buildExtPinTip(e.pin),
          lx: lx, ly: e.dp.y - EXT_LABEL_H / 2,
          isPortLbl: true, isGrouped: false,
          repPin: e.pin, repDp: e.dp, isInp: e.isInp, routingStatus: e.pin.routingStatus });
        continue;
      }

      // Find best group: 2+ entries sharing a common prefix of depth 2..4
      var bestPfx = null, bestGrp = null;
      var parts = lbl.split('.');
      for (var plen = Math.min(4, parts.length - 1); plen >= 2; plen--) {
        var pfx = parts.slice(0, plen).join('.');
        var grp = [i];
        for (var j = i + 1; j < entries.length; j++) {
          if (!used[j] && !isPortLikePin(entries[j].pin)) {
            var jlbl = entries[j].pin.externalLabel || '';
            if (jlbl === pfx || jlbl.startsWith(pfx + '.')) { grp.push(j); }
          }
        }
        if (grp.length >= 2 && (!bestGrp || grp.length > bestGrp.length)) {
          bestGrp = grp; bestPfx = pfx;
        }
      }

      if (bestPfx && bestGrp && bestGrp.length >= 2) {
        for (var k = 0; k < bestGrp.length; k++) { used[bestGrp[k]] = true; }
        var pfxParts = bestPfx.split('.');
        // Display: last 2 parts of prefix + count
        var dispPfx = pfxParts.length > 2 ? pfxParts.slice(-2).join('.') : bestPfx;
        var tipLines = bestGrp.map(function(idx) {
          var p = entries[idx].pin;
          return (p.externalLabel || p.routing || '');
        });
        var rep = entries[bestGrp[0]];
        var lxg = rep.isInp ? rep.dp.x - EXT_LABEL_GAP - EXT_LABEL_W : rep.dp.x + EXT_LABEL_GAP;
        result.push({ displayText: dispPfx + ' (\xd7' + bestGrp.length + ')',
          tooltip: tipLines.join('\\n'),
          lx: lxg, ly: rep.dp.y - EXT_LABEL_H / 2,
          isPortLbl: false, isGrouped: true,
          repPin: rep.pin, repDp: rep.dp, isInp: rep.isInp, routingStatus: 'resolved-external' });
      } else {
        used[i] = true;
        result.push({ displayText: shortenExtLabel(lbl), tooltip: buildExtPinTip(e.pin),
          lx: lx, ly: e.dp.y - EXT_LABEL_H / 2,
          isPortLbl: false, isGrouped: false,
          repPin: e.pin, repDp: e.dp, isInp: e.isInp, routingStatus: e.pin.routingStatus });
      }
    }
    return result;
  }

  // ── Per-pin row height and value visibility ───────────────────────────────
  // Returns { pinH, showValue, nameW, valueW }
  // nameW and valueW are the pixel widths consumed in the column.
  function calcPinLayout(pin, availColW) {
    // Port-like pins: never show value
    var showValue = !isPortLikePin(pin) && !!pin.value && pin.value.length > 0;
    var dotTotalW = DOT_W + DOT_GAP;
    var padTotal  = BODY_PAD_H * 2;
    var nameAvail = availColW - dotTotalW - padTotal;
    var nameW = measureTxt(pin.pinName || pin.attributeName || '', 11);
    var valueW = showValue ? measureTxt('=' + fmtValue(pin.value) + (pin.unitLabel ? ' ' + pin.unitLabel : ''), 9) + 4 : 0;

    // If value would push name out, drop value
    if (showValue && nameW + valueW > nameAvail) {
      showValue = false;
      valueW = 0;
      _dbgValuesHidden++;
    }

    var pinH = MIN_PIN_H;
    var clipped = false;
    if (nameW > nameAvail) {
      // Name needs wrapping
      _dbgPinNamesWrapped++;
      pinH = WRAP_PIN_H;
      showValue = false; // no value in wrapped rows
      // After wrap, each line gets ~nameAvail width, 2 lines available
      // If name is still too long for 2 lines, it clips (acceptable last resort)
      var wrapNameW = nameW / 2; // rough: 2 lines
      if (wrapNameW > nameAvail) {
        _dbgPinNamesClipped++;
        clipped = true;
      }
    }
    return { pinH: pinH, showValue: showValue, nameW: nameW, valueW: valueW, clipped: clipped };
  }

  // ── Node size calculation ─────────────────────────────────────────────────
  function calcNodeSize(node) {
    var inPins  = sortedPins(node.pins.filter(function(p) { return p.visualDirection === 'in';  }));
    var outPins = sortedPins(node.pins.filter(function(p) { return p.visualDirection === 'out'; }));

    // Iterate: start with a wide initial guess, refine column widths
    // We need to know final column widths to know if names wrap / values show.
    // Use two passes: first pass estimates, second pass confirms.

    function measureColW(pins, colAvail) {
      var w = 0;
      for (var i = 0; i < pins.length; i++) {
        var p = pins[i];
        var nameW = measureTxt(p.pinName || p.attributeName || '', 11);
        var vw = (!isPortLikePin(p) && p.value) ? measureTxt('=' + fmtValue(p.value), 9) + 4 : 0;
        // If value doesn't fit, don't include it in width requirement
        var needed = DOT_W + DOT_GAP + nameW + BODY_PAD_H * 2;
        if (vw > 0 && nameW + vw + DOT_W + DOT_GAP + BODY_PAD_H * 2 <= colAvail + 50) {
          needed = DOT_W + DOT_GAP + nameW + vw + BODY_PAD_H * 2;
        }
        w = Math.max(w, needed);
      }
      return w;
    }

    var hasBoth = inPins.length > 0 && outPins.length > 0;

    // Initial column widths: measure with "infinite" available space
    var inColW  = inPins.length  > 0 ? measureColW(inPins,  10000) : 0;
    var outColW = outPins.length > 0 ? measureColW(outPins, 10000) : 0;

    var hdrW = Math.max(
      measureTxt(node.name, 12) + 22,
      measureTxt(node.typeLabel || node.tagName, 9) + 22
    );

    var bodyW = hasBoth ? (inColW + outColW + SEP_W) : Math.max(inColW, outColW);
    var w = Math.max(bodyW, hdrW, MIN_NODE_W);
    w = Math.min(w, HARD_MAX_W);

    // Now compute per-pin heights using the actual column widths
    var actualInColW  = hasBoth ? (inColW  / (inColW + outColW) * (w - SEP_W)) : w;
    var actualOutColW = hasBoth ? (outColW / (inColW + outColW) * (w - SEP_W)) : w;
    if (!hasBoth) {
      actualInColW  = inPins.length > 0  ? w : 0;
      actualOutColW = outPins.length > 0 ? w : 0;
    }

    var inH = 0, outH = 0;
    for (var i = 0; i < inPins.length; i++) {
      inH  += calcPinLayout(inPins[i],  actualInColW).pinH;
    }
    for (var j = 0; j < outPins.length; j++) {
      outH += calcPinLayout(outPins[j], actualOutColW).pinH;
    }
    // At least 1 row minimum
    var bodyH = Math.max(inH, outH, MIN_PIN_H);
    var footerH = (node.vaconParameterCount > 0) ? VACON_FOOTER_H : 0;
    var h = HDR_H + BODY_PAD_V * 2 + bodyH + footerH;

    var leftExtW = 0, rightExtW = 0;
    for (var k = 0; k < node.pins.length; k++) {
      var pp = node.pins[k];
      if (!pp.externalLabel) { continue; }
      var lblSide = pp.externalLabelSide || (pp.direction === 'in' ? 'left' : 'right');
      if (lblSide === 'left') { leftExtW  = Math.max(leftExtW,  EXT_LABEL_W + EXT_LABEL_GAP); }
      else                   { rightExtW = Math.max(rightExtW, EXT_LABEL_W + EXT_LABEL_GAP); }
    }
    return { w: w, h: h, leftExtW: leftExtW, rightExtW: rightExtW,
             inColW: actualInColW, outColW: actualOutColW };
  }

  // ── Pre-compute node sizes ────────────────────────────────────────────────
  var nodeSizes = new Map();
  for (var ni0 = 0; ni0 < nodes.length; ni0++) {
    nodeSizes.set(nodes[ni0].id, calcNodeSize(nodes[ni0]));
  }

  // ── Pin-to-node map ────────────────────────────────────────────────────────
  var pinToNode = new Map();
  for (var ni1 = 0; ni1 < nodes.length; ni1++) {
    var nd1 = nodes[ni1];
    for (var pi1 = 0; pi1 < nd1.pins.length; pi1++) { pinToNode.set(nd1.pins[pi1].id, nd1); }
  }

  // ── Topological layer assignment ──────────────────────────────────────────
  function computeLayerMap() {
    var outAdj  = new Map();
    var inCount = new Map();
    for (var i = 0; i < nodes.length; i++) { outAdj.set(nodes[i].id, new Set()); inCount.set(nodes[i].id, 0); }
    for (var j = 0; j < edges.length; j++) {
      // Use visualDirection to determine edge direction for layout
      var fromPin = null, toPin = null;
      for (var ni2 = 0; ni2 < nodes.length; ni2++) {
        for (var pi2 = 0; pi2 < nodes[ni2].pins.length; pi2++) {
          if (nodes[ni2].pins[pi2].id === edges[j].fromPinId) { fromPin = nodes[ni2].pins[pi2]; }
          if (nodes[ni2].pins[pi2].id === edges[j].toPinId)   { toPin   = nodes[ni2].pins[pi2]; }
        }
      }
      var fn2 = pinToNode.get(edges[j].fromPinId);
      var tn2 = pinToNode.get(edges[j].toPinId);
      if (!fn2 || !tn2 || fn2.id === tn2.id) { continue; }
      if (!outAdj.get(fn2.id).has(tn2.id)) {
        outAdj.get(fn2.id).add(tn2.id);
        inCount.set(tn2.id, (inCount.get(tn2.id) || 0) + 1);
      }
    }
    var layerMap = new Map();
    var queue = [];
    for (var k = 0; k < nodes.length; k++) {
      if ((inCount.get(nodes[k].id) || 0) === 0) { queue.push(nodes[k].id); layerMap.set(nodes[k].id, 0); }
    }
    var qi = 0;
    while (qi < queue.length) {
      var cur = queue[qi++];
      var curL = layerMap.get(cur) || 0;
      var nbrs = outAdj.get(cur) || new Set();
      nbrs.forEach(function(next) {
        var nl = curL + 1;
        if (!layerMap.has(next) || layerMap.get(next) < nl) { layerMap.set(next, nl); }
        inCount.set(next, (inCount.get(next) || 1) - 1);
        if (inCount.get(next) <= 0) { queue.push(next); }
      });
    }
    for (var m = 0; m < nodes.length; m++) { if (!layerMap.has(nodes[m].id)) { layerMap.set(nodes[m].id, 0); } }
    return layerMap;
  }
  var layerMap = computeLayerMap();

  // ── Layout ─────────────────────────────────────────────────────────────────
  function doLayout(lgap, rgap) {
    var layerGroups = new Map();
    for (var i = 0; i < nodes.length; i++) {
      var l = layerMap.get(nodes[i].id) || 0;
      if (!layerGroups.has(l)) { layerGroups.set(l, []); }
      layerGroups.get(l).push(nodes[i]);
    }
    layerGroups.forEach(function(grp) {
      grp.sort(function(a, b) {
        // Port blocks float to top, then alpha
        var ap = a.isScopeBoundaryPort ? 0 : 1;
        var bp2 = b.isScopeBoundaryPort ? 0 : 1;
        return ap - bp2 || a.name.localeCompare(b.name);
      });
    });
    var sortedL = Array.from(layerGroups.keys()).sort(function(a,b){return a-b;});

    var layerXMap = new Map();
    var curX = CANVAS_PAD;
    for (var li = 0; li < sortedL.length; li++) {
      var lyr = sortedL[li];
      var grp = layerGroups.get(lyr);
      var maxLeftExt = 0, maxNodeW2 = 0, maxRightExt = 0;
      for (var gi = 0; gi < grp.length; gi++) {
        var sz = nodeSizes.get(grp[gi].id) || {};
        maxLeftExt  = Math.max(maxLeftExt,  sz.leftExtW  || 0);
        maxNodeW2   = Math.max(maxNodeW2,   sz.w         || MIN_NODE_W);
        maxRightExt = Math.max(maxRightExt, sz.rightExtW || 0);
      }
      var nodeX = curX + maxLeftExt;
      layerXMap.set(lyr, nodeX);
      curX = nodeX + maxNodeW2 + maxRightExt + lgap;
    }

    var pos = new Map();
    for (var li2 = 0; li2 < sortedL.length; li2++) {
      var lyr2 = sortedL[li2];
      var nodeX2 = layerXMap.get(lyr2);
      var y = CANVAS_PAD;
      var grp2 = layerGroups.get(lyr2);
      for (var gi2 = 0; gi2 < grp2.length; gi2++) {
        var nd = grp2[gi2];
        var sz2 = nodeSizes.get(nd.id) || { w: MIN_NODE_W, h: 60 };
        pos.set(nd.id, { x: nodeX2, y: y, w: sz2.w, h: sz2.h });
        y += sz2.h + rgap;
      }
    }
    return { pos: pos, layerGroups: layerGroups, sortedLayers: sortedL, layerXMap: layerXMap };
  }

  // ── Overlap checker ───────────────────────────────────────────────────────
  function checkOverlaps(boxes) {
    var result = [];
    for (var i = 0; i < boxes.length; i++) {
      for (var j = i + 1; j < boxes.length; j++) {
        var a = boxes[i], b = boxes[j];
        var noOvlp = a.x + a.w <= b.x || b.x + b.w <= a.x ||
                     a.y + a.h <= b.y || b.y + b.h <= a.y;
        if (!noOvlp) { result.push(a.id + ' vs ' + b.id); }
      }
    }
    return result;
  }

  // ── Iterative layout ──────────────────────────────────────────────────────
  var positions, layerGroups, sortedLayers, layerXMap;
  var layerGap = MIN_LAYER_GAP, rowGap = MIN_ROW_GAP, layoutIter = 0;
  var overlaps = [];
  for (var iter = 0; iter < 6; iter++) {
    var lr = doLayout(layerGap, rowGap);
    positions    = lr.pos;
    layerGroups  = lr.layerGroups;
    sortedLayers = lr.sortedLayers;
    layerXMap    = lr.layerXMap;
    var boxes = [];
    for (var bi = 0; bi < nodes.length; bi++) {
      var nd2 = nodes[bi];
      var bp2 = positions.get(nd2.id);
      var bsz = nodeSizes.get(nd2.id) || {};
      if (!bp2) { continue; }
      boxes.push({ id: nd2.name, x: bp2.x, y: bp2.y + 2, w: bp2.w, h: bp2.h - 4 });
      if (bsz.leftExtW) {
        boxes.push({ id: nd2.name + ':L', x: bp2.x - bsz.leftExtW, y: bp2.y, w: bsz.leftExtW - 4, h: bp2.h });
      }
      if (bsz.rightExtW) {
        boxes.push({ id: nd2.name + ':R', x: bp2.x + bp2.w + 4, y: bp2.y, w: bsz.rightExtW - 4, h: bp2.h });
      }
    }
    overlaps = checkOverlaps(boxes);
    if (overlaps.length === 0) { break; }
    layerGap += 80;
    rowGap   += 10;
    layoutIter++;
  }

  // ── Pin dot positions (from actual row heights) ───────────────────────────
  var pinDotPositions = new Map();
  for (var pni = 0; pni < nodes.length; pni++) {
    var pnd = nodes[pni];
    var ppos = positions.get(pnd.id);
    if (!ppos) { continue; }
    var pSz = nodeSizes.get(pnd.id) || {};
    var inPinsL  = sortedPins(pnd.pins.filter(function(p) { return p.visualDirection === 'in';  }));
    var outPinsL = sortedPins(pnd.pins.filter(function(p) { return p.visualDirection === 'out'; }));
    var inColAvail  = pSz.inColW  || ppos.w;
    var outColAvail = pSz.outColW || ppos.w;

    var yOff = ppos.y + HDR_H + BODY_PAD_V;
    for (var ii = 0; ii < inPinsL.length; ii++) {
      var pl = calcPinLayout(inPinsL[ii], inColAvail);
      pinDotPositions.set(inPinsL[ii].id, {
        x: ppos.x,
        y: yOff + pl.pinH / 2,
      });
      yOff += pl.pinH;
    }
    var yOff2 = ppos.y + HDR_H + BODY_PAD_V;
    for (var oi2 = 0; oi2 < outPinsL.length; oi2++) {
      var pl2 = calcPinLayout(outPinsL[oi2], outColAvail);
      pinDotPositions.set(outPinsL[oi2].id, {
        x: ppos.x + ppos.w,
        y: yOff2 + pl2.pinH / 2,
      });
      yOff2 += pl2.pinH;
    }
  }

  // ── Canvas size ───────────────────────────────────────────────────────────
  var maxX = CANVAS_PAD, maxY = CANVAS_PAD;
  for (var ci = 0; ci < nodes.length; ci++) {
    var cp = positions.get(nodes[ci].id);
    var csz = nodeSizes.get(nodes[ci].id) || {};
    if (cp) {
      maxX = Math.max(maxX, cp.x + cp.w + (csz.rightExtW || 0) + CANVAS_PAD);
      maxY = Math.max(maxY, cp.y + cp.h + CANVAS_PAD);
    }
  }

  var root      = document.getElementById('diagram-root');
  var edgesSvg  = document.getElementById('edges-layer');
  var container = document.getElementById('canvas-container');
  edgesSvg.style.width  = maxX + 'px';
  edgesSvg.style.height = maxY + 'px';

  // Update debug stats
  _dbgLayerCount = sortedLayers.length;
  var lxParts = [];
  for (var lxi = 0; lxi < Math.min(6, sortedLayers.length); lxi++) {
    lxParts.push(sortedLayers[lxi] + ':' + Math.round(layerXMap.get(sortedLayers[lxi]) || 0));
  }
  _dbgLayerX = lxParts.join(' ');
  var mNW = 0, mNH = 0;
  nodeSizes.forEach(function(sz) { mNW = Math.max(mNW, sz.w); mNH = Math.max(mNH, sz.h); });
  _dbgMaxNW = Math.round(mNW); _dbgMaxNH = Math.round(mNH);
  _dbgCanvasW = maxX; _dbgCanvasH = maxY;
  _dbgOverlaps = overlaps; _dbgLayoutIter = layoutIter;
  dbgRefresh();

  // ── makePinRow ────────────────────────────────────────────────────────────
  function makePinRow(pin, colAvailW) {
    var pl = calcPinLayout(pin, colAvailW);
    var isPort = isPortLikePin(pin);
    var row = document.createElement('div');
    row.className = 'pin' + (isPort ? ' port-pin' : '');
    row.style.minHeight = pl.pinH + 'px';

    // Tooltip: full path info
    var tipDir = pin.isScopeBoundaryPort
      ? (pin.direction === 'in' ? '[scope input = internal source]' : '[scope output = internal sink]')
      : '';
    var tipR = pin.routing  ? '\\nrouting: ' + pin.routing  : '';
    var tipV = pin.value    ? '\\nvalue: '   + pin.value + (pin.unitLabel ? ' ' + pin.unitLabel : '') : '';
    var tipPL = isPort ? '\\n[port-like]' : '';
    var tipOrigin = (pin.elementOrigin && pin.elementOrigin !== 'xml-configured')
      ? '\\norigin: ' + pin.elementOrigin : '';
    var tipFile = '';
    if (pin.filePath) { var _fpA = pin.filePath.split('/'); tipFile = '\\nsrc: ' + _fpA[_fpA.length - 1]; }
    row.title = (pin.pinName || pin.attributeName || '') + tipDir + tipR + tipV + tipPL + tipOrigin + tipFile;

    row.addEventListener('click', (function(p) {
      return function(e) { e.stopPropagation(); revealXml(p.filePath, p.valueLine, p.valueChar); };
    })(pin));

    var dot = document.createElement('div');
    dot.className = 'pin-dot ' + pin.routingStatus + (isPort ? ' port-like' : '');

    var lbl = document.createElement('span');
    lbl.className   = 'pin-name';
    lbl.textContent = pin.pinName || (pin.attributeName || '').replace(/Routing$/, '');
    // Note: white-space:normal is set in CSS, so text wraps naturally

    row.appendChild(dot);
    row.appendChild(lbl);

    if (pl.showValue && pin.value) {
      var fv = fmtValue(pin.value);
      var unit = pin.unitLabel ? '\u00a0' + pin.unitLabel : '';
      var val = document.createElement('span');
      val.className   = 'pin-value';
      val.title       = pin.value + (pin.unitLabel ? ' ' + pin.unitLabel : '');
      val.textContent = '=' + fv + unit;
      row.appendChild(val);
    }
    return row;
  }

  function revealXml(fp, line, ch) {
    vscode.postMessage({ type: 'revealXml', filePath: fp, line: line, character: ch });
  }

  // ── Render nodes ──────────────────────────────────────────────────────────
  try {
    for (var rni = 0; rni < nodes.length; rni++) {
      var rn = nodes[rni];
      var rpos = positions.get(rn.id);
      if (!rpos) { continue; }
      var rSz  = nodeSizes.get(rn.id) || { w: MIN_NODE_W, inColW: MIN_NODE_W/2, outColW: MIN_NODE_W/2 };

      var inPins3  = sortedPins(rn.pins.filter(function(p) { return p.visualDirection === 'in';  }));
      var outPins3 = sortedPins(rn.pins.filter(function(p) { return p.visualDirection === 'out'; }));

      var el = document.createElement('div');
      var bkClass = rn.isScopeBoundaryPort ? 'port-block' : (rn.blockKind || '');
      el.className  = 'node' + (bkClass ? ' ' + bkClass : '');
      el.style.left = rpos.x + 'px';
      el.style.top  = rpos.y + 'px';
      el.style.width = rpos.w + 'px';

      var hdr = document.createElement('div');
      hdr.className = 'node-header';
      hdr.title = (rn.srcFile ? 'Double-click to open ' + rn.srcFile + '\\n' : '') + rn.id;
      if (rn.isScopeBoundaryPort) {
        var dirLabel = rn.pins[0] && rn.pins[0].direction === 'in' ? ' [scope in]' : ' [scope out]';
        hdr.innerHTML =
          '<div class="node-name">' + escHtml(rn.name) + '</div>' +
          '<div class="node-type">' + escHtml('Port' + dirLabel) + '</div>';
      } else {
        hdr.innerHTML =
          '<div class="node-name">' + escHtml(rn.name) + '</div>' +
          '<div class="node-type">' + escHtml(rn.typeLabel || rn.tagName) + '</div>';
      }
      hdr.addEventListener('click', (function(n) {
        return function() { revealXml(n.filePath, n.elementLine, 0); };
      })(rn));
      if (rn.srcFile) {
        hdr.addEventListener('dblclick', (function(n) {
          return function(e) { e.stopPropagation(); vscode.postMessage({ type: 'openFile', filePath: n.srcFile }); };
        })(rn));
      }
      el.appendChild(hdr);

      var body = document.createElement('div');
      body.className = 'node-body';

      var inColW3  = rSz.inColW  || rpos.w;
      var outColW3 = rSz.outColW || rpos.w;

      var inCol  = document.createElement('div');
      inCol.className = 'pins-col inputs';
      if (inPins3.length > 0 && outPins3.length > 0) {
        inCol.style.width = Math.round(inColW3) + 'px';
        inCol.style.flex  = 'none';
      }

      var outCol = document.createElement('div');
      outCol.className = 'pins-col outputs';
      if (inPins3.length > 0 && outPins3.length > 0) {
        outCol.style.width = Math.round(outColW3) + 'px';
        outCol.style.flex  = 'none';
      }

      for (var ipi = 0; ipi < inPins3.length;  ipi++) { inCol.appendChild(makePinRow(inPins3[ipi],  inColW3));  }
      for (var opi = 0; opi < outPins3.length; opi++) { outCol.appendChild(makePinRow(outPins3[opi], outColW3)); }

      if (inPins3.length  === 0) { inCol.style.display  = 'none'; }
      if (outPins3.length === 0) { outCol.style.display = 'none'; }

      body.appendChild(inCol);
      body.appendChild(outCol);
      el.appendChild(body);

      // VaconParameters summary footer (drive-parameter-service managed params)
      if (rn.vaconParameterCount > 0) {
        var vpFoot = document.createElement('div');
        vpFoot.className = 'node-vacon-footer';
        vpFoot.textContent = '\u25a4 VaconParameters (\xd7' + rn.vaconParameterCount + ')';
        vpFoot.title = 'drive-parameter-service: ' + rn.vaconParameterCount + ' VaconParameter elements' +
          (rn.srcFile ? (function(f){ var a=f.split('/'); return '\\n'+a[a.length-1]; })(rn.srcFile) : '');
        el.appendChild(vpFoot);
      }

      root.appendChild(el);
    }
  } catch(e) { showError('renderNodes', e); }

  // ── Render edges ──────────────────────────────────────────────────────────
  try {
    // Build set of port-like pin ids for edge coloring
    var portLikePinIds = new Set();
    for (var pli = 0; pli < nodes.length; pli++) {
      for (var ppi = 0; ppi < nodes[pli].pins.length; ppi++) {
        if (isPortLikePin(nodes[pli].pins[ppi])) { portLikePinIds.add(nodes[pli].pins[ppi].id); }
      }
    }

    for (var ei = 0; ei < edges.length; ei++) {
      var edge = edges[ei];
      var fp = pinDotPositions.get(edge.fromPinId);
      var tp = pinDotPositions.get(edge.toPinId);
      if (!fp || !tp) { continue; }
      var isPortEdge = portLikePinIds.has(edge.fromPinId) || portLikePinIds.has(edge.toPinId);
      var dx = Math.abs(tp.x - fp.x);
      var cp1x = fp.x + dx * 0.5, cp2x = tp.x - dx * 0.5;
      var sc = isPortEdge ? '#b180ff'
             : edge.routingStatus === 'resolved-internal' ? '#00bfff'
             : edge.routingStatus === 'model-inherited'   ? '#d7ba7d'
             : edge.routingStatus === 'unresolved'        ? '#ff5722'
             : edge.routingStatus === 'invalid'           ? '#f44747' : '#4ec9b0';
      var pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d',
        'M' + fp.x + ',' + fp.y +
        ' C' + cp1x + ',' + fp.y + ' ' + cp2x + ',' + tp.y + ' ' + tp.x + ',' + tp.y);
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('stroke', sc);
      pathEl.setAttribute('stroke-width', isPortEdge ? '2' : '1.5');
      if (!isPortEdge && edge.routingStatus !== 'resolved-internal') {
        pathEl.setAttribute('stroke-dasharray', '4 3');
      }
      edgesSvg.appendChild(pathEl);
    }
  } catch(e) { showError('renderEdges', e); }

  // ── Render external labels (one label per pin, aligned to its pin row) ───
  // Rule: each pin always gets exactly one label, positioned at that pin's Y.
  // Inputs: never grouped — each input has one source, shown on its own row.
  // Outputs: one label per output pin. Fan-out grouping (one pin → many
  //   destinations) is reserved for future model support.
  try {
    for (var xni = 0; xni < nodes.length; xni++) {
      var xn = nodes[xni];
      if (!positions.get(xn.id)) { continue; }
      for (var xpi2 = 0; xpi2 < xn.pins.length; xpi2++) {
        var xp = xn.pins[xpi2];
        if (!xp.externalLabel) { continue; }
        var dp = pinDotPositions.get(xp.id);
        if (!dp) { continue; }
        var isInpE = (xp.externalLabelSide || (xp.direction === 'in' ? 'left' : 'right')) === 'left';
        var lx = isInpE ? dp.x - EXT_LABEL_GAP - EXT_LABEL_W : dp.x + EXT_LABEL_GAP;
        // Label center-Y is always the pin dot Y — strict per-row alignment
        var ly = dp.y - EXT_LABEL_H / 2;
        var isPortLbl = isPortLikePin(xp);
        var lblDiv = document.createElement('div');
        lblDiv.className = 'ext-label' + (isPortLbl ? ' port-label' : '');
        lblDiv.style.left  = lx + 'px';
        lblDiv.style.top   = ly + 'px';
        lblDiv.style.width = EXT_LABEL_W + 'px';
        lblDiv.textContent = shortenExtLabel(xp.externalLabel);
        lblDiv.title = buildExtPinTip(xp);
        lblDiv.addEventListener('click', (function(pin) {
          return function(e) { e.stopPropagation(); revealXml(pin.filePath, pin.valueLine, pin.valueChar); };
        })(xp));
        root.appendChild(lblDiv);
        // Connector line from label edge to pin dot, at exact pin Y
        var lineX1 = isInpE ? lx + EXT_LABEL_W : lx;
        var lc = isPortLbl                         ? '#7a52c0'
               : xp.routingStatus === 'unresolved' ? '#ff5722'
               : xp.routingStatus === 'invalid'    ? '#f44747'
               : '#3a6a3a';
        var conn = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        conn.setAttribute('x1', String(lineX1)); conn.setAttribute('y1', String(dp.y));
        conn.setAttribute('x2', String(dp.x));   conn.setAttribute('y2', String(dp.y));
        conn.setAttribute('stroke', lc); conn.setAttribute('stroke-width', '1');
        conn.setAttribute('stroke-dasharray', '3 2');
        edgesSvg.appendChild(conn);
      }
    }
  } catch(e) { showError('renderExternalLabels', e); }

  // ── Pan & Zoom ─────────────────────────────────────────────────────────────
  var scale = 1, tx = 0, ty = 0;
  var isPanning = false, startX = 0, startY = 0;
  function applyTransform() {
    _dbgScale = scale; _dbgTx = tx; _dbgTy = ty;
    root.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    dbgRefresh();
  }
  container.addEventListener('wheel', function(e) {
    e.preventDefault();
    var d = e.deltaY > 0 ? 0.9 : 1.1;
    var r = container.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    tx = mx - (mx - tx) * d; ty = my - (my - ty) * d; scale *= d;
    applyTransform();
  }, { passive: false });
  container.addEventListener('mousedown', function(e) {
    if (e.button !== 0) { return; }
    isPanning = true; startX = e.clientX - tx; startY = e.clientY - ty;
    container.classList.add('grabbing');
  });
  document.addEventListener('mousemove', function(e) {
    if (!isPanning) { return; }
    tx = e.clientX - startX; ty = e.clientY - startY; applyTransform();
  });
  document.addEventListener('mouseup', function() {
    isPanning = false; container.classList.remove('grabbing');
  });
  function fitAll() {
    try {
      var r = container.getBoundingClientRect();
      var w = Math.max(r.width, 200), h = Math.max(r.height, 200);
      var sx = (w - 40) / maxX, sy = (h - 40) / maxY;
      scale = Math.min(sx, sy, 1);
      if (!isFinite(scale) || scale <= 0) { scale = 0.5; }
      tx = (w - maxX * scale) / 2;
      ty = (h - maxY * scale) / 2;
      applyTransform();
    } catch(e) { showError('fitAll', e); }
  }
  document.getElementById('btn-fit').addEventListener('click', fitAll);
  document.getElementById('btn-reset').addEventListener('click', function() {
    scale = 1; tx = 0; ty = 0; applyTransform();
  });

  applyTransform();
  requestAnimationFrame(fitAll);
  dbgRefresh();
})();
</script>
</body>
</html>`;
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
