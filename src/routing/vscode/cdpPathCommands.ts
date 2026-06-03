/**
 * cdpPathCommands.ts
 *
 * "CDP: Copy Path" and related commands.
 *
 * Strategy:
 *  1. Parse live document text to walk the CDP path stack and find the element
 *     whose range contains the cursor.
 *  2. Use the stored fileContextPaths base to build the full CDP path, the same
 *     way liveDocumentScanner does.
 *  3. Fall back to index entries for the file if the live walk finds nothing.
 *  4. When multiple candidates exist (e.g. the cursor is on a container element
 *     that appears in several XML files), show a quick-pick.
 */

import * as vscode from "vscode";
import { CdpProjectIndex } from "../core/types";
import { parseXml, ParsedElement, textRangeContainsPosition } from "../core/xmlScanner";
import { isGroupingTag, collectRoutingOccurrences } from "../core/routingAttributeParser";
import { containsPosition } from "./rangeAdapter";
import type { RoutingAttributeOccurrence } from "../core/types";

// ---------------------------------------------------------------------------
// Path walk helpers
// ---------------------------------------------------------------------------

interface PathHit {
  fullPath: string;
  elementName: string;
}

/** Walk the parsed XML tree tracking the CDP path stack; return the deepest
 *  Named (non-grouping) element's path hit. */
function findCdpPathAtPosition(
  elements: ParsedElement[],
  basePath: string[],
  cursorLine: number,
  cursorChar: number
): PathHit | undefined {
  for (const el of elements) {
    const hit = walkElementForPath(el, basePath, cursorLine, cursorChar);
    if (hit) { return hit; }
  }
  return undefined;
}

function walkElementForPath(
  el: ParsedElement,
  cdpPath: string[],
  cursorLine: number,
  cursorChar: number
): PathHit | undefined {
  if (!textRangeContainsPosition(el.range, cursorLine, cursorChar)) {
    return undefined;
  }

  const nameValue = el.attributes.get("Name")?.value ?? "";
  const isNamed = !!nameValue && !isGroupingTag(el.tagName);
  const childPath = isNamed ? [...cdpPath, nameValue] : cdpPath;

  for (const child of el.children) {
    const childHit = walkElementForPath(child, childPath, cursorLine, cursorChar);
    if (childHit) { return childHit; }
  }

  if (isNamed && childPath.length > 0) {
    return { fullPath: childPath.join("."), elementName: nameValue };
  }
  return undefined;
}

/** Find the deepest Named (non-grouping) ParsedElement containing the cursor.
 *  Returns the ParsedElement so callers can inspect attributes and ranges. */
function findNamedElementAtPosition(
  elements: ParsedElement[],
  cursorLine: number,
  cursorChar: number
): ParsedElement | undefined {
  for (const el of elements) {
    const hit = walkElementForParsed(el, cursorLine, cursorChar);
    if (hit) { return hit; }
  }
  return undefined;
}

function walkElementForParsed(
  el: ParsedElement,
  cursorLine: number,
  cursorChar: number
): ParsedElement | undefined {
  if (!textRangeContainsPosition(el.range, cursorLine, cursorChar)) {
    return undefined;
  }

  for (const child of el.children) {
    const childHit = walkElementForParsed(child, cursorLine, cursorChar);
    if (childHit) { return childHit; }
  }

  const nameValue = el.attributes.get("Name")?.value;
  if (nameValue && !isGroupingTag(el.tagName)) {
    return el;
  }
  return undefined;
}

/** Compute a dot-relative routing string from contextPath to absolutePath. */
function computeRelativeRoutingPath(absolutePath: string, contextPath: string): string {
  const contextParts = contextPath.split(".");
  const targetParts = absolutePath.split(".");

  let common = 0;
  while (
    common < contextParts.length &&
    common < targetParts.length &&
    contextParts[common] === targetParts[common]
  ) {
    common++;
  }

  const levelsUp = contextParts.length - common;
  const remainder = targetParts.slice(common).join(".");
  const dots = ".".repeat(levelsUp + 1);
  return remainder ? `${dots}${remainder}` : dots;
}

