#!/usr/bin/env bash
# install.sh — clean build, verify, package, create handoff folder.
# The CLI (verifyRouting.js) owns the handoff folder and writes the clean
# routing report. This script provides the real build log and summary.
set -euo pipefail

EXTENSION_DIR="$(cd "$(dirname "$0")" && pwd)"
GOLDEN_PROJECT="/home/andmid04/systems/3dCraneBacklash"
TEMP_BUILD_LOG="$(mktemp)"
trap 'rm -f "$TEMP_BUILD_LOG"' EXIT

log() { echo "$*" | tee -a "$TEMP_BUILD_LOG"; }

log "=== CDP Extension Build ==="

# ── 1. Clean stale output ─────────────────────────────────────────────────────
log "--- Cleaning out/ ---"
rm -rf "$EXTENSION_DIR/out"
rm -f  "$EXTENSION_DIR"/*.vsix
log "out/ and old .vsix files removed."

# ── 2. Compile extension ──────────────────────────────────────────────────────
log "--- Compile extension (tsc) ---"
npm run compile 2>&1 | tee -a "$TEMP_BUILD_LOG"

# ── 3. Compile CLI ────────────────────────────────────────────────────────────
log "--- Compile CLI ---"
(cd "$EXTENSION_DIR/cli" && npm run compile 2>&1) | tee -a "$TEMP_BUILD_LOG"

# ── 4. Package VSIX (written to EXTENSION_DIR so CLI can find it) ─────────────
log "--- Package VSIX ---"
npx @vscode/vsce package \
  --no-dependencies \
  --allow-missing-repository 2>&1 | tee -a "$TEMP_BUILD_LOG"

# Find the freshly built VSIX
VSIX_PATH="$(ls "$EXTENSION_DIR"/cdp-codegen-*.vsix 2>/dev/null | sort | tail -1)"
if [[ -z "$VSIX_PATH" ]]; then
  log "ERROR: VSIX not found after packaging." ; exit 1
fi
VSIX_NAME="$(basename "$VSIX_PATH")"
log "VSIX: $VSIX_NAME"

# ── 5. Run CLI: routing verification + create handoff folder ──────────────────
log "--- Routing verification: $GOLDEN_PROJECT ---"
if [[ ! -d "$GOLDEN_PROJECT" ]]; then
  log "ERROR: Golden project not found at $GOLDEN_PROJECT" ; exit 1
fi

CLI_OUTPUT="$(node "$EXTENSION_DIR/out/routing/cli/verifyRouting.js" \
  "$GOLDEN_PROJECT" --no-build 2>&1)"
echo "$CLI_OUTPUT"

# Extract the handoff folder path written by the CLI
HANDOFF_DIR="$(echo "$CLI_OUTPUT" | grep "^Folder  :" | sed 's/^Folder  : *//' | tr -d '\r\n')"

if [[ -z "$HANDOFF_DIR" || ! -d "$HANDOFF_DIR" ]]; then
  log "ERROR: Could not determine handoff folder from CLI output." ; exit 1
fi

# Verify PASS
if ! echo "$CLI_OUTPUT" | grep -q "OVERALL: \*\*\* PASS \*\*\*"; then
  log "ERROR: Verification did NOT pass — see $HANDOFF_DIR" ; exit 1
fi

# ── 6. Overwrite build-log.txt with the REAL compile output ──────────────────
cp "$TEMP_BUILD_LOG" "$HANDOFF_DIR/build-log.txt"

# ── 7. Copy VSIX into handoff folder ─────────────────────────────────────────
cp "$VSIX_PATH" "$HANDOFF_DIR/"

