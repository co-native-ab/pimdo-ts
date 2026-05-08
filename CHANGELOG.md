# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
