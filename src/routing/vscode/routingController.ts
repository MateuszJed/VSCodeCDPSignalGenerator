import * as vscode from "vscode";
import { CdpProjectIndexer } from "../core/cdpProjectIndexer";
import { RoutingHoverProvider } from "./routingHoverProvider";
import { RoutingDefinitionProvider } from "./routingDefinitionProvider";
import { registerRoutingCommands } from "./routingCommands";
import { refreshDiagnostics } from "./routingDiagnostics";
import { CdpProjectIndex } from "../core/types";
import { computeRoutingStats } from "../core/routingStats";
import {
  createDecorationTypes,
  disposeDecorationTypes,
  applyDecorationsToAllVisible,
  applyDecorationsToEditor,
  RoutingDecorationTypes,
} from "./routingDecorations";

export async function activateRoutingSupport(
  context: vscode.ExtensionContext
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("CDP Routing");
  const diagnostics = vscode.languages.createDiagnosticCollection("cdp-routing");

  context.subscriptions.push(outputChannel, diagnostics);

  const indexer = new CdpProjectIndexer({
    appendLine: (msg: string) => outputChannel.appendLine(msg),
  });
  let index: CdpProjectIndex | null = null;
  let decorTypes: RoutingDecorationTypes = createDecorationTypes();
  context.subscriptions.push({ dispose: () => disposeDecorationTypes(decorTypes) });

  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  const liveRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function rebuildIndex(): Promise<void> {
    const workspaceRoots =
      vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
    index = await indexer.buildIndex(workspaceRoots);
    computeRoutingStats(index);
    refreshDiagnostics(index, diagnostics);
    applyDecorationsToAllVisible(index, decorTypes);
  }

  function scheduleRebuild(): void {
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
    }
    rebuildTimer = setTimeout(async () => {
      await rebuildIndex();
    }, 500);
  }

  function scheduleLiveRefresh(document: vscode.TextDocument): void {
    const key = document.uri.fsPath;
    const existing = liveRefreshTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    liveRefreshTimers.set(
      key,
      setTimeout(() => {
        liveRefreshTimers.delete(key);
        refreshDiagnostics(index, diagnostics, [document]);
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document.uri.fsPath === key) {
            applyDecorationsToEditor(editor, index, decorTypes);
          }
        }
      }, 150)
    );
  }

  // Initial index build if any Application.xml exists in the workspace
  const appFiles = await vscode.workspace.findFiles(
    "**/Application/Application.xml",
    "**/{node_modules,.git,out,build,dist}/**",
    1
  );
  if (appFiles.length > 0) {
    setTimeout(async () => {
      await rebuildIndex();
    }, 1000);
  }

  const watcher = vscode.workspace.createFileSystemWatcher("**/*.xml");
  watcher.onDidChange(scheduleRebuild);
  watcher.onDidCreate(scheduleRebuild);
  watcher.onDidDelete(scheduleRebuild);
  context.subscriptions.push(watcher);

  const xmlSelector: vscode.DocumentSelector = [
    { language: "xml" },
    { pattern: "**/*.xml" },
  ];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      xmlSelector,
      new RoutingHoverProvider(() => index)
    )
  );

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      xmlSelector,
      new RoutingDefinitionProvider(() => index)
    )
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.fileName.endsWith(".xml")) {
        applyDecorationsToEditor(editor, index, decorTypes);
        if (index) {
          refreshDiagnostics(index, diagnostics, [editor.document]);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        if (editor.document.fileName.endsWith(".xml")) {
          applyDecorationsToEditor(editor, index, decorTypes);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.fileName.endsWith(".xml")) {
        scheduleLiveRefresh(event.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.fileName.endsWith(".xml")) {
        // Immediate live refresh so decorations/diagnostics update without
        // waiting for the full index rebuild.
        scheduleLiveRefresh(document);
        // Full rebuild to keep the index consistent with saved content.
        scheduleRebuild();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cdp.routing.decorations")) {
        disposeDecorationTypes(decorTypes);
        decorTypes = createDecorationTypes();
        applyDecorationsToAllVisible(index, decorTypes);
      }
    })
  );

  registerRoutingCommands(
    context,
    () => index,
    rebuildIndex,
    diagnostics,
    outputChannel
  );
}
