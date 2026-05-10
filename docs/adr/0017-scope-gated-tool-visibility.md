---
title: "ADR-0017: Scope-Gated Dynamic Tool Visibility"
status: "Accepted"
date: "2026-05-09"
authors: "co-native-ab"
tags: ["architecture", "mcp", "tools", "auth", "scopes"]
supersedes: ""
superseded_by: ""
---

# ADR-0017: Scope-Gated Dynamic Tool Visibility

## Status

**Accepted**

## Context

pimdo-ts exposes 24 MCP tools today, most of which require one or
more OAuth scopes:

- `auth_*` tools (login / logout / status) — always available.
- `pim_group_*` tools — gated on PIM-for-groups scopes.
- `pim_role_entra_*` tools — gated on directory-role scopes.
- `pim_role_azure_*` tools — gated on the ARM
  `user_impersonation` scope.

Two facts shape the design:

1. **Consent is partial.** A tenant or user can decline any
   scope at consent time. Tenants can also _downgrade_ requested
   scopes at consent time (e.g. `RoleEligibilitySchedule.ReadWrite.
Directory` → `RoleEligibilitySchedule.Read.Directory`). The
   set of granted scopes is therefore not knowable at compile
   time; it must be read off the token response.
2. **Agent UX matters.** If the agent can _see_ a tool that
   would always fail with "consent required", it will keep
   trying. The cleanest experience is for the tool list the
   agent sees to reflect the scopes it actually has — the agent
   plans against capabilities, not 401s.

The MCP SDK supports per-tool `enable()` / `disable()` and a
`server.sendToolListChanged()` notification. We have to map
"which scopes are granted" onto "which tools are enabled" and
push the update whenever the granted set changes.

## Decision

**Each tool descriptor declares the scopes that enable it.** The
registry computes which tools should be enabled from the granted-
scopes set, calls `enable()` / `disable()` accordingly, and
notifies the client.

### Tool descriptor shape

`ToolDef` (in `src/tool-registry.ts`) carries:

```ts
interface ToolDef {
  name: string;
  title: string;
  description: string;
  /**
   * Scopes that enable this tool, expressed as a DNF (sum-of-products):
   * a list of alternatives, where each alternative is a list of scopes
   * that must ALL be granted. Empty outer list means always-enabled.
   */
  requiredScopes: OAuthScope[][];
}
```

`requiredScopes` uses **DNF (disjunctive normal form)**: `[[A, B], [C]]`
reads "(A AND B) OR C". This is the smallest shape that captures both
patterns we have:

- **OR between alternatives.** Read tools that Microsoft accepts under
  either `Read` or `ReadWrite` against the same path are listed as two
  single-scope alternatives — `[[Read.Directory], [ReadWrite.Directory]]`
  — so the tool stays visible after a tenant downgrades the requested
  `ReadWrite` consent to `Read`.
- **AND within an alternative.** Privilege-changing tools whose handler
  calls multiple endpoints with distinct scopes list every required
  scope inside one alternative — `[[A, B, C, D]]` — so the tool is
  hidden until the user has consented to _all_ of them. The previous
  flat-list "ANY of granted" rule made these tools visible after
  consenting to just one of the four scopes; the agent could call them
  and would always 401.

#### When to use one alternative vs. multiple

- **One alternative with multiple scopes** — when the handler genuinely
  needs every scope in the list to function. Example:
  `pim_role_entra_request` calls `RoleAssignmentSchedule.ReadWrite`,
  reads policy via `RoleManagementPolicy.Read`, and ranges over
  eligibilities via `RoleEligibilitySchedule.ReadWrite`; missing any one
  of those scopes guarantees a 401.
- **Multiple single-scope alternatives** — when any single member is
  sufficient. Example: `pim_role_entra_eligible_list` reads
  eligibilities, which Microsoft serves equally to `Read.Directory`
  _and_ `ReadWrite.Directory` callers. Listing both as alternatives
  makes the substitutability explicit.

### Registry mechanics

`syncToolState(entries, grantedScopes, server)` walks every
registered tool entry. For each:

- If `requiredScopes` is empty → always enabled.
- Else if any alternative is fully covered by `grantedScopes` →
  enable.
- Else → disable.

The result is followed by `server.sendToolListChanged()` so the
host pulls the new tool list.

### When does this run?

- **At server start.** If the user has a cached token,
  `MsalAuthenticator.isAuthenticated(...)` returns `true` and
  `grantedScopes(...)` is fed into `syncToolState`. The right
  tools come up on day one.
- **After login.** The login flow ends with
  `config.onScopesChanged(scopes)` — wired up in
  `createMcpServer` to call `syncToolState`.
- **After logout.** `onScopesChanged([])` disables every gated
  tool.
- **After silent ARM probe.** The probe extends `cachedScopes`
  if ARM consent was already granted; the next
  `grantedScopes(...)` call surfaces the merged set, which is
  then synced.

### Always-on tools

`AUTH_TOOLS` (login / logout / auth_status) declare
`requiredScopes: []` and are always enabled. The user must be
able to log in even when no PIM scopes have been granted yet.

### Instructions text

`buildInstructions(defs)` (in `src/tool-registry.ts`) groups
tools by their scope requirements and writes them into the
MCP `instructions` block, rendering each `requiredScopes` DNF
via `formatRequiredScopes`:

```
ALWAYS AVAILABLE:
  - login: …
  - auth_status: …

SCOPE-GATED TOOLS:
  Requires RoleEligibilitySchedule.Read.Directory OR RoleEligibilitySchedule.ReadWrite.Directory:
    - pim_role_entra_eligible_list: …
  Requires (RoleAssignmentSchedule.ReadWrite.Directory AND RoleManagement.ReadWrite.Directory):
    - pim_role_entra_deactivate: …
  …
```

