---
title: "ADR-0018: Conditional Access Step-Up via AI-Orchestrated Login"
status: "Accepted"
date: "2026-05-14"
authors: "co-native-ab"
tags: ["architecture", "auth", "mcp", "tools", "http"]
supersedes: ""
superseded_by: ""
---

# ADR-0018: Conditional Access Step-Up via AI-Orchestrated Login

## Status

**Accepted**

## Context

Some PIM activations are gated by Microsoft Entra Conditional Access
"authentication context" rules — typically `acrs=c1` for MFA, but
also compliant-device, hybrid-join, sign-in risk, and similar
policies. When the user's current access token does not satisfy the
required `acrs`, Microsoft Graph and Azure Resource Manager reject
the call and embed a **claims challenge** describing what step-up is
needed.

Two real-world shapes occur:

1. **Standard CAE / OAuth bearer challenge** — `WWW-Authenticate:
Bearer ..., claims="<base64url(JSON)>"` on a 401.
2. **PIM body fragment** — HTTP 400 `RoleAssignmentRequestAcrs-
ValidationFailed` whose `error.message` contains
   `&claims=<URL-encoded JSON>`.

Recovery requires re-authenticating with the **`claims` parameter**
passed through MSAL into `acquireTokenInteractive`, so AAD prompts
the user to satisfy whatever factor is missing. A plain `login`
re-run does **not** work — the requested scopes alone don't carry the
claim.

Equivalent native clients (Azure Portal, `az login --claims-
challenge`, pimctl) all detect the challenge, step up via the
browser, and either auto-retry the original call once or prompt the
user to retry. We needed an analogous flow that fits the MCP server
shape.

## Decision

**Detect at the HTTP transport boundary; recover via the AI
assistant calling the existing `login` tool with a new optional
`claims` parameter.**

Concretely:

1. A pure parser, `extractClaimsChallenge({ headers, body, message })`
   in `src/http/claims-challenge.ts`, recognises both shapes and
   returns the JSON challenge string (or `null`).
2. `BaseHttpClient.performRequest` calls the parser inside the
   existing `response.status >= 400` branch — the same place we
   already inspect headers, parse the error envelope, and build a
   `RequestError`. When a challenge is present, we throw
   `StepUpRequiredError` (a `RequestError` subclass) instead of the
   generic error. The transport gains no retry, no plugin hook, no
   knowledge of MSAL.
3. `Authenticator.login` accepts an optional `{ claims, loginHint }`.
   `MsalAuthenticator` passes both through to `acquireToken-
Interactive`. When `claims` is set we default `loginHint` to the
   cached account's `username` (so AAD skips the account picker and
   prompts the right account for MFA) and switch the MSAL `prompt`
   from `select_account` to `login`.
4. The `login` MCP tool exposes both options. `StepUpRequiredError`'s
   message embeds the literal claims JSON so the AI can copy it
   straight into the next `login({ claims })` call, then re-invoke
   the original PIM tool.

The `tool-registry.ts` instruction text primes the AI for this
recovery flow.

## Alternatives considered

### A. Auto-retry inside `BaseHttpClient`

Detect the challenge, call back into the authenticator with the
claims, mint a new token, replay the request once. This is what az
CLI and pimctl do internally.

Rejected because:

- The HTTP transport would have to know about the authenticator
  (today it only receives `tokenForResource` as a closure). Adding a
  `loginWithClaims` capability to the transport tightly couples two
  layers we deliberately keep separate (ADR-0013).
- The user would be silently dropped into a browser flow mid-tool-
  call, with no chance to confirm or read the challenge. That fights
  the project-wide "human always confirms in the browser" stance
  (ADR-0014).
- Failures (browser timeout, declined MFA, wrong account) become
  hard to surface — the AI sees only the post-retry error, not the
  original challenge.

### B. A separate `step_up` MCP tool

Have `pim_step_up` with a required `claims` argument, distinct from
`login`. Rejected to minimise the tool surface and because step-up
_is_ a login — the same browser flow, the same MSAL primitive, the
same end state (a fresh token). Folding it into `login` keeps tool
count flat and matches how `az login --claims-challenge` works.

### C. Plugin/hook on `BaseHttpClient`

A `onChallenge` plugin hook the auth layer could register. Rejected
as over-engineering: there's exactly one consumer, the coupling
problem from (A) is unchanged, and the AI-orchestrated path is
simpler to reason about, log, and explain to users.

## Consequences

### Positive

- Transport stays a pure status → typed-error pipeline.
- The human is in the loop on every step-up (browser confirmation),
  matching every other privilege-changing operation in pimdo.
- The AI assistant can explain _why_ the browser is opening
  ("activating `team-owner-cactx` requires MFA") because the
  challenge JSON is in the error message it just received.
- One-call recovery: `login({ claims })` then re-invoke the original
  tool. No state machines, no session cookies, no tool fan-out.
- Works identically for Graph and ARM — the parser handles both
  shapes and the base client is shared.

### Negative

- The AI must be primed to recognise `StepUpRequiredError` and react
  correctly. Mitigated by the registry instruction text and by
  embedding the literal claims JSON in the error message.
- One extra LLM round-trip on a step-up vs a silent auto-retry. In
  practice this is dwarfed by the browser MFA prompt that follows.
- Static-token mode (`StaticAuthenticator`) cannot satisfy step-up.
  The AI's `login({ claims })` call is accepted but is a no-op; the
  next PIM call surfaces the same `StepUpRequiredError`. Acceptable
  — static tokens are a developer convenience, not a production
  path.

### Neutral

- The `claims` payload may include tenant/user identifiers. We log
  detection at info level without the payload; the payload only
  reaches MSAL.
