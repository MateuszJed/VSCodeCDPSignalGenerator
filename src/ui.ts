import * as vscode from 'vscode';
import { ElementInfo, CDP_TYPES, ElementKind, CdpType } from './types';
import { ParsedClass } from './types';

const ALARM_LEVELS = ['Error', 'Warning', 'Notify'] as const;

/**
 * Prompt user for element details when adding.
 * Shows a full form with: Code Name, XML Name, Datatype, Unit, Description, Value, Input/Output
 */
export async function promptForNewElement(kind: ElementKind, parsed: ParsedClass): Promise<ElementInfo | undefined> {
  if (kind === 'StateTransition') {
    return promptForStateTransition(parsed);
  }

  // --- Code Name ---
  const codeName = await vscode.window.showInputBox({
    prompt: `[${kind}] Code name (C++ member variable)`,
    placeHolder: kind === 'Signal' ? 'e.g. i_SpeedIn or o_SpeedOut' : kind === 'Parameter' ? 'e.g. p_MaxSpeed' : kind === 'Alarm' ? 'e.g. a_OverSpeed' : `e.g. my${kind}`,
    validateInput: (v) => /^\w+$/.test(v) ? null : 'Must be alphanumeric/underscore',
  });
  if (!codeName) { return undefined; }

  // --- XML Name ---
  // Default: strip common prefixes (i_, o_, p_, a_) for XML name
  const defaultXmlName = codeName.replace(/^[iopa]_/, '');
  const xmlName = await vscode.window.showInputBox({
    prompt: `[${kind}] XML name (used in template XML)`,
    value: defaultXmlName,
    validateInput: (v) => v.length > 0 ? null : 'XML name cannot be empty',
  });
  if (!xmlName) { return undefined; }

  // --- Datatype (Signal, Property) ---
  let type: CdpType | undefined;
  if (kind === 'Signal' || kind === 'Property') {
    const picked = await vscode.window.showQuickPick(
      CDP_TYPES.map(t => ({ label: t })),
      { placeHolder: `[${kind}] Select data type` }
    );
    if (!picked) { return undefined; }
    type = picked.label as CdpType;
  }

  // --- Input/Output (Signal) ---
  let input: boolean | undefined;
  if (kind === 'Signal') {
    const io = await vscode.window.showQuickPick(
      [{ label: 'Input', description: 'Receives value via routing' }, { label: 'Output', description: 'Provides value to other components' }],
      { placeHolder: `[${kind}] Input or Output?` }
    );
    if (!io) { return undefined; }
    input = io.label === 'Input';
  }

  // --- Unit ---
  let unit: string | undefined;
  if (['Signal', 'Parameter', 'Alarm'].includes(kind)) {
    unit = await vscode.window.showInputBox({
      prompt: `[${kind}] Unit (optional)`,
      placeHolder: 'e.g. m/s, rad, 0/1, bar, rpm',
    }) || undefined;
  }

  // --- Description ---
  const description = await vscode.window.showInputBox({
    prompt: `[${kind}] Description (for XML)`,
    placeHolder: 'Brief description of this element',
  }) || undefined;

  // --- Value ---
  let value: string | undefined;
  if (['Signal', 'Parameter', 'Property'].includes(kind)) {
    value = await vscode.window.showInputBox({
      prompt: `[${kind}] Initial value (optional)`,
      placeHolder: 'e.g. 0, 1.5, true, ""',
    }) || undefined;
  }

  // --- Alarm-specific ---
  let level: string | undefined;
  let text: string | undefined;
  let min: string | undefined;
  let max: string | undefined;
  if (kind === 'Alarm') {
    const lvl = await vscode.window.showQuickPick(
      ALARM_LEVELS.map(l => ({ label: l })),
      { placeHolder: '[Alarm] Level' }
    );
    level = lvl?.label;

    text = await vscode.window.showInputBox({
      prompt: '[Alarm] Alarm text (displayed when active)',
      placeHolder: 'e.g. Motor overheated!',
    }) || undefined;
  }

  // --- Parameter min/max ---
  if (kind === 'Parameter') {
    min = await vscode.window.showInputBox({ prompt: '[Parameter] Min value (optional)' }) || undefined;
    max = await vscode.window.showInputBox({ prompt: '[Parameter] Max value (optional)' }) || undefined;
  }

  return { kind, codeName, xmlName, type, input, unit, description, value, level, text, min, max };
}

