import * as vscode from 'vscode';
import * as path from 'path';
import { ParsedClass, ElementInfo } from './types';
import { GeneratedCode, generateCode, generatePortClassFiles } from './generator';
import { addXmlElement, removeXmlElement, changeXmlElement } from './xmlEditor';

/**
 * Add an element to .h, .cpp, and XML files.
 */
function detectIndent(lines: string[], aroundLine: number): string {
  for (let i = aroundLine; i >= 0; i--) {
    const line = lines[i];
    if (line.trim().length > 0 && !line.trim().startsWith('{') && !line.trim().startsWith('}')) {
      const match = line.match(/^([ \t]+)/);
      if (match) { return match[1]; }
    }
  }
  return '  ';
}

export async function addElement(parsed: ParsedClass, element: ElementInfo): Promise<void> {
  const headerDoc = await vscode.workspace.openTextDocument(parsed.headerPath);
  const sourceDoc = await vscode.workspace.openTextDocument(parsed.sourcePath);

  const headerLines = headerDoc.getText().split('\n');
  const sourceLines = sourceDoc.getText().split('\n');
  const headerIndent = detectIndent(headerLines, parsed.lastMemberLine);
  const sourceIndent = detectIndent(sourceLines, parsed.createEndLine >= 0 ? parsed.createEndLine : parsed.createModelEndLine);

  const code = generateCode(element, parsed.className, headerIndent, sourceIndent);

  const headerEdit = new vscode.WorkspaceEdit();
  const sourceEdit = new vscode.WorkspaceEdit();
  const headerUri = headerDoc.uri;
  const sourceUri = sourceDoc.uri;

  // Add include if needed
  if (code.include) {
    const headerText = headerDoc.getText();
    if (!headerText.includes(code.include)) {
      const lines = headerLines;
      let lastIncludeLine = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trimStart().startsWith('#include')) {
          lastIncludeLine = i;
        }
      }
      headerEdit.insert(headerUri, new vscode.Position(lastIncludeLine + 1, 0), `#include ${code.include}\n`);
    }
  }

  // Add header declaration
  if (code.headerDecl) {
    const insertLine = parsed.lastMemberLine + 1;
    headerEdit.insert(headerUri, new vscode.Position(insertLine, 0), code.headerDecl + '\n');
  }

  // Add Create() call
  if (code.createCall && parsed.createEndLine >= 0) {
    sourceEdit.insert(sourceUri, new vscode.Position(parsed.createEndLine + 1, 0), code.createCall + '\n');
  }

  // Add CreateModel() call
  if (code.createModelCall) {
    if (parsed.createModelEndLine >= 0) {
      sourceEdit.insert(sourceUri, new vscode.Position(parsed.createModelEndLine + 1, 0), code.createModelCall + '\n');
    } else {
      const createModelBody = `\nvoid ${parsed.className}::CreateModel()\n{\n${sourceIndent}CDPComponent::CreateModel();\n${code.createModelCall}\n}\n`;
      sourceEdit.insert(sourceUri, new vscode.Position(parsed.sourceEndLine + 1, 0), createModelBody);
      headerEdit.insert(headerUri, new vscode.Position(parsed.closingBraceLine, 0), `${headerIndent}void CreateModel() override;\n`);
    }
  }

  // Add function bodies
  if (code.functionBodies) {
    sourceEdit.insert(sourceUri, new vscode.Position(sourceLines.length, 0), code.functionBodies);
  }

  // Apply edits and save
  await vscode.workspace.applyEdit(headerEdit);
  await headerDoc.save();
  await vscode.workspace.applyEdit(sourceEdit);
  await sourceDoc.save();

  // Handle Port: create separate port class files
  if (element.kind === 'Port') {
    const portFiles = generatePortClassFiles(element.codeName);
    const dir = path.dirname(parsed.headerPath);
    const portHeaderPath = path.join(dir, `${element.codeName}Port.h`);
    const portSourcePath = path.join(dir, `${element.codeName}Port.cpp`);

    const portHeaderUri = vscode.Uri.file(portHeaderPath);
    const portSourceUri = vscode.Uri.file(portSourcePath);

    const portEdit = new vscode.WorkspaceEdit();
    portEdit.createFile(portHeaderUri, { ignoreIfExists: true });
    portEdit.createFile(portSourceUri, { ignoreIfExists: true });
    await vscode.workspace.applyEdit(portEdit);

    const portEdit2 = new vscode.WorkspaceEdit();
    portEdit2.insert(portHeaderUri, new vscode.Position(0, 0), portFiles.headerContent);
    portEdit2.insert(portSourceUri, new vscode.Position(0, 0), portFiles.sourceContent);
    await vscode.workspace.applyEdit(portEdit2);
    const portHeaderDoc2 = await vscode.workspace.openTextDocument(portHeaderUri);
    const portSourceDoc2 = await vscode.workspace.openTextDocument(portSourceUri);
    await portHeaderDoc2.save();
    await portSourceDoc2.save();

    // Add include for the port header in the component header
    const includeEdit = new vscode.WorkspaceEdit();
    const portLines = headerLines;
    let portLastInclude = 0;
    for (let i = 0; i < portLines.length; i++) {
      if (portLines[i].trimStart().startsWith('#include')) { portLastInclude = i; }
    }
    includeEdit.insert(headerUri, new vscode.Position(portLastInclude + 1, 0), `#include "${element.codeName}Port.h"\n`);
    await vscode.workspace.applyEdit(includeEdit);
    await headerDoc.save();
  }

  // Add to XML template
  if (parsed.xmlPath) {
    await addXmlElement(parsed.xmlPath, element);
  }

  vscode.window.showInformationMessage(`Added ${element.kind}: ${element.codeName} (XML: ${element.xmlName})`);
}

