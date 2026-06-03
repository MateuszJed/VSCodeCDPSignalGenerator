/**
 * Core CDP routing types — no vscode dependency.
 * All ranges use TextRange; all file references use plain string paths.
 */

export interface TextRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface CdpXmlAttribute {
  name: string;
  value: string;
  nameRange: TextRange;
  valueRange: TextRange;
  fullRange: TextRange;
}

export interface CdpXmlElement {
  tagName: string;
  attributes: Map<string, CdpXmlAttribute>;
  filePath: string;
  range: TextRange;
  startTagRange: TextRange;
  parent?: CdpXmlElement;
  children: CdpXmlElement[];
}

export interface CdpIndexEntry {
  fullPath: string;
  pathParts: string[];
  name: string;
  tagName: string;
  model?: string;
  filePath: string;
  range: TextRange;
  nameRange?: TextRange;
  element: CdpXmlElement;
}

export interface RoutingAttributeOccurrence {
  filePath: string;
  attributeName: string;
  routing: string;
  valueRange: TextRange;
  fullRange: TextRange;
  owningElement: CdpXmlElement;
  contextPath: string;
}

export interface CdpProjectIndex {
  applications: Set<string>;
  entriesByFullPath: Map<string, CdpIndexEntry[]>;
  entriesByFile: Map<string, CdpIndexEntry[]>;
  fileContextPaths: Map<string, string[]>;
  knownPrefixes: Set<string>;
  routingOccurrencesByFile: Map<string, RoutingAttributeOccurrence[]>;
  stats: CdpRoutingIndexStats;
  buildTimeMs: number;
}

export interface CdpRoutingIndexStats {
  xmlFilesTotal: number;
  xmlFilesIndexed: number;
  applicationsIndexed: number;
  namedElementsIndexed: number;
  routingAttributesFound: number;
  emptyRoutings: number;
  resolvedRoutings: number;
  externalRoutings: number;
  modelInheritedRoutings: number;
  unresolvedRoutings: number;
  invalidRoutings: number;
}

export type RoutingResolution =
  | {
      status: "empty";
      routing: string;
      contextPath: string;
    }
  | {
      status: "resolved";
      routing: string;
      contextPath: string;
      resolvedPath: string;
      target: CdpIndexEntry;
    }
  | {
      status: "external";
      routing: string;
      contextPath: string;
      candidatePath: string;
      externalApplication: string;
      reason: string;
    }
  | {
      status: "model-inherited";
      routing: string;
      contextPath: string;
      candidatePath: string;
      nearestKnownParent: CdpIndexEntry;
      reason: string;
    }
  | {
      status: "unresolved";
      routing: string;
      contextPath: string;
      candidatePath: string;
      nearestKnownPrefix?: string;
      reason: string;
    }
  | {
      status: "invalid";
      routing: string;
      contextPath: string;
      candidatePath?: string;
      reason: string;
    };
