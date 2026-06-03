/**
 * verifyRouting.ts (cli)
 *
 * CLI entry point for CDP routing verification.
 * Uses the shared core — no vscode dependency.
 *
 * Usage:
 *   node out/routing/cli/verifyRouting.js <workspace-path>
 *
 * Exits with code 0 on PASS, non-zero on FAIL.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

import { CdpProjectIndexer } from "../core/cdpProjectIndexer";
import { computeRoutingStats, analyseRoutings } from "../core/routingStats";
import { buildReport, VsixCheckResult } from "../core/reportGenerator";

// Extension root = 3 levels up from out/routing/cli/
const EXTENSION_ROOT = path.resolve(__dirname, "../../..");

function getExtensionVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(EXTENSION_ROOT, "package.json"), "utf-8")
    );
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Build (compile extension + CLI + package VSIX)
// ────────────────────────────────────────────────────────────────────────────
interface BuildResult {
  success: boolean;
  log: string;
}

function buildAll(): BuildResult {
  const steps = [
    { label: "Compile extension (tsc)", cmd: "npx tsc -p .", cwd: EXTENSION_ROOT },
    { label: "Compile CLI (tsc)", cmd: "npm run compile", cwd: path.join(EXTENSION_ROOT, "cli") },
    {
      label: "Package VSIX",
      cmd: "npx @vscode/vsce package --no-dependencies --allow-missing-repository",
      cwd: EXTENSION_ROOT,
    },
  ];

  const logLines = ["=== BUILD LOG ==="];
  let allOk = true;

  for (const step of steps) {
    console.log(`  Building: ${step.label}...`);
    logLines.push(`\n--- ${step.label} ---`);
    logLines.push(`cwd: ${step.cwd}`);
    logLines.push(`cmd: ${step.cmd}`);
    try {
      const out = execSync(step.cmd, {
        cwd: step.cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      logLines.push(out || "(no output)");
      logLines.push("[OK]");
    } catch (e: any) {
      const msg = ((e.stdout ?? "") + "\n" + (e.stderr ?? "")).trim() || String(e);
      logLines.push(msg);
      logLines.push("[FAILED]");
      allOk = false;
      console.error(`    FAILED: ${step.label}`);
      console.error(`    ${msg.split("\n")[0]}`);
    }
  }

  return { success: allOk, log: logLines.join("\n") };
}

// ────────────────────────────────────────────────────────────────────────────
// VSIX bundle check
// ────────────────────────────────────────────────────────────────────────────
function checkVsixBundle(): VsixCheckResult {
  let vsixFiles: string[];
  try {
    vsixFiles = fs.readdirSync(EXTENSION_ROOT).filter((f) => f.endsWith(".vsix"));
  } catch {
    return { found: false };
  }

  if (vsixFiles.length === 0) {
    return { found: false };
  }

  const vsixPath = path.join(EXTENSION_ROOT, vsixFiles[vsixFiles.length - 1]);
  let listing = "";
  try {
    listing = execSync(`unzip -l "${vsixPath}"`, { encoding: "utf-8" });
  } catch (e: any) {
    return {
      found: true,
      vsixName: path.basename(vsixPath),
      error: String(e.stderr || e),
      checks: [],
    };
  }

  const lines = listing.split("\n").map((l) => l.trim());
  const checks = [
    {
      name: "cli/dist/*.js is included",
      pass: lines.some((l) => /extension\/cli\/dist\/.*\.js/.test(l)),
    },
    {
      name: "cli/src is NOT included",
      pass: !lines.some((l) => /extension\/cli\/src\//.test(l)),
    },
    {
      name: "cli/node_modules is NOT included",
      pass: !lines.some((l) => /extension\/cli\/node_modules\//.test(l)),
    },
    {
      name: ".ts files are NOT included",
      pass: !lines.some((l) => /extension\/.*\.ts$/.test(l)),
    },
  ];

  return { found: true, vsixName: path.basename(vsixPath), checks };
}

// ────────────────────────────────────────────────────────────────────────────
// Git helpers
// ────────────────────────────────────────────────────────────────────────────
function getGitInfo(dir: string): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const commit = execSync("git rev-parse --short HEAD", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return `${branch} @ ${commit}`;
  } catch {
    return "N/A";
  }
}

function getGitStatusFull(dir: string): string {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, {
        cwd: dir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e: any) {
      return e.stdout || e.stderr || String(e);
    }
  };

  const sep = "=".repeat(80);
  return [
    sep,
    `Git status report for: ${dir}`,
    `Generated: ${new Date().toISOString()}`,
    sep,
    "",
    "--- git status ---",
    run("git status"),
    "--- git diff --stat (unstaged) ---",
    run("git diff --stat"),
    "--- git diff --cached --stat (staged) ---",
    run("git diff --cached --stat"),
    "--- git log --oneline -10 ---",
    run("git log --oneline -10"),
    "--- git stash list ---",
    run("git stash list"),
    sep,
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Source archive
// ────────────────────────────────────────────────────────────────────────────
function createProjectTar(srcDir: string, outDir: string, datePart: string): string | null {
  const dirName = path.basename(srcDir);
  const tarName = `${dirName}-${datePart}.tar.gz`;
  const tarPath = path.join(outDir, tarName);
  const parentDir = path.dirname(srcDir);

  const excludes = [
    "--exclude=.git",
    "--exclude=node_modules",
    "--exclude=cli/node_modules",
    "--exclude=out",
    "--exclude=build",
    "--exclude=dist",
    "--exclude=cli/dist",
    "--exclude=*.vsix",
  ].join(" ");

  try {
    execSync(`tar ${excludes} -czf "${tarPath}" -C "${parentDir}" "${dirName}"`, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const sizeMb = (fs.statSync(tarPath).size / 1024 / 1024).toFixed(2);
    console.log(`  Tar     : ${tarName} (${sizeMb} MB)`);
    return tarName;
  } catch (e: any) {
    console.error(`  Tar FAILED: ${(e.stderr || e.message || String(e)).toString().trim().split("\n")[0]}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));

  const workspacePath = args[0];
  if (!workspacePath) {
    console.error("Usage: node out/routing/cli/verifyRouting.js <workspace-path> [--no-build]");
    process.exit(1);
  }

  const absWorkspace = path.resolve(workspacePath);
  if (!fs.existsSync(absWorkspace)) {
    console.error(`Workspace path not found: ${absWorkspace}`);
    process.exit(1);
  }

  // 1. Build extension + CLI + package VSIX (skip if bootstrap already did it)
  const skipBuild = flags.has("--no-build");
  let build: BuildResult;
  if (skipBuild) {
    console.log("Build: skipped (--no-build flag, bootstrap already compiled).");
    build = { success: true, log: "Build performed by scripts/verify-routing.js bootstrap." };
  } else {
    console.log("Building extension + CLI + packaging VSIX...");
    build = buildAll();
  }
  if (!build.success) {
    console.error("Build failed — report will still be written but VSIX check may fail.");
  }

  // 2. Build routing index
  const indexer = new CdpProjectIndexer({ appendLine: (m) => console.log(`  ${m}`) });
  console.log(`\nBuilding routing index for: ${absWorkspace}`);
  const index = await indexer.buildIndex([absWorkspace]);

  // 3. Compute stats and analyse
  computeRoutingStats(index);
  const analysis = analyseRoutings(index);

  console.log(`  Resolved:        ${index.stats.resolvedRoutings}`);
  console.log(`  Model-inherited: ${index.stats.modelInheritedRoutings}`);
  console.log(`  Unresolved:      ${index.stats.unresolvedRoutings}`);
  console.log(`  Invalid:         ${index.stats.invalidRoutings}`);
  console.log(`  Errors (red):    ${analysis.errors.length}`);

  // 4. VSIX + git info
  const vsixInfo = checkVsixBundle();
  const gitInfo = getGitInfo(absWorkspace);

  // 5. Compute overall pass/fail
  const routingPass = analysis.errors.length === 0;
  const vsixPass =
    vsixInfo.found && !vsixInfo.error && (vsixInfo.checks ?? []).every((c) => c.pass);
  const overallPass = build.success && routingPass && vsixPass;

  // 6. Build report text
  const reportText = buildReport({
    workspacePath: absWorkspace,
    extensionVersion: getExtensionVersion(),
    gitInfo,
    buildSuccess: build.success,
    index,
    analysis,
    vsixInfo,
  });

  // 7. Write output folder
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const datePart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  const projName = path.basename(absWorkspace);
  const outDir = path.join(os.homedir(), "Downloads", `vscodeextension-${datePart}`);
  fs.mkdirSync(outDir, { recursive: true });

  const reportName = `CDP-Routing-Verification-${projName}-${datePart}.txt`;
  fs.writeFileSync(path.join(outDir, reportName), reportText, "utf-8");
  fs.writeFileSync(path.join(outDir, "build-log.txt"), build.log, "utf-8");
  fs.writeFileSync(path.join(outDir, "git-status-extension.txt"), getGitStatusFull(EXTENSION_ROOT), "utf-8");
  if (path.resolve(absWorkspace) !== EXTENSION_ROOT) {
    fs.writeFileSync(path.join(outDir, `git-status-${projName}.txt`), getGitStatusFull(absWorkspace), "utf-8");
  }

  console.log("\nCreating source archive...");
  createProjectTar(EXTENSION_ROOT, outDir, datePart);

  // 8. Terminal summary
  console.log("");
  console.log(`Folder  : ${outDir}`);
  console.log(`Report  : ${reportName}`);
  console.log("");
  console.log(`  Build              : ${build.success ? "PASS" : "FAIL"}`);
  console.log(`  Routing validation : ${routingPass ? "PASS" : "FAIL"}  (${analysis.errors.length} red error(s))`);
  console.log(`  VSIX bundle        : ${vsixPass ? "PASS" : "FAIL"}`);
  console.log("");
  console.log(`OVERALL: ${overallPass ? "*** PASS ***" : "*** FAIL ***"}`);

  process.exit(overallPass ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
