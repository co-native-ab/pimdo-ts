# AGENTS.md — pimdo-ts

Guidance for AI agents (and humans) working on this codebase.

## Status

**v0.1.0 candidate.** All four phases of the roadmap (foundation, group, Entra-role, Azure-role surfaces) are complete. The MCP server exposes the full **24 tools**: 3 auth + 7 group + 7 Entra-role + 7 Azure-role. Phase 5 (polish & ship) is in progress: per-tool JSON Schemas, MCPB bundle, README, CI/release pipeline. See `.tmp/roadmap.md` and `.tmp/progress.md`.

## What pimdo is

pimdo is a local MCP server that gives an AI agent **scoped, just-in-time** access to Microsoft Entra Privileged Identity Management. Authentication uses MSAL via an interactive browser loopback, and the same login produces tokens for **both** Microsoft Graph and Azure Resource Manager (ARM is needed for Azure resource role assignments).

## Repository layout

```
src/
  index.ts                 server bootstrap; registers all 24 tools
  scopes.ts                GraphScope + Resource enums; PIM-specific scope set
  auth.ts                  MSAL + StaticAuthenticator; tokenForResource(Graph|Arm)
  config.ts                configDir + a no-op forward-compatible migration hook
  duration.ts              ISO-8601 PIM-subset duration parser/formatter
  graph/                   Microsoft Graph client + PIM group / Entra-role / policies
  arm/                     ARM client + PIM Azure-role + policies
  browser/                 loopback HTTP server framework + login/logout/row-form flows
  templates/               static HTML templates rendered by browser flows
  tools/                   MCP tool descriptors (auth/, pim/group/, pim/role-entra/, pim/role-azure/)
  tool-registry.ts         scope-gated tool enable/disable + instruction text
  errors.ts, logger.ts, fs-options.ts, shutdown-signals.ts

test/                       vitest tests mirroring src/ layout
scripts/                    encode-icons.mjs, generate-schemas.ts, preview-pages.mjs, bundle-mcpb.mjs
schemas/tools/              generated JSON Schemas, one per MCP tool inputSchema
docs/adr/                   ADRs inherited from graphdo-ts (still applicable)
.tmp/                       roadmap & phase plans (gitignored)
```

## Design decisions you must respect

- **Two resources, one login.** `Authenticator.tokenForResource(resource, signal)` is the canonical token path. `token(signal)` is a convenience for `Resource.Graph`. Do not bypass MSAL or cache tokens elsewhere.
- **Privilege-changing tools always go through a browser flow.** The AI may prefill values, but the human always confirms or overrides in the browser before submit. Implemented via the shared `runRowForm` primitive plus the three flows under `src/browser/flows/` (`requester`, `approver`, `confirmer`).
- **Tool naming is `pim_<surface>_<action>`** for PIM-specific tools (e.g. `pim_role_entra_request`, `pim_group_active_list`).
- **Scopes drive tool visibility.** A tool is only enabled when all its `requiredScopes` are present in the granted-scopes set tracked by the auth layer.
- **Single source of truth for tool input schemas.** Each tool's Zod `inputSchema` is the source of truth; `schemas/tools/<name>.json` is generated from it via `npm run schemas:generate` and gated by `npm run schemas:check`.

## Working with the code

- `npm install`
- `npm run check` runs format, lint, typecheck, tests.
- `npm run build` produces `dist/index.js`.
- `node dist/index.js` starts the MCP server on stdio.
- Smoke test: pipe a JSON-RPC `initialize` request to verify startup.

When making changes:

1. Touch only what your task requires.
2. Match the existing style (Prettier, ESLint, narrow Zod schemas).
3. Update the relevant test file in the same change.
4. Run `npm run check` before committing.
5. Do not commit `.tmp/` (it is gitignored).
