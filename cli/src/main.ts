#!/usr/bin/env node
/**
 * cdp-element CLI
 *
 * Usage:
 *   node dist/main.js add <kind> <file> <codeName> [options]
 *   node dist/main.js remove <file> <codeName> [--kind K] [--xml-name N]
 *   node dist/main.js change <file> <oldName> <newName> [--kind K]
 *   node dist/main.js parse <file>
 */

import { parseClass, parseExistingElements, findXmlTemplatePath } from './parser';
import { addElement, removeElement, changeElement } from './inserter';
import { ElementInfo, ElementKind, CdpType } from './types';

// ---------------------------------------------------------------------------
// Argument parsing helpers
// ---------------------------------------------------------------------------

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function defaultXmlName(codeName: string): string {
  return codeName.replace(/^[iopas]_/, '');
}

function guessKindFromHeader(headerPath: string, codeName: string): ElementKind | undefined {
  const fs = require('fs') as typeof import('fs');
  if (!fs.existsSync(headerPath)) { return undefined; }
  const text = fs.readFileSync(headerPath, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.includes(codeName)) { continue; }
    if (/Signal</.test(line)) { return 'Signal'; }
    if (/CDPParameter/.test(line)) { return 'Parameter'; }
    if (/CDPAlarm/.test(line)) { return 'Alarm'; }
    if (/CDPProperty</.test(line)) { return 'Property'; }
    if (/CDPConnector/.test(line)) { return 'Connector'; }
    if (line.includes(`Process${codeName}`)) { return 'State'; }
    if (line.includes(`Message${codeName}`)) { return 'Message'; }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const action = args[0];

  try {
    if (action === 'parse') {
      runParse(args.slice(1));
    } else if (action === 'add') {
      runAdd(args.slice(1));
    } else if (action === 'remove') {
      runRemove(args.slice(1));
    } else if (action === 'change') {
      runChange(args.slice(1));
    } else {
      die(`Unknown action: ${action}. Expected: add, remove, change, parse`);
    }
  } catch (err: any) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

function runParse(args: string[]): void {
  const [filePath] = args;
  if (!filePath) { die('parse requires <file>'); }

  const parsed = parseClass(filePath);
  const output = {
    className: parsed.className,
    headerPath: parsed.headerPath,
    sourcePath: parsed.sourcePath,
    xmlPath: parsed.xmlPath ?? null,
    elements: parsed.elements,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

function runAdd(args: string[]): void {
  const [kindRaw, filePath, codeName, ...rest] = args;
  if (!kindRaw || !filePath || !codeName) {
    die('add requires <kind> <file> <codeName>');
  }

  const kind = normalizeKind(kindRaw);
  const parsed = parseClass(filePath);

  const xmlName = getArg(rest, '--xml-name') ?? defaultXmlName(codeName);
  const type = (getArg(rest, '--type') ?? 'double') as CdpType;
  const isInput = !hasFlag(rest, '--output');
  const unit = getArg(rest, '--unit');
  const desc = getArg(rest, '--desc');
  const value = getArg(rest, '--value');
  const min = getArg(rest, '--min');
  const max = getArg(rest, '--max');
  const level = getArg(rest, '--level') ?? 'Error';
  const text = getArg(rest, '--text');
  const fromState = getArg(rest, '--from');
  const toState = getArg(rest, '--to');

  let element: ElementInfo;

  if (kind === 'StateTransition') {
    if (!fromState || !toState) { die('statetransition requires --from <state> --to <state>'); }
    element = {
      kind, codeName: `${fromState}To${toState}`, xmlName: `${fromState}To${toState}`,
      fromState, toState, description: desc,
    };
  } else {
    element = {
      kind, codeName, xmlName,
      type: (kind === 'Signal' || kind === 'Property') ? type : undefined,
      description: desc, unit, value, input: isInput,
      level, text, min, max,
    };
  }

  addElement(parsed, element);
  console.log(`Added ${kind}: ${element.codeName} (XML: ${element.xmlName})`);
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

function runRemove(args: string[]): void {
  const [filePath, codeName, ...rest] = args;
  if (!filePath || !codeName) { die('remove requires <file> <codeName>'); }

  const parsed = parseClass(filePath);

  const kindRaw = getArg(rest, '--kind');
  const kind: ElementKind = kindRaw
    ? normalizeKind(kindRaw)
    : (guessKindFromHeader(parsed.headerPath, codeName) ?? die('Cannot determine kind — use --kind'));

  const xmlName = getArg(rest, '--xml-name') ?? defaultXmlName(codeName);
  const fromState = getArg(rest, '--from');
  const toState = getArg(rest, '--to');

  const element: ElementInfo = { kind, codeName, xmlName, fromState, toState };
  removeElement(parsed, element);
  console.log(`Removed ${kind}: ${codeName}`);
}

// ---------------------------------------------------------------------------
// change
// ---------------------------------------------------------------------------

function runChange(args: string[]): void {
  const [filePath, oldName, newName, ...rest] = args;
  if (!filePath || !oldName || !newName) { die('change requires <file> <oldName> <newName>'); }

  const parsed = parseClass(filePath);

  const kindRaw = getArg(rest, '--kind');
  const kind: ElementKind = kindRaw
    ? normalizeKind(kindRaw)
    : (guessKindFromHeader(parsed.headerPath, oldName) ?? die('Cannot determine kind — use --kind'));

  const oldXml = getArg(rest, '--old-xml-name') ?? defaultXmlName(oldName);
  const newXml = getArg(rest, '--new-xml-name') ?? defaultXmlName(newName);

  const oldElement: ElementInfo = { kind, codeName: oldName, xmlName: oldXml };
  const newElement: ElementInfo = { kind, codeName: newName, xmlName: newXml };

  changeElement(parsed, oldElement, newElement);
  console.log(`Changed ${kind}: ${oldName} → ${newName}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeKind(raw: string): ElementKind {
  const map: Record<string, ElementKind> = {
    signal: 'Signal', parameter: 'Parameter', alarm: 'Alarm',
    property: 'Property', connector: 'Connector', state: 'State',
    statetransition: 'StateTransition', message: 'Message', port: 'Port',
  };
  const kind = map[raw.toLowerCase()];
  if (!kind) { die(`Unknown element kind: ${raw}. Valid: signal parameter alarm property connector state statetransition message port`); }
  return kind;
}

function die(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

function printUsage(): void {
  console.log(`
cdp-element — manage CDP elements in C++ component files

Usage:
  cdp-element add <kind> <file> <codeName> [options]
  cdp-element remove <file> <codeName> [--kind K]
  cdp-element change <file> <oldName> <newName> [--kind K]
  cdp-element parse <file>

Kinds: signal parameter alarm property connector state statetransition message port

Add options:
  --type      double|bool|int|float|...    (Signal, Property)
  --output                                 (Signal; default is input)
  --xml-name  NAME
  --unit      UNIT
  --desc      TEXT
  --value     VALUE
  --min / --max  VALUE                     (Parameter)
  --level     Error|Warning|Notify         (Alarm)
  --text      TEXT                         (Alarm)
  --from      STATE  --to  STATE           (StateTransition)

Examples:
  cdp-element add signal HoistControl.cpp i_Enable --type bool --input
  cdp-element remove HoistControl.cpp i_Enable
  cdp-element change HoistControl.cpp i_Enable i_EnableHoist
  cdp-element parse HoistControl.cpp
`);
}

main();