The agent therefore knows _why_ a tool is missing and which
scope (or scope combination) would make it appear.

## Consequences

### Positive

- **POS-001:** The agent's tool list always reflects what the
  user actually consented to. No "always failing" tools.
- **POS-002:** Tenants that downgrade `ReadWrite` to `Read` get
  the read tools and lose the mutation tools — exactly the
  intended behaviour, with no per-tenant configuration in
  pimdo-ts itself.
- **POS-003:** Adding a new tool is a one-line
  `requiredScopes: [...]` declaration. No registry rewiring.
- **POS-004:** The "scope required" hint in instructions text
  gives the agent a meaningful next step ("ask the user to log
  in again with X scope") instead of a generic 401.
- **POS-005:** Scope gating is independent of (and composes
  with) the browser-confirm policy (ADR-0014). A tool needs
  both the scope **and** the human click before it can mutate
  state.

### Negative

- **NEG-001:** The agent has to handle the tool list changing
  mid-session — it must call `tools/list` after auth state
  changes. The MCP `sendToolListChanged` notification is the
  protocol mechanism for this; not all hosts ack it
  identically.
- **NEG-002:** DNF can hide intent if a reader scans only the first
  alternative. We mitigate this in two ways: `formatRequiredScopes`
  renders the full structure with explicit `AND`/`OR` operators in
  `buildInstructions`, and the per-tool descriptor literal makes the
  shape visible at the declaration site (`[[X], [Y]]` for OR vs.
  `[[X, Y]]` for AND).
- **NEG-003:** Granted-scope tracking lives on the
  authenticator. Tests must populate it (or use
  `StaticAuthenticator`) for tool tests to enable the path
  under test.
- **NEG-004:** A future "per-resource auth state" (e.g. token
  expired only for ARM) needs more granular tracking than the
  current "merged set of granted scopes" model. Today acceptable
  because token lifetime is uniform within an MSAL session.

## Alternatives Considered

### Always Register Every Tool, Fail at Call-Time

- **ALT-001:** Register all 24 tools unconditionally; let the
  Graph / ARM clients return 401 / `consent_required` for
  ungranted scopes.
- **ALT-002:** **Rejection:** Bad agent UX (the agent will
  retry, hallucinate workarounds, or surface the failure to
  the user as an unrecoverable error). Misses the chance to
  signal "this would work after another scope is granted".

### Build Tool List From Granted Scopes Only at Server Start

- **ALT-003:** No `enable()` / `disable()`; just register the
  tools that match the start-time scope set.
- **ALT-004:** **Rejection:** Login mid-session would not
  surface new tools; the user would have to restart the MCP
  client. The dynamic-update path is the one that delivers
  the user value.

### Per-Tool Scope as a Flat List ("ANY of granted")

- **ALT-007:** Earlier iteration: `requiredScopes: OAuthScope[]`
  enabled whenever any element was granted.
- **ALT-008:** **Rejection:** Could not express "needs all of
  these" — multi-scope mutation tools (`pim_*_request`,
  `pim_*_deactivate`) became visible after consenting to a single
  scope and would always 401 at call time. Tightening to "ALL"
  was equally wrong because it broke the `Read`/`ReadWrite`
  substitutability for read tools after a tenant downgrade. DNF
  is the smallest shape that handles both.

### Per-Tool Scope as a String, No Enum

- **ALT-005:** Just put the OAuth scope literal on the
  descriptor.
- **ALT-006:** **Rejection:** Loses type safety; a typo in a
  scope literal silently disables the tool forever. The
  `OAuthScope` enum (ADR-0001 §1) is the single source of
  truth for valid scopes.

## Implementation Notes

- **IMP-001:** `syncToolState` is the single entry point for
  enable/disable. Tool code never calls `enable()` /
  `disable()` directly.
- **IMP-002:** The composition root (`createMcpServer` in
  `src/index.ts`) wires `config.onScopesChanged` to
  `syncToolState`. The login / logout tools call
  `onScopesChanged` after a successful state transition.
- **IMP-003:** `MsalAuthenticator.cachedScopes` is the merged
  set across resources (Graph + ARM probe results). It is
  rebuilt on login and extended by silent probes; never
  shrunk except by logout.
- **IMP-004:** Tests use `StaticAuthenticator` to inject a
  fixed scope set. See `test/tools/*.test.ts` for the pattern.
- **IMP-005:** When adding a new tool, declare the minimum
  `requiredScopes` that match the operation. For read paths
  that Microsoft accepts under either `Read` or `ReadWrite`,
  list them as **two separate alternatives**
  (`[[Read.Directory], [ReadWrite.Directory]]`) — the agent
  should not lose access just because the tenant downgraded.
  For mutation paths whose handler calls multiple endpoints
  with distinct scopes, list every needed scope **inside one
  alternative** (`[[A, B, C]]`) so the tool stays hidden until
  all of them are granted.

## References

- **REF-001:** ADR-0001 — Minimize Blast Radius (the rationale
  for scoped permissions).
- **REF-002:** ADR-0007 — Tool Descriptor Pattern (the
  one-tool-one-file structure that makes
  `requiredScopes` per-descriptor cheap).
- **REF-003:** ADR-0013 — Two-Resource Auth (the merging of
  Graph + ARM scopes into a single granted set).
- **REF-004:** ADR-0014 — Confirm-in-Browser Policy (the
  orthogonal control on privilege-changing tools).
- **REF-005:** [MCP `tools/list_changed` notification](https://modelcontextprotocol.io).
- **REF-006:** `src/tool-registry.ts` (`syncToolState`,
  `buildInstructions`, `formatRequiredScopes`),
  `src/index.ts` (`createMcpServer`),
  `src/scopes.ts` (`OAuthScope`).
