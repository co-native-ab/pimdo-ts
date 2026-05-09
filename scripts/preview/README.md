# scripts/preview

Single source of truth for the **preview site**.

The preview site is a static, fully self-contained gallery that lets a
human (or AI agent) click through every browser-facing page in both
colour schemes without running the live MCP server.

> MCP `*_list` tools are tracked by the registry and their renderers
> are exercised by `preview:check`, but they do **not** emit preview
> artefacts — they return plain text to the AI by contract, so there's
> nothing meaningful to render in a browser-facing site.

- **Locally:** run `npm run preview` and open `.preview/index.html`.
- **In a PR:** CI publishes to GitHub Pages — see the sticky comment
  at the bottom of the PR for the URL
  (`https://<owner>.github.io/<repo>/preview/pr/<id>/`). The latest
  `main` is always available at `/preview/main/`.

The output directory `.preview/` is **gitignored**; the generated
artefacts are never committed (see ADR-0012). They are rebuilt on
every CI run and pushed to the `gh-pages` branch by the
`preview-publish` workflow.

## Files

| File                | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `scenarios.ts`      | Canonical list of scenario ids (`empty`, `single`, …).              |
| `views.ts`          | Registry of browser views — re-uses the production templates.       |
| `tools.ts`          | Registry of MCP `*_list` tools — re-uses the production formatters. |
| `fixtures/`         | Deterministic Graph / ARM / row-form data per scenario.             |
| `render.ts`         | Pure helpers shared by `generate.ts` and `check.ts`.                |
| `index-template.ts` | Inline HTML/CSS/JS for `index.html`.                                |
| `generate.ts`       | Writes the output dir. Invoked by `npm run preview`.                |
| `check.ts`          | Verifies registration and source coverage.                          |

## Conventions

- **No duplication.** `render.ts` calls into `src/templates/*` and
  `src/tools/pim/*/format.ts` directly. Never reimplement a template
  or formatter here.
- **Determinism.** All fixtures use fixed display names, sequential
  GUIDs, and pinned ISO timestamps so the generator output is
  byte-stable across machines.
- **Five-scenario matrix.** Every list-producing surface (a row-form
  view or an MCP `*_list` tool) renders one output per id in
  `LIST_SCENARIO_IDS`.
- **Both colour schemes.** Every view is rendered to `light.html` and
  `dark.html` via a deterministic `<meta name="color-scheme">` shim;
  the underlying templates already respond to `prefers-color-scheme`.

## Adding a new view or tool

1. Implement the view (`src/browser/flows/...`) or tool (`src/tools/pim/...`).
2. Add a fixture under `fixtures/` if the existing data isn't enough.
3. Register the surface in `views.ts` or `tools.ts`.
4. Run `npm run preview` and visually review `.preview/index.html`.
5. Run `npm run preview:check`.

If you skip step 3 the check will fail with a structured nudge that
points back at this file, ADR-0012, and the `preview-coverage` agent.

## Output dir override

The generator honours the `PREVIEW_OUT_DIR` environment variable so CI
can stage the site for publication. The default is `.preview/` at the
repo root.

## Optional: screenshot rendering

Byte-deterministic PNGs across operating systems require an extra
image-diff tool, so they are not part of `npm run preview` or
`npm run preview:check`. The index renders each view live in an
iframe, in either light or dark theme, which already shows what
the page looks like — a separate "Screenshot" tab is therefore
not exposed today. A future `npm run preview:screenshots` job
(Playwright) could add PNG snapshots without changing the rest
of the framework.
