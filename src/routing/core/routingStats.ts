/**
 * routingStats.ts (core)
 *
 * Populates resolution counters on the index after buildIndex() completes.
 */

import { CdpProjectIndex } from "./types";
import { resolveRouting } from "./routingResolver";

export function computeRoutingStats(index: CdpProjectIndex): void {
  index.stats.resolvedRoutings = 0;
  index.stats.externalRoutings = 0;
  index.stats.modelInheritedRoutings = 0;
  index.stats.unresolvedRoutings = 0;
  index.stats.invalidRoutings = 0;

  for (const [filePath, occs] of index.routingOccurrencesByFile) {
    const contextKnown = index.fileContextPaths.has(filePath);
    for (const occ of occs) {
      if (!occ.routing.trim()) {
        continue;
      }
      const r = resolveRouting(occ.routing, occ.contextPath, index, contextKnown);
      switch (r.status) {
        case "resolved":        index.stats.resolvedRoutings++;        break;
        case "external":        index.stats.externalRoutings++;        break;
        case "model-inherited": index.stats.modelInheritedRoutings++;  break;
        case "unresolved":      index.stats.unresolvedRoutings++;      break;
        case "invalid":         index.stats.invalidRoutings++;         break;
        default: break;
      }
    }
  }
}

export interface RoutingAnalysis {
  errors:          Array<{ filePath: string; routing: string; contextPath: string; candidatePath?: string; reason: string }>;
  unresolved:      Array<{ filePath: string; attributeName: string; routing: string; contextPath: string; candidatePath: string; reason: string }>;
  modelInherited:  Array<{ filePath: string; attributeName: string; routing: string; contextPath: string; candidatePath: string; nearestParent: string }>;
  resolved:        Array<{ filePath: string; attributeName: string; routing: string; contextPath: string; resolvedPath: string }>;
}

/**
 * Full analysis walk — returns categorised lists for report generation.
 * Uses default diagnostic settings (strict=false, treatExternal=false, treatModelInherited=false).
 */
export function analyseRoutings(index: CdpProjectIndex): RoutingAnalysis {
  const result: RoutingAnalysis = { errors: [], unresolved: [], modelInherited: [], resolved: [] };

  for (const occs of index.routingOccurrencesByFile.values()) {
    for (const occ of occs) {
      if (!occ.routing.trim()) {
        continue;
      }
      const contextKnown = index.fileContextPaths.has(occ.filePath);
      const r = resolveRouting(occ.routing, occ.contextPath, index, contextKnown);

      switch (r.status) {
        case "resolved":
          if (result.resolved.length < 50) {
            result.resolved.push({
              filePath: occ.filePath,
              attributeName: occ.attributeName,
              routing: occ.routing,
              contextPath: occ.contextPath,
              resolvedPath: r.resolvedPath,
            });
          }
          break;
        case "model-inherited":
          if (result.modelInherited.length < 100) {
            result.modelInherited.push({
              filePath: occ.filePath,
              attributeName: occ.attributeName,
              routing: occ.routing,
              contextPath: occ.contextPath,
              candidatePath: r.candidatePath,
              nearestParent: r.nearestKnownParent.fullPath,
            });
          }
          break;
        case "invalid":
          if (contextKnown) {
            result.errors.push({
              filePath: occ.filePath,
              routing: occ.routing,
              contextPath: occ.contextPath,
              candidatePath: r.candidatePath,
              reason: r.reason,
            });
          }
          break;
        case "unresolved":
          result.unresolved.push({
            filePath: occ.filePath,
            attributeName: occ.attributeName,
            routing: occ.routing,
            contextPath: occ.contextPath,
            candidatePath: r.candidatePath,
            reason: r.reason,
          });
          break;
        default:
          break;
      }
    }
  }

  return result;
}
