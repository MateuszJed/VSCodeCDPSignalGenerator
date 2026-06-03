/**
 * routingAttributeParser.ts (core)
 *
 * Scans a parsed XML tree for *Routing attributes and collects occurrences.
 * No vscode dependency — uses plain file path strings and TextRange.
 */

import { ParsedElement } from "./xmlScanner";
import { CdpXmlElement, CdpXmlAttribute, RoutingAttributeOccurrence } from "./types";

/**
 * Grouping tags that are structural containers — must NOT contribute CDP path segments.
 */
const GROUPING_TAGS = new Set([
  "Subcomponents", "Signals", "Arguments", "Alarms", "Ports", "Properties",
  "Parameters", "Connections", "Messages", "States", "StateTransitions",
  "ExecutionControl", "ObjectDictionary", "Networks", "Nodes", "TPDOs", "RPDOs",
  "Entries", "Routes", "Values", "Commands", "EventHandlers", "Operators",
  "Channels", "ScalingPoints", "Modules", "RemoteAlarms", "Timers", "Transports",
  "MessageDestinations", "SelectorOutputs", "SelectorInputs", "SelectorIndicators",
  "Operations", "Groups", "Subscriptions", "Items", "FlagArguments",
]);

export function isGroupingTag(tagName: string): boolean {
  return GROUPING_TAGS.has(tagName);
}

function toCdpXmlElement(
  parsed: ParsedElement,
  filePath: string,
  parent?: CdpXmlElement
): CdpXmlElement {
  const attrs = new Map<string, CdpXmlAttribute>();
  for (const [k, v] of parsed.attributes) {
    attrs.set(k, {
      name: v.name,
      value: v.value,
      nameRange: v.nameRange,
      valueRange: v.valueRange,
      fullRange: v.fullRange,
    });
  }
  return {
    tagName: parsed.tagName,
    attributes: attrs,
    filePath,
    range: parsed.range,
    startTagRange: parsed.startTagRange,
    parent,
    children: [],
  };
}

/**
 * Scan a list of parsed root elements for *Routing attributes.
 * Tracks the CDP path stack to compute contextPath for each occurrence.
 */
export function collectRoutingOccurrences(
  elements: ParsedElement[],
  filePath: string,
  cdpPath: string[],
  occurrences: RoutingAttributeOccurrence[]
): void {
  for (const el of elements) {
    scanElementForRoutings(el, filePath, cdpPath, occurrences, undefined);
  }
}

function scanElementForRoutings(
  parsed: ParsedElement,
  filePath: string,
  cdpPath: string[],
  occurrences: RoutingAttributeOccurrence[],
  parentCdpElement: CdpXmlElement | undefined
): void {
  const cdpEl = toCdpXmlElement(parsed, filePath, parentCdpElement);

  const nameAttr = parsed.attributes.get("Name");
  const nameValue = nameAttr?.value ?? "";
  const isNamed = !!nameValue && !isGroupingTag(parsed.tagName);

  // Context for routing attrs on THIS element = current cdpPath (parent's path)
  const contextPath = cdpPath.join(".");

  for (const [attrName, attr] of parsed.attributes) {
    if (attrName.endsWith("Routing")) {
      occurrences.push({
        filePath,
        attributeName: attrName,
        routing: attr.value,
        valueRange: attr.valueRange,
        fullRange: attr.fullRange,
        owningElement: cdpEl,
        contextPath,
      });
    }
  }

  const childPath = isNamed ? [...cdpPath, nameValue] : cdpPath;

  for (const child of parsed.children) {
    scanElementForRoutings(child, filePath, childPath, occurrences, cdpEl);
  }
}
