---
title: "ADR-0001: Minimize Blast Radius for AI Agent Access"
status: "Accepted"
date: "2026-04-11"
authors: "co-native-ab"
tags: ["architecture", "security", "ai-agents", "pim", "microsoft-graph", "azure-rm"]
supersedes: ""
superseded_by: ""
---

# ADR-0001: Minimize Blast Radius for AI Agent Access

## Status

**Accepted**

> **Update (2026-05-09):** This ADR was originally written when pimdo-ts
> exposed Microsoft 365 mail / To Do tools. The product has since
> narrowed to **Microsoft Entra Privileged Identity Management** —
> Entra Groups, Entra (directory) roles, and Azure (resource) roles.
> The principles below are unchanged; the examples have been rewritten
> against the current PIM surface (24 tools across `auth`,
> `pim_group_*`, `pim_role_entra_*`, `pim_role_azure_*`).

## Context

pimdo-ts is a TypeScript MCP server that gives AI agents scoped access
to **Microsoft Entra PIM** — the just-in-time elevation system for
privileged access. The agent's job is to help a human elevate _their
own_ standing eligibilities into active assignments (and back again),
review approvals where the human is a reviewer, and read activation
policy. It targets two Microsoft resources from a single login:
Microsoft Graph (Entra Groups + directory roles) and Azure Resource
Manager (Azure RBAC role assignments).

PIM is, by design, the highest-stakes surface in an Entra tenant. A
mistake or prompt-injection attack carries far more damage potential
than the original mail/to-do scope did:

- Activating a Global Administrator or Privileged Role Administrator
  assignment for a longer duration than the user intended.
- Approving someone else's pending request without the user reading
  the justification.
- Activating an unintended Azure subscription Owner role and changing
  RBAC at a scope the user did not mean to touch.

Key forces at play:

- **Agent unpredictability.** AI agents may misinterpret instructions,
  hallucinate role IDs, or be manipulated by adversarial content in
  group descriptions, justifications, or tool outputs.
- **Two-resource breadth.** Graph + ARM together cover every
  privileged elevation path in Entra and Azure. Each new surface is a
  new escalation channel.
- **User trust.** Users need confidence that letting an agent help
  with PIM cannot quietly elevate them above what they intended, or
  approve changes for other people without their explicit click.
- **Organizational compliance.** Tenant administrators must be able
  to evaluate and approve the application's requested permissions
  and to see exactly which scopes are in play before consenting.
- **Usability vs. security.** Forcing the human to retype every
  argument removes the value of having an agent; granting the agent
  unattended privilege-changing power is unacceptable for PIM.

## Decision

pimdo-ts follows a **"minimize blast radius"** principle across all
design decisions. Every capability is evaluated through the lens of:
_what is the worst thing that could happen if the agent misuses this,
and how do we limit that?_

### 1. Scoped, Delegated, PIM-Only Permissions

Only delegated permissions are requested, scoped to the PIM-specific
Microsoft Graph + ARM resources the tools actually need. The agent
acts as the signed-in user; no application-level permissions are
used. Today's full scope set (`src/scopes.ts` `OAuthScope`):

- Graph base: `User.Read`, `offline_access`.
- Graph PIM Entra Groups: `PrivilegedEligibilitySchedule.Read.AzureADGroup`,
  `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup`,
  `RoleManagementPolicy.Read.AzureADGroup`.
- Graph PIM Entra Roles: `RoleEligibilitySchedule.Read.Directory`,
  `RoleAssignmentSchedule.ReadWrite.Directory`,
  `RoleManagementPolicy.Read.Directory`,
  `PrivilegedAccess.ReadWrite.AzureAD` (for the BETA approval surface).
- ARM PIM Azure Roles:
  `https://management.azure.com/user_impersonation` only.

There are no scopes for unrelated Graph surfaces (Mail, Files,
Calendar, Teams, …). pimdo applies a **single-variant policy** per
scope family — `Read` for read-only call sites, `ReadWrite` for any
family that includes a mutation — so the consent prompt shows the
true minimum permission set rather than a redundant Read+ReadWrite
pair. ADR-0017 documents the policy and the corresponding decision
not to silently fall back to a downgraded `Read` variant at runtime.

### 2. Privilege-Changing Tools Always Confirm in the Browser

Every tool that mutates an active PIM assignment, an eligibility, or
an approval routes through a local-loopback browser flow before it
talks to Graph or ARM. The AI may pre-fill values; the human always
confirms or overrides in the browser before submit. Today this
covers:

- `pim_group_request`, `pim_role_entra_request`,
  `pim_role_azure_request` — the **requester** flow.
- `pim_group_approval_review`, `pim_role_entra_approval_review`,
  `pim_role_azure_approval_review` — the **approver** flow.
