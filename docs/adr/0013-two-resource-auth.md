---
title: "ADR-0013: Two-Resource Auth — Single MSAL Login, `tokenForResource(Graph|Arm)`"
status: "Accepted"
date: "2026-05-09"
authors: "co-native-ab"
tags: ["architecture", "auth", "msal", "graph", "azure-rm"]
supersedes: ""
superseded_by: ""
---

# ADR-0013: Two-Resource Auth — Single MSAL Login, `tokenForResource(Graph|Arm)`

## Status

**Accepted**

## Context

pimdo-ts targets two distinct Microsoft REST surfaces:

- **Microsoft Graph** (`https://graph.microsoft.com`) — Entra Groups
  via `/identityGovernance/privilegedAccess/group/*` and Entra
  (directory) roles via `/roleManagement/directory/*`.
- **Azure Resource Manager**
  (`https://management.azure.com`) — Azure RBAC PIM via
  `/providers/Microsoft.Authorization/role*`.

Each resource is a distinct OAuth audience and requires its own
access token. There is no single token that works against both.
Microsoft's PIM functionality straddles the two: the Entra-side
role and group surfaces live in Graph, the Azure-resource-role
surfaces live in ARM, and a real PIM workflow ("activate Owner on
this subscription") routinely needs both.

The naive options are unattractive:

- **One MSAL `PublicClientApplication`, manual `acquireTokenSilent`
  with the right scope per call site** — leaks audience selection
  into every tool handler.
- **Two MSAL instances, one per resource** — doubles the cache
  files, doubles the login prompt, and forces the user to consent
  twice even though MSAL refresh tokens cross audiences (verified
  in practice: after a Graph login, `acquireTokenSilent` for ARM
  succeeds without re-prompting).
- **Static credentials per resource** — incompatible with the
  browser-only login policy in ADR-0003.

The codebase already has a `TokenCredential`-style abstraction in
`src/graph/client.ts` (mirroring Azure SDKs' `azidentity` /
`Azure.Identity`). The right shape is for that abstraction to
include the resource it wants a token for, and for the
authenticator to satisfy each.

## Decision

The `Authenticator` interface (in `src/auth.ts`) exposes a single
canonical token method:

```ts
tokenForResource(resource: Resource, signal: AbortSignal): Promise<string>
```

Where `Resource` is the enum `{ Graph = "graph", Arm = "arm" }`
defined in `src/scopes.ts`. A convenience method `token(signal)` is
preserved as a thin alias for `tokenForResource(Resource.Graph,
signal)`; new call sites should prefer the explicit form.

Each scope is tagged with the resource it targets via
`resourceForScope(scope: GraphScope): Resource`. The single ARM
scope today is the `https://management.azure.com/user_impersonation`
constant; everything else maps to `Resource.Graph`.

`MsalAuthenticator` runs **one** MSAL `PublicClientApplication`
backed by **one** file cache (`<configDir>/msal_cache.json`,
ADR-0001 §6). Login is interactive against Graph only; ARM and any
future audiences are reached via silent refresh on demand. The
`probeAdditionalResources(signal)` helper runs a silent
`acquireTokenSilent` for each non-Graph resource immediately after
login so that ARM-gated tools become visible without a second user
prompt.

The composition root constructs **one HTTP client per resource**
(`src/index.ts`):

```ts
const graphClient = new GraphClient(opts.graphBaseUrl, {
  getToken: (s) => opts.authenticator.tokenForResource(Resource.Graph, s),
});
const armClient = new ArmClient(opts.armBaseUrl, {
  getToken: (s) => opts.authenticator.tokenForResource(Resource.Arm, s),
});
```

A third client targets the Graph **beta** channel
(`graphBetaBaseUrl`), used by the small set of PIM features only
available there (the Entra-role assignment-approvals surface). It
shares the Graph token credential — beta and v1.0 are the same
resource, only different paths.

## Consequences

### Positive

- **POS-001:** Tool handlers never see audience selection. They
  call `config.graphClient.request(...)` or
  `config.armClient.request(...)` and the right token is acquired.
- **POS-002:** Single login, single cache file, single account.
  Adding a third resource (e.g. Microsoft Entitlement Management
  surface or Entra ID Beta endpoints with their own audience) is a
  one-line `Resource` enum addition + a probe entry.
- **POS-003:** Scope gating composes naturally with two-resource
  auth: a tool that needs `ArmUserImpersonation` is disabled until
  the ARM probe succeeds, regardless of how the user signed in.
- **POS-004:** Failure isolation between resources. A revoked or
  unconsented ARM scope only disables ARM tools; Graph tools keep
  working.
- **POS-005:** Maps cleanly onto the rest of Microsoft's SDK
  family. `tokenForResource` is the shape `azidentity.TokenCredential`
  and `Azure.Core.TokenCredential` use; engineers familiar with
  those translate immediately.

### Negative

- **NEG-001:** A user who declines ARM consent at the silent probe
  does not see ARM-gated tools until the next interactive flow
  (today: `login` again). The trade-off is acceptable because ARM
  consent is a separate organizational decision in many tenants.
- **NEG-002:** Two HTTP clients to maintain. Both implement the
  same retry / `Accept-Language: en` / 401-detection logic
  side-by-side (see `src/graph/client.ts`, `src/arm/client.ts`).
  Consolidation is possible but deferred until a third resource
  arrives. ADR-0015 explains the dependency posture; this one
  documents the duplication explicitly so that consolidation is
  intentional rather than accidental.
- **NEG-003:** The probe-and-cache pattern means the granted-scopes
  set in `cachedScopes` is built up over multiple token responses
  rather than from a single login response. Tests must exercise
  the probe path.

## Alternatives Considered

### Two MSAL Clients, Two Cache Files

- **ALT-001:** One `PublicClientApplication` for Graph, one for
  ARM, each with its own cache.
- **ALT-002:** **Rejection:** MSAL's refresh token is per-account,
  not per-application instance, but two instances cannot share a
  cache without external coordination. The user would be prompted
  twice for accounts that have already consented.

### Per-Tool Token Method on Authenticator

- **ALT-003:** Authenticator exposes `tokenForGraph(signal)`,
  `tokenForArm(signal)`, etc.
- **ALT-004:** **Rejection:** Doesn't compose. Adding a fourth
  resource requires a new method on the interface, plus
  per-method updates in every test double.

### Wrap MSAL in a Per-Resource Class Hierarchy

- **ALT-005:** `class GraphMsalAuthenticator`, `class
ArmMsalAuthenticator`.
- **ALT-006:** **Rejection:** Same single-login-prompt requirement
  as the previous option, plus a deeper class hierarchy in
  `src/auth.ts` for no expressive benefit.

## Implementation Notes

- **IMP-001:** `Resource` enum + `resourceForScope` /
  `scopesForResource` helpers live in `src/scopes.ts`. The single
  source of truth for "which scope targets which audience".
- **IMP-002:** `RESOURCE_PROBE_SCOPES` in `src/auth.ts` lists the
  minimal scope per resource that proves the resource is reachable
  (`User.Read` for Graph, `user_impersonation` for ARM). The probe
  reads the full set of consented scopes off the token response
  and merges into `cachedScopes`.
- **IMP-003:** Both `GraphClient` and `ArmClient` accept a
  `TokenCredential` interface (`{ getToken(signal): Promise<string> }`).
  The composition root passes lambdas that call
  `tokenForResource(...)`. Tests inject static-token credentials
  directly.
- **IMP-004:** Probe failures are intentionally swallowed and
  logged at debug level. `AuthenticationRequiredError` from the
  probe means "user has not consented to this resource yet" and
  the corresponding tools simply stay disabled.
- **IMP-005:** When adding a third resource, update: `Resource`
  enum + `resourceForScope` (`scopes.ts`), `RESOURCE_PROBE_SCOPES`
  (`auth.ts`), one new HTTP client, and the composition root.

## References

- **REF-001:** [MSAL Node — silent token acquisition across
  audiences](https://learn.microsoft.com/en-us/entra/msal/node/initialization-of-public-client-application).
- **REF-002:** [Microsoft Graph — endpoints](https://learn.microsoft.com/en-us/graph/use-the-api).
- **REF-003:** [Azure Resource Manager — REST API authentication](https://learn.microsoft.com/en-us/rest/api/azure/).
- **REF-004:** ADR-0001 — Minimize Blast Radius (this ADR
  realises the "delegated, scoped" half).
- **REF-005:** ADR-0003 — Browser-Only Authentication (this ADR's
  login path is the one specified there).
- **REF-006:** `src/auth.ts`, `src/scopes.ts`, `src/graph/client.ts`,
  `src/arm/client.ts`, `src/index.ts`.
