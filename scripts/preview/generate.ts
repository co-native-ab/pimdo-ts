// Generates the deterministic preview-site artefacts.
//
// Output directory:
//   default: `.preview/` at the repo root (gitignored)
//   override: `PREVIEW_OUT_DIR` env var (used by CI to stage for Pages)
//
// The generated tree is never committed — it is published to GitHub
// Pages by the `preview` / `preview-publish` workflows. See ADR-0012.
//
// Usage:
//   npm run preview          # write artefacts to .preview/
//   npm run preview:check    # registration + source coverage (see check.ts)
//
// The generator is intentionally small: it just walks the registries in
// `views.ts` and `tools.ts` and writes output. All rendering logic
// lives in the production template / format modules — this script
// never reimplements them.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VIEW_PREVIEWS } from "./views.js";
import { buildManifest, renderViewHtml } from "./render.js";
import { renderIndexHtml, INDEX_STYLES } from "./index-template.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");

/**
 * Output directory. Default is the gitignored `.preview/` at the repo
 * root so contributors can open `.preview/index.html` locally without
 * committing generated files. CI overrides this via `PREVIEW_OUT_DIR`
 * to stage the site for GitHub Pages publication.
 */
const outDir = resolve(root, process.env["PREVIEW_OUT_DIR"] ?? ".preview");

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

  // MCP `*_list` tools intentionally not emitted: they return plain text
  // to the AI by contract, so there's nothing meaningful to render in
  // the preview site. Their registration coverage is still validated by
  // `scripts/preview/check.ts` (every registered tool must render for
  // every list scenario).

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
  const rel = relative(root, outDir) || ".";
  // eslint-disable-next-line no-console
  console.log(
    `Generated ${String(files.length)} files in ${rel}/. Open ${rel}/index.html to browse.`,
  );
}