/** Position just before the closing > or /> of the element's start tag.
 *  startTagRange.endCharacter is exclusive (one past ">"). */
function getRoutingInsertionPosition(el: ParsedElement): vscode.Position {
  const endLine = el.startTagRange.endLine;
  const endChar = el.startTagRange.endCharacter;
  // Self-closing "... />" → insert before "/" at endChar - 2
  // Normal "... >"        → insert before ">" at endChar - 1
  const insertChar = el.selfClosing ? endChar - 2 : endChar - 1;
  return new vscode.Position(endLine, Math.max(0, insertChar));
}

// ---------------------------------------------------------------------------
// Command helpers
// ---------------------------------------------------------------------------

async function getPathAtCursor(
  getIndex: () => CdpProjectIndex | null
): Promise<PathHit | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("CDP: No active editor.");
    return undefined;
  }
  if (!editor.document.fileName.endsWith(".xml")) {
    vscode.window.showWarningMessage("CDP: Active file is not an XML file.");
    return undefined;
  }

  const index = getIndex();
  const document = editor.document;
  const position = editor.selection.active;
  const text = document.getText();
  const elements = parseXml(text);

  const stored = index?.fileContextPaths.get(document.uri.fsPath)?.[0];
  const basePath = stored ? stored.split(".") : [];

  const hit = findCdpPathAtPosition(elements, basePath, position.line, position.character);
  if (hit) { return hit; }

  // Fallback: quick-pick from index entries for this file
  const fileEntries = index?.entriesByFile.get(document.uri.fsPath);
  if (fileEntries && fileEntries.length > 0) {
    const items = fileEntries.map((e) => ({
      label: e.fullPath,
      description: `${e.tagName} — ${e.name}`,
      fullPath: e.fullPath,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Could not detect element at cursor — select a CDP path",
      matchOnDescription: true,
    });
    if (pick) {
      return { fullPath: pick.fullPath, elementName: pick.label.split(".").pop() ?? pick.label };
    }
  } else {
    vscode.window.showWarningMessage("CDP: No named CDP element found at cursor position.");
  }
  return undefined;
}

async function copyToClipboard(path: string, label: string): Promise<void> {
  await vscode.env.clipboard.writeText(path);
  vscode.window.showInformationMessage(`${label}: ${path}`);
}

// ---------------------------------------------------------------------------
// Public registration
// ---------------------------------------------------------------------------

