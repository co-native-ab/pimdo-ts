---
title: "ADR-0019: Bounded Pagination for Graph and ARM List Endpoints"
status: "Accepted"
date: "2026-05-20"
authors: "co-native-ab"
tags: ["architecture", "http", "tools", "pim"]
supersedes: ""
superseded_by: ""
---

# ADR-0019: Bounded Pagination for Graph and ARM List Endpoints

## Status

**Accepted**

## Context

PIM list tools were silently capped at the server-side default page
size (≈50 items for Microsoft Graph PIM endpoints, server-determined
for Azure Resource Manager). The symptom was a tenant with >50 PIM
group eligibilities returning only the first 50 from
`pim_group_eligible_list`, with no warning. Approver-side and
request-history tools had the same blind spot.

Root cause: the Graph list helpers in
`src/features/{group,role-entra}/client.ts` did a single
`client.request` plus `parsed.value`, the response schema
(`collectionSchema` in `src/graph/types.ts`) didn't even include
`@odata.nextLink`, and the fake Graph server never returned a
continuation. The ARM client did follow `nextLink` correctly but had
no bound and no truncation signal, so a misconfigured filter could
issue unbounded requests in the background.

Microsoft documents two paging contracts:

| Surface | Page-size param | Continuation | Default | Max |
|---|---|---|---|---|
| Microsoft Graph (v1.0 + beta) | `$top` | `@odata.nextLink` (absolute, opaque) | varies (~100) | 999 |
| ARM (`Microsoft.Authorization/2020-10-01`) | `$top` (initial only) | `nextLink` (absolute, opaque, `$skiptoken`-bearing) | server-determined | — |

For both surfaces, `$top` is sent **only on the initial request**.
Continuation URLs are followed verbatim — re-adding `$top` (or
`$skip`/`$skiptoken`) to a follow-up call is a client bug.

## Decision

Introduce a single bounded paginator primitive
(`src/http/paging.ts`) used by **every** list helper across Graph and
ARM:

```ts
interface PageOptions  { pageSize?: number; maxPages?: number }
interface PagedResult<T> { items: T[]; truncated: boolean; pagesFetched: number }
```

- `paginateGraph` and `paginateArm` share the same shape. They inject
  `$top` on the initial path only, follow the surface-specific
  continuation field (`@odata.nextLink` or `nextLink`), and stop at
  `maxPages`.
- All list client helpers return `PagedResult<T>` instead of bare
  `T[]`. Truncation is a **signal, not a throw** — callers decide
  whether to retry with a higher cap.
- Defaults: `pageSize=100`, `maxPages=10` (1 000 items per list).
  Bounds: `pageSize` 1–999, `maxPages` 1–100. Both are surfaced as
  Zod-validated tool inputs (`pageSize`, `maxPages`) on every
  `pim_*_list` tool.
- Tools append a `truncationWarning(result)` line to their output
  when `truncated === true`, telling the AI assistant to re-run with
  a higher `maxPages` or a narrower filter.
- Policy lookups (`getGroupMaxDuration`,
  `getDirectoryRoleMaxDuration`, `getAzureRoleMaxDuration`) also go
  through the paginator even though their filters select a single
  assignment. Uniformity > one-off short-cut: it removes a footgun
  if filter semantics ever loosen.

Mutation factory tools (`request`, `deactivate`, `request-cancel`,
`approval-review`) still consume `T[]` from list helpers via
`.then(r => r.items)`. The human picks rows in the browser flow, so
silently dropping the truncation signal in those paths is acceptable
— and saves a wider refactor of the factory signatures.

## Mock fidelity

`test/mock-paging.ts` paginates fixtures at a 50-item default
(matching Graph's real default), honors `$top`, returns correct
continuation tokens, and **rejects** continuations that re-include
`$top` with HTTP 400. The 13 tests in `test/http/pagination.test.ts`
seed 250 items per surface and assert: full traversal succeeds, the
cap produces `truncated=true`, and the client never re-sends `$top`
on a follow-up.

## Consequences

- AI assistants now see truncation as a structured warning instead
  of silently missing data.
- All list tools accept `pageSize` / `maxPages` for ad-hoc tuning
  against large tenants.
- One paginator primitive means one place to fix paging bugs.
- 50% of PIM tools (the 12 list endpoints) widened their tool input
  schema. JSON Schemas under `schemas/tools/` regenerate
  deterministically from the Zod source.

## Open items

The `?$expand=stages` (group / ARM) and `?$expand=steps` (entra
beta) approval-detail GETs are treated as single-page. We could not
find authoritative documentation about whether the expanded
collection paginates when an approval carries an unusually large
number of stages. In practice PIM approvals have 1–2 stages, so we
leave a `TODO` comment near each `$expand=…` GET and have not
paginated those paths. If a real-world tenant ever surfaces an
approval with truncated stages we will revisit.
