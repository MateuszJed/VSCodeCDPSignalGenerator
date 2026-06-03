import * as vscode from "vscode";
import { CdpProjectIndex } from "../core/types";
import { resolveRouting } from "../core/routingResolver";
import { findLiveOccurrenceAtPosition } from "./liveDocumentScanner";
import { toVsRange } from "./rangeAdapter";

export class RoutingDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly getIndex: () => CdpProjectIndex | null) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Definition | null> {
    const index = this.getIndex();

    const occurrence = findLiveOccurrenceAtPosition(document, position, index);
    if (!occurrence || !index) {
      return null;
    }

    const confidenceKnown = index.fileContextPaths.has(document.uri.fsPath);
    const resolution = resolveRouting(
      occurrence.routing,
      occurrence.contextPath,
      index,
      confidenceKnown
    );

    switch (resolution.status) {
      case "resolved": {
        const target = resolution.target;
        const targetRange = target.nameRange
          ? toVsRange(target.nameRange)
          : toVsRange(target.range);
        return new vscode.Location(vscode.Uri.file(target.filePath), targetRange);
      }

      case "model-inherited": {
        const config = vscode.workspace.getConfiguration("cdp.routing.navigation");
        const goToParent = config.get<boolean>(
          "goToNearestParentForModelInherited",
          true
        );
        if (goToParent) {
          const parent = resolution.nearestKnownParent;
          const parentRange = parent.nameRange
            ? toVsRange(parent.nameRange)
            : toVsRange(parent.range);
          return new vscode.Location(vscode.Uri.file(parent.filePath), parentRange);
        }
        return null;
      }

      default:
        return null;
    }
  }
}
