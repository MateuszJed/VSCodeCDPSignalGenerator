import * as fs from 'fs';
import * as path from 'path';
import { ElementInfo, cdpTypeToXmlType, cdpTypeToSignalModel } from './types';

/**
 * Generate XML snippet for an element.
 * Returns the tag string and its container element name.
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
      return { tag: `    <Signal ${attrs}/>`, container: 'Signals' };
    }
    case 'Parameter': {
      let attrs = `Description="${esc(element.description)}" Name="${esc(element.xmlName)}"`;
      if (element.unit) { attrs += ` Unit="${esc(element.unit)}"`; }
      if (element.value) { attrs += ` Value="${esc(element.value)}"`; }
      if (element.min) { attrs += ` Min="${esc(element.min)}"`; }
      if (element.max) { attrs += ` Max="${esc(element.max)}"`; }
      return { tag: `    <Parameter ${attrs}/>`, container: 'Parameters' };
    }
    case 'Alarm': {
      let attrs = `Name="${esc(element.xmlName)}"`;
      if (element.level) { attrs += ` Level="${esc(element.level)}"`; }
      if (element.text) { attrs += ` Text="${esc(element.text)}"`; }
      if (element.description) { attrs += ` Description="${esc(element.description)}"`; }
      return { tag: `    <Alarm ${attrs}/>`, container: 'Alarms' };
    }
    case 'Property': {
      const xmlType = element.type ? cdpTypeToXmlType(element.type) : 'double';
      let attrs = `Name="${esc(element.xmlName)}" Type="${xmlType}"`;
      if (element.description) { attrs += ` Description="${esc(element.description)}"`; }
      if (element.value) { attrs += ` Value="${esc(element.value)}"`; }
      return { tag: `    <CDPProperty ${attrs}/>`, container: 'Properties' };
    }
    case 'Connector': {
      const attrs = `Name="${esc(element.xmlName)}" Description="${esc(element.description)}" Object=""`;
      return { tag: `    <Connector ${attrs}/>`, container: 'Connectors' };
    }
    case 'State':
      return {
        tag: `    <State Name="${esc(element.xmlName)}"${element.description ? ` Description="${esc(element.description)}"` : ''}/>`,
        container: 'States',
      };
    case 'StateTransition':
      return {
        tag: `    <StateTransition Description="${esc(element.description)}" FromState="${esc(element.fromState)}" Name="${esc(element.xmlName)}" ToState="${esc(element.toState)}"/>`,
        container: 'StateTransitions',
      };
    case 'Message':
      return {
        tag: `    <Message Description="${esc(element.description)}" Name="${esc(element.xmlName)}"/>`,
        container: 'Messages',
      };
    case 'Port': {
      let attrs = `Name="${esc(element.xmlName)}"`;
      if (element.input !== undefined) { attrs += ` Input="${element.input ? '1' : '0'}"`; }
      return { tag: `    <Port ${attrs}/>`, container: 'Ports' };
    }
    default:
      throw new Error(`Unknown element kind: ${(element as any).kind}`);
  }
}

/**
 * Add an element tag to the XML template file.
 * Inserts into the existing container, or creates the container before </Model>.
 */
export function addXmlElement(xmlPath: string, element: ElementInfo): void {
  const text = fs.readFileSync(xmlPath, 'utf8');
  const lines = text.split('\n');
  const { tag, container } = generateXmlSnippet(element);

  const closeTag = `</${container}>`;
  const closeIdx = lines.findIndex(l => l.includes(closeTag));

  if (closeIdx >= 0) {
    lines.splice(closeIdx, 0, tag);
  } else {
    // Container does not exist — create it before </Model>
    const modelCloseIdx = lines.reduce((last, l, i) => l.includes('</Model>') ? i : last, -1);
    if (modelCloseIdx < 0) { throw new Error(`Could not find </Model> tag in: ${xmlPath}`); }
    lines.splice(modelCloseIdx, 0, ` <${container}>`, tag, ` </${container}>`);
  }

  fs.writeFileSync(xmlPath, lines.join('\n'), 'utf8');
}

/**
 * Remove an element tag from the XML template file.
 */
export function removeXmlElement(xmlPath: string, element: ElementInfo): void {
  const text = fs.readFileSync(xmlPath, 'utf8');
  const lines = text.split('\n');
  const filtered = lines.filter(l => !matchesXmlElement(l, element));
  fs.writeFileSync(xmlPath, filtered.join('\n'), 'utf8');
}

