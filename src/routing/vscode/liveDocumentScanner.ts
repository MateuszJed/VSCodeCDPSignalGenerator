/**
 * liveDocumentScanner.ts (vscode)
 *
 * Always parses routing occurrences from the current TextDocument text.
 * This is the source of truth for hover/definition/decorations on open documents.
 */
import * as vscode from "vscode";
import { CdpProjectIndex, RoutingAttributeOccurrence } from "../core/types";
import { parseXml } from "../core/xmlScanner";
import { collectRoutingOccurrences } from "../core/routingAttributeParser";
import { containsPosition } from "./rangeAdapter";

/**
 * Scan the live text of a document for routing occurrences.
 * Uses the index to obtain the correct CDP context path for the file, but
 * reads every routing value fresh from the document buffer.
 */
export function scanLiveDocument(
  document: vscode.TextDocument,
  index: CdpProjectIndex | null
): RoutingAttributeOccurrence[] {
  const text = document.getText();
  const elements = parseXml(text);
  const occurrences: RoutingAttributeOccurrence[] = [];

  // fileContextPaths stores the parent cdpPath (what processElement receives),
  // so split it as-is. Guard against empty string (Application.xml root → "").
  const stored = index?.fileContextPaths.get(document.uri.fsPath)?.[0];
  const basePath = stored ? stored.split(".") : [];

  collectRoutingOccurrences(elements, document.uri.fsPath, basePath, occurrences);
  return occurrences;
}

/**
 * Find the routing occurrence whose value range contains the given position,
 * always reading from the live document — never from cached index occurrences.
 */
export function findLiveOccurrenceAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  index: CdpProjectIndex | null
): RoutingAttributeOccurrence | undefined {
  const occs = scanLiveDocument(document, index);
  return occs.find((occ) => containsPosition(occ.valueRange, position));
}
