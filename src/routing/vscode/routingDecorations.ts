import * as vscode from "vscode";
import { CdpProjectIndex } from "../core/types";
import { resolveRouting } from "../core/routingResolver";
import { scanLiveDocument } from "./liveDocumentScanner";
import { toVsRange } from "./rangeAdapter";

function getConfig() {
  return vscode.workspace.getConfiguration("cdp.routing.decorations");
}

function makeDecorationType(
  colorKey: string,
  defaultColor: string,
  underlineStyle: "solid" | "dotted" | "wavy" | "none",
  bold = false
): vscode.TextEditorDecorationType {
  const color = getConfig().get<string>(colorKey, defaultColor);
  const textDecoration =
    underlineStyle === "none"
      ? undefined
      : `underline ${underlineStyle} ${color}`;
  return vscode.window.createTextEditorDecorationType({
    color,
    fontWeight: bold ? "bold" : undefined,
    textDecoration,
  });
}

export interface RoutingDecorationTypes {
  resolved: vscode.TextEditorDecorationType;
  invalid: vscode.TextEditorDecorationType;
  unresolved: vscode.TextEditorDecorationType;
  modelInherited: vscode.TextEditorDecorationType;
  external: vscode.TextEditorDecorationType;
}

export function createDecorationTypes(): RoutingDecorationTypes {
  return {
    resolved:      makeDecorationType("resolvedColor",       "#00BFFF", "solid",  true),  // bright cyan — link-like
    invalid:       makeDecorationType("invalidColor",        "#F44747", "wavy",   false), // red wavy
    unresolved:    makeDecorationType("unresolvedColor",     "#FF5722", "dotted", false), // red-orange dotted
    modelInherited:makeDecorationType("modelInheritedColor", "#D7BA7D", "dotted", false), // yellow/gold dotted
    external:      makeDecorationType("externalColor",       "#B180D7", "dotted", false), // purple dotted
  };
}

export function disposeDecorationTypes(types: RoutingDecorationTypes): void {
  types.resolved.dispose();
  types.invalid.dispose();
  types.unresolved.dispose();
  types.modelInherited.dispose();
  types.external.dispose();
}

export function applyDecorationsToEditor(
  editor: vscode.TextEditor,
  index: CdpProjectIndex | null,
  types: RoutingDecorationTypes
): void {
  const document = editor.document;

  if (!document.fileName.endsWith(".xml")) {
    clearDecorations(editor, types);
    return;
  }

  const enabled = getConfig().get<boolean>("enabled", true);
  if (!enabled) {
    clearDecorations(editor, types);
    return;
  }

  const occurrences = scanLiveDocument(document, index);

  const resolved: vscode.Range[] = [];
  const invalid: vscode.Range[] = [];
  const unresolved: vscode.Range[] = [];
  const modelInherited: vscode.Range[] = [];
  const external: vscode.Range[] = [];

  const confidenceKnown = index
    ? index.fileContextPaths.has(document.uri.fsPath)
    : false;

  for (const occ of occurrences) {
    if (!occ.routing.trim()) {
      continue;
    }

    if (!index) {
      unresolved.push(toVsRange(occ.valueRange));
      continue;
    }

    const r = resolveRouting(occ.routing, occ.contextPath, index, confidenceKnown);

    switch (r.status) {
      case "empty":
        break;
      case "resolved":
        resolved.push(toVsRange(occ.valueRange));
        break;
      case "invalid":
        invalid.push(toVsRange(occ.valueRange));
        break;
      case "unresolved":
        unresolved.push(toVsRange(occ.valueRange));
        break;
      case "model-inherited":
        modelInherited.push(toVsRange(occ.valueRange));
        break;
      case "external":
        external.push(toVsRange(occ.valueRange));
        break;
    }
  }

  editor.setDecorations(types.resolved, resolved);
  editor.setDecorations(types.invalid, invalid);
  editor.setDecorations(types.unresolved, unresolved);
  editor.setDecorations(types.modelInherited, modelInherited);
  editor.setDecorations(types.external, external);
}

export function clearDecorations(
  editor: vscode.TextEditor,
  types: RoutingDecorationTypes
): void {
  editor.setDecorations(types.resolved, []);
  editor.setDecorations(types.invalid, []);
  editor.setDecorations(types.unresolved, []);
  editor.setDecorations(types.modelInherited, []);
  editor.setDecorations(types.external, []);
}

export function applyDecorationsToAllVisible(
  index: CdpProjectIndex | null,
  types: RoutingDecorationTypes
): void {
  for (const editor of vscode.window.visibleTextEditors) {
    applyDecorationsToEditor(editor, index, types);
  }
}