- `pim_group_deactivate`, `pim_role_entra_deactivate`,
  `pim_role_azure_deactivate` — the **confirmer** flow.

The pattern (one local server primitive, three per-flow
descriptors) is described in ADR-0008. The policy that
privilege-changing tools must use a browser flow rather than a
silent argument schema is documented in ADR-0014.

### 3. Read-Only Tools Are Free of Browser Friction

`auth_status`, `pim_group_eligible_list`, `pim_group_active_list`,
`pim_group_request_list`, `pim_group_approval_list` and the matching
`pim_role_entra_*` / `pim_role_azure_*` list tools return data only.
They do not change PIM state, do not write to Graph or ARM, and do
not require a browser interaction — so the agent can use them freely
to plan an activation. Scope gating still applies: a list tool is
visible only when the corresponding scope (per the single-variant
policy in ADR-0017) was granted at login.

### 4. Login + Logout Are Always Browser-Driven

`login` and `logout` open the system browser via `src/browser/open.ts`
(ADR-0003, ADR-0008, ADR-0011). The agent cannot authenticate, change
the active account, or sign the user out without a human completing
the page. There is no device-code or static-credential fallback in
the shipped binary.

### 5. Defence-in-Depth Beyond What the Permissions Express

`Mail.Send` could theoretically be misused to send mail to anyone the
user can reach. PIM scopes have similar shape: `RoleAssignmentSchedule.
ReadWrite.Directory` is "manage role-assignment schedules" — it does
not constrain _which_ schedule. We layer additional checks on top
(see ADR-0016):

- `validateApiBaseUrl` rejects any `PIMDO_*_URL` that would send a
  Bearer token over plaintext to a non-loopback host.
- `MsalAuthenticator` validates `clientId` (GUID shape) and
  `tenantId` (`common` / `consumers` / `organizations` / GUID /
  `*.onmicrosoft.com`) before they reach MSAL.
- The loopback HTTP server pins `Host`, `Origin`, `Sec-Fetch-Site`,
  Content-Type, and uses a per-request CSP nonce + per-flow CSRF
  token (ADR-0008 §8, `src/browser/security.ts`).
- All PIM tool inputs are Zod-validated; the request tools accept an
  `eligibilityId` opaque string (returned by the matching list tool)
  rather than caller-shaped role / group / scope identifiers.

### 6. No Application Permissions, No Persisted Tokens Beyond MSAL

The Entra app registration requests no application-level permissions
and is multi-tenant only by audience selection. Tokens are persisted
through MSAL's cache plugin to `<configDir>/msal_cache.json` with
atomic writes and `0o600` permissions (`src/auth.ts`,
`src/fs-options.ts`). No long-lived secret or refresh token is
exposed to tool code.

## Consequences

### Positive

- **POS-001:** A bad agent activation request cannot exceed the
  user's standing eligibility — Graph and ARM enforce that. The
  browser confirmation step also gives the human a final read of
  every justification + duration before submission.
- **POS-002:** IT admins evaluating consent see only PIM-related
  scopes, not a wide-open Graph footprint, and never a redundant
  `Read`+`ReadWrite` pair for the same resource family. Tenants that
  downgrade a `ReadWrite` to `Read` at consent time cleanly lose the
  affected mutation tools rather than silently falling back to a
  read-only code path (ADR-0017).
- **POS-003:** Approver flows cannot be auto-approved by the agent;
  every approve/deny click is a human action. The same is true for
  deactivations (rare in practice, but irreversible without
  reactivation through PIM).
- **POS-004:** New Graph or ARM surfaces (entitlement management,
  PIM for Azure Resources at MG scope, etc.) inherit this template:
  a list tool, a request/approve/deactivate browser-confirmed
  triplet, scope gating in `tool-registry.ts`.
- **POS-005:** Users can audit at any time what is enabled — the MCP
  instructions block (`buildInstructions` in `src/tool-registry.ts`)
  enumerates which scope each gated tool requires.

### Negative

- **NEG-001:** Privilege-changing flows always require a browser
  context. In headless or remote-only setups (SSH, devcontainer
  without browser launch), the user must run the request manually.
- **NEG-002:** Two-resource auth (Graph + ARM) adds complexity to
  the authenticator (`tokenForResource(resource, signal)`,
  ADR-0013) and means consent is asked once per resource. ARM-gated
  tools stay disabled until ARM consent is granted (silently
  probed at login post-Graph; falls back to interactive on first
  tool call if needed).
- **NEG-003:** Adding new PIM-adjacent tools requires evaluating
  blast radius per tool, listing required scopes, and slotting the
  tool into either "list" or "browser-confirmed mutation"
  categories. There is no fast path that bypasses scope gating or
  the browser flow.
