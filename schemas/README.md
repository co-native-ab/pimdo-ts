# `schemas/`

Generated JSON Schema artefacts. **Do not edit by hand.**

## `tools/`

`schemas/tools/<tool-name>.json` is generated from each MCP tool's Zod
`inputSchema` defined under `src/tools/`. The generator is
`scripts/generate-schemas.ts` and is wired into:

- `npm run schemas:generate` — regenerate all files.
- `npm run schemas:check` — fail with a clear error if any file is missing,
  out of date, or orphaned (a tool was renamed/removed but the schema
  lingers). This runs as part of `npm run check` and CI.

The Zod schema in `src/tools/` is the single source of truth; the JSON
Schema files are derivable artefacts kept in the repo so that:

- they are reviewed alongside any change to a tool's input shape,
- downstream tooling that prefers JSON Schema (linters, doc generators)
  can consume them without the project needing to depend on Zod.

If the contents drift, run `npm run schemas:generate` and commit the
updated files.