/**
 * Remove an element from .h, .cpp, and XML files.
 */
export async function removeElement(parsed: ParsedClass, element: ElementInfo): Promise<void> {
  const headerDoc = await vscode.workspace.openTextDocument(parsed.headerPath);
  const sourceDoc = await vscode.workspace.openTextDocument(parsed.sourcePath);
  const headerText = headerDoc.getText();
  const sourceText = sourceDoc.getText();

  const headerLinesToRemove = findLinesToRemove(headerText, element, parsed.className, 'header');
  const sourceLinesToRemove = findLinesToRemove(sourceText, element, parsed.className, 'source');

  const bodyLines = findFunctionBodyLines(sourceText, element, parsed.className);
  const allSourceLines = [...sourceLinesToRemove, ...bodyLines];

  const headerEdit = new vscode.WorkspaceEdit();
  const sourceEdit = new vscode.WorkspaceEdit();

  for (const line of headerLinesToRemove.sort((a, b) => b - a)) {
    headerEdit.delete(headerDoc.uri, new vscode.Range(line, 0, line + 1, 0));
  }
  for (const line of [...new Set(allSourceLines)].sort((a, b) => b - a)) {
    sourceEdit.delete(sourceDoc.uri, new vscode.Range(line, 0, line + 1, 0));
  }

  await vscode.workspace.applyEdit(headerEdit);
  await headerDoc.save();
  await vscode.workspace.applyEdit(sourceEdit);
  await sourceDoc.save();

  // Remove from XML template
  if (parsed.xmlPath) {
    await removeXmlElement(parsed.xmlPath, element);
  }

  vscode.window.showInformationMessage(`Removed ${element.kind}: ${element.codeName}`);
}

/**
 * Change an element (rename) in .h, .cpp, and XML files.
 */
