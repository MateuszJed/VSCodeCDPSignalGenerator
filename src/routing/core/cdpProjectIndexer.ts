/**
 * cdpProjectIndexer.ts (core)
 *
 * Builds the full CDP project index from Application.xml roots.
 * No vscode dependency — uses Node fs for file I/O.
 */

import * as fs from "fs";
import * as path from "path";
import { parseXml, ParsedElement } from "./xmlScanner";
import { isGroupingTag } from "./routingAttributeParser";
import {
  CdpProjectIndex,
  CdpIndexEntry,
  CdpXmlElement,
  CdpXmlAttribute,
  RoutingAttributeOccurrence,
  TextRange,
} from "./types";

export interface Logger {
  appendLine(message: string): void;
}

const SILENT_LOGGER: Logger = { appendLine: () => undefined };

// Directories excluded from XML file search
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "out", "build", "dist", ".vscode",
]);

function emptyIndex(): CdpProjectIndex {
  return {
    applications: new Set(),
    entriesByFullPath: new Map(),
    entriesByFile: new Map(),
    fileContextPaths: new Map(),
    knownPrefixes: new Set(),
    routingOccurrencesByFile: new Map(),
    stats: {
      xmlFilesTotal: 0,
      xmlFilesIndexed: 0,
      applicationsIndexed: 0,
      namedElementsIndexed: 0,
      routingAttributesFound: 0,
      emptyRoutings: 0,
      resolvedRoutings: 0,
      externalRoutings: 0,
      modelInheritedRoutings: 0,
      unresolvedRoutings: 0,
      invalidRoutings: 0,
    },
    buildTimeMs: 0,
  };
}

function normalizeSrcPath(src: string): string {
  return src.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readFileText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Recursive XML file walk, respecting EXCLUDE_DIRS. */
export function walkXmlFiles(dir: string, result: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name) && !e.name.startsWith(".")) {
        walkXmlFiles(path.join(dir, e.name), result);
      }
    } else if (e.isFile() && e.name.endsWith(".xml")) {
      result.push(path.join(dir, e.name));
    }
  }
  return result;
}

function makeCdpXmlElement(
  parsed: ParsedElement,
  filePath: string,
  parent?: CdpXmlElement
): CdpXmlElement {
  const attrs = new Map<string, CdpXmlAttribute>();
  for (const [k, v] of parsed.attributes) {
    attrs.set(k, v as CdpXmlAttribute);
  }
  return {
    tagName: parsed.tagName,
    attributes: attrs,
    filePath,
    range: parsed.range,
    startTagRange: parsed.startTagRange,
    parent,
    children: [],
  };
}

function addEntry(index: CdpProjectIndex, entry: CdpIndexEntry): void {
  let list = index.entriesByFullPath.get(entry.fullPath);
  if (!list) {
    list = [];
    index.entriesByFullPath.set(entry.fullPath, list);
  }
  const dup = list.some(
    (e) =>
      e.filePath === entry.filePath &&
      e.range.startLine === entry.range.startLine &&
      e.range.startCharacter === entry.range.startCharacter
  );
  if (!dup) {
    list.push(entry);
  }

  let fileList = index.entriesByFile.get(entry.filePath);
  if (!fileList) {
    fileList = [];
    index.entriesByFile.set(entry.filePath, fileList);
  }
  fileList.push(entry);

  const parts = entry.fullPath.split(".");
  let prefix = "";
  for (let i = 0; i < parts.length; i++) {
    prefix = i === 0 ? parts[0] : `${prefix}.${parts[i]}`;
    index.knownPrefixes.add(prefix);
  }
  index.stats.namedElementsIndexed++;
}

function recordFileContext(
  index: CdpProjectIndex,
  filePath: string,
  cdpPath: string[]
): void {
  let paths = index.fileContextPaths.get(filePath);
  if (!paths) {
    paths = [];
    index.fileContextPaths.set(filePath, paths);
  }
  const p = cdpPath.join(".");
  if (!paths.includes(p)) {
    paths.push(p);
  }
}

function collectElementRouting(
  parsed: ParsedElement,
  filePath: string,
  contextPath: string,
  cdpEl: CdpXmlElement,
  index: CdpProjectIndex
): void {
  for (const [attrName, attr] of parsed.attributes) {
    if (!attrName.endsWith("Routing")) {
      continue;
    }
    const occ: RoutingAttributeOccurrence = {
      filePath,
      attributeName: attrName,
      routing: attr.value,
      valueRange: attr.valueRange,
      fullRange: attr.fullRange,
      owningElement: cdpEl,
      contextPath,
    };
    let list = index.routingOccurrencesByFile.get(filePath);
    if (!list) {
      list = [];
      index.routingOccurrencesByFile.set(filePath, list);
    }
    list.push(occ);
    index.stats.routingAttributesFound++;
    if (!attr.value.trim()) {
      index.stats.emptyRoutings++;
    }
  }
}

