# AGENTS.md — pimdo-ts

Guidance for AI agents (and humans) working on this codebase.

## Status

**Phase 1 (foundation & scaffolding).** Only the auth tools (`login`, `logout`, `auth_status`) are wired up. PIM-specific surfaces (groups, Entra roles, Azure resource roles) are added in later phases per `.tmp/roadmap.md`.

## What pimdo is

pimdo is a local MCP server that gives an AI agent **scoped, just-in-time** access to Microsoft Entra Privileged Identity Management. Authentication uses MSAL via an interactive browser loopback, and the same login produces tokens for **both** Microsoft Graph and Azure Resource Manager (ARM is needed for Azure resource role assignments).

## Repository layout

```
src/
  index.ts                 server bootstrap; auth tools only in phase 1
  scopes.ts                GraphScope + Resource enums; PIM-specific scope set
  auth.ts                  MSAL + StaticAuthenticator; tokenForResource(Graph|Arm)
  config.ts                configDir + a no-op forward-compatible migration hook
  duration.ts              ISO-8601 PIM-subset duration parser/formatter
  graph/client.ts          HTTP client for Microsoft Graph
  arm/client.ts            HTTP client for Azure Resource Manager
  browser/                 loopback HTTP server framework + login/logout flows
  templates/               static HTML templates rendered by browser flows
  tools/                   MCP tool descriptors (only auth/* in phase 1)
  tool-registry.ts         scope-gated tool enable/disable + instruction text
  errors.ts, logger.ts, fs-options.ts, shutdown-signals.ts

test/                       vitest tests mirroring src/ layout
scripts/                    encode-icons.mjs, preview-pages.mjs, bundle-mcpb.mjs
docs/adr/                   ADRs inherited from graphdo-ts (still applicable)
.tmp/                       roadmap & phase plans (gitignored)
```

## Design decisions you must respect

- **Two resources, one login.** `Authenticator.tokenForResource(resource, signal)` is the canonical token path. `token(signal)` is a convenience for `Resource.Graph`. Do not bypass MSAL or cache tokens elsewhere.
- **Privilege-changing tools always go through a browser flow.** The AI may prefill values, but the human always confirms or overrides in the browser before submit. (Phase 2+; the framework is `src/browser/`.)
- **Tool naming is `pim_<surface>_<action>`** for PIM-specific tools added later (e.g. `pim_role_entra_request`, `pim_group_active_list`).
- **Scopes drive tool visibility.** A tool is only enabled when all its `requiredScopes` are present in the granted-scopes set tracked by the auth layer.

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
