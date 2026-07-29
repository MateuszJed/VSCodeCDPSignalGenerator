/**
 * diagramModel.ts (core)
 *
 * Data model for the CDP XML block diagram viewer.
 * No vscode dependency.
 */

/** Routing resolution status as seen by the diagram (mirrors RoutingResolution.status). */
export type PinRoutingStatus =
  | "empty"
  | "resolved-internal"   // resolves to an element inside the same diagram scope
  | "resolved-external"   // resolves to an element outside the scope (another file/application)
  | "model-inherited"     // path plausible but target not in project XML
  | "unresolved"          // looks like a typo or missing element
  | "invalid";            // definitely impossible path

export interface DiagramPin {
  id: string;               // unique: nodeId + "::" + pinName
  nodeId: string;
  pinName: string;          // human label: Name of Signal / Port / Argument
  attributeName: string;    // XML attribute carrying the routing value (usually "Routing")
  direction: "in" | "out"; // logical direction: in = receives data, out = provides data
  routing: string;          // raw value from XML
  routingStatus: PinRoutingStatus;
  /** If resolved-internal: id of the target DiagramPin */
  targetPinId?: string;
  /** For external/model-inherited/unresolved: human readable label */
  externalLabel?: string;
  /** Source location in the XML document (file where pin element is declared) */
  filePath: string;
  valueLine: number;
  valueChar: number;
  /** Value="..." attribute (present for Signal and Parameter elements) */
  value?: string;
  /** Unit="..." attribute (present for Parameter elements) */
  unitLabel?: string;
  /**
   * Visual direction for drawing: where the internal connector dot appears.
   * For scope-boundary ports with Input="1" this is "out" (right side),
   * because inside the diagram the port acts as a data source.
   * For all other pins this equals `direction`.
   */
  visualDirection: "in" | "out";
  /**
   * Which side the external routing label is drawn on.
   * For top-level input ports (Input="1"): "left" — source comes from outside scope.
   * For top-level output ports (Input="0"): "right" — destination is outside scope.
   * For all other pins: follows visualDirection ("in" → "left", "out" → "right").
   */
  externalLabelSide: "left" | "right";
  /**
   * Describes where the element was defined / how it was created.
   * Used for visual differentiation and layout reporting.
   */
  elementOrigin: ElementOrigin;
  /** True if this pin is a port or port-like interface endpoint. */
  isPortLike: boolean;
  /**
   * True if this pin belongs to a Port element declared directly in the
   * current scope file (i.e. a top-level boundary port of the open component).
   */
  isScopeBoundaryPort: boolean;
}

/**
 * Describes where a pin or node element was defined or how it is managed.
 * - "xml-configured"          explicitly written in the scope's own XML
 * - "model-defined"           comes from the component model src XML (not in scope XML)
 * - "code-created"            created by C++ .Create() — not detectable from XML alone
 * - "runtime-service"         managed by a runtime or framework service
 * - "drive-parameter-service" VaconParameter / AnyParameterService managed drive params
 * - "unknown"                 default fallback
 */
export type ElementOrigin =
  | "xml-configured"
  | "model-defined"
  | "code-created"
  | "runtime-service"
  | "drive-parameter-service"
  | "unknown";

/**
 * Visual category of a diagram node, used for CSS-class-based styling.
 * - "port"          top-level scope boundary Port
 * - "cdp-component" CDPComponent (typeLabel === "CDPComponent" or no lib namespace)
 * - "model-library" reusable model/library block (typeLabel contains a Lib namespace)
 * - "operator"      Automation operator block (typeLabel contains Automation/Operator/Limiter)
 * - "signal"        scope-level Signal node
 * - "alarm"         Alarm element
 * - "unknown"       anything else
 */
export type BlockKind = "port" | "cdp-component" | "model-library" | "operator" | "signal" | "alarm" | "unknown";

export interface DiagramNode {
  id: string;             // full CDP path (e.g. "CraneApp.Boom.AxisCtrl")
  name: string;           // Name attribute value
  typeLabel: string;      // Model attribute value (e.g. "ECMCLib.AxisCtrl")
  tagName: string;        // Subcomponent, Operator, Port, Signal, etc.
  /** Absolute path to the src XML file (only set for Subcomponent nodes). */
  srcFile?: string;
  filePath: string;       // file where this element is declared in the scope
  elementLine: number;    // start line of the element's start tag
  pins: DiagramPin[];
  /** True if this node is a top-level scope boundary port block. */
  isScopeBoundaryPort: boolean;
  /** Visual category for block styling. */
  blockKind: BlockKind;
  /**
   * Number of VaconParameter elements found in the component src XML.
   * Only non-zero for Subcomponent nodes whose src file contains a
   * VaconParameters container. These are shown as a summary footer row.
   */
  vaconParameterCount: number;
}

export interface DiagramEdge {
  id: string;
  fromPinId: string;      // output pin (source of data)
  toPinId: string;        // input pin (destination)
  routingStatus: PinRoutingStatus;
}

export interface DiagramScopeDebugStats {
  /** Number of edges resolved as internal (source and target both inside scope). */
  internalEdges: number;
  /** Number of external label pins (resolved-external + unresolved with routing). */
  externalLabels: number;
  unresolvedLocalCandidates: number;
  resolvedButNoPinMatch: number;
  /** First ≤20 relative routings that did not become internal edges, for inspection. */
  failedLocalRoutings: string[];
  /** Number of pins detected as port-like. */
  portLikePinCount: number;
  /** Number of nodes that are scope boundary port blocks. */
  portBlockCount: number;
  /** Number of edges where at least one endpoint is port-like. */
  portEdgeCount: number;
  /** Number of top-level scope ports (Port nodes in the scope file). */
  topLevelPortCount: number;
  /** Number of top-level scope Input="1" ports (visually inverted to right side). */
  topLevelInputPortCount: number;
  /** Number of top-level input ports whose external label is on the left side. */
  topLevelInputPortsWithExternalLabelLeft: number;
  /** Counts of nodes per blockKind category. */
  blockKindCounts: Record<string, number>;
  /** Counts of pins per elementOrigin category. */
  elementOriginCounts: Record<string, number>;
}

export interface DiagramScope {
  /** The CDP path of the component whose direct children we are visualising. */
  scopePath: string;
  /** Human-readable label, e.g. the file name or component name. */
  label: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Pins that point outside this scope (no edge drawn, label rendered instead). */
  externalPins: DiagramPin[];
  /** Diagnostic counts populated by the builder. */
  debugStats: DiagramScopeDebugStats;
}
