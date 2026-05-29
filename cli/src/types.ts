export const CDP_TYPES = ['double', 'bool', 'int', 'unsigned int', 'unsigned short', 'unsigned char', 'float', 'short', 'std::string', 'unsigned int64'] as const;
export type CdpType = typeof CDP_TYPES[number];

export type ElementKind = 'Signal' | 'Parameter' | 'Alarm' | 'Property' | 'Connector' | 'State' | 'StateTransition' | 'Message' | 'Port';

export interface ElementInfo {
  kind: ElementKind;
  /** Name used in C++ code (member variable name) */
  codeName: string;
  /** Name used in XML (may differ from codeName) */
  xmlName: string;
  type?: CdpType;
  fromState?: string;
  toState?: string;
  description?: string;
  unit?: string;
  value?: string;
  input?: boolean;            // true = input, false = output
  /** Alarm level: Error, Warning, Notify */
  level?: string;
  /** Alarm text */
  text?: string;
  /** Parameter min/max */
  min?: string;
  max?: string;
  /** Routing path */
  routing?: string;
}

export interface ParsedClass {
  className: string;
  headerPath: string;
  sourcePath: string;
  xmlPath: string | undefined;
  // Line numbers for insertion points in header
  lastMemberLine: number;
  closingBraceLine: number;
  // Line numbers for insertion points in source
  createEndLine: number;
  createModelEndLine: number;
  sourceEndLine: number;
  // Existing elements for remove/change
  elements: ElementInfo[];
}

/** Map from CdpType to XML Type attribute value */
export function cdpTypeToXmlType(t: CdpType): string {
  if (t === 'std::string') { return 'string'; }
  return t;
}

/** Map from CdpType to XML Model attribute for CDPSignal */
export function cdpTypeToSignalModel(t: CdpType): string {
  const xmlType = t === 'std::string' ? 'string' : t;
  return `CDPSignal&lt;${xmlType}&gt;`;
}
