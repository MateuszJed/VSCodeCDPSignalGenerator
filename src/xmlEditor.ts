import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ElementInfo, cdpTypeToXmlType, cdpTypeToSignalModel } from './types';

/**
 * Find the XML template file for a given component class.
 * Searches for both `ClassName.xml` and `LibName.ClassName.xml` patterns
 * inside `<library>/Templates/Models/`.
 */
export async function findXmlTemplatePath(headerPath: string, className: string): Promise<string | undefined> {
  // Walk up from headerPath looking for Templates/Models/ sibling
  let dir = path.dirname(headerPath);
  // If we're in ModelSource/, go up one level to the library root
  if (path.basename(dir) === 'ModelSource') {
    dir = path.dirname(dir);
  }

  const modelsDir = path.join(dir, 'Templates', 'Models');
  if (!fs.existsSync(modelsDir)) {
    // Try going up one more level
    const parentModelsDir = path.join(path.dirname(dir), 'Templates', 'Models');
    if (!fs.existsSync(parentModelsDir)) {
      return undefined;
    }
    return findXmlInDir(parentModelsDir, className);
  }
  return findXmlInDir(modelsDir, className);
}

function findXmlInDir(modelsDir: string, className: string): string | undefined {
  // Try exact match first
  const exactPath = path.join(modelsDir, `${className}.xml`);
  if (fs.existsSync(exactPath)) { return exactPath; }

  // Try LibName.ClassName.xml pattern
  try {
    const files = fs.readdirSync(modelsDir);
    const match = files.find(f => f.endsWith(`.${className}.xml`));
    if (match) { return path.join(modelsDir, match); }
  } catch { /* ignore */ }

  return undefined;
}

/**
 * Read and parse XML template file to extract existing elements.
 */
export function parseXmlElements(xmlContent: string): ElementInfo[] {
  const elements: ElementInfo[] = [];

  // Signals
  const signalRegex = /<Signal\s+([^/>]*)\/?>/g;
  let m;
  while ((m = signalRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'Signal',
      codeName: '',  // filled by parser cross-reference
      xmlName: attrs['Name'] || '',
      type: mapXmlTypeToCdp(attrs['Type']),
      description: attrs['Description'],
      unit: attrs['Unit'],
      value: attrs['Value'],
      input: attrs['Input'] === '1',
      routing: attrs['Routing'],
    });
  }

  // Parameters
  const paramRegex = /<Parameter\s+([^/>]*)\/?>/g;
  while ((m = paramRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'Parameter',
      codeName: '',
      xmlName: attrs['Name'] || '',
      description: attrs['Description'],
      unit: attrs['Unit'],
      value: attrs['Value'],
      min: attrs['Min'],
      max: attrs['Max'],
    });
  }

  // Alarms
  const alarmRegex = /<Alarm\s+([^/>]*)\/?>/g;
  while ((m = alarmRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'Alarm',
      codeName: '',
      xmlName: attrs['Name'] || '',
      description: attrs['Description'],
      level: attrs['Level'],
      text: attrs['Text'],
    });
  }

  // States
  const stateRegex = /<State\s+([^/>]*)\/?>/g;
  while ((m = stateRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'State',
      codeName: '',
      xmlName: attrs['Name'] || '',
      description: attrs['Description'],
    });
  }

  // StateTransitions
  const transRegex = /<StateTransition\s+([^/>]*)\/?>/g;
  while ((m = transRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'StateTransition',
      codeName: '',
      xmlName: attrs['Name'] || '',
      fromState: attrs['FromState'],
      toState: attrs['ToState'],
      description: attrs['Description'],
    });
  }

  // Messages
  const msgRegex = /<Message\s+([^/>]*)\/?>/g;
  while ((m = msgRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'Message',
      codeName: '',
      xmlName: attrs['Name'] || '',
      description: attrs['Description'],
    });
  }

  // Connectors
  const connRegex = /<Connector\s+([^/>]*)\/?>/g;
  while ((m = connRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'Connector',
      codeName: '',
      xmlName: attrs['Name'] || '',
      description: attrs['Description'],
    });
  }

  // Ports
  const portRegex = /<Port\s+([^/>]*?)(?:\/>|>)/g;
  while ((m = portRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'Port',
      codeName: '',
      xmlName: attrs['Name'] || '',
      description: attrs['Description'],
      input: attrs['Input'] === '1',
    });
  }

  return elements;
}

