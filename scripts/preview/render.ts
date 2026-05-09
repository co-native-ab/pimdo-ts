// Pure rendering helpers shared by `generate.ts` and `check.ts`. Stays
// thin on purpose — all heavy lifting lives in `views.ts` / `tools.ts`,
// which in turn call the production template / format modules.

import { TOOL_PREVIEWS, type ToolPreview } from "./tools.js";
import { VIEW_PREVIEWS, type ViewPreview, type ViewScenario } from "./views.js";
import { LIST_SCENARIO_IDS, type ListScenarioId } from "./scenarios.js";

export interface ManifestView {
  name: string;
  family: string;
  description: string;
  kind: "static" | "row-form";
  scenarios: { id: string; label: string }[];
}

export interface ManifestTool {
  name: string;
  family: string;
  description: string;
  scenarios: { id: ListScenarioId; label: string }[];
}

export interface Manifest {
  schemaVersion: 1;
  generator: "scripts/preview/generate.ts";
  views: ManifestView[];
  tools: ManifestTool[];
}

export function buildManifest(): Manifest {
  return {
    schemaVersion: 1,
    generator: "scripts/preview/generate.ts",
    views: VIEW_PREVIEWS.map((v: ViewPreview) => ({
      name: v.name,
      family: v.family,
      description: v.description,
      kind: v.kind,
      scenarios: v.scenarios.map((s: ViewScenario) => ({ id: s.id, label: s.label })),
    })),
    tools: TOOL_PREVIEWS.map((t: ToolPreview) => ({
      name: t.name,
      family: t.family,
      description: t.description,
      scenarios: LIST_SCENARIO_IDS.map((id) => ({ id, label: id })),
    })),
  };
}

/**
 * Force a deterministic colour scheme on raw HTML produced by templates
 * that use `@media (prefers-color-scheme: dark)`. We can't rely on the
 * `color-scheme` meta alone — it controls UA defaults but does not make
 * the media query evaluate true. So we rewrite the CSS:
 *
 *   - dark: unwrap every `@media (prefers-color-scheme: dark) { ... }`
 *           block so its rules always apply, and switch any
 *           `<source media="(prefers-color-scheme: dark)">` to `all`.
 *   - light: drop those blocks and `<source>` elements entirely.
 *
 * Result: the static HTML renders identically on any OS regardless of
 * the viewer's system theme.
 */
export function themedHtml(rawHtml: string, theme: "light" | "dark"): string {
  let html = rewriteDarkMediaBlocks(rawHtml, theme);
  html = rewriteDarkPictureSources(html, theme);
  // Also pin the UA-level scheme (form controls, scrollbars, etc.).
  const cssOverride = `<style>:root{color-scheme:${theme};}</style>`;
  return html.replace(
    /<meta charset="utf-8"\s*\/?>/i,
    (match) => `${match}\n  <meta name="color-scheme" content="${theme}">\n  ${cssOverride}`,
  );
}

/** Find every `@media (prefers-color-scheme: dark) { ... }` block, with brace matching. */
function rewriteDarkMediaBlocks(input: string, theme: "light" | "dark"): string {
  const re = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/gi;
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const blockStart = match.index;
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMatchingBrace(input, bodyStart);
    if (bodyEnd === -1) {
      // Unbalanced — bail out, leave the rest unchanged.
      break;
    }
    out += input.slice(cursor, blockStart);
    if (theme === "dark") {
      // Inline the body so the rules always apply.
      out += input.slice(bodyStart, bodyEnd);
    }
    // theme === "light": drop the block entirely.
    cursor = bodyEnd + 1; // skip closing brace
    re.lastIndex = cursor;
  }
  out += input.slice(cursor);
  return out;
}

/**
 * Drop / unmask `<source ... media="(prefers-color-scheme: dark)">` inside
 * `<picture>` so the dark-themed image actually loads.
 */
function rewriteDarkPictureSources(input: string, theme: "light" | "dark"): string {
  const re = /<source\b[^>]*media=["']\(prefers-color-scheme:\s*dark\)["'][^>]*>/gi;
  if (theme === "light") {
    return input.replace(re, "");
  }
  // dark: rewrite media to "all" so the source is always selected.
  return input.replace(re, (tag) =>
    tag.replace(/media=["']\(prefers-color-scheme:\s*dark\)["']/i, 'media="all"'),
  );
}

/** Index of the `}` matching the `{` that opened at `bodyStart - 1`. */
function findMatchingBrace(input: string, bodyStart: number): number {
  let depth = 1;
  for (let i = bodyStart; i < input.length; i++) {
    const ch = input[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Render the markdown the MCP tool would return for this scenario. */
export function renderToolText(toolName: string, scenario: ListScenarioId): string {
  const tool = TOOL_PREVIEWS.find((t) => t.name === toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  return tool.render(scenario);
}

/** Render the HTML for a (view, scenario, theme) triple. */
export function renderViewHtml(
  viewName: string,
  scenarioId: string,
  theme: "light" | "dark",
): string {
  const view = VIEW_PREVIEWS.find((v) => v.name === viewName);
  if (!view) throw new Error(`Unknown view: ${viewName}`);
  const scenario = view.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario for ${viewName}: ${scenarioId}`);
  return themedHtml(scenario.render(), theme);
}
