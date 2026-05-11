// Generates `schemas/tools/<tool-name>.json` from each MCP tool's Zod
// `inputSchema`. Single source of truth: the tool descriptor's Zod shape.
// The JSON Schema files are derivable artefacts and are useful as
// documentation / for downstream tooling that prefers JSON Schema.
//
// Usage:
//   npm run schemas:generate         # write all schemas/tools/*.json files
//   npm run schemas:check            # verify every file is up-to-date (exit 1 if drift)
//
// Wired into `npm run check` (CI gate) and `npm run build` so a forgotten
// `npm run schemas:generate` is caught long before a release.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `__VERSION__` is replaced by esbuild at build time and otherwise
// evaluated at module load via `src/index.ts`. Set a placeholder before
// dynamically importing the tool barrels so module evaluation does not
// throw a ReferenceError.
(globalThis as unknown as { __VERSION__?: string }).__VERSION__ ??= "0.0.0-schemas";
// Suppress the auto-start `main()` in `src/index.ts` so importing it for
// schema generation does not also try to start the MCP server.
process.env["VITEST"] ??= "1";

const { z } = await import("zod");

const { AUTH_TOOLS } = await import("../src/tools/auth/index.js");
const { GROUP_TOOLS } = await import("../src/features/group/tools/index.js");
const { ROLE_AZURE_TOOLS } = await import("../src/features/role-azure/tools/index.js");
const { ROLE_ENTRA_TOOLS } = await import("../src/features/role-entra/tools/index.js");
type AnyTool = (typeof AUTH_TOOLS)[number];

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const schemasDir = resolve(root, "schemas", "tools");

const checkMode = process.argv.includes("--check");

const ALL_TOOLS: readonly AnyTool[] = [
  ...AUTH_TOOLS,
  ...GROUP_TOOLS,
  ...ROLE_ENTRA_TOOLS,
  ...ROLE_AZURE_TOOLS,
];

interface Plan {
  name: string;
  filePath: string;
  expected: string;
}

function buildPlan(): Plan[] {
  const plans: Plan[] = [];
  const seen = new Set<string>();
  for (const tool of ALL_TOOLS) {
    const name = tool.def.name;
    if (seen.has(name)) {
      throw new Error(`Duplicate tool name in registry: ${name}`);
    }
    seen.add(name);
    const schema = z.object(tool.inputSchema);
    // Trailing newline matches Prettier's defaults so a `prettier --write`
    // on the file is a no-op after generation.
    const json = z.toJSONSchema(schema, { target: "draft-2020-12" });
    const expected = `${JSON.stringify(json, null, 2)}\n`;
    plans.push({
      name,
      filePath: resolve(schemasDir, `${name}.json`),
      expected,
    });
  }
  return plans;
}

function runCheck(plans: Plan[]): number {
  const expectedFiles = new Set(plans.map((p) => `${p.name}.json`));
  let drift = false;

  // Detect orphan files (a tool was renamed/removed but the schema lingers).
  if (existsSync(schemasDir)) {
    for (const entry of readdirSync(schemasDir)) {
      if (!entry.endsWith(".json")) continue;
      if (!expectedFiles.has(entry)) {
        console.error(`schemas/tools/${entry} has no matching tool. Run: npm run schemas:generate`);
        drift = true;
      }
    }
  }

  for (const { name, filePath, expected } of plans) {
    let current: string;
    try {
      current = readFileSync(filePath, "utf-8");
    } catch {
      console.error(`schemas/tools/${name}.json is missing. Run: npm run schemas:generate`);
      drift = true;
      continue;
    }
    if (current !== expected) {
      console.error(
        `schemas/tools/${name}.json is out of date with src/tools/. Run: npm run schemas:generate`,
      );
      drift = true;
    }
  }
  if (drift) return 1;
  console.log(`schemas/tools/ up to date (${String(plans.length)} tools checked).`);
  return 0;
}

function runWrite(plans: Plan[]): void {
  // Wipe stale files so a tool rename leaves no orphan schema behind.
  rmSync(schemasDir, { recursive: true, force: true });
  mkdirSync(schemasDir, { recursive: true });
  for (const { filePath, expected } of plans) {
    writeFileSync(filePath, expected, "utf-8");
    console.log(`Generated ${filePath}`);
  }
}

const plans = buildPlan();
if (plans.length === 0) {
  console.error("no tool schemas to generate (tool registry is empty)");
  process.exit(1);
}

if (checkMode) {
  process.exit(runCheck(plans));
} else {
  runWrite(plans);
}