export async function changeElement(parsed: ParsedClass, oldElement: ElementInfo, newElement: ElementInfo): Promise<void> {
  const headerDoc = await vscode.workspace.openTextDocument(parsed.headerPath);
  const sourceDoc = await vscode.workspace.openTextDocument(parsed.sourcePath);

  const headerEdit = new vscode.WorkspaceEdit();
  const sourceEdit = new vscode.WorkspaceEdit();

  const className = parsed.className;

  // Replace in header
  const headerText = headerDoc.getText();
  const newHeaderText = replaceElementReferences(headerText, oldElement, newElement, className);
  if (newHeaderText !== headerText) {
    const fullRange = new vscode.Range(0, 0, headerDoc.lineCount, 0);
    headerEdit.replace(headerDoc.uri, fullRange, newHeaderText);
  }

  // Replace in source
  const sourceText = sourceDoc.getText();
  const newSourceText = replaceElementReferences(sourceText, oldElement, newElement, className);
  if (newSourceText !== sourceText) {
    const fullRange = new vscode.Range(0, 0, sourceDoc.lineCount, 0);
    sourceEdit.replace(sourceDoc.uri, fullRange, newSourceText);
  }

  await vscode.workspace.applyEdit(headerEdit);
  await headerDoc.save();
  await vscode.workspace.applyEdit(sourceEdit);
  await sourceDoc.save();

  // Change in XML template
  if (parsed.xmlPath) {
    await changeXmlElement(parsed.xmlPath, oldElement, newElement);
  }

  vscode.window.showInformationMessage(`Changed ${oldElement.kind}: ${oldElement.codeName} → ${newElement.codeName}`);
}

