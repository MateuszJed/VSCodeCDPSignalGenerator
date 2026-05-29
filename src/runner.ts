import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

let _context: vscode.ExtensionContext | undefined;

/** Call once from activate() to register the extension context. */
export function setContext(ctx: vscode.ExtensionContext): void {
  _context = ctx;
}

/**
 * Resolves the path to the bundled CLI entry point.
 * During development: <repo>/cli/dist/main.js
 * When installed as a VSIX: <extension>/cli/dist/main.js
 */
function getCliPath(): string {
  if (!_context) { throw new Error('Extension context not set. Call setContext() from activate().'); }
  return path.join(_context.extensionPath, 'cli', 'dist', 'main.js');
}

/**
 * Spawn the cdp-element CLI with the given arguments.
 * Resolves with stdout on exit code 0, rejects with stderr on non-zero.
 */
export function runCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliPath = getCliPath();
    const proc = cp.spawn(process.execPath, [cliPath, ...args], {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `cdp-element exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start cdp-element CLI: ${err.message}`));
    });
  });
}