/**
 * Replace an element tag in the XML template file.
 * Only updates the Name attribute (and Type/Model if a new type is explicitly provided).
 * All other attributes (Description, Input, Unit, Value, etc.) are preserved from
 * the existing line to avoid data loss on a simple rename.
 */
export function changeXmlElement(xmlPath: string, oldElement: ElementInfo, newElement: ElementInfo): void {
  const text = fs.readFileSync(xmlPath, 'utf8');
  const lines = text.split('\n');

  const idx = lines.findIndex(l => matchesXmlElement(l, oldElement));
  if (idx >= 0) {
    let line = lines[idx];

    // Rename: replace the Name attribute in-place
    line = line.replace(/Name="[^"]*"/, `Name="${esc(newElement.xmlName)}"`);

    // If a new type was explicitly provided, also update Type and Model attributes
    if (newElement.type !== undefined) {
      const newXmlType = cdpTypeToXmlType(newElement.type);
      line = line.replace(/Type="[^"]*"/, `Type="${newXmlType}"`);
      if (newElement.kind === 'Signal') {
        const newModel = cdpTypeToSignalModel(newElement.type);
        line = line.replace(/Model="[^"]*"/, `Model="${newModel}"`);
      }
    }

    lines[idx] = line;
  }

  fs.writeFileSync(xmlPath, lines.join('\n'), 'utf8');
}

/**
 * Read and parse XML template file to extract existing elements.
 */
export function parseXmlElements(xmlContent: string): ElementInfo[] {
  const elements: ElementInfo[] = [];

  const signalRegex = /<Signal\s+([^/>]*)\/?>/g;
  let m;
  while ((m = signalRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'Signal', codeName: '', xmlName: attrs['Name'] || '',
      type: mapXmlTypeToCdp(attrs['Type']),
      description: attrs['Description'], unit: attrs['Unit'],
      value: attrs['Value'], input: attrs['Input'] === '1', routing: attrs['Routing'],
    });
  }

  const paramRegex = /<Parameter\s+([^/>]*)\/?>/g;
  while ((m = paramRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'Parameter', codeName: '', xmlName: attrs['Name'] || '',
      description: attrs['Description'], unit: attrs['Unit'],
      value: attrs['Value'], min: attrs['Min'], max: attrs['Max'],
    });
  }

  const alarmRegex = /<Alarm\s+([^/>]*)\/?>/g;
  while ((m = alarmRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'Alarm', codeName: '', xmlName: attrs['Name'] || '',
      description: attrs['Description'], level: attrs['Level'], text: attrs['Text'],
    });
  }

  const stateRegex = /<State\s+([^/>]*)\/?>/g;
  while ((m = stateRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({ kind: 'State', codeName: '', xmlName: attrs['Name'] || '', description: attrs['Description'] });
  }

  const transRegex = /<StateTransition\s+([^/>]*)\/?>/g;
  while ((m = transRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({
      kind: 'StateTransition', codeName: '', xmlName: attrs['Name'] || '',
      fromState: attrs['FromState'], toState: attrs['ToState'], description: attrs['Description'],
    });
  }

  const msgRegex = /<Message\s+([^/>]*)\/?>/g;
  while ((m = msgRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({ kind: 'Message', codeName: '', xmlName: attrs['Name'] || '', description: attrs['Description'] });
  }

  const connRegex = /<Connector\s+([^/>]*)\/?>/g;
  while ((m = connRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({ kind: 'Connector', codeName: '', xmlName: attrs['Name'] || '', description: attrs['Description'] });
  }

  const portRegex = /<Port\s+([^/>]*?)(?:\/>|>)/g;
  while ((m = portRegex.exec(xmlContent))) {
    const attrs = parseXmlAttrs(m[1]);
    elements.push({ kind: 'Port', codeName: '', xmlName: attrs['Name'] || '', input: attrs['Input'] === '1' });
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesXmlElement(line: string, element: ElementInfo): boolean {
  const nameAttr = `Name="${element.xmlName}"`;
  if (!line.includes(nameAttr)) { return false; }
  switch (element.kind) {
    case 'Signal': return /<Signal\b/.test(line);
    case 'Parameter': return /<Parameter\b/.test(line);
    case 'Alarm': return /<Alarm\b/.test(line);
    case 'Property': return /<CDPProperty\b/.test(line);
    case 'Connector': return /<Connector\b/.test(line);
    case 'State': return /<State\b/.test(line) && !/<StateTransition/.test(line);
    case 'StateTransition': return /<StateTransition\b/.test(line);
    case 'Message': return /<Message\b/.test(line);
    case 'Port': return /<Port\b/.test(line);
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
