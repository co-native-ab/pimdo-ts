---
title: "ADR-0016: Defence-in-Depth Input Allow-Listing"
status: "Accepted"
date: "2026-05-09"
authors: "co-native-ab"
tags: ["architecture", "security", "validation", "supply-chain"]
supersedes: ""
superseded_by: ""
---

# ADR-0016: Defence-in-Depth Input Allow-Listing

## Status

**Accepted**

## Context

pimdo-ts holds delegated tokens that can elevate the user to Global
Administrator and ARM subscription Owner. Many of the inputs that
shape outbound HTTP requests, OAuth authority URLs, or local
loopback origins are operator-controlled (env vars, persisted
config, or values supplied to the constructor in tests):

| Input                  | Source       | Splatted into                    |
| ---------------------- | ------------ | -------------------------------- |
| `PIMDO_GRAPH_URL`      | env var      | every Graph URL                  |
| `PIMDO_GRAPH_BETA_URL` | env var      | every Graph beta URL             |
| `PIMDO_ARM_URL`        | env var      | every ARM URL                    |
| `PIMDO_TENANT_ID`      | env var      | OAuth authority URL              |
| `PIMDO_CLIENT_ID`      | env var      | OAuth authorize-URL query string |
| Loopback `Host` header | inbound HTTP | session validation               |
| Loopback `Origin`      | inbound HTTP | CSRF validation                  |
| Submitted JSON bodies  | inbound HTTP | tool execution                   |

A typo or hostile value in any of these can do real damage:
sending a Bearer token to `http://attacker.example.com`,
constructing an OAuth authority for a tenant the user does not
control, or accepting a CSRF-bypassing POST.

The OAuth permissions narrow which APIs the token addresses, but
they do not constrain _which host_ the token is sent to. Per
ADR-0001, defence-in-depth checks layered on top are required.

## Decision

pimdo-ts allow-lists every operator-controlled input that is later
splatted into a security-relevant string. Allow-listing is positive
("must match this regex / be in this set / parse as this URL with
these properties") and the failure mode is a thrown `Error` at
process startup (or `400 Bad Request` for inbound loopback
requests) — never silent normalization.

### URL allow-list — `validateApiBaseUrl`

`validateApiBaseUrl(envName, url)` (`src/index.ts`) is called once
at startup for each `PIMDO_*_URL`:

- Must parse as an absolute URL.
- `https://` allowed unconditionally.
- `http://` allowed **only** for `localhost` / `127.0.0.1` (test
  harness loopback).
- Any other scheme or any non-loopback `http://` host throws.

Rationale: the Graph and ARM clients send a delegated Bearer token
on every request. A misconfigured env var must never silently
exfiltrate that token to an arbitrary plaintext host.

### Tenant ID allow-list — `TENANT_ID_RE`

`MsalAuthenticator` constructor enforces a regex on `tenantId`:

- `common`, `consumers`, `organizations` — well-known aliases.
- A directory-tenant GUID (case-insensitive).
- `<name>.onmicrosoft.com` — tenant primary domain.

Anything else throws. The tenant ID is concatenated into the
authority URL `https://login.microsoftonline.com/<tenantId>`; a
malformed value would silently produce a broken URL.

### Client ID allow-list — `CLIENT_ID_RE`

`MsalAuthenticator` constructor enforces the GUID shape on
`clientId`. Defence-in-depth parity with the tenant check; the
client ID is splatted into MSAL's OAuth authorize-URL query
parameters and the same "fail fast" reasoning applies.

### Loopback request validation — `src/browser/security.ts`

Every inbound loopback request is validated before it is allowed
to mutate any flow state:

- **Origin / Host pinning.** The browser server binds to an
  explicit loopback host + port and rejects requests whose
  `Host` header differs from the bound origin.
- **`Sec-Fetch-Site` pinning.** Mutating verbs (`POST`)
  require `Sec-Fetch-Site: same-origin`.
- **CSRF token.** Each flow generates a per-flow CSRF token,
  embedded in the rendered HTML and required on every `POST`.
- **Content-Type pinning.** `POST /submit` and `POST /cancel`
  require `Content-Type: application/json` and a JSON body
  whose UTF-8 decoding is `<= MAX_BODY_BYTES`.
- **CSP nonce.** Each rendered page uses a per-request nonce
  passed into the template. No inline scripts execute without
  the matching nonce.

### Schema-validated tool inputs

Every MCP tool's `inputSchema` is a Zod schema (the single source
of truth, ADR-0007). Tool handlers receive validated args; MCP
input that does not match is rejected by the SDK before it
reaches the handler. Test coverage on each tool exercises the
malformed-input path.

### Schema-validated HTTP responses

Graph and ARM responses are parsed with `parseResponse(response,
schema)`. A malformed response throws `GraphResponseParseError` /
`ArmResponseParseError`, which surfaces as a tool error rather
than crashing the server. The defence here is symmetrical: trust
neither inbound nor outbound payload shape.

