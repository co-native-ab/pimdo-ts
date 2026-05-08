# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Phase 4: PIM Azure-role tool surface (`pim_role_azure_eligible_list`, `pim_role_azure_active_list`, `pim_role_azure_request_list`, `pim_role_azure_request`, `pim_role_azure_deactivate`, `pim_role_azure_approval_list`, `pim_role_azure_approval_review`). All seven tools speak Azure Resource Manager (ARM) instead of Microsoft Graph and are gated by the single ARM `user_impersonation` scope.
- ARM PIM domain layer (`src/arm/pim-role-azure.ts`) wrapping `roleEligibilityScheduleInstances`, `roleAssignmentScheduleInstances`, `roleAssignmentScheduleRequests`, and the `roleAssignmentApprovals/.../stages` PUT (delivered through the `2020-06-01` `/batch` endpoint, mirroring `pimctl`).
- `src/arm/types.ts` — zod schemas for the ARM PIM resources (eligibility/active schedule instances, schedule requests, role-management policy assignments + effective rules, expanded properties).
- `getAzureRoleMaxDuration` in `src/arm/policies.ts` for ARM-scoped role-management policy lookups (`Expiration_EndUser_Assignment` rule).
- ARM mock fake (`test/mock-arm.ts`) with seedable eligibility / active / pending-approval state and a `/batch` endpoint.
- End-to-end integration test for the Azure-role surface (`test/integration/role-azure-flow.test.ts`).
- Phase 3: PIM Entra-role tool surface (`pim_role_entra_eligible_list`, `pim_role_entra_active_list`, `pim_role_entra_request_list`, `pim_role_entra_request`, `pim_role_entra_deactivate`, `pim_role_entra_approval_list`, `pim_role_entra_approval_review`).
- Graph layer for PIM Entra roles (`src/graph/pim-role-entra.ts`) wrapping `roleEligibilitySchedules`, `roleAssignmentScheduleInstances`, `roleAssignmentScheduleRequests`, and `roleAssignmentApprovals` (beta) for parity with `pimctl`.
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

- Project reframed from a generic Microsoft Graph MCP to one focused on **Microsoft Entra Privileged Identity Management**.
