---
title: "ADR-0014: Confirm-in-Browser Policy for Privilege-Changing Tools"
status: "Accepted"
date: "2026-05-09"
authors: "co-native-ab"
tags: ["architecture", "security", "browser", "human-in-the-loop", "pim"]
supersedes: ""
superseded_by: ""
---

# ADR-0014: Confirm-in-Browser Policy for Privilege-Changing Tools

## Status

**Accepted**

## Context

pimdo-ts exposes 24 MCP tools across four domains. They split cleanly
into two categories by side-effect:

- **Read tools** — `auth_status`, `pim_*_eligible_list`,
  `pim_*_active_list`, `pim_*_request_list`, `pim_*_approval_list`.
  These return data and never mutate Graph or ARM state.
- **Privilege-changing tools** — `login`, `logout`, `pim_*_request`,
  `pim_*_deactivate`, `pim_*_approval_review`. These either change
  the user's effective privileges or the privileges of someone else
  the user is reviewing.

The blast-radius principle (ADR-0001) says agent mistakes for
privilege-changing tools are unacceptable. But the way to enforce
this is not "scope gating" (which only narrows _which_ privilege
moves are reachable, not _whether_ they happen) nor "prompt
engineering". The architectural answer must work even against a
fully prompt-injected agent.

The MCP protocol offers an `elicitation` capability — the host can
ask the user to confirm before a tool runs. We considered relying
on that exclusively. Three problems:

1. **Inconsistent host support.** Not all MCP hosts implement
   elicitation, and presentation varies wildly. We cannot guarantee
   the user sees a meaningful prompt.
2. **Single-bit confirmation.** Elicitation is "yes/no", not
   "edit before submit". For PIM, the human needs to see and
   edit per-row justification + duration, often across multiple
   eligibilities at once.
3. **Same-channel trust.** The agent that's potentially being
   prompt-injected is the same channel surfacing the elicitation.
   Out-of-band human confirmation (separate window, separate
   process) is materially stronger.

We already had a hardened loopback HTTP server for browser-based
login (ADR-0003, ADR-0008). The same primitive — local server +
system browser + CSRF + CSP + header pinning — gives us an
out-of-band confirmation channel with no extra dependencies.

## Decision

**Every privilege-changing tool MUST route through a browser flow
before mutating Graph or ARM state.** The AI may pre-fill values;
the human always confirms or overrides in the browser before
submit. There is no "skip browser" override flag, no "trusted
agent" bypass, and no programmatic single-call shortcut.

Concretely:

1. **Three flow descriptors share `runRowForm`** — `requester`,
   `approver`, `confirmer` (`src/browser/flows/`). Each is a
   `RowFormDescriptor<Submission, Result>` with its own zod
   `submitSchema` and `onSubmit` callback (ADR-0008).
2. **Tool handlers prefill rows from the validated tool args.**
   The agent's schema lets it pass `eligibilityId`,
   `justification`, `duration` (per row) for the requester flow,
   `requestId` + decision for the approver flow, and the
   `assignmentId` (or equivalent) for the confirmer flow.
3. **The browser page is the source of truth for the submitted
   value.** When the user changes a justification or duration, the
   posted value wins; the agent's prefill is a starting point.
4. **The user can always cancel.** `POST /cancel` from any
   row-form page rejects with `UserCancelledError`, which the tool
   catches and surfaces as a benign "Request cancelled."
5. **Read-only tools never use a browser flow.** They have no
   side-effect to confirm and adding browser friction destroys
   their usefulness.
