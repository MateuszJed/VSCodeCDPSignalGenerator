import * as fs from 'fs';
import * as path from 'path';
import { ParsedClass, ElementInfo } from './types';
import { GeneratedCode, generateCode, generatePortClassFiles } from './generator';
import { addXmlElement, removeXmlElement, changeXmlElement } from './xmlEditor';
import { parseClass } from './parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function insertLineAfter(lines: string[], index: number, newLine: string): string[] {
  return [...lines.slice(0, index + 1), newLine, ...lines.slice(index + 1)];
}

/** Ensure the include is present; inserts after the last existing #include if missing.
 *  Returns { lines, offset } where offset is 1 if a line was inserted, else 0. */
function ensureInclude(lines: string[], include: string): { lines: string[]; offset: number } {
  if (lines.some(l => l.includes(include))) { return { lines, offset: 0 }; }
  let lastInclude = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('#include')) { lastInclude = i; }
  }
  return {
    lines: [...lines.slice(0, lastInclude + 1), `#include ${include}`, ...lines.slice(lastInclude + 1)],
    offset: 1,
  };
}

// ---------------------------------------------------------------------------
// Add element
// ---------------------------------------------------------------------------

export function addElement(parsed: ParsedClass, element: ElementInfo): void {
  let headerLines = fs.readFileSync(parsed.headerPath, 'utf8').split('\n');
  const siRef = parsed.createEndLine >= 0 ? parsed.createEndLine : parsed.createModelEndLine;
  const sourceLines = fs.readFileSync(parsed.sourcePath, 'utf8').split('\n');

  const headerIndent = detectIndent(headerLines, parsed.lastMemberLine);
  const sourceIndent = detectIndent(sourceLines, siRef);

  const code = generateCode(element, parsed.className, headerIndent, sourceIndent);

  // --- Header: ensure include ---
  let includeOffset = 0;
  if (code.include) {
    const result = ensureInclude(headerLines, code.include);
    headerLines = result.lines;
    includeOffset = result.offset;
  }

  // --- Header: member declaration ---
  if (code.headerDecl) {
    const insertAt = parsed.lastMemberLine + includeOffset;
    headerLines = insertLineAfter(headerLines, insertAt, code.headerDecl);
  }

  fs.writeFileSync(parsed.headerPath, headerLines.join('\n'), 'utf8');

  // Re-parse to get updated line numbers for source (header write may have shifted nothing in source)
  const reparsed = parseClass(parsed.sourcePath);

  // --- Source: Create() call ---
  let sourceLines2 = fs.readFileSync(reparsed.sourcePath, 'utf8').split('\n');
  if (code.createCall && reparsed.createEndLine >= 0) {
    sourceLines2 = insertLineAfter(sourceLines2, reparsed.createEndLine, code.createCall);
  }

  // --- Source: CreateModel() call ---
  if (code.createModelCall) {
    if (reparsed.createModelEndLine >= 0) {
      sourceLines2 = insertLineAfter(sourceLines2, reparsed.createModelEndLine, code.createModelCall);
    } else {
      // CreateModel() does not exist — append it to end of source
      const createModelBody =
        `\nvoid ${reparsed.className}::CreateModel()\n{\n${sourceIndent}CDPComponent::CreateModel();\n${code.createModelCall}\n}\n`;
      sourceLines2.push(createModelBody);

      // Also add the declaration to header
      let hLines2 = fs.readFileSync(reparsed.headerPath, 'utf8').split('\n');
      const reparsed2 = parseClass(reparsed.headerPath);
      hLines2 = insertLineAfter(hLines2, reparsed2.closingBraceLine - 1, `${headerIndent}void CreateModel() override;`);
      fs.writeFileSync(reparsed.headerPath, hLines2.join('\n'), 'utf8');
    }
  }

  // --- Source: function bodies (State, StateTransition, Message) ---
  if (code.functionBodies) {
    sourceLines2.push(code.functionBodies);
  }

  fs.writeFileSync(reparsed.sourcePath, sourceLines2.join('\n'), 'utf8');

  // --- Handle Port: create separate port class files ---
  if (element.kind === 'Port') {
    const portFiles = generatePortClassFiles(element.codeName);
    const dir = path.dirname(parsed.headerPath);
    fs.writeFileSync(path.join(dir, `${element.codeName}Port.h`), portFiles.headerContent, 'utf8');
    fs.writeFileSync(path.join(dir, `${element.codeName}Port.cpp`), portFiles.sourceContent, 'utf8');

    // Add include for port header in component header
    let hLines3 = fs.readFileSync(reparsed.headerPath, 'utf8').split('\n');
    const portIncludeResult = ensureInclude(hLines3, `"${element.codeName}Port.h"`);
    if (portIncludeResult.offset > 0) {
      fs.writeFileSync(reparsed.headerPath, portIncludeResult.lines.join('\n'), 'utf8');
    }
  }

  // --- XML ---
  if (parsed.xmlPath) {
    addXmlElement(parsed.xmlPath, element);
  }
}

// ---------------------------------------------------------------------------
// Remove element
// ---------------------------------------------------------------------------

export function removeElement(parsed: ParsedClass, element: ElementInfo): void {
  const headerText = fs.readFileSync(parsed.headerPath, 'utf8');
  const sourceText = fs.readFileSync(parsed.sourcePath, 'utf8');

  const headerLinesToRemove = new Set(findLinesToRemove(headerText, element, parsed.className, 'header'));
  const sourceLinesToRemove = new Set([
    ...findLinesToRemove(sourceText, element, parsed.className, 'source'),
    ...findFunctionBodyLines(sourceText, element, parsed.className),
  ]);

  const newHeader = headerText.split('\n').filter((_, i) => !headerLinesToRemove.has(i)).join('\n');
  const newSource = sourceText.split('\n').filter((_, i) => !sourceLinesToRemove.has(i)).join('\n');

  fs.writeFileSync(parsed.headerPath, newHeader, 'utf8');
  fs.writeFileSync(parsed.sourcePath, newSource, 'utf8');

  if (parsed.xmlPath) {
    removeXmlElement(parsed.xmlPath, element);
  }
}