/**
 * Generate XML snippet for an element.
 */
export function generateXmlSnippet(element: ElementInfo): { tag: string; container: string } {
  switch (element.kind) {
    case 'Signal': {
      const inputVal = element.input ? '1' : '0';
      const model = element.type ? cdpTypeToSignalModel(element.type) : 'CDPSignal&lt;double&gt;';
      const xmlType = element.type ? cdpTypeToXmlType(element.type) : 'double';
      let attrs = `Description="${esc(element.description)}" Input="${inputVal}" Model="${model}" Name="${esc(element.xmlName)}" Type="${xmlType}"`;
      if (element.unit) { attrs += ` Unit="${esc(element.unit)}"`; }
      if (element.value) { attrs += ` Value="${esc(element.value)}"`; }
      if (element.routing) { attrs += ` Routing="${esc(element.routing)}"`; }
      return { tag: `  <Signal ${attrs}/>`, container: 'Signals' };
    }
    case 'Parameter': {
      let attrs = `Description="${esc(element.description)}" Name="${esc(element.xmlName)}"`;
      if (element.unit) { attrs += ` Unit="${esc(element.unit)}"`; }
      if (element.value) { attrs += ` Value="${esc(element.value)}"`; }
      if (element.min) { attrs += ` Min="${esc(element.min)}"`; }
      if (element.max) { attrs += ` Max="${esc(element.max)}"`; }
      return { tag: `  <Parameter ${attrs}/>`, container: 'Parameters' };
    }
    case 'Alarm': {
      let attrs = `Name="${esc(element.xmlName)}"`;
      if (element.level) { attrs += ` Level="${esc(element.level)}"`; }
      if (element.text) { attrs += ` Text="${esc(element.text)}"`; }
      if (element.description) { attrs += ` Description="${esc(element.description)}"`; }
      return { tag: `  <Alarm ${attrs}/>`, container: 'Alarms' };
    }
    case 'Property': {
      const xmlType = element.type ? cdpTypeToXmlType(element.type) : 'double';
      let attrs = `Name="${esc(element.xmlName)}" Type="${xmlType}"`;
      if (element.description) { attrs += ` Description="${esc(element.description)}"`; }
      if (element.value) { attrs += ` Value="${esc(element.value)}"`; }
      return { tag: `  <CDPProperty ${attrs}/>`, container: 'Properties' };
    }
    case 'Connector': {
      let attrs = `Name="${esc(element.xmlName)}"`;
      if (element.description) { attrs += ` Description="${esc(element.description)}"`; }
      attrs += ` Object=""`;
      return { tag: `  <Connector ${attrs}/>`, container: 'Connectors' };
    }
    case 'State':
      return {
        tag: `  <State Name="${esc(element.xmlName)}"${element.description ? ` Description="${esc(element.description)}"` : ''}/>`,
        container: 'States',
      };
    case 'StateTransition':
      return {
        tag: `  <StateTransition Description="${esc(element.description)}" FromState="${esc(element.fromState)}" Name="${esc(element.xmlName)}" ToState="${esc(element.toState)}"/>`,
        container: 'StateTransitions',
      };
    case 'Message':
      return {
        tag: `  <Message Description="${esc(element.description)}" Name="${esc(element.xmlName)}"/>`,
        container: 'Messages',
      };
    case 'Port': {
      let attrs = `Name="${esc(element.xmlName)}"`;
      if (element.input !== undefined) { attrs += ` Input="${element.input ? '1' : '0'}"`; }
      return { tag: `  <Port ${attrs}/>`, container: 'Ports' };
    }
  }
}

