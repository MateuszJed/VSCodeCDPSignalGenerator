/**
 * reportGenerator.ts (core)
 *
 * Builds the plain-text verification report from analysis results.
 * No vscode dependency.
 */

import * as path from "path";
import { CdpProjectIndex } from "./types";
import { RoutingAnalysis } from "./routingStats";

export interface VsixCheckResult {
  found: boolean;
  vsixName?: string;
  error?: string;
  checks?: Array<{ name: string; pass: boolean }>;
}

export interface ReportInput {
  workspacePath: string;
  extensionVersion: string;
  gitInfo: string;
  buildSuccess: boolean;
  index: CdpProjectIndex;
  analysis: RoutingAnalysis;
  vsixInfo: VsixCheckResult;
}

function hr(): string {
  return "=".repeat(80);
}

function h2(s: string): string {
  return `\n${s}\n${"-".repeat(s.length)}`;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w);
}

export function buildReport(input: ReportInput): string {
  const {
    workspacePath,
    extensionVersion,
    gitInfo,
    buildSuccess,
    index,
    analysis,
    vsixInfo,
  } = input;

  const s = index.stats;
  const { errors, unresolved, modelInherited, resolved } = analysis;

  const lines: string[] = [];
  const L = (line: string = "") => lines.push(line);

  L(hr());
  L(" CDP ROUTING VERIFICATION REPORT");
  L(hr());
  L("");
  L(`1.  Timestamp              : ${new Date().toISOString()}`);
  L(`2.  Workspace path         : ${workspacePath}`);
  L(`3.  Extension version      : ${extensionVersion}`);
  L(`4.  Git (workspace)        : ${gitInfo}`);

  L(h2("5. XML FILES"));
  L(`   Total XML files found   : ${pad(s.xmlFilesTotal, 6)}`);
  L(`   XML files indexed       : ${pad(s.xmlFilesIndexed, 6)}`);
  L(`   Application.xml roots   : ${pad(s.applicationsIndexed, 6)}`);

  L(h2("6. APPLICATION.XML ROOTS"));
  for (const app of [...index.applications].sort()) {
    L(`   - ${app}`);
  }

  L(h2("7. APPLICATIONS INDEXED"));
  for (const app of [...index.applications].sort()) {
    L(`   ${app}`);
  }

  L(h2("8. INDEX STATISTICS"));
  L(`   Named CDP elements      : ${pad(s.namedElementsIndexed, 6)}`);
  L(`   Routing attributes      : ${pad(s.routingAttributesFound, 6)}`);

  L(h2("9. ROUTING ATTRIBUTES BY TYPE"));
  // Tally attribute names from all occurrences
  const byAttr = new Map<string, number>();
  for (const occs of index.routingOccurrencesByFile.values()) {
    for (const occ of occs) {
      byAttr.set(occ.attributeName, (byAttr.get(occ.attributeName) ?? 0) + 1);
    }
  }
  for (const [name, count] of [...byAttr.entries()].sort((a, b) => b[1] - a[1])) {
    L(`   ${(name + ":").padEnd(34)} ${pad(count, 5)}`);
  }

  L(h2("10. RESOLUTION STATISTICS"));
  L(`   Resolved                : ${pad(s.resolvedRoutings, 6)}  (exact match in project XML)`);
  L(`   Model/library-inherited : ${pad(s.modelInheritedRoutings, 6)}  (target provided by CDP model/library at runtime)`);
  L(`   External                : ${pad(s.externalRoutings, 6)}  (first segment = application not in this workspace)`);
  L(`   Unresolved (genuine)    : ${pad(s.unresolvedRoutings, 6)}  (path broken — likely typo or missing component)`);
  L(`   Invalid                 : ${pad(s.invalidRoutings, 6)}  (relative routing climbs above application root)`);
  L(`   Empty (skipped)         : ${pad(s.emptyRoutings, 6)}`);

  L(h2("11. DIAGNOSTIC STATISTICS"));
  L("   (settings: strict=false, treatExternalAsError=false, treatModelInheritedAsError=false)");
  L(`   Errors (red)            : ${pad(errors.length, 6)}  (invalid routings with confirmed context)`);
  L(`   Warnings                :      0  (unresolved suppressed by default)`);
  L(`   Information             : ${pad(s.externalRoutings + s.modelInheritedRoutings, 6)}`);

  L(h2("12. INVALID ROUTINGS"));
  if (errors.length === 0) {
    L("   None.");
  } else {
    for (const e of errors) {
      const rel = path.relative(workspacePath, e.filePath);
      L(`   [INVALID] "${e.routing}"`);
      L(`             context:   ${e.contextPath || "(root)"}`);
      L(`             candidate: ${e.candidatePath ?? ""}`);
      L(`             file:      ${rel}`);
      L(`             reason:    ${e.reason}`);
      L("");
    }
  }

  L(h2("13. GENUINE UNRESOLVED ROUTINGS (first 100)"));
  L("   Note: these have a broken path segment — likely typo or missing component.");
  L("   Model/library-inherited routings are NOT shown here (see section 14).");
  L("");
  if (unresolved.length === 0) {
    L("   None.");
  } else {
    for (const u of unresolved.slice(0, 100)) {
      const rel = path.relative(workspacePath, u.filePath);
      L(`   [UNRESOLVED] "${u.routing}"`);
      L(`               candidate: ${u.candidatePath}`);
      L(`               context:   ${u.contextPath || "(root)"}`);
      L(`               reason:    ${u.reason}`);
      L(`               file:      ${rel}`);
      L("");
    }
    if (unresolved.length > 100) {
      L(`   ... and ${unresolved.length - 100} more (total ${unresolved.length})`);
    }
  }

  L(h2("14. MODEL/LIBRARY-INHERITED ROUTINGS (first 100)"));
  L("   These targets are not declared in project XML but are plausible CDP model");
  L("   or library members (PascalCase segment after a known parent).");
  L("   No diagnostic error is raised for these by default.");
  L("");
  if (modelInherited.length === 0) {
    L("   None.");
  } else {
    for (const m of modelInherited.slice(0, 100)) {
      L(`   [MODEL] "${m.routing}"`);
      L(`           candidate:     ${m.candidatePath}`);
      L(`           nearest parent: ${m.nearestParent}`);
    }
    if (s.modelInheritedRoutings > modelInherited.length) {
      L(`\n   ... and ${s.modelInheritedRoutings - modelInherited.length} more model-inherited (total ${s.modelInheritedRoutings})`);
    }
  }

  L(h2("15. SAMPLE RESOLVED ROUTINGS (first 50)"));
  if (resolved.length === 0) {
    L("   None.");
  } else {
    for (const r of resolved) {
      L(`   ${r.routing}`);
      L(`     -> ${r.resolvedPath}`);
    }
    if (s.resolvedRoutings > resolved.length) {
      L(`\n   ... and ${s.resolvedRoutings - resolved.length} more resolved`);
    }
  }

  L(h2("16. VSIX BUNDLE CHECKS"));
  if (!vsixInfo.found) {
    L("   No .vsix file found in extension directory.");
  } else {
    L(`   VSIX: ${vsixInfo.vsixName}`);
    if (vsixInfo.error) {
      L(`   Error reading VSIX: ${vsixInfo.error}`);
    } else {
      for (const c of vsixInfo.checks ?? []) {
        L(`   [${c.pass ? "PASS" : "FAIL"}] ${c.name}`);
      }
    }
  }

  const vsixPass =
    vsixInfo.found &&
    !vsixInfo.error &&
    (vsixInfo.checks ?? []).every((c) => c.pass);
  const routingPass = errors.length === 0;
  const overallPass = buildSuccess && routingPass && vsixPass;

  L(h2("17. FINAL SUMMARY"));
  L(`   Build success                    : ${buildSuccess ? "PASS" : "FAIL"}`);
  L(`   Routing validation (red errors)  : ${routingPass ? "PASS" : "FAIL"}  (${errors.length} error(s))`);
  L(`   VSIX bundle checks               : ${vsixPass ? "PASS" : "FAIL"}`);
  L("");
  L(`   OVERALL: ${overallPass ? "*** PASS ***" : "*** FAIL ***"}`);
  L("");
  L(hr());

  return lines.join("\n") + "\n";
}
