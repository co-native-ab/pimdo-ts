// Generates the "Required scopes" table in README.md from the call-site
// registry in `src/scopes-doc.ts`. Single source of truth: the `*_SCOPES`
// DNF constants declared next to the Graph/ARM functions that use them.
//
// Usage:
//   npm run scopes           # rewrite README.md scope table
//   npm run scopes:check     # verify it is up-to-date (exit 1 if drift)
//
// Wired into `npm run check` so a forgotten regeneration is caught in CI.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

(globalThis as unknown as { __VERSION__?: string }).__VERSION__ ??= "0.0.0-scope-docs";
process.env["VITEST"] ??= "1";

const prettier = await import("prettier");

const { SCOPE_CALL_SITES } = await import("../src/scopes-doc.js");
const { ALWAYS_REQUIRED_SCOPES, AVAILABLE_SCOPES, OAuthScope, Resource, resourceForScope } =
  await import("../src/scopes.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const readmePath = resolve(root, "README.md");

function escapeCell(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resourceFor(scope: OAuthScope): "Graph" | "ARM" {
  return resourceForScope(scope) === Resource.Graph ? "Graph" : "ARM";
}

interface Row {
  scope: OAuthScope;
  resource: "Graph" | "ARM";
  uses: { label: string; docsUrl: string; required: boolean }[];
}

function buildRows(): Row[] {
  const rows: Row[] = [];
  for (const def of AVAILABLE_SCOPES) {
    const isAlways = ALWAYS_REQUIRED_SCOPES.includes(def.scope);
    const uses: Row["uses"] = [];
    for (const cs of SCOPE_CALL_SITES) {
      // The call site requires this scope when every DNF alternative includes it.
      const inEvery = cs.scopes.length > 0 && cs.scopes.every((alt) => alt.includes(def.scope));
      // It accepts this scope (one valid path) when at least one alternative includes it.
      const inSome = cs.scopes.some((alt) => alt.includes(def.scope));
      if (inEvery) {
        uses.push({ label: cs.label, docsUrl: cs.docsUrl, required: true });
      } else if (inSome) {
        uses.push({ label: cs.label, docsUrl: cs.docsUrl, required: false });
      }
    }
    if (isAlways) {
      // Always-required scopes (User.Read, offline_access) are documented as such.
      rows.push({ scope: def.scope, resource: resourceFor(def.scope), uses: [] });
    } else if (uses.length > 0) {
      rows.push({ scope: def.scope, resource: resourceFor(def.scope), uses });
    }
  }
  return rows;
}

function renderUses(uses: Row["uses"], isAlways: boolean): string {
  if (isAlways) return "always (sign-in identity / refresh tokens)";
  if (uses.length === 0) return "—";
  return uses
    .map((u) => {
      const link = `[${escapeCell(u.label)}](${u.docsUrl})`;
      return u.required ? link : `${link} (alternative — Read variant accepted)`;
    })
    .join("; ");
}

function renderTable(rows: Row[]): string {
  const lines: string[] = [];
  lines.push("| Scope | Resource | When required |");
  lines.push("| ----- | -------- | ------------- |");
  for (const row of rows) {
    const isAlways = ALWAYS_REQUIRED_SCOPES.includes(row.scope);
    lines.push(`| \`${row.scope}\` | ${row.resource} | ${renderUses(row.uses, isAlways)} |`);
  }
  return lines.join("\n");
}

function replaceMarkedBlock(content: string, body: string): string {
  const start = "<!-- scope-table:start -->";
  const end = "<!-- scope-table:end -->";
  const re = new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`);
  if (!re.test(content)) {
    throw new Error(
      `README.md is missing the scope-table markers. ` +
        `Expected both ${start} and ${end} to be present.`,
    );
  }
  return content.replace(re, `${start}\n\n${body}\n\n${end}`);
}

async function formatWithPrettier(content: string, filepath: string): Promise<string> {
  const cfg = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(content, { ...cfg, filepath });
}

async function buildReadme(currentReadme: string): Promise<string> {
  const next = replaceMarkedBlock(currentReadme, renderTable(buildRows()));
  return formatWithPrettier(next, readmePath);
}

const checkMode = process.argv.includes("--check");
const currentReadme = readFileSync(readmePath, "utf-8");
const nextReadme = await buildReadme(currentReadme);

if (checkMode) {
  if (currentReadme !== nextReadme) {
    console.error("README.md scope table is out of date. Run: npm run scopes");
    process.exit(1);
  }
  console.log(
    `README.md scope table up to date (${String(buildRows().length)} scopes across ` +
      `${String(SCOPE_CALL_SITES.length)} call sites).`,
  );
} else {
  writeFileSync(readmePath, nextReadme, "utf-8");
  console.log(`Updated ${readmePath}`);
}
