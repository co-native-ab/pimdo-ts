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

/** Wrap raw view HTML in a tiny shim that pins the colour scheme. */
export function themedHtml(rawHtml: string, theme: "light" | "dark"): string {
  // Inject a top-level `<meta name="color-scheme">` and a CSS override
  // that forces `prefers-color-scheme` deterministically. The templates
  // already respond to the OS preference; here we lock it.
  const colorScheme = theme;
  const cssOverride = `<style>:root{color-scheme:${colorScheme};}</style>`;
  // Place after the existing <meta charset> so it takes precedence.
  return rawHtml.replace(
    /<meta charset="utf-8"\s*\/?>/i,
    (match) => `${match}\n  <meta name="color-scheme" content="${colorScheme}">\n  ${cssOverride}`,
  );
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
