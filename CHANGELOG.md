# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Three new MCP tools — `pim_group_request_cancel`,
  `pim_role_entra_request_cancel`, `pim_role_azure_request_cancel` —
  letting the signed-in user cancel one or more of their own PIM
  activation requests that are still in `PendingApproval` state. Each
  tool reuses the existing browser confirmation pattern (no-reason mode,
  since the underlying Graph and ARM cancel APIs accept no body) so the
  human always confirms before any cancel is submitted. No new OAuth
  scopes are required — each surface reuses its existing PIM
  ReadWrite (Graph) or ARM `user_impersonation` scope set. (#39)

### Fixed

- `pim_group_request_list`, `pim_role_entra_request_list`, and
  `pim_role_azure_request_list` now mark pending `selfActivate`
  entries with an inline `[stale]` tag when the caller no longer has
  a matching eligibility for the underlying group / role + scope. The
  same `[stale]` tag is also applied on the approver side
  (`pim_group_approval_list`, `pim_role_entra_approval_list`,
  `pim_role_azure_approval_list`) for entries whose underlying
  approval no longer has a live stage assigned to the caller.
  Stale principal-side entries can be retracted with the matching
  `pim_*_request_cancel` tool added in #39. (#40)

## [0.1.0] — 2026-05-14

First public release of `@co-native-ab/pimdo-ts`. Published to npm via
GitHub Actions OIDC Trusted Publishing with `--provenance` and build
attestations.

### Added

- Shared multi-tenant `pimdo-ts` Entra application client ID
  (`30cdf00b-19c8-4fe6-94bd-2674ee51a3ff`, published by Co-native AB)
  baked in as the default for `CLIENT_ID` / `PIMDO_CLIENT_ID` /
  manifest `client_id`. Custom registrations can still be wired up by
  overriding `PIMDO_CLIENT_ID`.

- Phase 5: Per-tool JSON Schemas generated from each MCP tool's Zod
  `inputSchema` into `schemas/tools/<tool-name>.json`. New
  `scripts/generate-schemas.ts` plus `npm run schemas:generate` /
  `npm run schemas:check` scripts; `schemas:check` is gated by
  `npm run check` and CI.
- Phase 5: GitHub Actions CI workflow runs `format:check`, `icons:check`,
  `schemas:check`, lint, typecheck, tests with coverage, build, and
  MCPB bundle smoke-build on every push / PR.
- Phase 5: GitHub Actions release workflow stamps the version into
  `package.json` + `manifest.json`, runs the full check, builds
  `pimdo-ts-vX.Y.Z.mcpb` and `pimdo-ts-vX.Y.Z.js`, attests provenance,
  uploads release artifacts, and publishes
  `@co-native-ab/pimdo-ts` to npm via OIDC trusted publishing.
- Phase 5: README rewritten for the upcoming first release — install via MCPB / npm /
  standalone JS, full 24-tool listing, manual Entra app-registration
  steps, configuration and security model, FAQ.
- Phase 4: PIM Azure-role tool surface (`pim_role_azure_eligible_list`, `pim_role_azure_active_list`, `pim_role_azure_request_list`, `pim_role_azure_request`, `pim_role_azure_deactivate`, `pim_role_azure_approval_list`, `pim_role_azure_approval_review`). All seven tools speak Azure Resource Manager (ARM) instead of Microsoft Graph and are gated by the single ARM `user_impersonation` scope.
- ARM PIM domain layer (`src/arm/pim-role-azure.ts`) wrapping `roleEligibilityScheduleInstances`, `roleAssignmentScheduleInstances`, `roleAssignmentScheduleRequests`, and the `roleAssignmentApprovals/.../stages` PUT (delivered through the `2020-06-01` `/batch` endpoint).
- `src/arm/types.ts` — zod schemas for the ARM PIM resources (eligibility/active schedule instances, schedule requests, role-management policy assignments + effective rules, expanded properties).
- `getAzureRoleMaxDuration` in `src/arm/policies.ts` for ARM-scoped role-management policy lookups (`Expiration_EndUser_Assignment` rule).
- ARM mock fake (`test/mock-arm.ts`) with seedable eligibility / active / pending-approval state and a `/batch` endpoint.
- End-to-end integration test for the Azure-role surface (`test/integration/role-azure-flow.test.ts`).
- Phase 3: PIM Entra-role tool surface (`pim_role_entra_eligible_list`, `pim_role_entra_active_list`, `pim_role_entra_request_list`, `pim_role_entra_request`, `pim_role_entra_deactivate`, `pim_role_entra_approval_list`, `pim_role_entra_approval_review`).
- Graph layer for PIM Entra roles (`src/graph/pim-role-entra.ts`) wrapping `roleEligibilitySchedules`, `roleAssignmentScheduleInstances`, `roleAssignmentScheduleRequests`, and `roleAssignmentApprovals` (beta).
- `getDirectoryRoleMaxDuration` in `src/graph/policies.ts` for directory-scoped role-management policy lookups.
- Beta-channel Microsoft Graph client wired through `ServerConfig.graphBetaClient`, configurable via `PIMDO_GRAPH_BETA_URL` (default `https://graph.microsoft.com/beta`). Used only by the Entra-role assignment-approvals surface.
- PIM mock-graph extended with Entra-role state, seed helpers (`seedRoleEntraEligibility`, `seedRoleEntraPendingApproval`), and routes for v1.0 + beta paths.
- End-to-end integration test for the Entra-role surface (`test/integration/role-entra-flow.test.ts`).
- Phase 2: PIM Group tool surface (`pim_group_eligible_list`, `pim_group_active_list`, `pim_group_request_list`, `pim_group_request`, `pim_group_deactivate`, `pim_group_approval_list`, `pim_group_approval_review`).
- Three browser flows for human-confirmed PIM actions: `requesterFlow` (multi-row activation form with policy-clamped duration), `approverFlow` (Approve/Deny/Skip per row), and `confirmerFlow` (per-row include + reason). All built on a shared `runRowForm` primitive with CSRF + CSP hardening identical to the existing picker flow.
- Graph layer for PIM groups (`src/graph/pim-group.ts`, `src/graph/policies.ts`, `src/graph/me.ts`) wrapping `eligibilitySchedules`, `assignmentScheduleInstances`, `assignmentScheduleRequests`, `assignmentApprovals`, and `roleManagementPolicyAssignments`.
- PIM-focused HTTP fake (`test/mock-graph.ts`) plus an end-to-end integration test that walks eligible → request → approve → active → deactivate.
- Phase 1 scaffolding: MCP server bootstrap with `login`, `logout`, and `auth_status` tools.
- `Authenticator.tokenForResource(resource, signal)` for acquiring tokens against Microsoft Graph **or** Azure Resource Manager from the same login.
- `src/arm/client.ts` — Azure Resource Manager HTTP client mirroring the Graph client (bearer auth, error envelopes, retry on 429/503/504, timeouts).
- `src/duration.ts` — ISO-8601 PIM-subset duration parser/formatter/comparator/clamper.
- PIM-focused scope set in `src/scopes.ts` (groups, Entra roles, Azure resource roles).

### Changed

- Audit Phase 7 (vertical slice refactor — finding A-1): PIM
  surface-specific code moved from horizontal layering
  (`src/graph/pim-*.ts`, `src/arm/pim-*.ts`,
  `src/tools/pim/{group,role-entra,role-azure}/`) into vertical slices
  under `src/features/<surface>/{client.ts, format.ts, tools/}`. Shared
  Graph/ARM transport, factories (`src/tools/pim/factories/`), shared
  formatters (`src/tools/pim/format-shared.ts`), and auth tools
  (`src/tools/auth/`) stayed put. Behaviour and public API unchanged;
  ADR-0007 updated.
- Project reframed from a generic Microsoft Graph MCP to one focused on **Microsoft Entra Privileged Identity Management**.
