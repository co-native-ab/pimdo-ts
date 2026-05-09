---
title: "ADR-0015: Dependency Minimisation — Hand-Rolled Graph and ARM Clients"
status: "Accepted"
date: "2026-05-09"
authors: "co-native-ab"
tags: ["architecture", "dependencies", "supply-chain", "http", "graph", "azure-rm"]
supersedes: ""
superseded_by: ""
---

# ADR-0015: Dependency Minimisation — Hand-Rolled Graph and ARM Clients

## Status

**Accepted**

## Context

pimdo-ts ships as an MCPB bundle with **four** runtime dependencies:
`@modelcontextprotocol/sdk`, `zod`, `@azure/msal-node`, and `open`
(ADR-0011). It runs on Node ≥ 22, in users' shells, holding
delegated tokens that can elevate them to Global Administrator. The
trust model is: every line of code that runs in this process is
auditable. Every dependency is a supply-chain target.

The HTTP surface needed by the tool handlers is small:

- Bearer-authenticated GET / POST / PUT / PATCH / DELETE
  against Microsoft Graph (`v1.0` and `beta`).
- Bearer-authenticated GET / POST / PUT / DELETE against ARM
  with the `api-version` query parameter conventions.
- Retry on 429 / 5xx with `Retry-After` / exponential backoff.
- Graceful 401 → `AuthenticationRequiredError` → silent refresh.
- Zod-validated response parsing for typed tool output.

Microsoft publishes SDKs for both surfaces:

- `@microsoft/microsoft-graph-client` for Graph.
- `@azure/arm-authorization` (and the rest of the
  `@azure/arm-*` family) for ARM.

Both pull in large transitive trees: `@azure/core-rest-pipeline`,
`@azure/core-auth`, `@azure/core-tracing`, `@azure/identity`
adapters, polyfills, etc. Even minimal usage adds tens of
megabytes of node_modules and dozens of supply-chain edges.

The MSAL dependency is unavoidable (we are an OAuth client; we
need the public-client / MSAL-cache abstractions). The MCP SDK is
the protocol implementation. `zod` is used for both tool input
schemas (single source of truth, ADR-0007) and API response
validation. `open` replaced our hand-rolled cross-platform browser
launcher (ADR-0011) with a well-maintained dependency.

Everything else is in scope for "hand-roll, audit, ship".

## Decision

pimdo-ts maintains a **hand-rolled HTTP client per resource**:

- `GraphClient` (`src/graph/client.ts`, ~314 lines).
- `ArmClient` (`src/arm/client.ts`, ~294 lines).

Both clients:

1. Take a `TokenCredential` (`{ getToken(signal): Promise<string> }`)
   instead of binding to a specific authenticator. This is the
   shape Microsoft's SDKs use; it lets us inject static-token
   credentials in tests and the real authenticator in production.