async function promptForStateTransition(parsed: ParsedClass): Promise<ElementInfo | undefined> {
  const existingStates = parsed.elements.filter(e => e.kind === 'State').map(e => e.xmlName);

  let fromState: string | undefined;
  let toState: string | undefined;

  if (existingStates.length > 0) {
    const from = await vscode.window.showQuickPick(
      [...existingStates.map(s => ({ label: s })), { label: '$(add) Enter custom...', description: 'Type a new state name' }],
      { placeHolder: 'From state' }
    );
    if (!from) { return undefined; }
    fromState = from.label.startsWith('$(add)') ? await vscode.window.showInputBox({ prompt: 'From state name' }) : from.label;

    const to = await vscode.window.showQuickPick(
      [...existingStates.map(s => ({ label: s })), { label: '$(add) Enter custom...', description: 'Type a new state name' }],
      { placeHolder: 'To state' }
    );
    if (!to) { return undefined; }
    toState = to.label.startsWith('$(add)') ? await vscode.window.showInputBox({ prompt: 'To state name' }) : to.label;
  } else {
    fromState = await vscode.window.showInputBox({ prompt: 'From state name' });
    toState = fromState ? await vscode.window.showInputBox({ prompt: 'To state name' }) : undefined;
  }

  if (!fromState || !toState) { return undefined; }

  const description = await vscode.window.showInputBox({ prompt: 'Description (optional)' });

  return {
    kind: 'StateTransition',
    codeName: `${fromState}To${toState}`,
    xmlName: `${fromState}To${toState}`,
    fromState,
    toState,
    description: description || undefined,
  };
}

/**
 * Prompt user to select an existing element (for remove/change).
 */
export async function promptSelectElement(parsed: ParsedClass, action: 'remove' | 'change'): Promise<ElementInfo | undefined> {
  if (parsed.elements.length === 0) {
    vscode.window.showInformationMessage('No CDP elements found in this class.');
    return undefined;
  }

  const items = parsed.elements.map(e => ({
    label: formatElementLabel(e),
    description: e.kind,
    detail: e.codeName !== e.xmlName ? `Code: ${e.codeName} | XML: ${e.xmlName}` : undefined,
    element: e,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Select element to ${action}`,
  });

  return picked?.element;
}

/**
 * Prompt for new values when changing an element.
 */
export async function promptForChange(oldElement: ElementInfo): Promise<ElementInfo | undefined> {
  if (oldElement.kind === 'StateTransition') {
    const fromState = await vscode.window.showInputBox({ prompt: 'New from state', value: oldElement.fromState });
    if (!fromState) { return undefined; }
    const toState = await vscode.window.showInputBox({ prompt: 'New to state', value: oldElement.toState });
    if (!toState) { return undefined; }
    return { ...oldElement, fromState, toState, codeName: `${fromState}To${toState}`, xmlName: `${fromState}To${toState}` };
  }

  const newCodeName = await vscode.window.showInputBox({
    prompt: `New code name for ${oldElement.kind}`,
    value: oldElement.codeName,
    validateInput: (v) => /^\w+$/.test(v) ? null : 'Must be alphanumeric/underscore',
  });
  if (!newCodeName) { return undefined; }

  const newXmlName = await vscode.window.showInputBox({
    prompt: `New XML name for ${oldElement.kind}`,
    value: oldElement.xmlName,
  });
  if (!newXmlName) { return undefined; }

  let newType = oldElement.type;
  if (oldElement.kind === 'Signal' || oldElement.kind === 'Property') {
    const picked = await vscode.window.showQuickPick(
      CDP_TYPES.map(t => ({ label: t, picked: t === oldElement.type })),
      { placeHolder: `Select type (current: ${oldElement.type})` }
    );
    if (picked) { newType = picked.label as CdpType; }
  }

  return { ...oldElement, codeName: newCodeName, xmlName: newXmlName, type: newType };
}

function formatElementLabel(e: ElementInfo): string {
  switch (e.kind) {
    case 'Signal': return `${e.codeName} : CDPSignal<${e.type}>`;
    case 'Property': return `${e.codeName} : CDPProperty<${e.type}>`;
    case 'StateTransition': return `${e.fromState} → ${e.toState}`;
    default: return e.codeName;
  }
}