export function registerCdpPathCommands(
  context: vscode.ExtensionContext,
  getIndex: () => CdpProjectIndex | null
): void {

  // ── CDP: Copy Path ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("cdp.copyPath", async () => {
      const hit = await getPathAtCursor(getIndex);
      if (hit) { await copyToClipboard(hit.fullPath, "Copied CDP path"); }
    })
  );

  // ── CDP: Copy Absolute Path ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("cdp.copyAbsolutePath", async () => {
      const hit = await getPathAtCursor(getIndex);
      if (hit) { await copyToClipboard(hit.fullPath, "Copied absolute CDP path"); }
    })
  );

  // ── CDP: Copy Routing Value ───────────────────────────────────────────────
  // If cursor is on a Routing="..." value, copy that string.
  // Otherwise, copy the element's full CDP path.
  context.subscriptions.push(
    vscode.commands.registerCommand("cdp.copyRoutingValue", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const index = getIndex();
      const document = editor.document;
      const position = editor.selection.active;
      const text = document.getText();
      const elements = parseXml(text);
      const stored = index?.fileContextPaths.get(document.uri.fsPath)?.[0];
      const basePath = stored ? stored.split(".") : [];

      const occs: RoutingAttributeOccurrence[] = [];
      collectRoutingOccurrences(elements, document.uri.fsPath, basePath, occs);
      const occ = occs.find((o) => containsPosition(o.valueRange, position));
      if (occ) {
        await copyToClipboard(occ.routing, "Copied routing value");
        return;
      }

      const hit = await getPathAtCursor(getIndex);
      if (hit) { await copyToClipboard(hit.fullPath, "Copied CDP path"); }
    })
  );

  // ── CDP: Copy Routing From Current Context (palette alias) ────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("cdp.copyRoutingFromContext", async () => {
      await vscode.commands.executeCommand("cdp.copyRoutingValue");
    })
  );

  // ── CDP: Copy Relative Path From Current Context (palette only) ───────────
  context.subscriptions.push(
    vscode.commands.registerCommand("cdp.copyRelativePath", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const hit = await getPathAtCursor(getIndex);
      if (!hit) { return; }

      const index = getIndex();
      const stored = index?.fileContextPaths.get(editor.document.uri.fsPath)?.[0];
      if (!stored) {
        await copyToClipboard(hit.fullPath, "Copied CDP path (no context, using absolute)");
        return;
      }

      const relative = computeRelativeRoutingPath(hit.fullPath, stored);
      await copyToClipboard(relative, "Copied relative CDP path");
    })
  );

  // ── CDP: Paste As Routing ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("cdp.pasteAsRouting", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("CDP: No active editor.");
        return;
      }
      if (!editor.document.fileName.endsWith(".xml")) {
        vscode.window.showWarningMessage("CDP: Active file is not an XML file.");
        return;
      }

      // 1. Read and validate clipboard
      const clipRaw = (await vscode.env.clipboard.readText()).trim();
      if (!clipRaw) {
        vscode.window.showWarningMessage("CDP: Clipboard is empty.");
        return;
      }
      // Strip surrounding quotes in case copied from somewhere that added them
      const clipText = clipRaw.replace(/^["']|["']$/g, "").trim();
      // Valid CDP routing: word chars, dots, semicolons, leading dots for relative
      if (!/^[._A-Za-z0-9;]+$/.test(clipText)) {
        vscode.window.showWarningMessage(
          `CDP: Clipboard does not look like a CDP path: "${clipText}"`
        );
        return;
      }

      const document = editor.document;
      const position = editor.selection.active;
      const index = getIndex();

      // 2. Parse live document and find named element under cursor
      const text = document.getText();
      const elements = parseXml(text);
      const el = findNamedElementAtPosition(elements, position.line, position.character);
      if (!el) {
        vscode.window.showWarningMessage(
          "CDP: No named CDP element found at cursor. " +
          "Place cursor on a Signal, Parameter, Port, Property, Argument, etc."
        );
        return;
      }

      // 3. Offer absolute vs relative if clipboard is absolute and context is known
      let routingValue = clipText;
      const stored = index?.fileContextPaths.get(document.uri.fsPath)?.[0];
      if (!clipText.startsWith(".") && stored) {
        const relPath = computeRelativeRoutingPath(clipText, stored);
        if (relPath !== clipText) {
          const pick = await vscode.window.showQuickPick(
            [
              { label: clipText, description: "Absolute path", value: clipText },
              { label: relPath, description: `Relative from ${stored}`, value: relPath },
            ],
            { placeHolder: "Choose routing format to paste" }
          );
          if (!pick) { return; }
          routingValue = pick.value;
        }
      }

      // 4. Apply edit via editor.edit() so the change joins the normal undo stack.
      // Do NOT use WorkspaceEdit here — it bypasses per-editor undo history.
      const existingRouting = el.attributes.get("Routing");
      let ok: boolean;

      if (existingRouting) {
        // Replace only the value content between the quotes (not the quotes).
        const vr = existingRouting.valueRange;
        const replaceRange = new vscode.Range(
          vr.startLine, vr.startCharacter,
          vr.endLine, vr.endCharacter
        );
        ok = await editor.edit(
          (editBuilder) => { editBuilder.replace(replaceRange, routingValue); },
          { undoStopBefore: true, undoStopAfter: true }
        );
      } else {
        // Insert Routing="..." just before the closing > or /> of the start tag.
        const insertPos = getRoutingInsertionPosition(el);
        ok = await editor.edit(
          (editBuilder) => { editBuilder.insert(insertPos, ` Routing="${routingValue}"`); },
          { undoStopBefore: true, undoStopAfter: true }
        );
      }

      if (ok) {
        vscode.window.showInformationMessage(`Inserted Routing="${routingValue}"`);
      } else {
        vscode.window.showErrorMessage("CDP: Failed to apply Routing edit.");
      }
    })
  );
}