### Other places we layer

- `validateApiBaseUrl` is called for `graphBaseUrl`,
  `graphBetaBaseUrl`, `armBaseUrl` — three independent inputs,
  three independent checks.
- The browser `open.ts` shim re-validates the URL form before
  delegating to the `open` package (ADR-0011).
- File writes in `src/fs-options.ts` use atomic rename + `0o600`
  perms (`writeFileAtomic` / `writeJsonAtomic`) to prevent torn
  writes and over-permissive token cache files.

## Consequences

### Positive

- **POS-001:** A typo in `PIMDO_GRAPH_URL` produces a clear error
  at startup, not a silent token exfiltration.
- **POS-002:** A hostile value supplied via a copy-paste from
  documentation, support article, or LLM hallucination cannot
  reach MSAL or the HTTP clients.
- **POS-003:** Each allow-list is small and centralised
  (`src/index.ts`, `src/auth.ts`, `src/browser/security.ts`).
  Auditable in one read-through.
- **POS-004:** Failure modes are loud — exceptions / `400`s — not
  silent normalization. Easier to diagnose, harder to weaponise.
- **POS-005:** The same primitives generalise: when adding a new
  inbound input or env var, the convention is "find the nearest
  allow-list and extend it; do not invent a new shape".

### Negative

- **NEG-001:** Allow-lists need maintenance. If Microsoft
  introduces a new authority alias, `TENANT_ID_RE` needs an
  update. The trade-off is acceptable because Microsoft's
  authority forms change rarely and an out-of-date allow-list
  fails closed.
- **NEG-002:** Custom Entra deployments (e.g. clouds with
  different authority hosts: USGov, China) need additional
  configuration before pimdo accepts them. We accept this scope
  limitation today.
- **NEG-003:** The validation logic is itself code that can have
  bugs. We mitigate by colocating each check with the input it
  validates, plus per-check unit tests.

## Alternatives Considered

### Trust Operator-Supplied Values

- **ALT-001:** Pass env vars and config straight through to MSAL,
  the HTTP clients, and the loopback server.
- **ALT-002:** **Rejection:** Removes the only line of defence
  between a misconfigured (or hostile) env var and a Bearer token
  on the wire. Unacceptable for a tool that holds privileged
  delegated tokens.

### Block-Listing Instead of Allow-Listing

- **ALT-003:** Maintain a list of disallowed hosts / shapes /
  tenant patterns.
- **ALT-004:** **Rejection:** Block-lists fail open — any value
  not on the list is allowed. The threat surface is too broad to
  enumerate. Allow-listing fails closed.

### Schema-Only Validation (No Allow-Lists)

- **ALT-005:** Rely solely on Zod input schemas and Microsoft's
  own API rejection.
- **ALT-006:** **Rejection:** Zod validates _shape_, not
  _semantics_. A URL of shape `string().url()` still allows
  `http://attacker.com` — which Microsoft's API would never see
  but which we would happily POST our token to.

## Implementation Notes

- **IMP-001:** Allow-list code lives next to the consumer. The
  `validateApiBaseUrl` function is in `src/index.ts` (called
  from `main()`). The `TENANT_ID_RE` / `CLIENT_ID_RE` regexes are
  in `src/auth.ts` and enforced in the `MsalAuthenticator`
  constructor.
- **IMP-002:** Loopback hardening is centralised in
  `src/browser/security.ts` and consumed by every flow via
  `src/browser/server.ts`. Per-flow code never re-implements
  CSRF, CSP, or header pinning.
- **IMP-003:** Each allow-list has a unit test covering the
  positive (accepted) and negative (rejected) cases. See
  `test/index.test.ts`, `test/auth.test.ts`,
  `test/browser/security.test.ts`.
- **IMP-004:** When adding a new env var or operator-controlled
  input, the PR description must answer: what shape is allowed,
  where is the check, what error is thrown.
- **IMP-005:** Logging redaction policy: query strings are
  trimmed before they hit `logger.debug` because PIM URLs embed
  user IDs / role-assignment GUIDs / `$filter` expressions. See
  `src/graph/client.ts:performRequest` for the canonical pattern.

## References

- **REF-001:** ADR-0001 — Minimize Blast Radius (the umbrella
  rationale).
- **REF-002:** ADR-0008 — Browser Flow Pattern (the loopback
  hardening this ADR builds on).
- **REF-003:** [OWASP — Open Redirect / SSRF prevention](https://owasp.org).
- **REF-004:** [Microsoft authority URL forms](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc).
- **REF-005:** `src/index.ts` (`validateApiBaseUrl`),
  `src/auth.ts` (`TENANT_ID_RE`, `CLIENT_ID_RE`),
  `src/browser/security.ts`.
