/**
 * routingResolver.ts (core)
 *
 * Resolves *Routing attribute values against the project index.
 * Pure logic — no vscode dependency.
 */

import { CdpProjectIndex, CdpIndexEntry, RoutingResolution } from "./types";

/**
 * Determine whether a segment is a plausible CDP model/library member name.
 *
 * Rules:
 *   1. Must start with an uppercase letter — this matches the PascalCase convention
 *      used for ALL valid CDP element names and model-provided members.
 *      Single-character or lowercase segments (e.g. "w", "x") indicate typos.
 *   2. Must not be a single character alone (e.g. "A", "B" are unlikely model members).
 *
 * This is intentionally permissive for uppercase names because CDP model/library
 * definitions provide many runtime members not declared in project XML.
 * Bogus inserted segments like "w" are definitively rejected by the lowercase check.
 */
function isPlausibleModelMember(segment: string): boolean {
  if (!segment || segment.length < 2) {
    return false;
  }
  return /^[A-Z]/.test(segment);
}

/**
 * Compute the candidate CDP path from a routing value and its context.
 *
 * Leading dots = relative routing:
 *   1 dot  = current context
 *   2 dots = climb 1 level
 *   N dots = climb N-1 levels
 *
 * No leading dots = absolute routing.
 * Returns null if routing climbs above root.
 */
export function computeCandidatePath(
  routing: string,
  contextPath: string
): string | null {
  if (!routing.startsWith(".")) {
    return routing;
  }

  let dotCount = 0;
  while (dotCount < routing.length && routing[dotCount] === ".") {
    dotCount++;
  }

  const remainder = routing.substring(dotCount);
  const contextParts = contextPath ? contextPath.split(".") : [];
  const levelsToClimb = dotCount - 1;

  if (levelsToClimb > contextParts.length) {
    return null;
  }

  const baseParts = contextParts.slice(0, contextParts.length - levelsToClimb);

  if (!remainder) {
    return baseParts.join(".");
  }
  if (baseParts.length === 0) {
    return remainder;
  }
  return baseParts.join(".") + "." + remainder;
}

function findNearestKnownPrefix(
  candidatePath: string,
  knownPrefixes: Set<string>
): string | undefined {
  const parts = candidatePath.split(".");
  for (let len = parts.length - 1; len >= 1; len--) {
    const prefix = parts.slice(0, len).join(".");
    if (knownPrefixes.has(prefix)) {
      return prefix;
    }
  }
  return undefined;
}

function findAnyEntryWithPrefix(
  prefix: string,
  index: CdpProjectIndex
): CdpIndexEntry | undefined {
  for (const [fullPath, entries] of index.entriesByFullPath) {
    if (
      (fullPath === prefix || fullPath.startsWith(prefix + ".")) &&
      entries.length > 0
    ) {
      return entries[0];
    }
  }
  return undefined;
}

/**
 * Resolve a routing attribute value (or semicolon-separated list) against the index.
 * Public entry point — handles multi-routing automatically.
 */
export function resolveRouting(
  routing: string,
  contextPath: string,
  index: CdpProjectIndex,
  confidenceKnown: boolean = true
): RoutingResolution {
  const trimmed = routing.trim();
  if (!trimmed) {
    return { status: "empty", routing, contextPath };
  }

  // Semicolon-separated multi-routing: resolve each part, return worst case.
  if (trimmed.includes(";")) {
    return resolveMultiRouting(trimmed, contextPath, index, confidenceKnown);
  }

  return resolveRoutingSingle(trimmed, contextPath, index, confidenceKnown);
}

/** Status severity — higher = worse. */
const STATUS_PRIORITY: Record<string, number> = {
  invalid: 5, unresolved: 4, "model-inherited": 3, external: 2, empty: 1, resolved: 0,
};

