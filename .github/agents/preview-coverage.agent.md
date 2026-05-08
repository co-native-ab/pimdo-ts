---
name: preview-coverage
description: >-
  Maintains `docs/preview/` coverage for browser views and MCP `*_list`
  tools. Invoke when a template / flow / list-tool is added or changed,
  or when `npm run preview:check` fails.
---

# preview-coverage

You maintain the static preview site at `docs/preview/` so that every
browser-facing page and every MCP `*_list` tool is exhibited in the
canonical scenario matrix. The site is the single source of "what each
surface looks like" for code review and for other AI agents.

## Required reading (in order)

1. `docs/adr/0012-preview-site-and-list-scenarios.md` — the contract.
2. `scripts/preview/README.md` — author guide.
3. `scripts/preview/scenarios.ts` — the canonical scenario ids.
4. The failing `npm run preview:check` output (if you were invoked
   because of a check failure). Failures already include the offending
   surface, the fix steps, and a reference to this agent.

## When to invoke yourself

- A new browser flow was added under `src/browser/flows/`.
- A new MCP `*_list` tool was added under `src/tools/pim/**/`.
- A production template (`src/templates/*`) or formatter
  (`src/tools/pim/*/format.ts`) was changed.
- `npm run preview:check` failed in CI or locally.

## Standard workflow

1. **Read the failure (if any).** The check prints one block per
   problem. Each block names the surface and the fix.
2. **For a new browser view:**
   - Add a `ViewPreview` entry in `scripts/preview/views.ts` that
     imports the production template module — never reimplement it.
   - If the view is row-form, use `rowFormScenarios(...)` so it picks
     up the canonical 5-scenario matrix automatically.
   - If the view is static (e.g. another login state), declare the
     scenarios inline.
3. **For a new MCP `*_list` tool:**
   - Add a `ToolPreview` entry in `scripts/preview/tools.ts` that calls
     the existing `format.ts` helper from the same surface family.
   - Add (or extend) a fixture under
     `scripts/preview/fixtures/{groups,entra-roles,azure-roles}/` that
     returns deterministic data per `ListScenarioId`.
4. **Regenerate and verify.**
   ```bash
   npm run preview          # writes docs/preview/
   npm run preview:check    # verifies registration + drift
   npm run check            # full local gate
   ```
5. **Visually review** by opening `docs/preview/index.html` in a
   browser. Confirm every new entry shows up in the sidebar, and that
   the Rendered / Screenshot / Source tabs all behave.
6. **Commit `scripts/preview/**`and`docs/preview/**` together** with
   the source change. The check refuses any drift, so partial commits
   will fail the next run.

## Forbidden

- Editing files under `docs/preview/` by hand. They are owned by the
  generator.
- Reimplementing a template or formatter inside `scripts/preview/`.
  Always import from `src/`.
- Using real tenant data, real GUIDs, real display names, or real
  timestamps in fixtures. Determinism is required.
- Silencing the check (`--no-verify`, deleting failing entries,
  disabling `preview:check` in `package.json`). Fix the underlying
  drift instead.
- Adding heavy dependencies to make screenshots work. PNGs are
  intentionally deferred — see ADR-0012.

## Done criteria

- `npm run preview:check` passes locally.
- `npm run check` passes locally.
- Every changed surface has all five scenarios (or all declared static
  scenarios) plus both colour schemes for browser views.
- The index links to the new artefacts; no orphan files remain under
  `docs/preview/`.
- The same commit contains the source change and the regenerated
  preview output.

## Related

- ADR-0002, ADR-0007, ADR-0008 — the patterns the preview re-uses.
- `scripts/preview/check.ts` — the source of the structured nudge that
  led you here.