- **NEG-004:** Defence-in-depth checks have a maintenance cost —
  every URL/host/clientId/tenantId/scope allow-list (ADR-0016) is
  a regex or set that must stay in sync with Microsoft's accepted
  values.
- **NEG-005:** AI agent use of PIM is never risk-free. This design
  minimises but does not eliminate risk. A user who clicks "OK" on
  every browser page without reading still bears the consequences
  of whatever the agent prefilled.

## Alternatives Considered

### Broad Graph + ARM Permissions, Silent Activation

- **ALT-001:** **Description:** Request `Directory.ReadWrite.All`,
  `RoleManagement.ReadWrite.All`, ARM Owner-equivalent scopes, and
  let the agent activate / approve / deactivate from tool args
  alone, without a browser confirmation step.
- **ALT-002:** **Rejection Reason:** Maximises blast radius. A
  prompt-injection attack on a meeting invite or approval
  justification could chain into a Global Admin activation or a
  subscription-Owner activation with no human touch. Unacceptable
  for PIM.

### Application-Level Permissions

- **ALT-003:** **Description:** Use `RoleManagement.ReadWrite.All`
  application permissions so the server can act tenant-wide
  without a signed-in user.
- **ALT-004:** **Rejection Reason:** Application permissions grant
  access across every user in the tenant. The "agent is signed in
  as me, helping me with my own elevations" framing is gone. No
  human-in-the-loop is possible.

### Browser Confirmation for List Tools Too

- **ALT-005:** **Description:** Require a browser confirmation
  step for every read tool as well, not just the
  privilege-changing ones.
- **ALT-006:** **Rejection Reason:** Destroys the value of the
  agent on the planning side. List tools have no side-effects on
  Graph or ARM — making the user click through every "show me my
  eligibilities" reduces pimdo to a verbose CLI. The chosen split
  (free reads, browser-confirmed mutations) preserves utility
  where it is safe.

### One Resource Only (Graph) — Skip Azure Roles

- **ALT-007:** **Description:** Drop the ARM scope and ship only
  Entra Groups + directory roles via Microsoft Graph.
- **ALT-008:** **Rejection Reason:** Entra-only PIM coverage
  leaves Azure RBAC out of scope, and Azure subscription / RG
  Owner / Contributor activations are exactly the kind of
  privilege moves users want help with. The two-resource design
  (ADR-0013) makes this a single-login experience without
  granting any new Graph scopes.

## Implementation Notes

- **IMP-001:** Tool descriptors live one-per-file under
  `src/tools/auth/*`, `src/tools/pim/group/*`,
  `src/tools/pim/role-entra/*`, `src/tools/pim/role-azure/*`
  (ADR-0007). Each descriptor declares its `requiredScopes`; the
  registry disables tools whose scopes were not granted.
- **IMP-002:** `MsalAuthenticator` enforces input validation on
  `clientId` and `tenantId` at construction time and refuses to
  build an authority URL from a malformed value
  (`src/auth.ts:CLIENT_ID_RE`, `TENANT_ID_RE`).
- **IMP-003:** `validateApiBaseUrl` (in `src/index.ts`) rejects
  any `PIMDO_GRAPH_URL`, `PIMDO_GRAPH_BETA_URL`, or `PIMDO_ARM_URL`
  that would cause the client to send a Bearer token over
  plaintext to a non-loopback host.
- **IMP-004:** Browser flows live under `src/browser/flows/`
  (login, logout, requester, approver, confirmer) and share the
  hardened loopback-server primitive in `src/browser/server.ts`
  (ADR-0008).
- **IMP-005:** When adding a new PIM-adjacent tool, follow the
  pattern: list tool with `Read*` scope, mutation tool with
  `ReadWrite*` scope and a row-form browser flow. Update the
  scope enum, the `AVAILABLE_SCOPES` table, and add a per-tool
  test under `test/tools/`.

## References

- **REF-001:** [Model Context Protocol specification](https://modelcontextprotocol.io)
  — the protocol pimdo-ts implements for AI agent communication.
- **REF-002:** [Microsoft Entra ID Privileged Identity Management overview](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure)
  — what PIM is and what it protects.
- **REF-003:** [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
  — delegated vs. application permission types.
- **REF-004:** [Azure RBAC documentation](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview)
  — the Azure-resource roles surfaced via ARM PIM.
- **REF-005:** [pimdo-ts README — Privacy & Security](../../README.md)
  — user-facing documentation of the blast radius minimization
  approach.
- **REF-006:** [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
  — industry guidance on risks specific to AI/LLM-powered
  applications, including prompt injection and excessive agency.