# ── 8. Write summary.txt ─────────────────────────────────────────────────────
VERSION="$(node -p "require('$EXTENSION_DIR/package.json').version" 2>/dev/null || echo unknown)"
TS="$(basename "$HANDOFF_DIR" | sed 's/vscodeextension-//')"
{
  echo "CDP Extension Handoff"
  echo "====================="
  echo "Timestamp : $TS"
  echo "Version   : $VERSION"
  echo "VSIX      : $VSIX_NAME"
  echo "Folder    : $HANDOFF_DIR"
  echo ""
  echo "What changed:"
  echo "  - scope-level port visual direction inversion (Input=1 -> visual 'out')"
  echo "  - port-like pin detection (DrivePort, RefPort, FCPort, VaconDrivesPort etc)"
  echo "  - port block nodes: purple/lilac border and header"
  echo "  - port-like pin dots: purple (#c586c0)"
  echo "  - port edge routing: purple (#b180ff)"
  echo "  - ports-first sort order in pin columns"
  echo "  - external label width: 360px (was 260px)"
  echo "  - dynamic column widths (proportional, not 50/50)"
  echo "  - pin name wrapping instead of ellipsis clipping"
  echo "  - value hidden when name + value would exceed column"
  echo "  - HARD_MAX_W=900px node width cap"
  echo "  - pin dot position computed from actual row heights"
  echo "  - layout report: pinNamesClipped, pinNamesWrapped, valuesHidden, port stats"
  echo ""
  echo "Verification results:"
  echo "$CLI_OUTPUT" | grep -E "OVERALL:|Build +:|Routing validation|VSIX bundle|Resolved|Unresolved|Invalid|Model-inherited" || true
  echo ""
  echo "Extension git log (last 5):"
  git -C "$EXTENSION_DIR" log --oneline -5 2>/dev/null || echo "N/A"
} > "$HANDOFF_DIR/summary.txt"

# ── 9. Generate block-diagram webview HTML for Boom.xml ─────────────────────
BOOM_XML="$GOLDEN_PROJECT/systems/CraneControl/CraneApp/Application/Components/Boom.xml"
if [[ -f "$BOOM_XML" ]]; then
  log "--- Generating block-diagram-webview.html ---"
  node "$EXTENSION_DIR/scripts/dump-webview.js" "$BOOM_XML" \
    > "$HANDOFF_DIR/block-diagram-webview.html" 2>&1 && \
    log "block-diagram-webview.html written ($(wc -c < "$HANDOFF_DIR/block-diagram-webview.html") bytes)" || \
    log "WARN: dump-webview.js not available; skipping webview HTML"
fi

# ── 10. Generate layout report for Boom.xml ───────────────────────────────────
if [[ -f "$BOOM_XML" ]]; then
  log "--- Generating block-diagram-layout-report-Boom.txt ---"
  node "$EXTENSION_DIR/scripts/generate-layout-report.js" \
    "$BOOM_XML" "$HANDOFF_DIR/block-diagram-layout-report-Boom.txt" 2>&1 | tee -a "$TEMP_BUILD_LOG"
  REPORT_EXIT=${PIPESTATUS[0]}
  if [[ $REPORT_EXIT -ne 0 ]] || [[ ! -f "$HANDOFF_DIR/block-diagram-layout-report-Boom.txt" ]]; then
    log "ERROR: layout report generation failed (exit $REPORT_EXIT)"
    exit 1
  fi
  log "layout report generated OK"
  # Extract key stats into summary.txt
  LAYOUT_STATS=$(grep -E "^(scopePath|nodes|pins|internalEdges|externalLabels|layoutOverlaps|pinNamesClipped|topLevelPortCount|portLikePinCount|portBlockCount|portEdgeCount|topLevelInputPortCount|topLevelInputPortsWithExternalLabelLeft):" \
    "$HANDOFF_DIR/block-diagram-layout-report-Boom.txt" | head -20)
  {
    echo ""
    echo "--- Layout report (Boom.xml) ---"
    echo "$LAYOUT_STATS"
  } >> "$HANDOFF_DIR/summary.txt"
else
  log "WARN: BOOM_XML not found at $BOOM_XML — skipping layout report"
fi

# ── 11. Force-install VSIX ───────────────────────────────────────────────────
log "--- Installing VSIX ---"
code --install-extension "$HANDOFF_DIR/$VSIX_NAME" --force 2>&1 | tee -a "$TEMP_BUILD_LOG"

# Update build-log with install step too
cp "$TEMP_BUILD_LOG" "$HANDOFF_DIR/build-log.txt"

log ""
log "--- Handoff folder contents ---"
ls -lh "$HANDOFF_DIR"

echo ""
echo "=== Handoff complete: $HANDOFF_DIR ==="
echo ""
echo "$HANDOFF_DIR"
