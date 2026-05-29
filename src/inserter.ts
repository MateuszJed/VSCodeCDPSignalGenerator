// This file is the VS Code extension wrapper for the CLI inserter.
// The original implementation has been moved to cli/src/inserter.ts.
// See src/inserter.ts.orig for the previous version.

import * as vscode from 'vscode';
import { ParsedClass, ElementInfo } from './types';
import { runCli } from './runner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elementToArgs(element: ElementInfo): string[] {
  const args: string[] = [];

  if (element.xmlName && element.xmlName !== element.codeName) {
    args.push('--xml-name', element.xmlName);
  }
  if (element.type) { args.push('--type', element.type); }
  if (element.input === false) { args.push('--output'); }
  if (element.unit) { args.push('--unit', element.unit); }
  if (element.description) { args.push('--desc', element.description); }
  if (element.value) { args.push('--value', element.value); }
  if (element.min) { args.push('--min', element.min); }
  if (element.max) { args.push('--max', element.max); }
  if (element.level) { args.push('--level', element.level); }
  if (element.text) { args.push('--text', element.text); }
  if (element.fromState) { args.push('--from', element.fromState); }
  if (element.toState) { args.push('--to', element.toState); }

  return args;
}

// ---------------------------------------------------------------------------
// Public API — mirrors the original inserter signatures
// ---------------------------------------------------------------------------

export async function addElement(parsed: ParsedClass, element: ElementInfo): Promise<void> {
  const kindLower = element.kind.toLowerCase();
  const codeName = element.kind === 'StateTransition'
    ? `${element.fromState}To${element.toState}`
    : element.codeName;

  const args = ['add', kindLower, parsed.sourcePath, codeName, ...elementToArgs(element)];

  try {
    const msg = await runCli(args);
    vscode.window.showInformationMessage(msg);
  } catch (err: any) {
    vscode.window.showErrorMessage(err.message);
  }
}

export async function removeElement(parsed: ParsedClass, element: ElementInfo): Promise<void> {
  const args = [
    'remove', parsed.sourcePath, element.codeName,
    '--kind', element.kind,
    '--xml-name', element.xmlName,
    ...(element.fromState ? ['--from', element.fromState] : []),
    ...(element.toState ? ['--to', element.toState] : []),
  ];

  try {
    const msg = await runCli(args);
    vscode.window.showInformationMessage(msg);
  } catch (err: any) {
    vscode.window.showErrorMessage(err.message);
  }
}

export async function changeElement(parsed: ParsedClass, oldElement: ElementInfo, newElement: ElementInfo): Promise<void> {
  const args = [
    'change', parsed.sourcePath, oldElement.codeName, newElement.codeName,
    '--kind', oldElement.kind,
    '--old-xml-name', oldElement.xmlName,
    '--new-xml-name', newElement.xmlName,
  ];

  try {
    const msg = await runCli(args);
    vscode.window.showInformationMessage(msg);
  } catch (err: any) {
    vscode.window.showErrorMessage(err.message);
  }
}

// ---- Original implementation moved to cli/src/inserter.ts ---- //
// Original file preserved as src/inserter.ts.orig
