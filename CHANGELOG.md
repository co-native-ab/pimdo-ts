# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Phase 1 scaffolding: MCP server bootstrap with `login`, `logout`, and `auth_status` tools.
- `Authenticator.tokenForResource(resource, signal)` for acquiring tokens against Microsoft Graph **or** Azure Resource Manager from the same login.
- `src/arm/client.ts` — Azure Resource Manager HTTP client mirroring the Graph client (bearer auth, error envelopes, retry on 429/503/504, timeouts).
- `src/duration.ts` — ISO-8601 PIM-subset duration parser/formatter/comparator/clamper.
- PIM-focused scope set in `src/scopes.ts` (groups, Entra roles, Azure resource roles).

### Changed

- Project reframed from a generic Microsoft Graph MCP to one focused on **Microsoft Entra Privileged Identity Management**.
