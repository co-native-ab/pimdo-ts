// Pure rendering helpers shared by `generate.ts` and `check.ts`. Stays
// thin on purpose — all heavy lifting lives in `views.ts` / `tools.ts`,
// which in turn call the production template / format modules.

import { VIEW_PREVIEWS, type ViewPreview, type ViewScenario } from "./views.js";

export interface ManifestView {
  name: string;
  family: string;
  description: string;
  kind: "static" | "row-form";
  scenarios: { id: string; label: string }[];
}

/**
 * Build provenance surfaced in the index top bar so reviewers can tell
 * at a glance whether they are looking at a published PR preview, the
 * `main` site, or a local working copy. Populated from environment
 * variables in {@link readBuildInfo}; defaults to a `local` kind when
 * none are set (e.g. when a contributor runs `npm run preview` on
 * their machine).
 */
export interface BuildInfo {
  kind: "pr" | "main" | "local";
  /** PR number for `pr`, `"main"` for main, `"local"` otherwise. */
  id: string;
  /** Full commit SHA, when known. */
  sha?: string;
  /** Short commit SHA (first 7 chars), when known. */
  shortSha?: string;
  /** GitHub repo HTML URL (e.g. `https://github.com/owner/repo`), when known. */
  repoUrl?: string;
}

export interface Manifest {
  schemaVersion: 2;
  generator: "scripts/preview/generate.ts";
  build: BuildInfo;
  views: ManifestView[];
}

export function buildManifest(): Manifest {
  return {
    schemaVersion: 2,
    generator: "scripts/preview/generate.ts",
    build: readBuildInfo(),
    views: VIEW_PREVIEWS.map((v: ViewPreview) => ({
      name: v.name,
      family: v.family,
      description: v.description,
      kind: v.kind,
      scenarios: v.scenarios.map((s: ViewScenario) => ({ id: s.id, label: s.label })),
    })),
  };
}

/**
 * Read build provenance from environment variables. The CI workflow
 * (`.github/workflows/preview.yml`) sets these before invoking
 * `npm run preview`; locally they default to a sentinel `local` build.
 *
 * Inputs:
 *   - `PREVIEW_BUILD_KIND`  `"pr" | "main"` — anything else is treated
 *     as `local`.
 *   - `PREVIEW_BUILD_ID`    PR number for `pr`, ignored for `main`.
 *   - `PREVIEW_BUILD_SHA`   40-char commit SHA.
 *   - `PREVIEW_BUILD_REPO_URL`  e.g. `https://github.com/owner/repo`.
 *
 * All inputs are validated against strict patterns; invalid values are
 * dropped (rather than throwing) so a misconfigured CI run still
 * produces a usable preview, just without the badge link.
 */
function readBuildInfo(): BuildInfo {
  const rawKind = process.env["PREVIEW_BUILD_KIND"];
  const rawId = (process.env["PREVIEW_BUILD_ID"] ?? "").trim();
  const rawSha = (process.env["PREVIEW_BUILD_SHA"] ?? "").trim();
  const rawRepoUrl = (process.env["PREVIEW_BUILD_REPO_URL"] ?? "").trim();

  const sha = /^[0-9a-f]{40}$/i.test(rawSha) ? rawSha.toLowerCase() : undefined;
  const shortSha = sha ? sha.slice(0, 7) : undefined;
  const repoUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/i.test(rawRepoUrl)
    ? rawRepoUrl
    : undefined;

  if (rawKind === "pr" && /^[1-9][0-9]{0,9}$/.test(rawId)) {
    return { kind: "pr", id: rawId, sha, shortSha, repoUrl };
  }
  if (rawKind === "main") {
    return { kind: "main", id: "main", sha, shortSha, repoUrl };
  }
  return { kind: "local", id: "local", sha, shortSha, repoUrl };
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
