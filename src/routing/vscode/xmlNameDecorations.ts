/**
 * xmlNameDecorations.ts
 *
 * Highlights the value of every Name="..." attribute in CDP XML files.
 * Uses live document text — updates on every keystroke via onDidChangeTextDocument.
 * Routing decorations are applied separately and always win over name decorations
 * because they target different attribute ranges (Routing values vs Name values).
 */

import * as vscode from "vscode";
import { parseXml, ParsedElement } from "../core/xmlScanner";

function getConfig() {
  return vscode.workspace.getConfiguration("cdp.xml.decorations");
}

export function createNameDecorationType(): vscode.TextEditorDecorationType {
  const color      = getConfig().get<string>("nameColor",      "#C5E478");
  const fontWeight = getConfig().get<string>("nameFontWeight", "bold");
  return vscode.window.createTextEditorDecorationType({ color, fontWeight });
}

function collectNameRanges(el: ParsedElement, result: vscode.Range[]): void {
  const nameAttr = el.attributes.get("Name");
  if (nameAttr && nameAttr.value) {
    const vr = nameAttr.valueRange;
    result.push(new vscode.Range(vr.startLine, vr.startCharacter, vr.endLine, vr.endCharacter));
  }
  for (const child of el.children) {
    collectNameRanges(child, result);
  }
}

export function applyNameDecorationsToEditor(
  editor: vscode.TextEditor,
  nameDecorType: vscode.TextEditorDecorationType
): void {
  if (!editor.document.fileName.endsWith(".xml")) {
    editor.setDecorations(nameDecorType, []);
    return;
  }

  if (!getConfig().get<boolean>("names.enabled", true)) {
    editor.setDecorations(nameDecorType, []);
    return;
  }

  const elements = parseXml(editor.document.getText());
  const ranges: vscode.Range[] = [];
  for (const el of elements) {
    collectNameRanges(el, ranges);
  }
  editor.setDecorations(nameDecorType, ranges);
}

export function applyNameDecorationsToAllVisible(
  nameDecorType: vscode.TextEditorDecorationType
): void {
  for (const editor of vscode.window.visibleTextEditors) {
    applyNameDecorationsToEditor(editor, nameDecorType);
  }
}