2. Wrap `fetch` (Node's undici implementation) directly — no
   pipeline / interceptor / handler stack. Headers are computed
   per request; bodies are JSON-stringified for the typed paths
   and passed raw for the small number of upload paths.
3. Implement retry with `Retry-After` parsing and exponential
   backoff for 429 / 5xx (`retryableStatusCodes`).
4. Pin `Accept-Language: en` on every request (Node undici
   defaults it to `*`, which Graph PIM endpoints reject with
   `CultureNotFoundException`).
5. Surface domain-specific error classes (`GraphRequestError`,
   `GraphResponseParseError`, `ArmRequestError`, …) so tool
   handlers can format meaningful failures for the agent.
6. Forward the caller's `AbortSignal` and combine it with a
   per-request timeout via `AbortSignal.any([signal,
AbortSignal.timeout(timeoutMs)])`. Cancellation propagates
   into `fetch`.

Adding a new HTTP dependency requires a deliberate Yes — see the
"Alternatives" section below for the bar.

## Consequences

### Positive

- **POS-001:** Small, auditable runtime. Four dependencies + their
  transitive trees are a tractable manual review on every release.
- **POS-002:** Each client is roughly 300 lines and reads
  top-to-bottom. Debugging a Graph error means reading
  `src/graph/client.ts`, not chasing through pipeline policies.
- **POS-003:** Behaviour is exactly what we need and nothing more.
  No surprising telemetry, no transparent token refresh racing
  our explicit one, no library-version regressions on edge cases.
- **POS-004:** Tests inject the credential directly. No "global
  registry" or "default pipeline" hidden state.
- **POS-005:** Bundle size stays small. The `dist/index.js`
  produced by `build.mjs` is dominated by MSAL and the MCP SDK,
  not by HTTP client overhead.

### Negative

- **NEG-001:** Both clients have near-duplicate retry / header /
  timeout / error-formatting code. ~200 lines overlap between
  `src/graph/client.ts` and `src/arm/client.ts`. A future ADR
  may extract a shared `BaseClient`; the current duplication is
  intentional (two stable surfaces, low edit frequency).
- **NEG-002:** We carry the maintenance burden of HTTP correctness:
  `Retry-After` parsing (seconds vs. HTTP-date), 5xx handling,
  Bearer header construction, query-string encoding for ARM's
  `api-version`, and so on. Each is small individually, in
  aggregate non-trivial.
- **NEG-003:** New surfaces (e.g. Microsoft Entitlement
  Management) require either a third client or a base extraction
  before the third client is added.
- **NEG-004:** We do not get telemetry, distributed tracing, or
  pipeline-style retry policies for free. Today this is a
  feature; in some deployment models (e.g. a hosted version with
  observability requirements) it would be a gap.

## Alternatives Considered

### Use `@microsoft/microsoft-graph-client` and `@azure/arm-authorization`

- **ALT-001:** Drop both hand-rolled clients in favour of the
  vendor SDKs.
- **ALT-002:** **Rejection:** Pulls in the `@azure/core-*` family
  (rest-pipeline, auth, tracing) plus per-service typings. Much
  larger supply-chain footprint, less audit-friendly. The PIM
  surfaces we use are also not always first-class in those SDKs
  (PIM endpoints are spread across Graph identity governance and
  ARM authorization, often via long URL paths the SDKs do not
  generate well-typed clients for).

### Use a Lightweight Third-Party HTTP Client (`axios`, `got`, `ky`)

- **ALT-003:** Replace the hand-rolled `fetch` wrapper with a
  small dependency.
- **ALT-004:** **Rejection:** None of `axios` / `got` / `ky`
  reduces the auth/retry/zod-parse code we wrote. They would
  replace ~30 lines of `fetch` boilerplate at the cost of
  another dependency. Net negative.

### Consolidate Now Into a Shared `BaseClient`

- **ALT-005:** Extract the retry / header / timeout / error
  shaping into a shared module today.
- **ALT-006:** **Deferred, not rejected.** With only two clients
  the abstraction overhead currently exceeds the duplication.
  When (or if) a third client lands, extracting the common
  surface is a one-PR refactor and is the moment when the
  abstraction earns its keep.

## Implementation Notes

- **IMP-001:** The `TokenCredential` interface is duplicated in
  `src/graph/client.ts` and `src/arm/client.ts`. Both have the
  identical shape `{ getToken(signal): Promise<string> }`. This
  is a deliberate copy — the file-level boundary is part of the
  point.
- **IMP-002:** Add new dependencies only after a written
  justification on the PR: why is this strictly needed, what
  does it add transitively, what's the alternative cost
  estimate, who maintains it. The current set was each justified
  in this way.
- **IMP-003:** When adding a new endpoint to either client, mirror
  the existing patterns — typed `parseResponse(...)` with a Zod
  schema for the response, `GraphRequestError` /
  `ArmRequestError` for HTTP errors, abort-signal forwarding for
  cancellation.
- **IMP-004:** `gh-advisory-database` checks run against
  `package.json` on PRs. New deps must be CVE-clean at the
  proposed version.
- **IMP-005:** The MCPB bundling step (`scripts/bundle-mcpb.mjs`)
  inlines runtime dependencies. The build size is monitored as
  part of release; any spike on a dep bump is a flag.

## References

- **REF-001:** ADR-0001 — Minimize Blast Radius (the rationale).
- **REF-002:** ADR-0011 — Delegate Browser Launch to `open`
  (the existing precedent for adding a dependency only when the
  bar is met).
- **REF-003:** [Node `fetch` (undici)](https://nodejs.org/api/globals.html#fetch).
- **REF-004:** [`AbortSignal.any`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static).
- **REF-005:** `src/graph/client.ts`, `src/arm/client.ts`,
  `package.json` (runtime dependency list).