function findLinesToRemove(text: string, element: ElementInfo, className: string, fileType: 'header' | 'source'): number[] {
  const lines = text.split('\n');
  const toRemove: number[] = [];
  const codeName = element.codeName;
  const xmlName = element.xmlName;
  const nameWord = new RegExp(`\\b${codeName}\\b`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    switch (element.kind) {
      case 'Signal':
        if (fileType === 'header' && /Signal<.*>\s+/.test(line) && nameWord.test(line)) { toRemove.push(i); }
        if (fileType === 'source' && new RegExp(`\\b${codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
        break;
      case 'Parameter':
        if (fileType === 'header' && /CDPParameter/.test(line) && nameWord.test(line)) { toRemove.push(i); }
        if (fileType === 'source' && new RegExp(`\\b${codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
        break;
      case 'Alarm':
        if (fileType === 'header' && /CDPAlarm/.test(line) && nameWord.test(line)) { toRemove.push(i); }
        if (fileType === 'source' && new RegExp(`\\b${codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
        break;
      case 'Property':
        if (fileType === 'header' && /CDPProperty<.*>/.test(line) && nameWord.test(line)) { toRemove.push(i); }
        if (fileType === 'source' && new RegExp(`\\b${codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
        break;
      case 'Connector':
        if (fileType === 'header' && /CDPConnector/.test(line) && nameWord.test(line)) { toRemove.push(i); }
        if (fileType === 'source' && new RegExp(`\\b${codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
        break;
      case 'State':
        if (fileType === 'header' && line.includes(`Process${codeName}`)) { toRemove.push(i); }
        if (fileType === 'source' && line.includes(`RegisterStateProcess`) && line.includes(`"${xmlName}"`)) { toRemove.push(i); }
        break;
      case 'StateTransition': {
        const from = element.fromState!;
        const to = element.toState!;
        if (fileType === 'header' && line.includes(`Transition${from}To${to}`)) { toRemove.push(i); }
        if (fileType === 'source' && line.includes(`RegisterStateTransitionHandler`) && line.includes(`"${from}"`) && line.includes(`"${to}"`)) { toRemove.push(i); }
        break;
      }
      case 'Message':
        if (fileType === 'header' && line.includes(`Message${codeName}`)) { toRemove.push(i); }
        if (fileType === 'source' && line.includes(`RegisterMessage`) && line.includes(`"${xmlName}"`)) { toRemove.push(i); }
        break;
    }
  }
  return toRemove;
}

function findFunctionBodyLines(sourceText: string, element: ElementInfo, className: string): number[] {
  const lines = sourceText.split('\n');
  const toRemove: number[] = [];

  let funcName: string | undefined;
  if (element.kind === 'State') {
    funcName = `Process${element.codeName}`;
  } else if (element.kind === 'StateTransition') {
    funcName = `Transition${element.fromState}To${element.toState}`;
  } else if (element.kind === 'Message') {
    funcName = `Message${element.codeName}`;
  }

  if (!funcName) { return []; }

  const funcRegex = new RegExp(`\\b${className}::${funcName}\\s*\\(`);
  let inFunc = false;
  let braceDepth = 0;
  let funcStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (!inFunc && funcRegex.test(lines[i])) {
      inFunc = true;
      braceDepth = 0;
      funcStartLine = (i > 0 && lines[i - 1].trim() === '') ? i - 1 : i;
    }
    if (inFunc) {
      for (const ch of lines[i]) {
        if (ch === '{') { braceDepth++; }
        if (ch === '}') {
          braceDepth--;
          if (braceDepth === 0) {
            for (let j = funcStartLine; j <= i; j++) { toRemove.push(j); }
            inFunc = false;
            break;
          }
        }
      }
    }
  }

  return toRemove;
}

function replaceElementReferences(text: string, oldEl: ElementInfo, newEl: ElementInfo, className: string): string {
  let result = text;
  const oldCodeName = oldEl.codeName;
  const newCodeName = newEl.codeName;
  const oldXmlName = oldEl.xmlName;
  const newXmlName = newEl.xmlName;

  switch (oldEl.kind) {
    case 'Signal':
    case 'Parameter':
    case 'Alarm':
    case 'Property':
    case 'Connector': {
      // Replace code name references
      result = result.replace(new RegExp(`\\b${oldCodeName}\\b`, 'g'), newCodeName);
      // Replace XML name in Create() calls
      result = result.replace(new RegExp(`"${escapeRegex(oldXmlName)}"`, 'g'), `"${newXmlName}"`);
      // If type changed (Signal/Property), replace type too
      if (oldEl.type && newEl.type && oldEl.type !== newEl.type) {
        if (oldEl.kind === 'Signal') {
          result = result.replace(new RegExp(`Signal<${escapeRegex(oldEl.type)}>\\s+${newCodeName}`, 'g'), `CDPSignal<${newEl.type}> ${newCodeName}`);
        } else if (oldEl.kind === 'Property') {
          result = result.replace(new RegExp(`CDPProperty<${escapeRegex(oldEl.type)}>\\s+${newCodeName}`, 'g'), `CDPProperty<${newEl.type}> ${newCodeName}`);
        }
      }
      break;
    }
    case 'State':
      result = result.replace(new RegExp(`Process${oldCodeName}`, 'g'), `Process${newCodeName}`);
      result = result.replace(new RegExp(`"${escapeRegex(oldXmlName)}"`, 'g'), `"${newXmlName}"`);
      break;
    case 'StateTransition': {
      const oldFrom = oldEl.fromState!;
      const oldTo = oldEl.toState!;
      const newFrom = newEl.fromState || oldFrom;
      const newTo = newEl.toState || oldTo;
      result = result.replace(new RegExp(`Transition${oldFrom}To${oldTo}`, 'g'), `Transition${newFrom}To${newTo}`);
      result = result.replace(new RegExp(`"${escapeRegex(oldFrom)}"(\\s*,\\s*)"${escapeRegex(oldTo)}"`, 'g'), `"${newFrom}"$1"${newTo}"`);
      break;
    }
    case 'Message':
      result = result.replace(new RegExp(`Message${oldCodeName}`, 'g'), `Message${newCodeName}`);
      result = result.replace(new RegExp(`"${escapeRegex(oldXmlName)}"`, 'g'), `"${newXmlName}"`);
      break;
  }

  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