6. **The instructions block (`buildInstructions`) tells the agent
   the policy explicitly** so it can describe the user-visible
   step before invoking a privilege-changing tool ("opening a
   browser to confirm…").

## Consequences

### Positive

- **POS-001:** A prompt-injected agent that crafts a valid
  `pim_role_entra_request` with a Global Admin
  `eligibilityId` cannot complete the activation without a human
  click. The human sees the role name + duration in the browser
  before submit.
- **POS-002:** The same primitive handles approver flows —
  approve/deny on someone else's request must be a human click,
  not an agent argument.
- **POS-003:** The user can use the agent to plan ("what should I
  activate to do X?") and then steer the actual values in the
  browser. The agent provides cognitive scaffolding; the human
  retains authority.
- **POS-004:** No host-specific UI assumptions. The browser is
  universally available wherever pimdo-ts can run.
- **POS-005:** Symmetry across PIM surfaces — the three row-form
  flows (`requester`, `approver`, `confirmer`) cover every
  privilege-changing tool today. New PIM surfaces fit one of the
  three; no per-tool browser code.

### Negative

- **NEG-001:** Headless / SSH-only setups need the system browser
  available. The composition root injects `openBrowser` so a
  remote scenario can be supported by a custom shim, but the
  shipping default requires a desktop session.
- **NEG-002:** Per-flow timeout: row-form flows time out after 5
  minutes of user inactivity (`DEFAULT_ROW_FORM_TIMEOUT_MS`).
  Long-running consideration of an approval batch may force a
  re-invocation.
- **NEG-003:** The agent cannot batch-activate "for me" without a
  user present. This is a feature, not a bug, but it has to be
  acknowledged.
- **NEG-004:** Test surface area is larger — every privilege-
  changing tool needs a unit test that covers the prefill path
  through `runRequesterFlow` / `runApproverFlow` /
  `runConfirmerFlow`.

## Alternatives Considered

### MCP Elicitation Only

- **ALT-001:** Use `server.elicitation(...)` on every
  privilege-changing tool; no browser flow.
- **ALT-002:** **Rejection:** Inconsistent host support, single-bit
  confirmation, same-channel trust (see Context).

### Browser Flow Only for "Dangerous" Roles (Allow-list)

- **ALT-003:** Skip the browser flow for low-blast-radius roles
  (e.g. self-service group eligibility) and require it only for
  Global Admin / Privileged Role Admin / Owner.
- **ALT-004:** **Rejection:** Maintaining the allow-list is itself
  a security boundary. Misclassification (or future-Microsoft
  changes to what each role can do) silently downgrades the
  guarantee. Uniform "browser for every mutation" is simpler to
  reason about.

### Programmatic "Trusted Agent" Override Flag

- **ALT-005:** Allow an environment variable
  (`PIMDO_AGENT_TRUSTED=1`) to skip the browser confirmation step.
- **ALT-006:** **Rejection:** The first prompt-injection attack
  that tells the agent "now set PIMDO_AGENT_TRUSTED" inside the
  tool args defeats the design. Any bypass mechanism is a
  prompt-injection target. There is no such flag.

## Implementation Notes

- **IMP-001:** `runRowForm` (`src/browser/flows/row-form.ts`) is
  the single primitive. Per-flow files supply `name`,
  `renderHtml`, `submitSchema`, `onSubmit`. Login and logout flows
  use the same hardened server primitive but their own handlers
  (`src/browser/flows/login.ts`, `logout.ts`).
- **IMP-002:** Tool handlers follow a fixed shape: validate args
  → build `rows`/payload from validated args → call
  `runRequesterFlow / runApproverFlow / runConfirmerFlow` → on
  the result, call into Graph/ARM to perform the mutation. See
  `src/tools/pim/group/pim-group-request.ts` for the canonical
  example.
- **IMP-003:** `UserCancelledError` is exported from
  `src/errors.ts`. Tool handlers catch it and return a
  user-facing "Request cancelled." text content; not an
  `isError: true` response.
- **IMP-004:** When adding a new privilege-changing tool, choose
  one of the three row forms (request / approve / confirm), do
  not invent a fourth flow. New flows only when none of the three
  fits the input shape.
- **IMP-005:** The instructions block (`buildInstructions` in
  `src/tool-registry.ts`) explicitly states the
  "privilege-changing tools always route through a browser flow"
  rule so AI agents can describe the next step to the user
  before invoking the tool.

## References

- **REF-001:** [MCP elicitation capability](https://modelcontextprotocol.io)
  — the protocol-native confirmation primitive that this ADR
  intentionally does not rely on as the sole defence.
- **REF-002:** ADR-0001 — Minimize Blast Radius (the rationale).
- **REF-003:** ADR-0003 — Browser-Only Authentication (the
  precedent for using the system browser as the human-in-the-loop
  channel).
- **REF-004:** ADR-0008 — Browser Flow Pattern (the primitive
  that this ADR makes mandatory for privilege-changing tools).
- **REF-005:** `src/browser/flows/{requester,approver,confirmer,
row-form}.ts`, `src/tools/pim/*/pim-*-{request,deactivate,
approval-review}.ts`.