// ---------------------------------------------------------------------------
// Change element (rename)
// ---------------------------------------------------------------------------

export function changeElement(parsed: ParsedClass, oldElement: ElementInfo, newElement: ElementInfo): void {
  for (const filePath of [parsed.headerPath, parsed.sourcePath]) {
    let text = fs.readFileSync(filePath, 'utf8');
    text = replaceElementReferences(text, oldElement, newElement, parsed.className);
    fs.writeFileSync(filePath, text, 'utf8');
  }

  if (parsed.xmlPath) {
    changeXmlElement(parsed.xmlPath, oldElement, newElement);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findLinesToRemove(text: string, element: ElementInfo, className: string, fileType: 'header' | 'source'): number[] {
  const lines = text.split('\n');
  const toRemove: number[] = [];
  const nameWord = new RegExp(`\\b${element.codeName}\\b`);
  const k = element.kind;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (k === 'Signal') {
      if (fileType === 'header' && /Signal<.*>/.test(line) && nameWord.test(line)) { toRemove.push(i); }
      if (fileType === 'source' && new RegExp(`\\b${element.codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
    } else if (k === 'Parameter') {
      if (fileType === 'header' && /CDPParameter/.test(line) && nameWord.test(line)) { toRemove.push(i); }
      if (fileType === 'source' && new RegExp(`\\b${element.codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
    } else if (k === 'Alarm') {
      if (fileType === 'header' && /CDPAlarm/.test(line) && nameWord.test(line)) { toRemove.push(i); }
      if (fileType === 'source' && new RegExp(`\\b${element.codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
    } else if (k === 'Property') {
      if (fileType === 'header' && /CDPProperty<.*>/.test(line) && nameWord.test(line)) { toRemove.push(i); }
      if (fileType === 'source' && new RegExp(`\\b${element.codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
    } else if (k === 'Connector') {
      if (fileType === 'header' && /CDPConnector/.test(line) && nameWord.test(line)) { toRemove.push(i); }
      if (fileType === 'source' && new RegExp(`\\b${element.codeName}\\.Create\\(`).test(line)) { toRemove.push(i); }
    } else if (k === 'State') {
      if (fileType === 'header' && line.includes(`Process${element.codeName}`)) { toRemove.push(i); }
      if (fileType === 'source' && line.includes('RegisterStateProcess') && line.includes(`"${element.xmlName}"`)) { toRemove.push(i); }
    } else if (k === 'StateTransition') {
      const fn = `Transition${element.fromState}To${element.toState}`;
      if (fileType === 'header' && line.includes(fn)) { toRemove.push(i); }
      if (fileType === 'source' && line.includes('RegisterStateTransitionHandler') && line.includes(`"${element.fromState}"`) && line.includes(`"${element.toState}"`)) { toRemove.push(i); }
    } else if (k === 'Message') {
      if (fileType === 'header' && line.includes(`Message${element.codeName}`)) { toRemove.push(i); }
      if (fileType === 'source' && line.includes('RegisterMessage') && line.includes(`"${element.xmlName}"`)) { toRemove.push(i); }
    }
  }
  return toRemove;
}

function findFunctionBodyLines(sourceText: string, element: ElementInfo, className: string): number[] {
  const lines = sourceText.split('\n');
  const toRemove: number[] = [];

  let funcName: string | undefined;
  if (element.kind === 'State') { funcName = `Process${element.codeName}`; }
  else if (element.kind === 'StateTransition') { funcName = `Transition${element.fromState}To${element.toState}`; }
  else if (element.kind === 'Message') { funcName = `Message${element.codeName}`; }
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

  if (oldEl.kind === 'State') {
    result = result.replace(new RegExp(`Process${oldEl.codeName}`, 'g'), `Process${newEl.codeName}`);
    result = result.replace(new RegExp(`"${oldEl.xmlName}"`, 'g'), `"${newEl.xmlName}"`);
  } else if (oldEl.kind === 'StateTransition') {
    const oldFn = `Transition${oldEl.fromState}To${oldEl.toState}`;
    const newFn = `Transition${newEl.fromState}To${newEl.toState}`;
    result = result.replace(new RegExp(oldFn, 'g'), newFn);
    result = result.replace(new RegExp(`"${oldEl.fromState}"`, 'g'), `"${newEl.fromState}"`);
    result = result.replace(new RegExp(`"${oldEl.toState}"`, 'g'), `"${newEl.toState}"`);
  } else if (oldEl.kind === 'Message') {
    result = result.replace(new RegExp(`Message${oldEl.codeName}`, 'g'), `Message${newEl.codeName}`);
    result = result.replace(new RegExp(`"${oldEl.xmlName}"`, 'g'), `"${newEl.xmlName}"`);
  } else {
    // Signal, Parameter, Alarm, Property, Connector
    result = result.replace(new RegExp(`\\b${oldEl.codeName}\\b`, 'g'), newEl.codeName);
    if (oldEl.xmlName !== newEl.xmlName) {
      result = result.replace(new RegExp(`"${oldEl.xmlName}"`, 'g'), `"${newEl.xmlName}"`);
    }
    // Update type in declarations if changed
    if (oldEl.type && newEl.type && oldEl.type !== newEl.type) {
      result = result.replace(
        new RegExp(`(Signal|Property)<${oldEl.type}>`, 'g'),
        `$1<${newEl.type}>`,
      );
    }
  }

  return result;
}
