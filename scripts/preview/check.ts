// Verifies that `docs/preview/` matches what `generate.ts` would
// produce. Failure messages are designed to be actionable for both
// humans and AI agents — every failure points at the `preview-coverage`
// agent and ADR-0012.
//
// Usage:
//   npm run preview:check
//
// Wired into `npm run check` and CI.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LIST_SCENARIO_IDS } from "./scenarios.js";
import { TOOL_PREVIEWS } from "./tools.js";
import { VIEW_PREVIEWS } from "./views.js";
import { plan } from "./generate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");
const outDir = resolve(root, "docs", "preview");
const srcRoot = resolve(root, "src");

interface Failure {
  surface: string;
  reason: string;
  fixSteps: string[];
}

const NUDGE_FOOTER = [
  "",
  "  Convention reference:  docs/adr/0012-preview-site-and-list-scenarios.md",
  '  Use the "preview-coverage" agent (.github/agents/preview-coverage.agent.md)',
  "  to perform the steps above automatically and consistently.",
].join("\n");

function fail(failures: Failure[]): never {
  const blocks = failures.map((f) => {
    const steps = f.fixSteps.map((s, i) => `    ${String(i + 1)}. ${s}`).join("\n");
    return [
      `  Surface: ${f.surface}`,
      `  Reason:  ${f.reason}`,
      `  How to fix:`,
      steps,
      NUDGE_FOOTER,
    ].join("\n");
  });
  const summary = `\u2717 preview:check failed\n\n${blocks.join("\n\n")}\n`;
  process.stderr.write(summary);
  appendStepSummary(summary);
  process.exit(1);
}

/** When running in GitHub Actions, mirror the nudge into the step summary. */
function appendStepSummary(text: string): void {
  const path = process.env["GITHUB_STEP_SUMMARY"];
  if (!path) return;
  try {
    writeFileSync(path, text + "\n", { flag: "a" });
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// 1. Registration coverage: every list scenario present, every theme present.
// ---------------------------------------------------------------------------

function checkRegistrations(): Failure[] {
  const failures: Failure[] = [];
  for (const tool of TOOL_PREVIEWS) {
    for (const id of LIST_SCENARIO_IDS) {
      let ok = true;
      try {
        const text = tool.render(id);
        if (typeof text !== "string") ok = false;
      } catch {
        ok = false;
      }
      if (!ok) {
        failures.push({
          surface: tool.name,
          reason: `scenario "${id}" failed to render`,
          fixSteps: [
            `Open scripts/preview/fixtures/ and add a fixture for the "${id}" scenario.`,
            `Run: npm run preview`,
            `Commit the regenerated files under docs/preview/`,
          ],
        });
      }
    }
  }
  for (const view of VIEW_PREVIEWS) {
    if (view.scenarios.length === 0) {
      failures.push({
        surface: view.name,
        reason: "view has zero scenarios",
        fixSteps: [
          `Add at least one scenario to ${view.name} in scripts/preview/views.ts.`,
          `Run: npm run preview`,
          `Commit the regenerated files under docs/preview/`,
        ],
      });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 2. Source coverage: every browser flow / *_list tool is registered.
// ---------------------------------------------------------------------------

function checkSourceCoverage(): Failure[] {
  const failures: Failure[] = [];

  // Browser flows under src/browser/flows/ — every flow file must be
  // referenced as a view (by name). row-form is a primitive, not a flow.
  const flowsDir = resolve(srcRoot, "browser", "flows");
  const flowFiles = readdirSync(flowsDir)
    .filter((f) => f.endsWith(".ts") && f !== "row-form.ts")
    .map((f) => f.replace(/\.ts$/, ""));
  const viewNames = new Set(VIEW_PREVIEWS.map((v) => v.name));
  for (const flow of flowFiles) {
    if (!viewNames.has(flow)) {
      failures.push({
        surface: flow,
        reason: `browser flow src/browser/flows/${flow}.ts is not registered in scripts/preview/views.ts`,
        fixSteps: [
          `Add a ViewPreview entry for "${flow}" in scripts/preview/views.ts (re-use the production template module).`,
          `Run: npm run preview`,
          `Commit the regenerated files under docs/preview/`,
        ],
      });
    }
  }

  // *_list MCP tools — every file matching pim-*-list.ts under
  // src/tools/pim must have a tool entry.
  const toolNames = new Set(TOOL_PREVIEWS.map((t) => t.name));
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...walk(full));
      } else if (entry.endsWith("-list.ts")) {
        out.push(full);
      }
    }
    return out;
  }
  for (const file of walk(resolve(srcRoot, "tools", "pim"))) {
    const text = readFileSync(file, "utf8");
    const m = /name:\s*"(pim_[a-z_]+_list)"/.exec(text);
    if (!m) continue;
    const name = m[1];
    if (!toolNames.has(name)) {
      failures.push({
        surface: name,
        reason: `MCP list tool ${name} (${relative(root, file)}) is not registered in scripts/preview/tools.ts`,
        fixSteps: [
          `Add a ToolPreview entry for "${name}" in scripts/preview/tools.ts (re-use the existing format.ts module).`,
          `Add fixtures (if needed) under scripts/preview/fixtures/.`,
          `Run: npm run preview`,
          `Commit the regenerated files under docs/preview/`,
        ],
      });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 3. Drift: regenerate into a temp dir and compare with on-disk output.
// ---------------------------------------------------------------------------

function checkDrift(): Failure[] {
  const expected = plan();
  const failures: Failure[] = [];
  const expectedPaths = new Set<string>();
  for (const f of expected) {
    expectedPaths.add(f.path);
    if (!existsSync(f.path)) {
      failures.push({
        surface: relative(outDir, f.path),
        reason: "missing in docs/preview/ (generator would create it)",
        fixSteps: [`Run: npm run preview`, `Commit the regenerated files under docs/preview/`],
      });
      continue;
    }
    const onDisk = readFileSync(f.path, "utf8");
    if (onDisk !== f.content) {
      failures.push({
        surface: relative(outDir, f.path),
        reason: "content differs from what the generator would produce",
        fixSteps: [`Run: npm run preview`, `Commit the regenerated files under docs/preview/`],
      });
    }
  }
  // Detect orphan files.
  function listAll(dir: string): string[] {
    const out: string[] = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) out.push(...listAll(full));
      else out.push(full);
    }
    return out;
  }
  for (const path of listAll(outDir)) {
    if (path.endsWith(".png")) continue; // PNGs are produced by the optional screenshot job
    if (!expectedPaths.has(path)) {
      failures.push({
        surface: relative(outDir, path),
        reason: "orphan file under docs/preview/ (no longer produced by the generator)",
        fixSteps: [
          `Run: npm run preview (this rewrites docs/preview/ from scratch).`,
          `Commit the regenerated files under docs/preview/`,
        ],
      });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------

function main(): void {
  // Sanity: the temp regeneration uses the same plan() helper, so the
  // tmpdir branch is mainly future-proofing if we ever decide to write
  // before diffing.
  const tmpDir = resolve(root, ".tmp", "preview-check");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const failures: Failure[] = [...checkRegistrations(), ...checkSourceCoverage(), ...checkDrift()];
  if (failures.length > 0) fail(failures);

  // eslint-disable-next-line no-console
  console.log("\u2713 preview:check OK");
}

main();
