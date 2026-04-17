import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ParsedClass, ElementInfo } from './types';
import { findXmlTemplatePath } from './xmlEditor';

export function getPairedFile(filePath: string): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  if (ext === '.h' || ext === '.hpp') { return base + '.cpp'; }
  return base + '.h';
}

export async function parseClass(filePath: string): Promise<ParsedClass | undefined> {
  const ext = path.extname(filePath);
  const headerPath = (ext === '.h' || ext === '.hpp') ? filePath : getPairedFile(filePath);
  const sourcePath = (ext === '.cpp' || ext === '.cc') ? filePath : getPairedFile(filePath);

  let headerDoc: vscode.TextDocument;
  let sourceDoc: vscode.TextDocument;
  try {
    headerDoc = await vscode.workspace.openTextDocument(headerPath);
    sourceDoc = await vscode.workspace.openTextDocument(sourcePath);
  } catch {
    vscode.window.showErrorMessage('Could not find paired .h/.cpp files.');
    return undefined;
  }

  const headerText = headerDoc.getText();
  const sourceText = sourceDoc.getText();

  const classMatch = headerText.match(/class\s+(\w+)\s*:\s*public\s+(?:CDPComponent|CDPBaseComponent|CDPOperator)\b/);
  if (!classMatch) {
    vscode.window.showErrorMessage('No CDPComponent class found in header.');
    return undefined;
  }
  const className = classMatch[1];

  // Find XML template
  const xmlPath = await findXmlTemplatePath(headerPath, className);

  // Find insertion points in header
  const headerLines = headerText.split('\n');
  let lastMemberLine = -1;
  let closingBraceLine = -1;
  let inClass = false;
  let braceDepth = 0;
  const classStartRegex = new RegExp(`class\\s+${className}\\b`);

  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];
    if (!inClass && classStartRegex.test(line)) { inClass = true; }
    if (inClass) {
      for (const ch of line) {
        if (ch === '{') { braceDepth++; }
        if (ch === '}') { braceDepth--; }
      }
      if (braceDepth === 1 && line.trim().endsWith(';') && !line.trim().startsWith('//')) {
        lastMemberLine = i;
      }
      if (braceDepth === 0 && inClass && line.includes('}')) {
        closingBraceLine = i;
        break;
      }
    }
  }
  if (lastMemberLine === -1) { lastMemberLine = closingBraceLine - 1; }

  const sourceLines = sourceText.split('\n');
  const createEndLine = findMethodClosingBrace(sourceLines, className, 'Create');
  const createModelEndLine = findMethodClosingBrace(sourceLines, className, 'CreateModel');
  const sourceEndLine = sourceLines.length - 1;

  const elements = parseExistingElements(headerText, sourceText, className);

  return {
    className, headerPath, sourcePath, xmlPath,
    lastMemberLine, closingBraceLine,
    createEndLine, createModelEndLine, sourceEndLine,
    elements,
  };
}

function findMethodClosingBrace(lines: string[], className: string, methodName: string): number {
  const methodRegex = new RegExp(`\\b${className}::${methodName}\\s*\\(`);
  let foundMethod = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!foundMethod && methodRegex.test(lines[i])) {
      foundMethod = true;
      braceDepth = 0;
    }
    if (foundMethod) {
      for (const ch of lines[i]) {
        if (ch === '{') { braceDepth++; }
        if (ch === '}') {
          braceDepth--;
          if (braceDepth === 0) { return i - 1; }
        }
      }
    }
  }
  return -1;
}

function parseExistingElements(headerText: string, sourceText: string, className: string): ElementInfo[] {
  const elements: ElementInfo[] = [];
  let m;

  // Signals: CDPSignal<type> name; or Signal<type> name;
  const signalRegex = /(?:CDP)?Signal<(\w[\w\s:]*)>\s+(\w+)\s*;/g;
  while ((m = signalRegex.exec(headerText))) {
    const codeName = m[2];
    const xmlName = findXmlNameFromCreate(sourceText, codeName) || codeName;
    elements.push({ kind: 'Signal', codeName, xmlName, type: m[1].trim() as any });
  }

  // Parameters
  const paramRegex = /CDPParameter(?:Timer)?\s+(\w+)\s*;/g;
  while ((m = paramRegex.exec(headerText))) {
    const codeName = m[1];
    const xmlName = findXmlNameFromCreate(sourceText, codeName) || codeName;
    elements.push({ kind: 'Parameter', codeName, xmlName });
  }

  // Alarms
  const alarmRegex = /CDPAlarm\s+(\w+)\s*(?:\[.*?\])?\s*;/g;
  while ((m = alarmRegex.exec(headerText))) {
    const codeName = m[1];
    const xmlName = findXmlNameFromCreate(sourceText, codeName) || codeName;
    elements.push({ kind: 'Alarm', codeName, xmlName });
  }

  // Properties
  const propRegex = /CDPProperty<(\w[\w\s:]*)>\s+(\w+)\s*;/g;
  while ((m = propRegex.exec(headerText))) {
    const codeName = m[2];
    const xmlName = findXmlNameFromCreate(sourceText, codeName) || codeName;
    elements.push({ kind: 'Property', codeName, xmlName, type: m[1].trim() as any });
  }

  // Connectors
  const connRegex = /CDPConnector\s+(\w+)\s*;/g;
  while ((m = connRegex.exec(headerText))) {
    const codeName = m[1];
    const xmlName = findXmlNameFromCreate(sourceText, codeName) || codeName;
    elements.push({ kind: 'Connector', codeName, xmlName });
  }

  // States
  const stateRegex = /RegisterStateProcess\s*\(\s*"(\w+)"\s*,.*?::Process(\w+)/g;
  while ((m = stateRegex.exec(sourceText))) {
    elements.push({ kind: 'State', codeName: m[2], xmlName: m[1] });
  }

  // State Transitions
  const transRegex = /RegisterStateTransitionHandler\s*\(\s*"(\w+)"\s*,\s*"(\w+)"/g;
  while ((m = transRegex.exec(sourceText))) {
    elements.push({ kind: 'StateTransition', codeName: `${m[1]}To${m[2]}`, xmlName: `${m[1]}To${m[2]}`, fromState: m[1], toState: m[2] });
  }

  // Messages
  const msgRegex = /RegisterMessage\s*\(\s*CM_TEXTCOMMAND\s*,\s*"(\w+)".*?::Message(\w+)/g;
  while ((m = msgRegex.exec(sourceText))) {
    elements.push({ kind: 'Message', codeName: m[2], xmlName: m[1] });
  }

  return elements;
}

/**
 * Extract the XML name from a Create() call: `codeName.Create("XmlName", this);`
 */
function findXmlNameFromCreate(sourceText: string, codeName: string): string | undefined {
  const regex = new RegExp(`${codeName}\\.Create\\s*\\(\\s*"([^"]+)"`);
  const m = regex.exec(sourceText);
  return m ? m[1] : undefined;
}
