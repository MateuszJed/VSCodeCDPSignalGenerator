import * as vscode from "vscode";
import * as path from "path";
import { CdpProjectIndex, RoutingAttributeOccurrence } from "../core/types";
import { resolveRouting } from "../core/routingResolver";
import { findLiveOccurrenceAtPosition } from "./liveDocumentScanner";
import { toVsRange } from "./rangeAdapter";

function relativeFilePath(fileUri: vscode.Uri, targetFilePath: string): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    for (const folder of workspaceFolders) {
      const rel = path.relative(folder.uri.fsPath, targetFilePath);
      if (!rel.startsWith("..")) {
        return rel.replace(/\\/g, "/");
      }
    }
  }
  return targetFilePath;
}

export class RoutingHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly getIndex: () => CdpProjectIndex | null
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | null> {
    const index = this.getIndex();

    const occurrence = findLiveOccurrenceAtPosition(document, position, index);
    if (!occurrence) {
      return null;
    }

    const confidenceKnown = index
      ? index.fileContextPaths.has(document.uri.fsPath)
      : false;

    const resolution = index
      ? resolveRouting(occurrence.routing, occurrence.contextPath, index, confidenceKnown)
      : null;

    if (!resolution) {
      if (occurrence.routing.trim()) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**CDP Routing attribute**: \`${occurrence.attributeName}\`\n\n`);
        md.appendMarkdown(`Value: \`${occurrence.routing}\``);
        return new vscode.Hover(md, toVsRange(occurrence.valueRange));
      }
      return null;
    }

    const md = buildHoverContent(resolution, occurrence, index!, document.uri);
    if (!md) {
      return null;
    }

    return new vscode.Hover(md, toVsRange(occurrence.valueRange));
  }
}

function buildHoverContent(
  resolution: ReturnType<typeof resolveRouting>,
  occurrence: RoutingAttributeOccurrence,
  index: CdpProjectIndex,
  fileUri: vscode.Uri
): vscode.MarkdownString | null {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  switch (resolution.status) {
    case "empty":
      return null;

    case "resolved": {
      md.appendMarkdown("**CDP routing resolved**\n\n");
      md.appendMarkdown(`Attribute: \`${occurrence.attributeName}\`  \n`);
      md.appendMarkdown(`Routing: \`${resolution.routing}\`  \n`);
      md.appendMarkdown(`Resolved path: \`${resolution.resolvedPath}\`  \n`);
      const relFile = relativeFilePath(fileUri, resolution.target.filePath);
      md.appendMarkdown(`Target file: \`${relFile}\`  \n`);
      if (resolution.target.tagName) {
        md.appendMarkdown(`Element: \`${resolution.target.tagName}\``);
      }
      return md;
    }

    case "model-inherited": {
      md.appendMarkdown("**CDP routing — model/library-defined target**\n\n");
      md.appendMarkdown(`Attribute: \`${occurrence.attributeName}\`  \n`);
      md.appendMarkdown(`Candidate path: \`${resolution.candidatePath}\`  \n`);
      md.appendMarkdown(
        `Nearest known parent: \`${resolution.nearestKnownParent.fullPath}\`  \n`
      );
      md.appendMarkdown(
        "\n*No error reported by default — CDP models/libraries may provide this target at runtime.*"
      );
      return md;
    }

    case "external": {
      md.appendMarkdown("**External CDP routing**\n\n");
      md.appendMarkdown(`Attribute: \`${occurrence.attributeName}\`  \n`);
      md.appendMarkdown(`Candidate path: \`${resolution.candidatePath}\`  \n`);
      md.appendMarkdown(
        `\nThe application \`${resolution.externalApplication}\` is not present in this workspace.`
      );
      return md;
    }

    case "unresolved": {
      md.appendMarkdown("**CDP routing — unresolved**\n\n");
      md.appendMarkdown(`Attribute: \`${occurrence.attributeName}\`  \n`);
      md.appendMarkdown(`Candidate path: \`${resolution.candidatePath}\`  \n`);
      if (resolution.nearestKnownPrefix) {
        const unresolvedRemainder = resolution.candidatePath.slice(resolution.nearestKnownPrefix.length + 1);
        const bogusSegment = unresolvedRemainder.split(".")[0];
        md.appendMarkdown(`Nearest known parent: \`${resolution.nearestKnownPrefix}\`  \n`);
        md.appendMarkdown(`First unknown segment: \`${bogusSegment}\`  \n`);
      }
      md.appendMarkdown(`\nReason: ${resolution.reason}`);
      return md;
    }

    case "invalid": {
      md.appendMarkdown("**Invalid CDP routing**\n\n");
      md.appendMarkdown(`Attribute: \`${occurrence.attributeName}\`  \n`);
      if (resolution.candidatePath) {
        md.appendMarkdown(`Candidate path: \`${resolution.candidatePath}\`  \n`);
      }
      md.appendMarkdown(`\nReason: ${resolution.reason}`);
      return md;
    }
  }
}
