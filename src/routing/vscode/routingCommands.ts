import * as vscode from "vscode";
import { CdpProjectIndex } from "../core/types";
import { resolveRouting } from "../core/routingResolver";
import { refreshDiagnostics } from "./routingDiagnostics";
import { parseXml } from "../core/xmlScanner";
import { collectRoutingOccurrences } from "../core/routingAttributeParser";
import { containsPosition } from "./rangeAdapter";
import { findLiveOccurrenceAtPosition } from "./liveDocumentScanner";

export function registerRoutingCommands(
  context: vscode.ExtensionContext,
  getIndex: () => CdpProjectIndex | null,
  rebuildIndex: () => Promise<void>,
  diagnostics: vscode.DiagnosticCollection,
  outputChannel: vscode.OutputChannel
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cdp.rebuildRoutingIndex", async () => {
      await rebuildIndex();
      vscode.window.showInformationMessage("CDP routing index rebuilt.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cdp.validateRoutingCurrentFile",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("No active editor.");
          return;
        }
        if (!editor.document.fileName.endsWith(".xml")) {
          vscode.window.showWarningMessage("Active file is not an XML file.");
          return;
        }
        const index = getIndex();
        if (!index) {
          vscode.window.showWarningMessage(
            "CDP routing index is not built. Run 'CDP: Rebuild Routing Index' first."
          );
          return;
        }
        refreshDiagnostics(index, diagnostics, [editor.document]);
        vscode.window.showInformationMessage(
          `CDP routing: validated ${editor.document.fileName}`
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cdp.validateRoutingWorkspace",
      async () => {
        const index = getIndex();
        if (!index) {
          vscode.window.showWarningMessage(
            "CDP routing index is not built. Run 'CDP: Rebuild Routing Index' first."
          );
          return;
        }
        refreshDiagnostics(index, diagnostics);
        vscode.window.showInformationMessage(
          "CDP routing: workspace validation complete."
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cdp.showRoutingTarget", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor.");
        return;
      }
      const index = getIndex();
      const position = editor.selection.active;
      const document = editor.document;

      // Always use live scanner for accuracy
      let occurrence = findLiveOccurrenceAtPosition(document, position, index);

      if (!occurrence) {
        // Fallback: check index cache
        occurrence = index?.routingOccurrencesByFile
          .get(document.uri.fsPath)
          ?.find((o) => containsPosition(o.valueRange, position));
      }

      if (!occurrence) {
        vscode.window.showInformationMessage(
          "CDP routing: cursor is not inside a routing attribute value."
        );
        return;
      }

      if (!index) {
        vscode.window.showInformationMessage(
          `CDP routing: value = "${occurrence.routing}" (index not built)`
        );
        return;
      }

      const confidenceKnown = index.fileContextPaths.has(document.uri.fsPath);
      const resolution = resolveRouting(
        occurrence.routing,
        occurrence.contextPath,
        index,
        confidenceKnown
      );

      switch (resolution.status) {
        case "empty":
          vscode.window.showInformationMessage("CDP routing: empty value.");
          break;

        case "resolved": {
          const target = resolution.target;
          await vscode.window.showTextDocument(vscode.Uri.file(target.filePath), {
            selection: target.nameRange
              ? new vscode.Range(
                  target.nameRange.startLine,
                  target.nameRange.startCharacter,
                  target.nameRange.endLine,
                  target.nameRange.endCharacter
                )
              : new vscode.Range(
                  target.range.startLine,
                  target.range.startCharacter,
                  target.range.endLine,
                  target.range.endCharacter
                ),
          });
          break;
        }

        case "model-inherited": {
          const parent = resolution.nearestKnownParent;
          const choice = await vscode.window.showInformationMessage(
            `CDP routing: target "${resolution.candidatePath}" may be model/library-defined.\n` +
              `Nearest known parent: "${parent.fullPath}"`,
            "Go to nearest parent"
          );
          if (choice === "Go to nearest parent") {
            await vscode.window.showTextDocument(vscode.Uri.file(parent.filePath), {
              selection: parent.nameRange
                ? new vscode.Range(
                    parent.nameRange.startLine,
                    parent.nameRange.startCharacter,
                    parent.nameRange.endLine,
                    parent.nameRange.endCharacter
                  )
                : new vscode.Range(
                    parent.range.startLine,
                    parent.range.startCharacter,
                    parent.range.endLine,
                    parent.range.endCharacter
                  ),
            });
          }
          break;
        }

        case "external":
          vscode.window.showInformationMessage(
            `CDP routing: external application "${resolution.externalApplication}" — ${resolution.reason}`
          );
          break;

        case "unresolved":
          vscode.window.showInformationMessage(
            `CDP routing: unresolved. Candidate: "${resolution.candidatePath}". ${resolution.reason}`
          );
          break;

        case "invalid":
          vscode.window.showWarningMessage(
            `CDP routing invalid: ${resolution.reason}`
          );
          break;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cdp.showRoutingIndexStats", () => {
      const index = getIndex();
      if (!index) {
        vscode.window.showWarningMessage(
          "CDP routing index is not built. Run 'CDP: Rebuild Routing Index' first."
        );
        return;
      }

      const s = index.stats;
      const appList = [...index.applications].join(", ") || "(none)";

      const lines = [
        `CDP Routing Index Statistics`,
        `============================`,
        `Applications indexed:     ${s.applicationsIndexed} (${appList})`,
        `XML files total:          ${s.xmlFilesTotal}`,
        `XML files indexed:        ${s.xmlFilesIndexed}`,
        `Named elements indexed:   ${s.namedElementsIndexed}`,
        `Routing attributes found: ${s.routingAttributesFound}`,
        `  Empty routings:         ${s.emptyRoutings}`,
        `  Resolved:               ${s.resolvedRoutings}`,
        `  External:               ${s.externalRoutings}`,
        `  Model-inherited:        ${s.modelInheritedRoutings}`,
        `  Unresolved:             ${s.unresolvedRoutings}`,
        `  Invalid:                ${s.invalidRoutings}`,
        `Index build time:         ${index.buildTimeMs}ms`,
      ];

      outputChannel.clear();
      outputChannel.appendLine(lines.join("\n"));
      outputChannel.show();
    })
  );
}
