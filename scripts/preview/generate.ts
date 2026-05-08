// Generates the deterministic preview-site artefacts under
// `docs/preview/`. Single source of truth for the directory; never
// hand-edit anything inside it (`scripts/preview/check.ts` enforces
// this with a `git diff --exit-code` style verification).
//
// Usage:
//   npm run preview          # write artefacts
//   npm run preview:check    # verify (see check.ts)
//
// The generator is intentionally small: it just walks the registries in
// `views.ts` and `tools.ts` and writes output. All rendering logic
// lives in the production template / format modules — this script
// never reimplements them.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LIST_SCENARIOS, type ListScenarioId } from "./scenarios.js";
import { TOOL_PREVIEWS } from "./tools.js";
import { VIEW_PREVIEWS } from "./views.js";
import { buildManifest, renderToolText, renderViewHtml } from "./render.js";
import { renderIndexHtml, INDEX_STYLES } from "./index-template.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");
const outDir = resolve(root, "docs", "preview");

interface FileEntry {
  /** Absolute path. */
  path: string;
  /** UTF-8 contents to write. */
  content: string;
}

export function plan(): FileEntry[] {
  const files: FileEntry[] = [];

  // ---- Browser views -----------------------------------------------------
  for (const view of VIEW_PREVIEWS) {
    for (const scenario of view.scenarios) {
      const base = resolve(outDir, "views", view.name, scenario.id);
      files.push({
        path: resolve(base, "light.html"),
        content: renderViewHtml(view.name, scenario.id, "light") + "\n",
      });
      files.push({
        path: resolve(base, "dark.html"),
        content: renderViewHtml(view.name, scenario.id, "dark") + "\n",
      });
      files.push({
        path: resolve(base, "meta.json"),
        content:
          JSON.stringify(
            {
              view: view.name,
              family: view.family,
              scenario: scenario.id,
              themes: ["light", "dark"],
              generator: "scripts/preview/generate.ts",
            },
            null,
            2,
          ) + "\n",
      });
    }
  }

  // ---- MCP list-tool text ------------------------------------------------
  for (const tool of TOOL_PREVIEWS) {
    for (const sc of LIST_SCENARIOS) {
      const id: ListScenarioId = sc.id;
      const base = resolve(outDir, "tools", tool.name);
      const text = renderToolText(tool.name, id);
      files.push({ path: resolve(base, `${id}.md`), content: text + "\n" });
      files.push({
        path: resolve(base, `${id}.html`),
        content: toolHtmlPage(tool.name, id, sc.label, sc.description, text) + "\n",
      });
    }
  }

  // ---- Index + manifest --------------------------------------------------
  const manifest = buildManifest();
  files.push({
    path: resolve(outDir, "manifest.json"),
    content: JSON.stringify(manifest, null, 2) + "\n",
  });
  files.push({
    path: resolve(outDir, "styles.css"),
    content: INDEX_STYLES,
  });
  files.push({
    path: resolve(outDir, "index.html"),
    content: renderIndexHtml(manifest) + "\n",
  });

  return files;
}

/** Wrap a tool's raw text output in a self-contained themed page. */
function toolHtmlPage(
  name: string,
  scenario: string,
  scenarioLabel: string,
  scenarioDescription: string,
  text: string,
): string {
  // Minimal escaping — text comes from our own format functions.
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light dark">
  <title>pimdo preview — ${name} · ${scenario}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; background: #f6f6f8; color: #1f1f24; }
    @media (prefers-color-scheme: dark) { body { background: #15151a; color: #e7e7ec; } pre { background: #1c1b29; color: #e7e7ec; } }
    h1 { font-size: 1rem; margin: 0 0 4px; font-weight: 600; }
    p.meta { font-size: 0.85rem; color: #6e6e7a; margin: 0 0 16px; }
    pre { background: #fff; border-radius: 8px; padding: 16px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9rem; line-height: 1.45; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  </style>
</head>
<body>
  <h1>${name} · ${scenarioLabel}</h1>
  <p class="meta">${scenarioDescription}</p>
  <pre>${safe}</pre>
</body>
</html>`;
}

function writeAll(files: readonly FileEntry[]): void {
  rmSync(outDir, { recursive: true, force: true });
  for (const f of files) {
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.content);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const files = plan();
  writeAll(files);
  // eslint-disable-next-line no-console
  console.log(
    `Generated ${String(files.length)} files in docs/preview/. Open docs/preview/index.html to browse.`,
  );
}
