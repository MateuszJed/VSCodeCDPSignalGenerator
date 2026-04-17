import * as vscode from 'vscode';
import { ElementKind } from './types';
import { parseClass } from './parser';
import { addElement, removeElement, changeElement } from './inserter';
import { promptForNewElement, promptSelectElement, promptForChange } from './ui';

export function activate(context: vscode.ExtensionContext) {
  const addCommands: [string, ElementKind][] = [
    ['cdp.addSignal', 'Signal'],
    ['cdp.addParameter', 'Parameter'],
    ['cdp.addAlarm', 'Alarm'],
    ['cdp.addProperty', 'Property'],
    ['cdp.addConnector', 'Connector'],
    ['cdp.addState', 'State'],
    ['cdp.addStateTransition', 'StateTransition'],
    ['cdp.addMessage', 'Message'],
    ['cdp.addPort', 'Port'],
  ];

  for (const [commandId, kind] of addCommands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const parsed = await parseClass(editor.document.uri.fsPath);
        if (!parsed) { return; }

        const element = await promptForNewElement(kind, parsed);
        if (!element) { return; }

        await addElement(parsed, element);
      })
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('cdp.remove', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const parsed = await parseClass(editor.document.uri.fsPath);
      if (!parsed) { return; }

      const element = await promptSelectElement(parsed, 'remove');
      if (!element) { return; }

      await removeElement(parsed, element);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cdp.change', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const parsed = await parseClass(editor.document.uri.fsPath);
      if (!parsed) { return; }

      const oldElement = await promptSelectElement(parsed, 'change');
      if (!oldElement) { return; }

      const newElement = await promptForChange(oldElement);
      if (!newElement) { return; }

      await changeElement(parsed, oldElement, newElement);
    })
  );
}

export function deactivate() {}
