// This file is the VS Code extension wrapper for the CLI parser.
// The original implementation has been moved to cli/src/parser.ts.
// See src/parser.ts.orig for the previous version.

import * as vscode from 'vscode';
import { ParsedClass } from './types';
import { runCli } from './runner';

/**
 * Parse a CDP component by calling the CLI parse action.
 * Returns a ParsedClass populated from the JSON output, or undefined on error.
 */
export async function parseClass(filePath: string): Promise<ParsedClass | undefined> {
  let json: string;
  try {
    json = await runCli(['parse', filePath]);
  } catch (err: any) {
    vscode.window.showErrorMessage(err.message);
    return undefined;
  }

  try {
    const data = JSON.parse(json);
    return {
      className: data.className,
      headerPath: data.headerPath,
      sourcePath: data.sourcePath,
      xmlPath: data.xmlPath ?? undefined,
      elements: data.elements ?? [],
      // Line numbers are used only by the CLI inserter internally — not needed here.
      lastMemberLine: -1,
      closingBraceLine: -1,
      createEndLine: -1,
      createModelEndLine: -1,
      sourceEndLine: -1,
    };
  } catch {
    vscode.window.showErrorMessage('cdp-element parse returned unexpected output.');
    return undefined;
  }
}

// Unused stub — kept so existing imports in ui.ts do not break.
export function getPairedFile(_filePath: string): string { return ''; }

// ---- Everything below this line is dead code replaced by the CLI ---- //
// Original file preserved as src/parser.ts.orig
