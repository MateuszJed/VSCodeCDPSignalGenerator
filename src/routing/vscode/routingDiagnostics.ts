import * as vscode from "vscode";
import { CdpProjectIndex, RoutingAttributeOccurrence } from "../core/types";
import { resolveRouting } from "../core/routingResolver";
import { parseXml } from "../core/xmlScanner";
import { collectRoutingOccurrences } from "../core/routingAttributeParser";
import { toVsRange } from "./rangeAdapter";

export function refreshDiagnostics(
  index: CdpProjectIndex | null,
  diagnostics: vscode.DiagnosticCollection,
  documents?: readonly vscode.TextDocument[]
): void {
  if (!index) {
    return;
  }

  const config = vscode.workspace.getConfiguration("cdp.routing.validation");
  const enabled = config.get<boolean>("enabled", true);
  if (!enabled) {
    diagnostics.clear();
    return;
  }

  const strict = config.get<boolean>("strict", false);
  const treatExternalAsError = config.get<boolean>("treatExternalAsError", false);
  const treatModelInheritedAsError = config.get<boolean>(
    "treatModelInheritedAsError",
    false
  );

  if (documents) {
    for (const document of documents) {
      validateDocument(
        document,
        index,
        diagnostics,
        strict,
        treatExternalAsError,
        treatModelInheritedAsError
      );
    }
    return;
  }

  for (const filePath of index.routingOccurrencesByFile.keys()) {
    const occs = index.routingOccurrencesByFile.get(filePath)!;
    const contextKnown = index.fileContextPaths.has(filePath);
    const fileDiags = buildDiagnostics(
      occs,
      index,
      contextKnown,
      strict,
      treatExternalAsError,
      treatModelInheritedAsError
    );
    const fileUri = vscode.Uri.file(filePath);
    if (fileDiags.length > 0) {
      diagnostics.set(fileUri, fileDiags);
    } else {
      diagnostics.delete(fileUri);
    }
  }
}

function validateDocument(
  document: vscode.TextDocument,
  index: CdpProjectIndex,
  diagnostics: vscode.DiagnosticCollection,
  strict: boolean,
  treatExternalAsError: boolean,
  treatModelInheritedAsError: boolean
): void {
  const filePath = document.uri.fsPath;
  const contextKnown = index.fileContextPaths.has(filePath);
  const text = document.getText();
  const elements = parseXml(text);
  const occurrences: RoutingAttributeOccurrence[] = [];
  const knownContextPaths = index.fileContextPaths.get(filePath) ?? [];
  // fileContextPaths stores the parent cdpPath; guard against empty string.
  const basePath = knownContextPaths[0] ? knownContextPaths[0].split(".") : [];
  collectRoutingOccurrences(elements, filePath, basePath, occurrences);

  const fileDiags = buildDiagnostics(
    occurrences,
    index,
    contextKnown,
    strict,
    treatExternalAsError,
    treatModelInheritedAsError
  );

  if (fileDiags.length > 0) {
    diagnostics.set(document.uri, fileDiags);
  } else {
    diagnostics.delete(document.uri);
  }
}

function buildDiagnostics(
  occs: RoutingAttributeOccurrence[],
  index: CdpProjectIndex,
  contextKnown: boolean,
  strict: boolean,
  treatExternalAsError: boolean,
  treatModelInheritedAsError: boolean
): vscode.Diagnostic[] {
  const fileDiags: vscode.Diagnostic[] = [];
  for (const occ of occs) {
    const diag = makeDiagnostic(
      occ,
      index,
      contextKnown,
      strict,
      treatExternalAsError,
      treatModelInheritedAsError
    );
    if (diag) {
      fileDiags.push(diag);
    }
  }
  return fileDiags;
}

function makeDiagnostic(
  occ: RoutingAttributeOccurrence,
  index: CdpProjectIndex,
  contextKnown: boolean,
  strict: boolean,
  treatExternalAsError: boolean,
  treatModelInheritedAsError: boolean
): vscode.Diagnostic | null {
  const resolution = resolveRouting(
    occ.routing,
    occ.contextPath,
    index,
    contextKnown
  );

  switch (resolution.status) {
    case "empty":
    case "resolved":
      return null;

    case "external": {
      if (!treatExternalAsError) {
        return null;
      }
      return makeDiag(
        occ,
        `CDP routing: external application "${resolution.externalApplication}" not in workspace. ${resolution.reason}`,
        vscode.DiagnosticSeverity.Warning
      );
    }

    case "model-inherited": {
      if (!treatModelInheritedAsError) {
        return null;
      }
      return makeDiag(
        occ,
        `CDP routing: target may be model/library-defined. Nearest parent: ${resolution.nearestKnownParent.fullPath}`,
        vscode.DiagnosticSeverity.Warning
      );
    }

    case "unresolved": {
      if (!strict || !contextKnown) {
        return null;
      }
      return makeDiag(
        occ,
        `CDP routing: unresolved target "${resolution.candidatePath}". ${resolution.reason}`,
        vscode.DiagnosticSeverity.Warning
      );
    }

    case "invalid": {
      if (!contextKnown) {
        return null;
      }
      return makeDiag(
        occ,
        `CDP routing invalid: ${resolution.reason}`,
        vscode.DiagnosticSeverity.Error
      );
    }
  }
}

function makeDiag(
  occ: RoutingAttributeOccurrence,
  message: string,
  severity: vscode.DiagnosticSeverity
): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(toVsRange(occ.valueRange), message, severity);
  diag.source = "CDP Routing";
  return diag;
}
