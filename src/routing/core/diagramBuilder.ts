/**
 * diagramBuilder.ts (core)
 *
 * Builds a DiagramScope from a live document text + project index.
 *
 * Strategy (Phase 1):
 *  - The scope is the component described by the open file (e.g. Boom.xml → CraneApp.Boom).
 *  - Direct named children of that component become diagram nodes:
 *      Subcomponent  → follow src="..." to load the referenced XML; extract
 *                       Signal and Port elements as input/output pins.
 *      Operator      → Arguments are pins (inline in scope file).
 *      Port          → Scope-level interface node (1 proxy pin per port).
 *      Signal        → Scope-level signal node only when routing is non-empty.
 *  - Routing on pins is resolved against the project index.
 *  - Internal edges connect pins inside the same scope.
 *  - External routings are shown as labels on pins.
 *
 * No vscode dependency — uses Node.js fs for reading src files.
 */

import * as fs from "fs";
import * as path from "path";
import { CdpProjectIndex } from "./types";
import { parseXml, ParsedElement } from "./xmlScanner";
import { isGroupingTag } from "./routingAttributeParser";
import { resolveRouting, computeCandidatePath } from "./routingResolver";
import {
  DiagramScope,
  DiagramNode,
  DiagramPin,
  DiagramEdge,
  BlockKind,
  ElementOrigin,
} from "./diagramModel";

// Signal names that are system/boilerplate and should not appear as diagram pins.
const SKIP_SIGNAL_NAMES = new Set([
  "Process Timer",
  "Process Period",
  "Status",
]);

// All routing attribute names used in CDP XML.
const ROUTING_ATTR_NAMES = [
  "Routing", "InValueRouting", "OutValueRouting",
  "SourceValueRouting", "TargetValueRouting",
];

// ── Port-like detection ────────────────────────────────────────────────────
// A pin is "port-like" if its name or tag suggests it's an interface endpoint.
const PORT_LIKE_PATTERNS = [
  /Port$/i,
  /^Port/i,
  /Port\d+$/i,
  /Ref$/i,
];
const PORT_LIKE_EXACT: Set<string> = new Set([
  "DrivePort", "RefPort", "RefPortIn", "RefPortOut", "DrivesPort",
  "FCPort1", "FCPort2", "I_SpeedRefPort", "O_SpeedRefPort",
  "VaconDrivesPort", "Man1Ref", "Man2Ref", "AMC1Ref", "AMC2Ref",
]);

function detectPortLike(name: string, tagName: string): boolean {
  if (tagName === "Port" || tagName === "Connection") { return true; }
  if (PORT_LIKE_EXACT.has(name)) { return true; }
  for (const p of PORT_LIKE_PATTERNS) {
    if (p.test(name)) { return true; }
  }
  return false;
}

// ── Block kind detection ───────────────────────────────────────────────────
const OPERATOR_TYPE_PATTERNS = [
  /^Automation\./i,
  /Operator/i,
  /Limiter/i,
];
const LIB_NAMESPACE_PATTERN = /^[A-Za-z]\w*Lib\./;

function detectBlockKind(tagName: string, typeLabel: string): BlockKind {
  if (tagName === "Port") { return "port"; }
  if (tagName === "Signal") { return "signal"; }
  if (tagName === "Alarm") { return "alarm"; }
  if (tagName === "Operator") {
    // Operators may still be typed — check typeLabel
    for (const p of OPERATOR_TYPE_PATTERNS) {
      if (p.test(typeLabel)) { return "operator"; }
    }
    return "operator";
  }
  if (tagName === "Subcomponent") {
    // Check typeLabel for known patterns
    for (const p of OPERATOR_TYPE_PATTERNS) {
      if (p.test(typeLabel)) { return "operator"; }
    }
    if (LIB_NAMESPACE_PATTERN.test(typeLabel)) { return "model-library"; }
    if (typeLabel === "CDPComponent" || typeLabel === tagName || !typeLabel.includes(".")) {
      return "cdp-component";
    }
    // Qualified name without Lib suffix → still model-library
    if (typeLabel.includes(".")) { return "model-library"; }
    return "cdp-component";
  }
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a src="..." attribute to an absolute file path.
 * CDP src paths are relative to the Application root directory.
 * We find it by walking up from the declaring file until the combined path exists.
 */
function resolveSrcPath(srcAttr: string, fromFilePath: string): string | null {
  let dir = path.dirname(fromFilePath);
  for (let depth = 0; depth < 10; depth++) {
    const candidate = path.join(dir, srcAttr);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) { break; }
    dir = parent;
  }
  return null;
}

