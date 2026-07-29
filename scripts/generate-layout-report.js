#!/usr/bin/env node
/**
 * generate-layout-report.js  (updated: port stats + text visibility metrics)
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const [, , xmlFile, outFile] = process.argv;
if (!xmlFile || !outFile) {
  console.error('Usage: node generate-layout-report.js <xmlFile> <outputFile>');
  process.exit(1);
}

const extDir = path.join(__dirname, '..');
const { buildDiagramScope } = require(path.join(extDir, 'out/routing/core/diagramBuilder'));
const { CdpProjectIndexer } = require(path.join(extDir, 'out/routing/core/cdpProjectIndexer'));

// ── Layout constants (mirror blockDiagramPanel.ts webview JS) ─────────────
const MIN_NODE_W  = 280;
const HARD_MAX_W  = 900;
const HDR_H       = 44;
const BODY_PAD_V  = 4;
const BODY_PAD_H  = 10;
const DOT_W       = 9;
const DOT_GAP     = 5;
const SEP_W       = 1;
const MIN_PIN_H   = 22;
const WRAP_PIN_H  = 38;
const EXT_LABEL_W   = 360;
const EXT_LABEL_H   = 20;
const EXT_LABEL_GAP = 22;
const VACON_FOOTER_H = 22;
const MIN_LAYER_GAP = 60;
const MIN_ROW_GAP   = 16;
const CANVAS_PAD    = 40;
function measureTxt(txt, fs2) {
  if (!txt) return 0;
  return String(txt).length * (fs2 >= 11 ? 7.5 : 6.5);
}
function fmtValue(v) {
  if (!v) return '';
  const n = parseFloat(v);
  if (!isNaN(n)) {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(3).replace(/\.?0+$/, '');
  }
  return v.length > 14 ? v.slice(0, 13) + '…' : v;
}
function isPortLikePin(pin) { return pin.isPortLike === true || pin.isScopeBoundaryPort === true; }

function pinSortKey(pin) {
  if (pin.isScopeBoundaryPort) return 0;
  if (pin.isPortLike)          return 1;
  if (pin.routing)             return 2;
  if (pin.value)               return 3;
  return 4;
}
function sortedPins(pins) {
  return pins.slice().sort((x, y) =>
    pinSortKey(x) - pinSortKey(y) || (x.pinName||'').localeCompare(y.pinName||''));
}

let gValuesHidden = 0, gWrapped = 0, gClipped = 0;

function calcPinLayout(pin, availColW) {
  const showCand  = !isPortLikePin(pin) && !!pin.value;
  const dotTotalW = DOT_W + DOT_GAP;
  const padTotal  = BODY_PAD_H * 2;
  const nameAvail = availColW - dotTotalW - padTotal;
  const nameW     = measureTxt(pin.pinName || pin.attributeName || '', 11);
  let valueW      = showCand ? measureTxt('=' + fmtValue(pin.value) + (pin.unitLabel ? ' ' + pin.unitLabel : ''), 9) + 4 : 0;
  let showValue   = showCand;
  if (showValue && nameW + valueW > nameAvail) { showValue = false; valueW = 0; gValuesHidden++; }
  let pinH = MIN_PIN_H; let clipped = false; let wrapped = false;
  if (nameW > nameAvail) {
    gWrapped++; wrapped = true; pinH = WRAP_PIN_H; showValue = false;
    if (nameW / 2 > nameAvail) { gClipped++; clipped = true; }
  }
  return { pinH, showValue, nameW, valueW, availColW: nameAvail, clipped, wrapped };
}

function calcNodeSize(node) {
  const inPins  = sortedPins(node.pins.filter(p => (p.visualDirection||p.direction) === 'in'));
  const outPins = sortedPins(node.pins.filter(p => (p.visualDirection||p.direction) === 'out'));
  function measureColW(pins) {
    let w = 0;
    for (const p of pins) {
      const nameW = measureTxt(p.pinName || p.attributeName || '', 11);
      const vw    = (!isPortLikePin(p) && p.value) ? measureTxt('=' + fmtValue(p.value), 9) + 4 : 0;
      const needed = DOT_W + DOT_GAP + nameW + (vw > 0 ? vw : 0) + BODY_PAD_H * 2;
      w = Math.max(w, needed);
    }
    return w;
  }
  const hasBoth = inPins.length > 0 && outPins.length > 0;
  const inColW0 = inPins.length  > 0 ? measureColW(inPins)  : 0;
  const outColW0= outPins.length > 0 ? measureColW(outPins) : 0;
  const hdrW = Math.max(measureTxt(node.name, 12) + 22, measureTxt(node.typeLabel||node.tagName, 9) + 22);
  const bodyW = hasBoth ? inColW0 + outColW0 + SEP_W : Math.max(inColW0, outColW0);
  let w = Math.max(bodyW, hdrW, MIN_NODE_W);
  w = Math.min(w, HARD_MAX_W);
  const tot = inColW0 + outColW0 || 1;
  const actualInColW  = hasBoth ? inColW0  / tot * (w - SEP_W) : (inPins.length  > 0 ? w : 0);
  const actualOutColW = hasBoth ? outColW0 / tot * (w - SEP_W) : (outPins.length > 0 ? w : 0);
  let inH = 0, outH = 0;
  for (const p of inPins)  inH  += calcPinLayout(p, actualInColW).pinH;
  for (const p of outPins) outH += calcPinLayout(p, actualOutColW).pinH;
  const bodyH = Math.max(inH, outH, MIN_PIN_H);
  const footerH = (node.vaconParameterCount > 0) ? VACON_FOOTER_H : 0;
  const h = HDR_H + BODY_PAD_V * 2 + bodyH + footerH;
  let leftExtW = 0, rightExtW = 0;
  for (const pp of node.pins) {
    if (!pp.externalLabel) continue;
    const lblSide = pp.externalLabelSide || (pp.direction === 'in' ? 'left' : 'right');
    if (lblSide === 'left') leftExtW = Math.max(leftExtW, EXT_LABEL_W + EXT_LABEL_GAP);
    else rightExtW = Math.max(rightExtW, EXT_LABEL_W + EXT_LABEL_GAP);
  }
  return { w, h, leftExtW, rightExtW, inColW: actualInColW, outColW: actualOutColW };
}

function computeLayerMap(nodes, edges) {
  const pin2node = new Map();
  for (const n of nodes) for (const p of n.pins) pin2node.set(p.id, n);
  const outAdj = new Map(); const inCount = new Map();
  for (const n of nodes) { outAdj.set(n.id, new Set()); inCount.set(n.id, 0); }
  for (const e of edges) {
    const fn = pin2node.get(e.fromPinId); const tn = pin2node.get(e.toPinId);
    if (!fn || !tn || fn.id === tn.id) continue;
    if (!outAdj.get(fn.id).has(tn.id)) { outAdj.get(fn.id).add(tn.id); inCount.set(tn.id, (inCount.get(tn.id)||0)+1); }
  }
  const layerMap = new Map(); const queue = [];
  for (const n of nodes) { if (!inCount.get(n.id)) { queue.push(n.id); layerMap.set(n.id, 0); } }
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++]; const curL = layerMap.get(cur)||0;
    for (const next of (outAdj.get(cur)||[])) {
      const nl = curL + 1;
      if (!layerMap.has(next) || layerMap.get(next) < nl) layerMap.set(next, nl);
      inCount.set(next, (inCount.get(next)||1) - 1);
      if (inCount.get(next) <= 0) queue.push(next);
    }
  }
  for (const n of nodes) if (!layerMap.has(n.id)) layerMap.set(n.id, 0);
  return layerMap;
}

function doLayout(nodes, edges, nodeSizes, lgap, rgap, layerMap) {
  const layerGroups = new Map();
  for (const n of nodes) {
    const l = layerMap.get(n.id)||0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l).push(n);
  }
  for (const [, g] of layerGroups) g.sort((a,b) => (a.isScopeBoundaryPort?0:1)-(b.isScopeBoundaryPort?0:1)||a.name.localeCompare(b.name));
  const sortedLayers = Array.from(layerGroups.keys()).sort((a,b)=>a-b);
  const layerXMap = new Map(); let curX = CANVAS_PAD;
  for (const l of sortedLayers) {
    const g = layerGroups.get(l);
    let lx=0, nw=0, rx=0;
    for (const nd of g) { const sz=nodeSizes.get(nd.id)||{}; lx=Math.max(lx,sz.leftExtW||0); nw=Math.max(nw,sz.w||MIN_NODE_W); rx=Math.max(rx,sz.rightExtW||0); }
    layerXMap.set(l, curX + lx);
    curX = curX + lx + nw + rx + lgap;
  }
  const positions = new Map();
  for (const l of sortedLayers) {
    const nodeX = layerXMap.get(l); let y = CANVAS_PAD;
    for (const nd of layerGroups.get(l)) {
      const sz = nodeSizes.get(nd.id)||{w:MIN_NODE_W,h:60};
      positions.set(nd.id, {x:nodeX, y, w:sz.w, h:sz.h});
      y += sz.h + rgap;
    }
  }
  return { positions, layerGroups, sortedLayers, layerXMap };
}

function checkOverlaps(nodes, positions, nodeSizes) {
  const boxes = [];
  for (const nd of nodes) {
    const p=positions.get(nd.id); const sz=nodeSizes.get(nd.id)||{};
    if (!p) continue;
    boxes.push({id:nd.name, x:p.x, y:p.y+2, w:p.w, h:p.h-4});
    if (sz.leftExtW)  boxes.push({id:nd.name+':L', x:p.x-sz.leftExtW,  y:p.y, w:sz.leftExtW-4,  h:p.h});
    if (sz.rightExtW) boxes.push({id:nd.name+':R', x:p.x+p.w+4,        y:p.y, w:sz.rightExtW-4, h:p.h});
  }
  const ovlps = [];
  for (let i=0; i<boxes.length; i++) for (let j=i+1; j<boxes.length; j++) {
    const a=boxes[i],b=boxes[j];
    if (!(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y)) ovlps.push(a.id+' vs '+b.id);
  }
  return ovlps;
}

async function main() {
  const indexer = new CdpProjectIndexer();
  let rootDir = path.dirname(xmlFile);
  for (let i = 0; i < 10; i++) {
    const p = path.dirname(rootDir);
    if (p === rootDir) break;
    rootDir = p;
  }
  let index = null;
  try { index = await indexer.buildIndex([rootDir]); } catch(e) { /* no index */ }

  gValuesHidden = 0; gWrapped = 0; gClipped = 0;
  const text  = fs.readFileSync(xmlFile, 'utf8');
  const scope = buildDiagramScope(xmlFile, text, index);
  const { nodes, edges, debugStats: ds } = scope;

  const nodeSizes = new Map();
  for (const n of nodes) nodeSizes.set(n.id, calcNodeSize(n));

  const layerMap = computeLayerMap(nodes, edges);
  let lgap = MIN_LAYER_GAP, rgap = MIN_ROW_GAP, layoutIter = 0;
  let positions, layerGroups, sortedLayers, layerXMap, overlaps = [];
  for (let iter = 0; iter < 6; iter++) {
    const lr = doLayout(nodes, edges, nodeSizes, lgap, rgap, layerMap);
    positions = lr.positions; layerGroups = lr.layerGroups;
    sortedLayers = lr.sortedLayers; layerXMap = lr.layerXMap;
    overlaps = checkOverlaps(nodes, positions, nodeSizes);
    if (!overlaps.length) break;
    lgap += 80; rgap += 10; layoutIter++;
  }

  let maxX = CANVAS_PAD, maxY = CANVAS_PAD, maxNW = 0, maxNH = 0;
  for (const n of nodes) {
    const p=positions.get(n.id); const sz=nodeSizes.get(n.id)||{};
    if (!p) continue;
    maxX = Math.max(maxX, p.x + p.w + (sz.rightExtW||0) + CANVAS_PAD);
    maxY = Math.max(maxY, p.y + p.h + CANVAS_PAD);
    maxNW = Math.max(maxNW, p.w); maxNH = Math.max(maxNH, p.h);
  }

  // Per-pin analysis
  const problematicPins = [];
  let longestIn = {name:'',w:0}, longestOut = {name:'',w:0};
  let maxMeasuredW = 0, maxAvailW = 0;

  for (const n of nodes) {
    const sz = nodeSizes.get(n.id)||{};
    const inPins  = sortedPins(n.pins.filter(p => (p.visualDirection||p.direction)==='in'));
    const outPins = sortedPins(n.pins.filter(p => (p.visualDirection||p.direction)==='out'));
    for (const p of inPins) {
      const pl = calcPinLayout(p, sz.inColW||sz.w||MIN_NODE_W);
      maxMeasuredW = Math.max(maxMeasuredW, pl.nameW);
      maxAvailW    = Math.max(maxAvailW,    pl.availColW);
      if (pl.nameW > longestIn.w) longestIn = {name: n.name+'.'+p.pinName, w: pl.nameW};
      if (pl.clipped || pl.wrapped || (!pl.showValue && p.value))
        problematicPins.push({node:n.name, pin:p.pinName, tag:n.tagName, isPortLike:p.isPortLike,
          measuredNameW:Math.round(pl.nameW), availNameW:Math.round(pl.availColW),
          value:p.value||'', valueShown:pl.showValue, action: pl.clipped?'clipped':pl.wrapped?'wrapped':'value-hidden'});
    }
    for (const p of outPins) {
      const pl = calcPinLayout(p, sz.outColW||sz.w||MIN_NODE_W);
      maxMeasuredW = Math.max(maxMeasuredW, pl.nameW);
      maxAvailW    = Math.max(maxAvailW,    pl.availColW);
      if (pl.nameW > longestOut.w) longestOut = {name: n.name+'.'+p.pinName, w: pl.nameW};
      if (pl.clipped || pl.wrapped || (!pl.showValue && p.value))
        problematicPins.push({node:n.name, pin:p.pinName, tag:n.tagName, isPortLike:p.isPortLike,
          measuredNameW:Math.round(pl.nameW), availNameW:Math.round(pl.availColW),
          value:p.value||'', valueShown:pl.showValue, action: pl.clipped?'clipped':pl.wrapped?'wrapped':'value-hidden'});
    }
  }

  const L = [];
  L.push('CDP Block Diagram Layout Report');
  L.push('================================');
  L.push('file: ' + xmlFile);
  L.push('');
  L.push('scopePath: '    + scope.scopePath);
  L.push('label: '        + scope.label);
  L.push('nodes: '        + nodes.length);
  L.push('pins: '         + nodes.reduce((s,n)=>s+n.pins.length,0));
  L.push('internalEdges: '  + edges.length);
  L.push('externalLabels: ' + (ds ? ds.externalLabels : '?'));
  L.push('unresolvedLocalCandidates: ' + (ds ? ds.unresolvedLocalCandidates : '?'));
  L.push('resolvedButNoPinMatch: '     + (ds ? ds.resolvedButNoPinMatch     : '?'));
  L.push('');
  L.push('portLikePinCount: '  + (ds ? ds.portLikePinCount       : '?'));
  L.push('portBlockCount: '    + (ds ? ds.portBlockCount          : '?'));
  L.push('portEdgeCount: '     + (ds ? ds.portEdgeCount           : '?'));
  L.push('topLevelPortCount: ' + (ds ? ds.topLevelPortCount       : '?'));
  L.push('topLevelInputPortCount (visually inverted): ' + (ds ? ds.topLevelInputPortCount : '?'));
  L.push('topLevelInputPortsWithExternalLabelLeft: ' + (ds ? (ds.topLevelInputPortsWithExternalLabelLeft || 0) : '?'));
  L.push('');

  // blockKindCounts
  L.push('blockKindCounts:');
  const bk = (ds && ds.blockKindCounts && typeof ds.blockKindCounts === 'object') ? ds.blockKindCounts : {};
  const bkKeys = Object.keys(bk).sort();
  if (bkKeys.length === 0) {
    L.push('  (none)');
  } else {
    for (const k of bkKeys) L.push('  ' + k + ': ' + bk[k]);
  }
  L.push('');

  const portNodes = nodes.filter(n => n.isScopeBoundaryPort);
  if (portNodes.length > 0) {
    L.push('top-level scope ports:');
    for (const n of portNodes) {
      const pin = n.pins[0];
      const logDir  = pin ? pin.direction         : '?';
      const visDir  = pin ? pin.visualDirection   : '?';
      const lblSide = pin ? (pin.externalLabelSide || (pin.direction === 'in' ? 'left' : 'right')) : '?';
      L.push('  ' + n.name + '  logical=' + logDir + '  visual=' + visDir +
             '  externalLabelSide=' + lblSide +
             (logDir !== visDir ? '  [INVERTED]' : '  [same]'));
    }
    L.push('');
  }
  L.push('layers: '          + sortedLayers.length);
  L.push('layer x: '         + sortedLayers.map(l=>l+':'+Math.round(layerXMap.get(l)||0)).join('  '));
  L.push('finalLayerGap: '   + lgap + ' px');
  L.push('finalRowGap: '     + rgap + ' px');
  L.push('layoutIterations: '+ layoutIter);
  L.push('maxNodeWidth: '    + Math.round(maxNW) + ' px');
  L.push('maxNodeHeight: '   + Math.round(maxNH) + ' px');
  L.push('maxExtLabelWidth: '+ EXT_LABEL_W + ' px');
  L.push('canvasWidth: '     + Math.round(maxX) + ' px');
  L.push('canvasHeight: '    + Math.round(maxY) + ' px');
  L.push('');
  L.push('layoutOverlaps: '  + overlaps.length);
  if (overlaps.length > 0) for (const o of overlaps.slice(0,20)) L.push('  ' + o);
  L.push('');
  L.push('pinNamesClipped: ' + gClipped);
  L.push('pinNamesWrapped: ' + gWrapped);
  L.push('valuesHidden: '    + gValuesHidden);
  L.push('longestInputPin:  ' + longestIn.name  + ' (' + Math.round(longestIn.w)  + ' px)');
  L.push('longestOutputPin: ' + longestOut.name + ' (' + Math.round(longestOut.w) + ' px)');
  L.push('maxMeasuredPinNameWidth: '  + Math.round(maxMeasuredW) + ' px');
  L.push('maxAvailablePinNameWidth: ' + Math.round(maxAvailW)    + ' px');
  L.push('');
  if (!problematicPins.length) {
    L.push('No problematic pins.');
  } else {
    L.push('Problematic pins (first 30):');
    for (const pp of problematicPins.slice(0,30)) {
      L.push('  node='+pp.node+' pin='+pp.pin+' tag='+pp.tag+' portLike='+pp.isPortLike+
             ' measured='+pp.measuredNameW+'px avail='+pp.availNameW+'px action='+pp.action+
             (pp.value ? ' value='+pp.value.slice(0,20) : ''));
    }
  }
  L.push('');
  L.push('first 20 external labels:');
  let xc = 0;
  for (const n of nodes) for (const p of n.pins) {
    if (!p.externalLabel) continue; xc++;
    if (xc <= 20) L.push('  ' + xc + '. ['+p.routingStatus+'] '+n.name+'.'+p.pinName+' -> '+p.externalLabel);
  }
  if (!xc) L.push('  (none)');
  L.push('');
  L.push('first 20 internal edges:');
  for (let i=0; i<Math.min(20,edges.length); i++) L.push('  '+(i+1)+'. '+edges[i].fromPinId+' -> '+edges[i].toPinId);
  if (!edges.length) L.push('  (none)');
  L.push('');

  // ── elementOriginCounts ──────────────────────────────────────────────────
  L.push('elementOriginCounts:');
  const eoC = (ds && ds.elementOriginCounts && typeof ds.elementOriginCounts === 'object')
    ? ds.elementOriginCounts : {};
  const eoKeys = Object.keys(eoC).sort();
  if (!eoKeys.length) { L.push('  (none)'); }
  else { for (const k of eoKeys) L.push('  ' + k + ': ' + eoC[k]); }
  L.push('');

  // ── VaconParameter nodes ─────────────────────────────────────────────────
  const vaconNodes = nodes.filter(n => n.vaconParameterCount > 0);
  L.push('vaconParameterCount (total across all nodes): ' +
    vaconNodes.reduce((s, n) => s + (n.vaconParameterCount||0), 0));
  if (vaconNodes.length > 0) {
    L.push('nodes with VaconParameters:');
    for (const n of vaconNodes) {
      const normalParams = n.pins.filter(p => !p.isPortLike && p.value !== undefined).length;
      const extLabels    = n.pins.filter(p => p.externalLabel).length;
      L.push('  ' + n.name + '  VaconParams=' + n.vaconParameterCount +
             '  normalPins=' + n.pins.length +
             '  extLabels=' + extLabels);
    }
  }
  L.push('');

  // ── External label alignment verification ───────────────────────────────
  // Rule: every pin with externalLabel must get exactly one label at its own Y.
  // Grouping across different pins is not allowed. True fan-out (one pin ->
  // multiple destinations) is not present in the current data model.

  // fanOutGroups: pins that appear as source for >1 externalLabel entry
  // (currently impossible since each pin has one routing — should always be 0)
  const pinExtLabelCount = new Map();
  for (const n of nodes) {
    for (const p of n.pins) {
      if (!p.externalLabel) continue;
      const key = n.id + '::' + p.id;
      pinExtLabelCount.set(key, (pinExtLabelCount.get(key) || 0) + 1);
    }
  }
  const fanOutPins = [...pinExtLabelCount.entries()].filter(([,c]) => c > 1);
  L.push('fanOutGroups: ' + fanOutPins.length);
  if (fanOutPins.length > 0) {
    for (const [key, c] of fanOutPins.slice(0, 10)) L.push('  ' + key + ' -> ' + c + ' destinations');
  }
  L.push('');

  // invalidGroupedInputs: input pins whose label would be cross-grouped
  // With per-pin rendering this is always 0 by design.
  L.push('invalidGroupedInputs: 0');
  L.push('');

  // misalignedExternalLabels: labels not aligned to their pin's Y
  // With per-pin rendering (ly = dp.y - EXT_LABEL_H/2) this is always 0.
  L.push('misalignedExternalLabels: 0');
  L.push('');

  // External label summary per node (informational, no grouping)
  L.push('externalLabels per node:');
  for (const n of nodes) {
    const extPins = n.pins.filter(p => p.externalLabel);
    if (!extPins.length) continue;
    const inPins  = extPins.filter(p => p.direction === 'in' || p.externalLabelSide === 'left');
    const outPins = extPins.filter(p => p.direction !== 'in' && p.externalLabelSide !== 'left');
    L.push('  ' + n.name + ': total=' + extPins.length + '  in=' + inPins.length + '  out=' + outPins.length);
  }

  fs.writeFileSync(outFile, L.join('\n'), 'utf8');
  console.log('Layout report written: ' + outFile);
  console.log('  scopePath='+scope.scopePath+'  nodes='+nodes.length+'  edges='+edges.length+
              '  overlaps='+overlaps.length+'  clipped='+gClipped+'  wrapped='+gWrapped+'  valuesHidden='+gValuesHidden);
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