function resolveMultiRouting(
  routing: string,
  contextPath: string,
  index: CdpProjectIndex,
  confidenceKnown: boolean
): RoutingResolution {
  const parts = routing.split(";").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { status: "empty", routing, contextPath };
  }

  const resolutions = parts.map((p) =>
    resolveRoutingSingle(p, contextPath, index, confidenceKnown)
  );

  // Find the worst-case resolution
  resolutions.sort(
    (a, b) => (STATUS_PRIORITY[b.status] ?? 0) - (STATUS_PRIORITY[a.status] ?? 0)
  );
  const worst = resolutions[0];
  const partSummary = resolutions
    .map((r, i) => `part ${i + 1}: ${r.status}`)
    .join(", ");
  const multiNote = `Multi-routing (${parts.length} parts — ${partSummary}). `;

  // Return the worst-case resolution, replacing its routing with the full original
  // string and prepending the multi-note to the reason.
  switch (worst.status) {
    case "empty":
      return { status: "empty", routing, contextPath };
    case "resolved":
      return { status: "resolved", routing, contextPath,
        resolvedPath: worst.resolvedPath, target: worst.target };
    case "external":
      return { status: "external", routing, contextPath,
        candidatePath: worst.candidatePath,
        externalApplication: worst.externalApplication,
        reason: multiNote + worst.reason };
    case "model-inherited":
      return { status: "model-inherited", routing, contextPath,
        candidatePath: worst.candidatePath,
        nearestKnownParent: worst.nearestKnownParent,
        reason: multiNote + worst.reason };
    case "unresolved":
      return { status: "unresolved", routing, contextPath,
        candidatePath: worst.candidatePath,
        nearestKnownPrefix: worst.nearestKnownPrefix,
        reason: multiNote + worst.reason };
    case "invalid":
      return { status: "invalid", routing, contextPath,
        candidatePath: worst.candidatePath,
        reason: multiNote + worst.reason };
  }
}

/** Core single-value resolver (no semicolons). */
function resolveRoutingSingle(
  routing: string,
  contextPath: string,
  index: CdpProjectIndex,
  confidenceKnown: boolean
): RoutingResolution {
  const candidatePath = computeCandidatePath(routing, contextPath);

  if (candidatePath === null) {
    if (confidenceKnown && contextPath) {
      return {
        status: "invalid",
        routing,
        contextPath,
        reason: "Relative routing climbs above the application root.",
      };
    }
    return {
      status: "unresolved",
      routing,
      contextPath,
      candidatePath: "(invalid relative path)",
      reason: "Relative routing may climb above root; context path uncertain.",
    };
  }

  // Exact match
  const exact = index.entriesByFullPath.get(candidatePath);
  if (exact && exact.length > 0) {
    return {
      status: "resolved",
      routing,
      contextPath,
      resolvedPath: candidatePath,
      target: exact[0],
    };
  }

  // External: absolute routing with first segment not in known applications
  if (!routing.startsWith(".")) {
    const firstSegment = candidatePath.split(".")[0];
    if (firstSegment && !index.applications.has(firstSegment)) {
      return {
        status: "external",
        routing,
        contextPath,
        candidatePath,
        externalApplication: firstSegment,
        reason: `Application "${firstSegment}" is not present in this workspace.`,
      };
    }
  }

  // Model-inherited: nearest known prefix exists AND the first unresolved segment
  // is a plausible CDP element/model-member name (starts with uppercase, length >= 2).
  // Lowercase segments like "w" or single chars are rejected → unresolved.
  const nearestPrefix = findNearestKnownPrefix(candidatePath, index.knownPrefixes);
  if (nearestPrefix) {
    const remainder = candidatePath.slice(nearestPrefix.length + 1); // skip joining "."
    const firstUnresolvedSegment = remainder.split(".")[0];
    if (isPlausibleModelMember(firstUnresolvedSegment)) {
      const parentEntries = index.entriesByFullPath.get(nearestPrefix);
      const parent =
        (parentEntries && parentEntries.length > 0 ? parentEntries[0] : undefined) ??
        findAnyEntryWithPrefix(nearestPrefix, index);
      if (parent) {
        return {
          status: "model-inherited",
          routing,
          contextPath,
          candidatePath,
          nearestKnownParent: parent,
          reason:
            "Target is not declared in project XML. " +
            "The nearest known parent exists; the target may be provided by CDP model/library/runtime definitions.",
        };
      }
    }
  }

  // Unresolved: path is within a known application but target not found
  const firstSeg = candidatePath.split(".")[0];
  const unresolvedReason = nearestPrefix
    ? (() => {
        const remainder = candidatePath.slice(nearestPrefix.length + 1);
        const bogus = remainder.split(".")[0];
        return `Segment "${bogus}" after known parent "${nearestPrefix}" is not a known CDP element or plausible model member (must start with uppercase).`;
      })()
    : "Target path not found in project index.";

  if (firstSeg && index.applications.has(firstSeg)) {
    return {
      status: "unresolved",
      routing,
      contextPath,
      candidatePath,
      nearestKnownPrefix: nearestPrefix,
      reason: unresolvedReason,
    };
  }

  return {
    status: "unresolved",
    routing,
    contextPath,
    candidatePath,
    nearestKnownPrefix: nearestPrefix,
    reason: "Target path not found in project index.",
  };
}
