/**
 * xmlScanner.ts — Pure XML parser with no vscode dependency.
 * Preserves source position information via TextRange.
 */

import { TextRange } from "./types";

export interface ParsedAttribute {
  name: string;
  value: string;
  nameRange: TextRange;
  valueRange: TextRange;
  fullRange: TextRange;
}

export interface ParsedElement {
  tagName: string;
  attributes: Map<string, ParsedAttribute>;
  selfClosing: boolean;
  startTagRange: TextRange;
  range: TextRange;
  children: ParsedElement[];
  parent?: ParsedElement;
}

export function buildLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

export function offsetToPosition(
  offset: number,
  lineOffsets: number[]
): { line: number; character: number } {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, character: offset - lineOffsets[lo] };
}

export function makeRange(
  startOffset: number,
  endOffset: number,
  lineOffsets: number[]
): TextRange {
  const start = offsetToPosition(startOffset, lineOffsets);
  const end = offsetToPosition(endOffset, lineOffsets);
  return {
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character,
  };
}

export function textRangeContainsPosition(
  range: TextRange,
  line: number,
  character: number
): boolean {
  if (line < range.startLine || line > range.endLine) {
    return false;
  }
  if (line === range.startLine && character < range.startCharacter) {
    return false;
  }
  if (line === range.endLine && character >= range.endCharacter) {
    return false;
  }
  return true;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Parse XML text into a tree of ParsedElement, preserving source ranges.
 */
export function parseXml(text: string): ParsedElement[] {
  const lineOffsets = buildLineOffsets(text);
  const stack: ParsedElement[] = [];
  const roots: ParsedElement[] = [];
  let i = 0;
  const len = text.length;

  function pos(offset: number) {
    return offsetToPosition(Math.min(offset, len), lineOffsets);
  }

  function range(start: number, end: number): TextRange {
    const s = pos(start);
    const e = pos(end);
    return {
      startLine: s.line,
      startCharacter: s.character,
      endLine: e.line,
      endCharacter: e.character,
    };
  }

  while (i < len) {
    if (text[i] !== "<") {
      i++;
      continue;
    }

    const tagStart = i;
    i++;

    if (i >= len) {
      break;
    }

    // XML comment
    if (text[i] === "!" && text.startsWith("--", i + 1)) {
      const end = text.indexOf("-->", i + 3);
      i = end < 0 ? len : end + 3;
      continue;
    }

    // CDATA
    if (text[i] === "!" && text.startsWith("[CDATA[", i + 1)) {
      const end = text.indexOf("]]>", i + 8);
      i = end < 0 ? len : end + 3;
      continue;
    }

    // DOCTYPE / declaration
    if (text[i] === "!") {
      const end = text.indexOf(">", i);
      i = end < 0 ? len : end + 1;
      continue;
    }

    // Processing instruction
    if (text[i] === "?") {
      const end = text.indexOf("?>", i);
      i = end < 0 ? len : end + 2;
      continue;
    }

    // Closing tag
    if (text[i] === "/") {
      i++;
      while (i < len && !isWhitespace(text[i]) && text[i] !== ">") {
        i++;
      }
      while (i < len && text[i] !== ">") {
        i++;
      }
      const closeEnd = i + 1;
      if (i < len) {
        i = closeEnd;
      }
      if (stack.length > 0) {
        const element = stack.pop()!;
        element.range = range(element.startTagRange.startLine === 0 && element.startTagRange.startCharacter === 0
          ? 0
          : lineOffsets[element.startTagRange.startLine] + element.startTagRange.startCharacter,
          closeEnd);
        if (stack.length === 0) {
          roots.push(element);
        }
      }
      continue;
    }

    // Opening tag — read name
    const nameStart = i;
    while (
      i < len &&
      !isWhitespace(text[i]) &&
      text[i] !== ">" &&
      text[i] !== "/"
    ) {
      i++;
    }
    const tagName = text.substring(nameStart, i);
    if (!tagName) {
      continue;
    }

    // Parse attributes
    const attributes = new Map<string, ParsedAttribute>();
    let selfClosing = false;

    attributeLoop: while (i < len) {
      while (i < len && isWhitespace(text[i])) {
        i++;
      }
      if (i >= len) {
        break;
      }
      if (text[i] === ">") {
        i++;
        break;
      }
      if (text[i] === "/" && i + 1 < len && text[i + 1] === ">") {
        selfClosing = true;
        i += 2;
        break;
      }

      const attrNameStart = i;
      while (
        i < len &&
        text[i] !== "=" &&
        !isWhitespace(text[i]) &&
        text[i] !== ">" &&
        text[i] !== "/"
      ) {
        i++;
      }
      const attrNameEnd = i;
      const attrName = text.substring(attrNameStart, attrNameEnd);

      if (!attrName) {
        if (i < len) {
          i++;
        }
        continue;
      }

      while (i < len && isWhitespace(text[i])) {
        i++;
      }

      if (i >= len || text[i] !== "=") {
        attributes.set(attrName, {
          name: attrName,
          value: "",
          nameRange: range(attrNameStart, attrNameEnd),
          valueRange: range(attrNameEnd, attrNameEnd),
          fullRange: range(attrNameStart, attrNameEnd),
        });
        continue;
      }

      i++; // skip '='
      while (i < len && isWhitespace(text[i])) {
        i++;
      }

      if (i >= len) {
        break attributeLoop;
      }

      const quote = text[i];
      if (quote === '"' || quote === "'") {
        i++;
        const valueStart = i;
        while (i < len && text[i] !== quote) {
          i++;
        }
        const valueEnd = i;
        if (i < len) {
          i++;
        }
        const value = decodeEntities(text.substring(valueStart, valueEnd));
        attributes.set(attrName, {
          name: attrName,
          value,
          nameRange: range(attrNameStart, attrNameEnd),
          valueRange: range(valueStart, valueEnd),
          fullRange: range(attrNameStart, i),
        });
      } else {
        const valueStart = i;
        while (
          i < len &&
          !isWhitespace(text[i]) &&
          text[i] !== ">" &&
          text[i] !== "/"
        ) {
          i++;
        }
        const valueEnd = i;
        const value = text.substring(valueStart, valueEnd);
        attributes.set(attrName, {
          name: attrName,
          value,
          nameRange: range(attrNameStart, attrNameEnd),
          valueRange: range(valueStart, valueEnd),
          fullRange: range(attrNameStart, valueEnd),
        });
      }
    }

    const startTagRange = range(tagStart, i);
    const element: ParsedElement = {
      tagName,
      attributes,
      selfClosing,
      startTagRange,
      range: startTagRange,
      children: [],
    };

    if (selfClosing) {
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        element.parent = parent;
        parent.children.push(element);
      } else {
        roots.push(element);
      }
    } else {
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        element.parent = parent;
        parent.children.push(element);
      }
      stack.push(element);
    }
  }

  // Handle unclosed tags
  while (stack.length > 0) {
    const element = stack.pop()!;
    element.range = element.startTagRange;
    if (stack.length === 0) {
      roots.push(element);
    }
  }

  return roots;
}