/**
 * Add an element to the XML template file.
 */
export async function addXmlElement(xmlPath: string, element: ElementInfo): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(xmlPath);
  const text = doc.getText();
  const { tag, container } = generateXmlSnippet(element);

  const edit = new vscode.WorkspaceEdit();
  const uri = doc.uri;

  // Find existing container or create one
  const containerOpenRegex = new RegExp(`<${container}>`);
  const containerCloseRegex = new RegExp(`</${container}>`);

  const openMatch = containerOpenRegex.exec(text);
  if (openMatch) {
    // Insert before closing tag
    const closeMatch = containerCloseRegex.exec(text);
    if (closeMatch) {
      const pos = doc.positionAt(closeMatch.index);
      edit.insert(uri, pos, tag + '\n');
    }
  } else {
    // Create container before </Model>
    const modelClose = text.lastIndexOf('</Model>');
    if (modelClose >= 0) {
      const pos = doc.positionAt(modelClose);
      edit.insert(uri, pos, ` <${container}>\n${tag}\n </${container}>\n`);
    }
  }

  await vscode.workspace.applyEdit(edit);
  await doc.save();
}

/**
 * Remove an element from the XML template file.
 */
export async function removeXmlElement(xmlPath: string, element: ElementInfo): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(xmlPath);
  const text = doc.getText();
  const lines = text.split('\n');

  const edit = new vscode.WorkspaceEdit();
  const uri = doc.uri;

  const xmlName = element.xmlName;

  // Find lines containing this element by Name attribute
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (matchesXmlElement(line, element)) {
      edit.delete(uri, new vscode.Range(i, 0, i + 1, 0));
    }
  }

  await vscode.workspace.applyEdit(edit);
  await doc.save();
}

/**
 * Change an element in the XML template file (remove old, add new).
 */
export async function changeXmlElement(xmlPath: string, oldElement: ElementInfo, newElement: ElementInfo): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(xmlPath);
  const text = doc.getText();
  const lines = text.split('\n');

  const edit = new vscode.WorkspaceEdit();
  const uri = doc.uri;
  const { tag } = generateXmlSnippet(newElement);

  for (let i = 0; i < lines.length; i++) {
    if (matchesXmlElement(lines[i], oldElement)) {
      edit.replace(uri, new vscode.Range(i, 0, i, lines[i].length), tag);
      break;
    }
  }

  await vscode.workspace.applyEdit(edit);
  await doc.save();
}

function matchesXmlElement(line: string, element: ElementInfo): boolean {
  const xmlName = element.xmlName;
  switch (element.kind) {
    case 'Signal': return /<Signal\b/.test(line) && line.includes(`Name="${xmlName}"`);
    case 'Parameter': return /<Parameter\b/.test(line) && line.includes(`Name="${xmlName}"`);
    case 'Alarm': return /<Alarm\b/.test(line) && line.includes(`Name="${xmlName}"`);
    case 'Property': return /<CDPProperty\b/.test(line) && line.includes(`Name="${xmlName}"`);
    case 'Connector': return /<Connector\b/.test(line) && line.includes(`Name="${xmlName}"`);
    case 'State': return /<State\b/.test(line) && !/<StateTransition/.test(line) && line.includes(`Name="${xmlName}"`);
    case 'StateTransition': return /<StateTransition\b/.test(line) && line.includes(`Name="${xmlName}"`);
    case 'Message': return /<Message\b/.test(line) && line.includes(`Name="${xmlName}"`);
    case 'Port': return /<Port\b/.test(line) && line.includes(`Name="${xmlName}"`);
  }
  return false;
}

function esc(s: string | undefined): string {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseXmlAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = regex.exec(attrString))) {
    attrs[m[1]] = m[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  }
  return attrs;
}

function mapXmlTypeToCdp(xmlType: string | undefined): any {
  if (!xmlType) { return 'double'; }
  if (xmlType === 'string') { return 'std::string'; }
  return xmlType;
}