/**
 * Get the best routing attribute value from an element.
 * Returns { attrName, value } for the first routing attr that has a non-empty value,
 * or the first routing attr that exists.
 */
function getRoutingAttr(el: ParsedElement): { attrName: string; value: string; line: number; char: number } | null {
  for (const name of ROUTING_ATTR_NAMES) {
    const attr = el.attributes.get(name);
    if (attr !== undefined) {
      return {
        attrName: name,
        value: attr.value.trim(),
        line: attr.valueRange.startLine,
        char: attr.valueRange.startCharacter,
      };
    }
  }
  return null;
}

/**
 * Collect all direct named non-grouping children of a root element, recursing
 * into grouping containers (Signals, Ports, Subcomponents, etc.).
 */
function collectScopeChildren(root: ParsedElement): ParsedElement[] {
  const result: ParsedElement[] = [];

  function walk(el: ParsedElement, depth: number) {
    for (const child of el.children) {
      const name = child.attributes.get("Name")?.value;
      if (name && !isGroupingTag(child.tagName)) {
        result.push(child);
      } else if (isGroupingTag(child.tagName) && depth < 4) {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return result;
}

/**
 * Extract public Signal and Port elements from the root element of a src file.
 * Only top-level Signals and Ports containers are scanned.
 *
 * Pin IDs follow the convention  ${nodeId}::${signalOrPortName}
 * so they can be resolved via `targetNode::targetName` lookups.
 */
function extractPinsFromSrcRoot(
  rootEl: ParsedElement,
  nodeId: string,
  srcFilePath: string,
): { pins: DiagramPin[]; vaconParameterCount: number } {
  const pins: DiagramPin[] = [];

  for (const container of rootEl.children) {
    const isSignals = container.tagName === "Signals";
    const isPorts   = container.tagName === "Ports";
    const isParams  = container.tagName === "Parameters";
    if (!isSignals && !isPorts && !isParams) { continue; }

    for (const el of container.children) {
      const isSignal = el.tagName === "Signal";
      const isPort   = el.tagName === "Port";
      const isParam  = el.tagName === "Parameter" || el.tagName === "Param";
      if (!isSignal && !isPort && !isParam) { continue; }

      const name = el.attributes.get("Name")?.value ?? "";
      if (!name || SKIP_SIGNAL_NAMES.has(name)) { continue; }

      // Determine direction
      const inputAttr = el.attributes.get("Input");
      let direction: "in" | "out";
      if (inputAttr) {
        direction = inputAttr.value === "1" ? "in" : "out";
      } else if (isParam) {
        direction = "out"; // Parameters expose values to outside
      } else {
        // If it has a routing attribute it receives data → input
        const r = getRoutingAttr(el);
        direction = r && r.value ? "in" : "out";
      }

      const routingInfo = getRoutingAttr(el);
      const routing = routingInfo?.value ?? "";

      // Value/unit: only meaningful for Signal and Parameter elements
      const valueStr = (isSignal || isParam)
        ? el.attributes.get("Value")?.value?.trim() || undefined
        : undefined;
      const unitStr = isParam
        ? el.attributes.get("Unit")?.value?.trim() || undefined
        : undefined;

      pins.push({
        id: `${nodeId}::${name}`,
        nodeId,
        pinName: name,
        attributeName: routingInfo?.attrName ?? "Routing",
        direction,
        routing,
        routingStatus: "empty",
        filePath: srcFilePath,
        valueLine: routingInfo?.line ?? el.startTagRange.startLine,
        valueChar: routingInfo?.char ?? el.startTagRange.startCharacter,
        value: valueStr,
        unitLabel: unitStr,
        visualDirection: direction,
        externalLabelSide: direction === "in" ? "left" : "right",
        elementOrigin: "model-defined",
        isPortLike: detectPortLike(name, el.tagName),
        isScopeBoundaryPort: false,
      });
    }
  }

  // Count VaconParameter elements (drive-parameter-service managed).
  // They live under a VaconParameters container and are NOT shown as regular pins.
  let vaconParameterCount = 0;
  for (const container of rootEl.children) {
    if (container.tagName === "VaconParameters") {
      for (const el of container.children) {
        if (el.tagName === "VaconParameter") { vaconParameterCount++; }
      }
    } else if (container.tagName === "Parameters") {
      // Some projects nest VaconParameter under Parameters
      for (const el of container.children) {
        if (el.tagName === "VaconParameter") { vaconParameterCount++; }
      }
    }
  }

  return { pins, vaconParameterCount };
}

/**
 * Extract Argument children of an Operator element as pins.
 */
function extractOperatorPins(
  opEl: ParsedElement,
  nodeId: string,
  filePath: string,
): DiagramPin[] {
  const pins: DiagramPin[] = [];

  for (const child of opEl.children) {
    if (child.tagName !== "Argument") { continue; }
    const name = child.attributes.get("Name")?.value ?? "";
    const inputAttr = child.attributes.get("Input");
    if (!name || !inputAttr) { continue; }

    const direction: "in" | "out" = inputAttr.value === "1" ? "in" : "out";
    const routingInfo = getRoutingAttr(child);
    const routing = routingInfo?.value ?? "";

    pins.push({
      id: `${nodeId}::${name}`,
      nodeId,
      pinName: name,
      attributeName: routingInfo?.attrName ?? "Routing",
      direction,
      routing,
      routingStatus: "empty",
      filePath,
      valueLine: routingInfo?.line ?? child.startTagRange.startLine,
      valueChar: routingInfo?.char ?? child.startTagRange.startCharacter,
      visualDirection: direction,
      externalLabelSide: direction === "in" ? "left" : "right",
      elementOrigin: "xml-configured",
      isPortLike: detectPortLike(name, "Argument"),
      isScopeBoundaryPort: false,
    });
  }

  return pins;
}

function shortLabel(fullPath: string): string {
  const parts = fullPath.split(".");
  return parts.length > 4 ? "…" + parts.slice(-3).join(".") : fullPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildDiagramScope(
  filePath: string,
  documentText: string,
  index: CdpProjectIndex | null,
): DiagramScope {
  const elements = parseXml(documentText);
  const label = path.basename(filePath, ".xml");

  const emptyStats = { internalEdges: 0, externalLabels: 0, unresolvedLocalCandidates: 0, resolvedButNoPinMatch: 0, failedLocalRoutings: [], portLikePinCount: 0, portBlockCount: 0, portEdgeCount: 0, topLevelPortCount: 0, topLevelInputPortCount: 0, topLevelInputPortsWithExternalLabelLeft: 0, blockKindCounts: {}, elementOriginCounts: {} };

  if (elements.length === 0) {
    return { scopePath: "", label, nodes: [], edges: [], externalPins: [], debugStats: emptyStats };
  }

  const root = elements[0];

  // ── Compute scope path ────────────────────────────────────────────────────
  // fileContextPaths stores the PARENT cdpPath (e.g. "CraneApp" for Boom.xml).
  // The file's own root element Name (e.g. "Boom") must be appended to get the
  // actual scope path "CraneApp.Boom".
  const stored = index?.fileContextPaths.get(filePath)?.[0];
  const rootName = root.attributes.get("Name")?.value ?? label;
  const scopePath = stored ? `${stored}.${rootName}` : rootName;

  const scopeChildren = collectScopeChildren(root);
  const nodes: DiagramNode[] = [];

  for (const child of scopeChildren) {
    const name = child.attributes.get("Name")?.value ?? "";
    if (!name) { continue; }

    const nodeId = `${scopePath}.${name}`;
    const typeLabel = child.attributes.get("Model")?.value ?? child.tagName;
    const tag = child.tagName;

    let pins: DiagramPin[] = [];
    let srcFile: string | undefined;
    let nodeVaconCount = 0;

    if (tag === "Subcomponent") {
      const srcAttr = child.attributes.get("src")?.value;
      if (srcAttr) {
        const resolved = resolveSrcPath(srcAttr, filePath);
        if (resolved) {
          srcFile = resolved;
          try {
            const srcText = fs.readFileSync(resolved, "utf8");
            const srcEls = parseXml(srcText);
            if (srcEls.length > 0) {
              const srcResult = extractPinsFromSrcRoot(srcEls[0], nodeId, resolved);
              pins = srcResult.pins;
              nodeVaconCount = srcResult.vaconParameterCount;
            }
          } catch {
            // File unreadable — node will appear with no pins
          }
        }
      }

    } else if (tag === "Operator") {
      pins = extractOperatorPins(child, nodeId, filePath);

    } else if (tag === "Port") {
      // Scope-level boundary port — treat it as a single-pin node.
      // The logical direction follows Input="1"→in (Boom receives data from outside).
      // BUT inside the Boom diagram this port is a source of data, so it renders
      // on the right side (visualDirection = "out") when Input="1".
      // Conversely, Input="0" = Boom outputs data = sink inside = left side (visualDirection = "in").
      // IMPORTANT: externalLabelSide follows LOGICAL direction, not visual direction.
      //   Input="1" (logical in): source comes from outside scope → label on LEFT.
      //   Input="0" (logical out): destination is outside scope → label on RIGHT.
      const inputAttr = child.attributes.get("Input");
      const logicalDirection: "in" | "out" = (!inputAttr || inputAttr.value === "1") ? "in" : "out";
      const visualDir: "in" | "out" = logicalDirection === "in" ? "out" : "in";
      const extLabelSide: "left" | "right" = logicalDirection === "in" ? "left" : "right";
      const routingInfo = getRoutingAttr(child);
      const routing = routingInfo?.value ?? "";
      pins = [{
        id: `${nodeId}::${name}`,
        nodeId,
        pinName: name,
        attributeName: routingInfo?.attrName ?? "Routing",
        direction: logicalDirection,
        routing,
        routingStatus: "empty",
        filePath,
        valueLine: routingInfo?.line ?? child.startTagRange.startLine,
        valueChar: routingInfo?.char ?? child.startTagRange.startCharacter,
        visualDirection: visualDir,
        externalLabelSide: extLabelSide,
        elementOrigin: "xml-configured",
        isPortLike: true,
        isScopeBoundaryPort: true,
      }];

    } else if (tag === "Signal") {
      const routingInfo = getRoutingAttr(child);
      const routing = routingInfo?.value ?? "";
      if (!routing) { continue; } // Skip scope-level signals with no routing
      const inputAttr = child.attributes.get("Input");
      const direction: "in" | "out" = (!inputAttr || inputAttr.value === "1") ? "in" : "out";
      const value = child.attributes.get("Value")?.value?.trim() || undefined;
      pins = [{
        id: `${nodeId}::${name}`,
        nodeId,
        pinName: name,
        attributeName: routingInfo?.attrName ?? "Routing",
        direction,
        routing,
        routingStatus: "empty",
        filePath,
        valueLine: routingInfo?.line ?? child.startTagRange.startLine,
        valueChar: routingInfo?.char ?? child.startTagRange.startCharacter,
        value,
        visualDirection: direction,
        externalLabelSide: direction === "in" ? "left" : "right",
        elementOrigin: "xml-configured",
        isPortLike: detectPortLike(name, tag),
        isScopeBoundaryPort: false,
      }];

    } else if (tag === "Parameter" || tag === "Param") {
      const valueAttr = child.attributes.get("Value");
      const value = valueAttr?.value?.trim() || undefined;
      const routingInfo = getRoutingAttr(child);
      const routing = routingInfo?.value ?? "";
      if (!value && !routing) { continue; } // Skip empty parameters
      const inputAttr = child.attributes.get("Input");
      const direction: "in" | "out" = inputAttr ? (inputAttr.value === "1" ? "in" : "out") : "out";
      const unitLabel = child.attributes.get("Unit")?.value?.trim() || undefined;
      pins = [{
        id: `${nodeId}::${name}`,
        nodeId,
        pinName: name,
        attributeName: routingInfo?.attrName ?? "Routing",
        direction,
        routing,
        routingStatus: "empty",
        filePath,
        valueLine: valueAttr?.valueRange.startLine ?? child.startTagRange.startLine,
        valueChar: valueAttr?.valueRange.startCharacter ?? child.startTagRange.startCharacter,
        value,
        unitLabel,
        visualDirection: direction,
        externalLabelSide: direction === "in" ? "left" : "right",
        elementOrigin: "xml-configured",
        isPortLike: false,
        isScopeBoundaryPort: false,
      }];

    } else {
      continue;
    }

    nodes.push({ id: nodeId, name, typeLabel, tagName: tag, srcFile, filePath, elementLine: child.startTagRange.startLine, pins, isScopeBoundaryPort: tag === "Port", blockKind: detectBlockKind(tag, typeLabel), vaconParameterCount: nodeVaconCount });
  }

  // ── Routing resolution ────────────────────────────────────────────────────

  const allPinIds = new Set<string>();
  for (const node of nodes) {
    for (const pin of node.pins) { allPinIds.add(pin.id); }
  }
  const nodeIdSet = new Set(nodes.map(n => n.id));

  let dbgUnresolvedLocalCandidates = 0;
  let dbgResolvedButNoPinMatch = 0;
  const dbgFailedLocalRoutings: string[] = [];

  /**
   * Resolve a relative routing path against the node context and classify it
   * as resolved-internal, resolved-external, or unresolved.
   * Used for both the null-index path and to re-check index-resolved paths.
   */
  function resolveLocalRelative(
    pin: DiagramPin,
    routing: string,
    nodeContextPath: string,
    fromNodeId: string,
  ): void {
    const candidate = computeCandidatePath(routing, nodeContextPath);
    if (!candidate) {
      pin.routingStatus = "invalid";
      pin.externalLabel = routing;
      return;
    }
    const prefix = scopePath + ".";
    if (!candidate.startsWith(prefix)) {
      // Outside current scope
      pin.routingStatus = "resolved-external";
      pin.externalLabel = shortLabel(candidate);
      return;
    }
    const afterScope = candidate.slice(prefix.length);
    const parts = afterScope.split(".");
    const targetNodeId = `${scopePath}.${parts[0]}`;

    if (targetNodeId === fromNodeId) {
      // Self-reference — sub-element within this node (e.g. SpeedError-internal signal)
      pin.routingStatus = "resolved-external";
      pin.externalLabel = shortLabel(candidate);
      if (dbgFailedLocalRoutings.length < 20) {
        dbgFailedLocalRoutings.push(routing + " -> " + candidate + " (self)");
      }
      dbgUnresolvedLocalCandidates++;
      return;
    }
    if (!nodeIdSet.has(targetNodeId)) {
      // References an element inside a subcomponent (not a scope-level node)
      pin.routingStatus = "resolved-external";
      pin.externalLabel = shortLabel(candidate);
      if (dbgFailedLocalRoutings.length < 20) {
        dbgFailedLocalRoutings.push(routing + " -> " + candidate + " (no node)");
      }
      dbgUnresolvedLocalCandidates++;
      return;
    }
    // Target node exists — find the pin
    let targetPinId: string;
    if (parts.length >= 2) {
      const bySubName = `${targetNodeId}::${parts[1]}`;
      targetPinId = allPinIds.has(bySubName) ? bySubName : `${targetNodeId}::${parts[0]}`;
    } else {
      targetPinId = `${targetNodeId}::${parts[0]}`;
    }
    if (allPinIds.has(targetPinId)) {
      pin.routingStatus = "resolved-internal";
      pin.targetPinId = targetPinId;
      pin.externalLabel = undefined;
    } else {
      pin.routingStatus = "unresolved";
      pin.externalLabel = shortLabel(candidate);
      if (dbgFailedLocalRoutings.length < 20) {
        dbgFailedLocalRoutings.push(routing + " -> " + candidate + " (no pin)");
      }
      dbgResolvedButNoPinMatch++;
    }
  }

  for (const node of nodes) {
    // Context for routing resolution:
    // - Scope-level Port/Signal: context = scopePath (the parent component)
    // - Subcomponent/Operator pins come from the src file where the element is
    //   declared; the indexer uses the node's own CDP path as the context.
    const nodeContextPath =
      (node.tagName === "Port" || node.tagName === "Signal")
        ? scopePath
        : `${scopePath}.${node.name}`;

    for (const pin of node.pins) {
      if (!pin.routing) { pin.routingStatus = "empty"; continue; }

      if (!index) {
        // Without a project index, resolve relative paths locally.
        // Absolute paths cannot be looked up without the index.
        if (pin.routing.startsWith(".")) {
          resolveLocalRelative(pin, pin.routing, nodeContextPath, node.id);
        } else {
          pin.routingStatus = "unresolved";
          pin.externalLabel = shortLabel(pin.routing);
        }
        continue;
      }

      const confidenceKnown = index.fileContextPaths.has(filePath);
      const res = resolveRouting(pin.routing, nodeContextPath, index, confidenceKnown);

      switch (res.status) {
        case "empty": pin.routingStatus = "empty"; break;
        case "resolved": {
          const targetPath = res.resolvedPath;
          const prefix = scopePath + ".";
          if (!targetPath.startsWith(prefix)) {
            pin.routingStatus = "resolved-external"; pin.externalLabel = shortLabel(targetPath); break;
          }
          const afterScope = targetPath.slice(prefix.length);
          const parts = afterScope.split(".");
          const targetNodeId = `${scopePath}.${parts[0]}`;

          // Self-reference: routing within the same subcomponent (e.g. SpeedError-internal)
          if (targetNodeId === node.id) {
            pin.routingStatus = "resolved-external"; pin.externalLabel = shortLabel(targetPath);
            dbgUnresolvedLocalCandidates++;
            break;
          }
          if (!nodeIdSet.has(targetNodeId)) {
            pin.routingStatus = "resolved-external"; pin.externalLabel = shortLabel(targetPath);
            dbgUnresolvedLocalCandidates++;
            break;
          }

          // Find the target pin:
          //   If routing goes into a sub-element (e.g. AxisCtrl.DrivePort), use parts[1].
          //   Otherwise (routing targets node directly), use parts[0] (node name).
          let targetPinId: string;
          if (parts.length >= 2) {
            const bySubName = `${targetNodeId}::${parts[1]}`;
            // Also try the target node's own name as fallback (single-pin nodes like
            // scope-level Port "Man1Ref" have pin id = "...::Man1Ref")
            targetPinId = allPinIds.has(bySubName) ? bySubName : `${targetNodeId}::${parts[0]}`;
          } else {
            // Routing targets the node directly (e.g. ".Man1Ref" → "CraneApp.Boom.Man1Ref")
            targetPinId = `${targetNodeId}::${parts[0]}`;
          }

          if (allPinIds.has(targetPinId)) {
            pin.routingStatus = "resolved-internal";
            pin.targetPinId = targetPinId;
            pin.externalLabel = undefined;
          } else {
            pin.routingStatus = "unresolved";
            pin.externalLabel = shortLabel(targetPath);
            dbgResolvedButNoPinMatch++;
          }
          break;
        }
        case "external": pin.routingStatus = "resolved-external"; pin.externalLabel = shortLabel(res.candidatePath); break;
        case "model-inherited": pin.routingStatus = "model-inherited"; pin.externalLabel = shortLabel(res.candidatePath); break;
        case "unresolved": pin.routingStatus = "unresolved"; pin.externalLabel = shortLabel(res.candidatePath); break;
        case "invalid": pin.routingStatus = "invalid"; pin.externalLabel = pin.routing; break;
      }
    }
  }

  // ── Edge building ─────────────────────────────────────────────────────────

  const edges: DiagramEdge[] = [];
  const externalPins: DiagramPin[] = [];
  let edgeIdx = 0;

  for (const node of nodes) {
    for (const pin of node.pins) {
      if (pin.routingStatus === "resolved-internal" && pin.targetPinId) {
        if (allPinIds.has(pin.targetPinId)) {
          edges.push({
            id: `edge_${edgeIdx++}`,
            fromPinId: pin.targetPinId,  // data source (routing target)
            toPinId: pin.id,              // data sink (has the routing attr)
            routingStatus: "resolved-internal",
          });
        } else {
          // Target pin id not found — treat as external
          pin.routingStatus = "resolved-external";
          pin.externalLabel = shortLabel(pin.routing);
          externalPins.push(pin);
        }
      } else if (pin.routingStatus !== "empty" && pin.routing) {
        externalPins.push(pin);
      }
    }
  }

  // Build pin lookup map once for portEdgeCount (avoid repeated flatMap)
  const allPinsFlat = nodes.flatMap(n => n.pins);
  const pinById = new Map<string, DiagramPin>();
  for (const p of allPinsFlat) { pinById.set(p.id, p); }

  // blockKindCounts
  const blockKindCounts: Record<string, number> = {};
  for (const n of nodes) {
    blockKindCounts[n.blockKind] = (blockKindCounts[n.blockKind] ?? 0) + 1;
  }

  // elementOriginCounts
  const elementOriginCounts: Record<string, number> = {};
  for (const p of allPinsFlat) {
    const o = p.elementOrigin ?? "unknown";
    elementOriginCounts[o] = (elementOriginCounts[o] ?? 0) + 1;
  }

  const debugStats = {
    internalEdges: edges.length,
    externalLabels: externalPins.length,
    unresolvedLocalCandidates: dbgUnresolvedLocalCandidates,
    resolvedButNoPinMatch: dbgResolvedButNoPinMatch,
    failedLocalRoutings: dbgFailedLocalRoutings,
    portLikePinCount: allPinsFlat.filter(p => p.isPortLike).length,
    portBlockCount: nodes.filter(n => n.isScopeBoundaryPort).length,
    portEdgeCount: edges.filter(e => (pinById.get(e.fromPinId)?.isPortLike ?? false) || (pinById.get(e.toPinId)?.isPortLike ?? false)).length,
    topLevelPortCount: nodes.filter(n => n.isScopeBoundaryPort).length,
    topLevelInputPortCount: nodes.filter(n => n.isScopeBoundaryPort && n.pins.some(p => p.direction === "in")).length,
    topLevelInputPortsWithExternalLabelLeft: nodes.filter(n =>
      n.isScopeBoundaryPort && n.pins.some(p => p.direction === "in" && p.externalLabelSide === "left")
    ).length,
    blockKindCounts,
    elementOriginCounts,
  };

  return { scopePath, label, nodes, edges, externalPins, debugStats };
}