async function processElement(
  parsed: ParsedElement,
  filePath: string,
  appRootDir: string,
  cdpPath: string[],
  index: CdpProjectIndex,
  visitedFiles: Set<string>,
  parentCdpEl?: CdpXmlElement
): Promise<void> {
  const cdpEl = makeCdpXmlElement(parsed, filePath, parentCdpEl);

  const nameAttr = parsed.attributes.get("Name");
  const nameValue = nameAttr?.value ?? "";
  const isNamed = !!nameValue && !isGroupingTag(parsed.tagName);

  const contextPath = cdpPath.join(".");
  collectElementRouting(parsed, filePath, contextPath, cdpEl, index);

  const srcAttr = parsed.attributes.get("src");
  const srcValue = srcAttr?.value ?? "";

  if (isNamed) {
    const childCdpPath = [...cdpPath, nameValue];

    let didFollowSrc = false;
    if (srcValue) {
      const normalizedSrc = normalizeSrcPath(srcValue);
      const resolvedSrcPath = path.join(appRootDir, normalizedSrc);

      if (
        resolvedSrcPath !== filePath &&
        !visitedFiles.has(resolvedSrcPath) &&
        fs.existsSync(resolvedSrcPath)
      ) {
        visitedFiles.add(resolvedSrcPath);
        didFollowSrc = true;

        const srcText = readFileText(resolvedSrcPath);
        if (srcText !== null) {
          index.stats.xmlFilesIndexed++;
          // Store the PARENT path (cdpPath), not the child path.
          // processElement is called with cdpPath so the file's root element
          // contributes its own Name to the path during traversal.
          // liveDocumentScanner reads this value as its starting basePath,
          // so it must match what processElement receives.
          recordFileContext(index, resolvedSrcPath, cdpPath);

          const srcElements = parseXml(srcText);
          for (const srcEl of srcElements) {
            await processElement(
              srcEl,
              resolvedSrcPath,
              appRootDir,
              cdpPath,
              index,
              visitedFiles,
              undefined
            );
          }
        }
      }
    }

    if (!didFollowSrc) {
      const entry: CdpIndexEntry = {
        fullPath: childCdpPath.join("."),
        pathParts: childCdpPath,
        name: nameValue,
        tagName: parsed.tagName,
        model: parsed.attributes.get("Model")?.value,
        filePath,
        range: parsed.range,
        nameRange: nameAttr ? nameAttr.valueRange : undefined,
        element: cdpEl,
      };
      addEntry(index, entry);

      for (const child of parsed.children) {
        await processElement(
          child,
          filePath,
          appRootDir,
          childCdpPath,
          index,
          visitedFiles,
          cdpEl
        );
      }
    } else {
      for (const child of parsed.children) {
        await processElement(
          child,
          filePath,
          appRootDir,
          childCdpPath,
          index,
          visitedFiles,
          cdpEl
        );
      }
    }
  } else {
    for (const child of parsed.children) {
      await processElement(
        child,
        filePath,
        appRootDir,
        cdpPath,
        index,
        visitedFiles,
        cdpEl
      );
    }
  }
}

export class CdpProjectIndexer {
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? SILENT_LOGGER;
  }

  async buildIndex(workspaceRoots: string[]): Promise<CdpProjectIndex> {
    const start = Date.now();
    const index = emptyIndex();

    // Collect all XML files across all workspace roots
    const allXmlFiles: string[] = [];
    for (const root of workspaceRoots) {
      walkXmlFiles(root, allXmlFiles);
    }
    index.stats.xmlFilesTotal = allXmlFiles.length;

    // Find Application.xml files under */Application/Application.xml
    const appFiles = allXmlFiles.filter(
      (f) =>
        path.basename(f) === "Application.xml" &&
        path.basename(path.dirname(f)) === "Application"
    );

    this.logger.appendLine(
      `CDP Routing: Found ${appFiles.length} application root(s), ${allXmlFiles.length} total XML files`
    );

    for (const appFile of appFiles) {
      await this.indexApplication(appFile, index);
    }

    index.stats.applicationsIndexed = index.applications.size;
    index.buildTimeMs = Date.now() - start;

    this.logger.appendLine(
      `CDP Routing: Index complete in ${index.buildTimeMs}ms — ` +
        `${index.stats.applicationsIndexed} apps, ` +
        `${index.stats.xmlFilesIndexed} files, ` +
        `${index.stats.namedElementsIndexed} elements, ` +
        `${index.stats.routingAttributesFound} routing attrs ` +
        `(${index.stats.emptyRoutings} empty)`
    );

    return index;
  }

  private async indexApplication(
    appFilePath: string,
    index: CdpProjectIndex
  ): Promise<void> {
    const appRootDir = path.dirname(appFilePath);
    const text = readFileText(appFilePath);
    if (!text) {
      return;
    }

    const elements = parseXml(text);
    if (elements.length === 0) {
      return;
    }

    const root = elements[0];
    const appName = root.attributes.get("Name")?.value;
    if (!appName) {
      this.logger.appendLine(
        `CDP Routing: Skipping ${appFilePath} — no Name on root element`
      );
      return;
    }

    this.logger.appendLine(`CDP Routing: Indexing application "${appName}"`);
    index.applications.add(appName);

    index.stats.xmlFilesIndexed++;
    recordFileContext(index, appFilePath, []);

    const visitedFiles = new Set<string>([appFilePath]);

    await processElement(root, appFilePath, appRootDir, [], index, visitedFiles, undefined);
  }
}
