// Generates the tool tables in README.md and the `tools[]` array in
// manifest.json from each MCP tool's descriptor (`def.name` + `def.description`).
// Single source of truth: the tool descriptor in `src/tools/auth/` and
// `src/features/<surface>/tools/`.
//
// Usage:
//   npm run readme           # rewrite README.md tool tables + manifest.json tools[]
//   npm run readme:check     # verify both are up-to-date (exit 1 if drift)
//
// Wired into `npm run check` (CI gate) so a forgotten regeneration is caught
// before review. See ADR-0007 (tool descriptor).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `__VERSION__` is replaced by esbuild at build time and otherwise evaluated
// at module load via `src/index.ts`. Set a placeholder before dynamically
// importing the tool barrels so module evaluation does not throw.
(globalThis as unknown as { __VERSION__?: string }).__VERSION__ ??= "0.0.0-tool-docs";
// Suppress the auto-start `main()` in case any imported module references it.
process.env["VITEST"] ??= "1";

const prettier = await import("prettier");

const { AUTH_TOOLS } = await import("../src/tools/auth/index.js");
const { GROUP_TOOLS } = await import("../src/features/group/tools/index.js");
const { ROLE_AZURE_TOOLS } = await import("../src/features/role-azure/tools/index.js");
const { ROLE_ENTRA_TOOLS } = await import("../src/features/role-entra/tools/index.js");

type AnyTool = (typeof AUTH_TOOLS)[number];

interface Section {
  /** Marker suffix used in README, e.g. `auth` → `<!-- tool-table:auth:start -->`. */
  marker: string;
  tools: readonly AnyTool[];
}

const SECTIONS: readonly Section[] = [
  { marker: "auth", tools: AUTH_TOOLS },
  { marker: "group", tools: GROUP_TOOLS },
  { marker: "role-entra", tools: ROLE_ENTRA_TOOLS },
  { marker: "role-azure", tools: ROLE_AZURE_TOOLS },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const readmePath = resolve(root, "README.md");
const manifestPath = resolve(root, "manifest.json");

// ---------------------------------------------------------------------------
// README tool tables
// ---------------------------------------------------------------------------

function escapeCell(s: string): string {
  // Markdown table cells split on unescaped `|`. Replace any literal pipes,
  // and collapse any internal whitespace so the cell renders on one logical
  // line (tool descriptions are short paragraphs assembled from string
  // concatenation in the descriptor files). Escape backslashes first so a
  // literal `\` in the input does not accidentally become the escape
  // character for the following `|` after the pipe substitution.
  return s.replace(/\s+/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").trim();
}

function renderTable(tools: readonly AnyTool[]): string {
  const lines: string[] = [];
  lines.push("| Tool | Description |");
  lines.push("| ---- | ----------- |");
  for (const tool of tools) {
    lines.push(`| \`${tool.def.name}\` | ${escapeCell(tool.def.description)} |`);
  }
  return lines.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMarkedBlock(content: string, marker: string, body: string): string {
  const start = `<!-- tool-table:${marker}:start -->`;
  const end = `<!-- tool-table:${marker}:end -->`;
  const re = new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`);
  if (!re.test(content)) {
    throw new Error(
      `README.md is missing the tool-table markers for "${marker}". ` +
        `Expected both ${start} and ${end} to be present.`,
    );
  }
  return content.replace(re, `${start}\n\n${body}\n\n${end}`);
}

async function formatWithPrettier(content: string, filepath: string): Promise<string> {
  // The prettier JS API does not auto-resolve `prettier.config.mjs` the way
  // the CLI does — call `resolveConfig` explicitly so the project's
  // printWidth + other options are honoured. Otherwise `npm run format:check`
  // would diverge from `npm run readme`.
  const cfg = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(content, { ...cfg, filepath });
}

async function buildReadme(currentReadme: string): Promise<string> {
  let next = currentReadme;
  for (const section of SECTIONS) {
    next = replaceMarkedBlock(next, section.marker, renderTable(section.tools));
  }
  // Round-trip through prettier so the generated tables match the project's
  // `format:check` gate without any extra effort.
  return formatWithPrettier(next, readmePath);
}

// ---------------------------------------------------------------------------
// manifest.json tools[]
// ---------------------------------------------------------------------------

async function buildManifest(currentManifest: string): Promise<string> {
  const parsed = JSON.parse(currentManifest) as Record<string, unknown>;
  parsed["tools"] = SECTIONS.flatMap((section) =>
    section.tools.map((tool) => ({
      name: tool.def.name,
      description: tool.def.description,
    })),
  );
  // Defer formatting to prettier so this matches `format:manifest` exactly.
  return formatWithPrettier(JSON.stringify(parsed), manifestPath);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const checkMode = process.argv.includes("--check");

const currentReadme = readFileSync(readmePath, "utf-8");
const currentManifest = readFileSync(manifestPath, "utf-8");

const nextReadme = await buildReadme(currentReadme);
const nextManifest = await buildManifest(currentManifest);

if (checkMode) {
  let drift = false;
  if (currentReadme !== nextReadme) {
    console.error("README.md tool tables are out of date. Run: npm run readme");
    drift = true;
  }
  if (currentManifest !== nextManifest) {
    console.error("manifest.json tools[] is out of date. Run: npm run readme");
    drift = true;
  }
  if (drift) {
    process.exit(1);
  }
  const totalTools = SECTIONS.reduce((acc, s) => acc + s.tools.length, 0);
  console.log(
    `README.md tool tables and manifest.json tools[] up to date ` +
      `(${String(totalTools)} tools across ${String(SECTIONS.length)} sections).`,
  );
} else {
  writeFileSync(readmePath, nextReadme, "utf-8");
  writeFileSync(manifestPath, nextManifest, "utf-8");
  console.log(`Updated ${readmePath}`);
  console.log(`Updated ${manifestPath}`);
}
