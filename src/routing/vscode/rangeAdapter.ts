/**
 * rangeAdapter.ts (vscode)
 *
 * Adapters between core TextRange and vscode.Range.
 */

import * as vscode from "vscode";
import { TextRange } from "../core/types";

export function toVsRange(r: TextRange): vscode.Range {
  return new vscode.Range(r.startLine, r.startCharacter, r.endLine, r.endCharacter);
}

export function containsPosition(range: TextRange, pos: vscode.Position): boolean {
  return toVsRange(range).contains(pos);
}
