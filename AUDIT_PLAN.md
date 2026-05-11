# Audit Plan: pimdo-ts

_Generated: 2026-05-10_

## Project summary

pimdo-ts is a stdio MCP server (Node ≥ 22, TypeScript, esbuild bundle)
that gives an AI agent scoped, just-in-time access to Microsoft Entra
Privileged Identity Management. Pre-release, no version tagged yet —
the first release will be cut once this audit's follow-up work lands.
24 tools across auth + three PIM surfaces (group, role-entra,
role-azure). Auth is MSAL via interactive browser loopback, with one
login covering both Microsoft Graph and Azure Resource Manager. Single
maintainer (`@simongottschlag`).

The repo is already in good shape:

- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noPropertyAccessFromIndexSignature`).
- ESLint `strictTypeChecked` + `stylisticTypeChecked`.
- Vitest with 90/90/90/75 coverage thresholds, mock Graph + ARM
  servers, three integration-flow tests.
- CI: pinned action SHAs, `permissions: contents: read`,
  `persist-credentials: false`, dependency-review action set to
  `fail-on-severity: moderate`.
- Release: OIDC trusted publishing to npm, build-provenance
  attestations, MCPB bundle.
- Logger writes only to stderr (correct for stdio MCP).
- Loopback hardening (CSRF, CSP nonce, Host pin, Sec-Fetch-Site,
  application/json content-type).
- Atomic file writes with `0o600` POSIX modes for the auth cache.
- 17 ADRs covering the non-obvious design choices.
- 4 runtime deps only (`@modelcontextprotocol/sdk`, `@azure/msal-node`,
  `zod`, `open`) per ADR-0015.

The audit therefore focuses on remaining gaps rather than rewrites.

## Findings (deduplicated, by dimension)

Severity legend: **C** critical / **H** high / **M** medium / **L** low.
Effort: S / M / L.

### Architecture & code structure

| ID  | Sev | Effort | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1 | M   | L      | Horizontal layering vs owner's vertical-slice preference. Each PIM surface lives in three sibling trees: `src/graph/pim-group.ts`, `src/tools/pim/group/`, `src/arm/pim-role-azure.ts`, `src/tools/pim/role-azure/`, etc. A `src/features/{group,role-entra,role-azure}/` layout would co-locate `{client wrapper, formatter, tool descriptors, integration test}` for each slice. Shared infra (`src/http/`, `src/browser/`, `src/templates/`, `src/auth.ts`, `src/scopes.ts`) stays where it is. |
| A-2 | L   | S      | `src/index.ts` mixes the library entry (`createMcpServer`, `validateApiBaseUrl`, `wireShutdownSignals`, `VERSION`) with `main()` and the `if (!process.env["VITEST"])` auto-start guard. Splitting `main()` into `src/main.ts` and pointing `bin` at it would remove the env-guard hack and make the library half independently importable.                                                                                                                                                        |
| A-3 | L   | M      | `Tool<any>` erasure in `tool-registry.ts:95`. Documented and intentional; revisit only if a stronger encoding (HKT-style helper, branded shape) lets the homogeneous array drop the disable comment without churn. Probably keep.                                                                                                                                                                                                                                                                  |
| A-4 | L   | S      | `GraphRequestError` and `ArmRequestError` add nothing over the base `RequestError` beyond `name` and a `resource` string. Shared base now exists in `src/http/base-client.ts` — collapse the subclasses unless an `instanceof` discriminator is used somewhere (it currently is not).                                                                                                                                                                                                              |
| A-5 | L   | S      | Three `eslint-disable @typescript-eslint/no-non-null-assertion` sites in approval-review tools (`pim_*_approval_review`) work around `RoleEntraAssignmentRequest.approvalId?: string`. The list endpoints already filter by `status='PendingApproval'`, so the optionality is structural, not real. Either tighten the type after the list call (a `WithApprovalId<T>` brand) or narrow at the boundary.                                                                                           |
| A-6 | L   | S      | The `request()` overload in `src/http/base-client.ts:204` uses a non-null assertion on `signalArg` to satisfy the second overload. A discriminated union or two named methods (`request` / `requestWithBody`) avoids the disable.                                                                                                                                                                                                                                                                  |

### Security

| ID   | Sev | Effort | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-1  | H   | S      | No `SECURITY.md`. For a tool that brokers delegated PIM tokens (potential Global Admin elevation), a public disclosure policy is table stakes. Add `SECURITY.md` with a private reporting channel (GitHub Security Advisories or a published email) and the supported-version statement.                                                                                                                                                                                       |
| S-2  | M   | S      | `validateApiBaseUrl` accepts any `https://` host. A misconfigured `PIMDO_GRAPH_URL=https://attacker.example` silently exfiltrates Bearer tokens. Microsoft's hostnames are well known: tighten to a default allow-list (`graph.microsoft.com`, `graph.microsoft.us`, `graph.microsoft.de`, `dod-graph.microsoft.us`, `management.azure.com`, the sovereign ARM hosts, plus `*.microsoft.com` if needed) with an explicit `PIMDO_ALLOW_INSECURE_API_HOSTS` opt-out for testing. |
| S-3  | M   | S      | `PIMDO_ACCESS_TOKEN` is a static-token bypass shipped in the production binary. Documented as "not for production" but anyone who can set the env var can swap MSAL for a token they control. Either gate on `process.env["NODE_ENV"] !== "production"`, strip in the release bundle (esbuild `define` flag), or require an additional `PIMDO_ALLOW_STATIC_TOKEN=true` interlock.                                                                                              |
| S-4  | M   | S      | No CodeQL workflow. GitHub-hosted, free for public repos, catches a different class of bug than ESLint. Add `.github/workflows/codeql.yml` (TypeScript) on push + PR.                                                                                                                                                                                                                                                                                                          |
| S-5  | M   | S      | No OSSF Scorecard workflow. Adding `scorecard.yml` (with token-permissions, branch-protection, signed-releases checks) gives a measurable supply-chain baseline and a badge.                                                                                                                                                                                                                                                                                                   |
| S-6  | L   | S      | `npm audit` reports 4 low CVEs, all dev-only and transitive through `@anthropic-ai/mcpb` → `@inquirer/prompts` → `tmp` (CVE GHSA-52f5-9888-hmc6, symlink temp-dir CWE-59). Not exploitable in our use (`mcpb` runs only in the release pipeline against a clean checkout). Track upstream and bump `@anthropic-ai/mcpb` once a fix lands. No code change today.                                                                                                                |
| S-7  | L   | S      | `loadAccount` returns `parsed.data as msal.AccountInfo` (`src/auth.ts:246`) after validating only `username`. If MSAL's silent-auth lookup needs `homeAccountId` / `tenantId` to disambiguate accounts, today's relaxed schema would mask the breakage. Tighten the schema to the fields MSAL actually consumes and round-trip the cast through a typed builder.                                                                                                               |
| S-8  | L   | S      | `MsalAuthenticator.tokenForResource` (`src/auth.ts:417`) constructs a fresh `PublicClientApplication` and reloads `account.json` on every call. Disk I/O per Graph request, and a brief window where two concurrent requests race the cache plugin. Hold one PCA + cached `AccountInfo` per authenticator instance; invalidate on `logout` / `login`.                                                                                                                          |
| S-9  | L   | S      | `dependency-review-action` is good; pair it with `permissions: contents: read, pull-requests: write` (already correct) and add `allow-licenses` / `deny-licenses` to formalise the MIT-only stance. License audit today is implicit — call it out so a future copyleft transitive dep fails CI.                                                                                                                                                                                |
| S-10 | L   | S      | Loopback browser flows already pin Host / Origin / `Sec-Fetch-Site`. Add an explicit `Sec-Fetch-Mode` / `Sec-Fetch-Dest` check on POST as defence-in-depth — modern browsers always send these on form submits, so rejecting absent values does not regress UX.                                                                                                                                                                                                                |

### Testing & CI/CD

| ID  | Sev | Effort | Finding                                                                                                                                                                                                                                                                                                 |
| --- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1 | M   | S      | CI runs only on `ubuntu-latest` × Node 24. README and `engines.node` claim `>= 22`. Auth + `fs-options.ts` branch heavily on Windows (POSIX modes, `%APPDATA%`). Add a matrix `os: [ubuntu-latest, windows-latest, macos-latest]`, `node-version: [22, 24]`. Keep the coverage-comment job ubuntu-only. |
| T-2 | M   | S      | `engines.node: ">=22.0.0"` vs CI Node 24. Pin `package.json` `engines` to a specific minor (`>=22.11.0` for the LTS release line you actually test against) and document the policy in CONTRIBUTING.                                                                                                    |
| T-3 | L   | S      | `vitest.config.ts` excludes `src/index.ts` from coverage. After A-2 (split `main` out), include the library half so `createMcpServer`'s wiring is covered.                                                                                                                                              |
| T-4 | L   | S      | No pre-commit hook. CONTRIBUTING tells humans to run `npm run check` manually. A `lefthook.yml` running `format:check` + `lint --staged` keeps churn down without becoming a yak-shave. Optional — owner pref.                                                                                          |
| T-5 | L   | S      | `release.yml` job `build` lacks `concurrency.cancel-in-progress: false` at the job level (only at workflow level). Currently fine because tags are unique. Note for future when you add a "release-from-branch" trigger.                                                                                |
| T-6 | L   | S      | No real-Graph e2e smoke test. Acceptable today (OAuth interactivity makes it expensive). If pre-release confidence becomes an issue, a manual `npm run smoke` against a sandbox tenant with a long-lived test eligibility is one path; the AAD interactive prompt makes it hard to fully automate.      |

### Performance & DX

| ID  | Sev | Effort | Finding                                                                                                                                                                                                                                 |
| --- | --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1 | M   | S      | See S-8 — per-request PCA + account file read. Single biggest avoidable hot-path cost. Counted under security because the race window is the more interesting failure mode; the perf win is incidental.                                 |
| P-2 | L   | S      | `RESOURCE_PROBE_SCOPES[resource]` (`src/auth.ts:438`) clones with `[...]` on every call to satisfy MSAL's mutable-array typing. Hoist a precomputed `string[]` per resource at module load.                                             |
| P-3 | L   | S      | `npm run check` is a long synchronous chain. Splitting `format:check + icons:check + schemas:check + preview:check` into a parallel turbo / npm-run-all step would shave a few seconds locally without changing CI semantics. Optional. |
| P-4 | L   | S      | esbuild `external: ["node:*"]` is correct. Build is already fast — leave alone.                                                                                                                                                         |

### Docs & maintainability

| ID  | Sev | Effort | Finding                                                                                                                                                                                                                                                                                                                                                  |
| --- | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | M   | S      | No issue or pull-request templates under `.github/ISSUE_TEMPLATE/` or `.github/pull_request_template.md`. For a security-sensitive tool, even minimal templates (bug, feature, security-disclosure-pointer) reduce triage cost.                                                                                                                          |
| D-2 | M   | S      | `AGENTS.md` previously claimed "v0.1.0 candidate" / "Phase 5 in progress" and `CHANGELOG.md` carried a shipped `[0.1.0] - 2026-05-08` entry, but no version has actually been tagged. Fixed in this audit pass: README banner, AGENTS.md status, and CHANGELOG `[Unreleased]` rolled back. Keep them as the single truth until the first real release.   |
| D-3 | M   | M      | The 24-tool table in README.md is hand-maintained and will drift. Generate it from the tool descriptors (`AUTH_TOOLS` + `GROUP_TOOLS` + …) into a `<!-- tool-table:start -->` block, gated by a `npm run readme:check` step in `npm run check`. Same generator can drive `manifest.json`'s `tools[]` array, which today duplicates names + descriptions. |
| D-4 | L   | S      | ADRs `0004`, `0005`, `0006`, `0009`, `0010` are placeholder "removed" stubs. Replace each with a one-line tombstone (`Superseded by ADR-NNNN`) or compact the numbering once. Keeps `docs/adr/` skimmable.                                                                                                                                               |
| D-5 | L   | S      | No `.github/FUNDING.yml`, no `SUPPORT.md`. Optional, low priority for an MIT tool with one maintainer.                                                                                                                                                                                                                                                   |
| D-6 | L   | S      | `package.json.files` ships only `dist/index.js` + README + LICENSE — good. Confirm the bundle does not embed the test fixture mocks (it should not, but worth a one-off `tar -tf` check on the npm tarball during release).                                                                                                                              |
| D-7 | L   | S      | CHANGELOG is hand-maintained and follows Keep a Changelog. No commitlint / conventional-commits enforcement. With one maintainer this is fine; revisit only when contributors arrive.                                                                                                                                                                    |

### Cross-cutting / explicitly checked, no action

- **Stdio protocol hygiene.** Verified: only `src/logger.ts` writes to a console, and only via `console.error` (stderr). No `console.log`, no `process.stdout.write`. Stdout is reserved for MCP, as required.
- **Secrets in logs.** `logger` calls explicitly omit query strings (`src/http/base-client.ts:271`) and tokens. Usernames and error messages are the only PII. Acceptable.
- **Lockfile + pinning.** `package-lock.json` is committed. Action SHAs are pinned in every workflow. Dependabot is configured for both npm and actions with grouping. Good.
- **Input validation.** Every external boundary uses Zod (tool inputs, `loadAccount`, Graph/ARM responses via `parseResponseGeneric`). Good.
- **License compatibility.** Direct deps are MIT/Apache-2.0/ISC. No copyleft (no GPL/AGPL/LGPL). Confirmed via `npm ls` + spot check.
- **MCP SDK usage.** Aligned with `@modelcontextprotocol/sdk` v1.x patterns: `McpServer`, `registerTool`, `RegisteredTool.enable/disable()`, `sendToolListChanged()`. No deprecated APIs.

## Phased plan

Each phase is one shippable PR, small enough to review in one sitting,
independently revertible. Order: security/CI gates first (highest risk
reduction per unit effort), then structural moves, polish last.

### Phase 1 — Security baseline & supply-chain gates

**Touches:** `SECURITY.md` (new), `src/index.ts` (validateApiBaseUrl
host allow-list + `PIMDO_ACCESS_TOKEN` interlock), `.github/workflows/codeql.yml`
(new), `.github/workflows/scorecard.yml` (new),
`.github/workflows/dependency-review.yml` (license allow/deny lists).

- **S-1** Add `SECURITY.md` with private disclosure channel and supported versions.
- **S-2** Default `validateApiBaseUrl` to a Microsoft-host allow-list, opt out via `PIMDO_ALLOW_INSECURE_API_HOSTS`.
- **S-3** Gate `PIMDO_ACCESS_TOKEN` behind `NODE_ENV !== "production"` or a `PIMDO_ALLOW_STATIC_TOKEN` interlock; document.
- **S-4** Enable CodeQL scanning (the repository uses GitHub's CodeQL **default setup** rather than a checked-in `codeql.yml`, since default setup conflicts with advanced configurations).
- **S-5** Add OSSF Scorecard workflow + README badge.
- **S-9** Add `allow-licenses` / `deny-licenses` to `dependency-review-action`.

Effort: **M**. Diff: ~250 lines, mostly YAML + one new MD file. Tests
needed for S-2 and S-3 only (extend `validate-api-base-url.test.ts`).

### Phase 2 — CI matrix on Node + OS

**Touches:** `.github/workflows/ci.yml`, `package.json` (`engines`), `CONTRIBUTING.md`.

- **T-1** Add `os: [ubuntu-latest, windows-latest, macos-latest]` × `node-version: [22, 24]` matrix to the `check` job. Keep `coverage-comment` ubuntu-only and gated on the matrix passing.
- **T-2** Pin `engines.node` to the actual minimum (`>=22.11.0`) and document the policy.

Effort: **S**. Diff: ~60 lines YAML + 1 line `package.json`. Likely
flushes out at least one Windows file-mode bug — fix in the same PR if
small, otherwise spin off Phase 2a.

### Phase 3 — Repo hygiene meta files

**Touches:** `.github/ISSUE_TEMPLATE/{bug.yml,feature.yml,config.yml}`,
`.github/pull_request_template.md`, `AGENTS.md`, `docs/adr/000{4,5,6,9,10}-removed.md`.

- **D-1** Add minimal issue + PR templates. The `config.yml` `contact_links` should point at `SECURITY.md` for security disclosure. ✅ landed in Phase 3.
- **D-2** Already addressed in this audit pass (README banner, `AGENTS.md` status, `CHANGELOG.md` `[Unreleased]` rolled back). No further work needed in this phase.
- **D-4** Tombstone or compact removed-ADR placeholders. ✅ landed in Phase 3 (one-line tombstone explaining the numbers are preserved for stable references).

Effort: **S**. Diff: ~150 lines, no code. No tests.

### Phase 4 — MsalAuthenticator hot-path: cache PCA + AccountInfo

**Touches:** `src/auth.ts`, `test/auth.test.ts`, possibly `test/mock-auth.ts`.

- **S-8 / P-1** Hold one `PublicClientApplication` per `MsalAuthenticator` instance; cache the `AccountInfo` after first `loadAccount`. Invalidate both on `login()` (replace) and `logout()` (clear). Preserve the existing `AbortSignal` wiring on the cache plugin and the per-resource probe semantics.
- **S-7** Tighten the `AccountInfoSchema` to the fields MSAL actually consumes (`homeAccountId`, `environment`, `tenantId`, `username`, `localAccountId`) and remove the `as msal.AccountInfo` cast.
- **P-2** Hoist `RESOURCE_PROBE_SCOPES` arrays to module-load constants.

Effort: **M**. Diff: ~150 lines `src/auth.ts` plus targeted test
additions. Risk: token cache reload semantics — needs careful tests for
multi-resource probe + concurrent `tokenForResource` calls.

### Phase 5 — Type-safety polish: remove `no-non-null-assertion` disables

**Touches:** `src/http/base-client.ts`, `src/tools/pim/*/pim-*-approval-review.ts`,
`src/tools/pim/factories/approval-review.ts`, `src/graph/pim-group.ts`,
`src/graph/pim-role-entra.ts`.

- **A-5** ✅ The approval-review factory now resolves the approval id once in `pickApprovals` and threads it through to the per-surface `toRow` adapter as an explicit parameter, so the three `r.approvalId!` assertions are gone (no structural brand needed — the resolved id was already present, it just wasn't carried through).
- **A-6** ✅ `BaseHttpClient.request()` reorders the overload narrowing (`signalArg !== undefined` first) and throws a `TypeError` for the invalid shape; no non-null assertion. The retry-loop tail in `performRequest()` now decides retryable + last-attempt inside the loop, so each iteration either returns or throws — the post-loop `lastError!` is replaced with an unreachable guard.
- ✅ The index-lookup non-null assertions in `pickLiveStage` (`src/graph/pim-group.ts`) and `pickLiveStep` (`src/graph/pim-role-entra.ts`) are removed via `const [first, ...rest] = candidates;` destructuring.

Effort: **M**. Diff: ~100 lines, no behavior change. ESLint disables
removed.

### Phase 6 — Library / composition split

**Touches:** `src/index.ts` (becomes library entry), `src/main.ts` (new,
houses `main()` + the env wiring), `package.json` (`bin` points at
`dist/main.js` or the bundled binary), `build.mjs` (entry point),
`vitest.config.ts` (drop the `src/index.ts` exclusion).

- **A-2** Move `main()` and the `if (!process.env["VITEST"])` guard into `src/main.ts`. `src/index.ts` exports `createMcpServer`, `validateApiBaseUrl`, `wireShutdownSignals`, `VERSION`, `CLIENT_ID`.
- **T-3** Drop the `src/index.ts` coverage exclusion.

Effort: **S**. Diff: ~100 lines, mostly file rename. Tests already cover
`createMcpServer` indirectly via the integration suite.

### Phase 7 — Vertical slice refactor: collapse per-PIM-surface code

✅ **Landed.** PIM surface-specific code moved from horizontal layering
(`src/graph/pim-*.ts`, `src/arm/pim-*.ts`, `src/tools/pim/<surface>/`) to
vertical slices under `src/features/<surface>/{client.ts,format.ts,tools/}`.
Shared transport (`src/graph/{client,me,policies,types}.ts`,
`src/arm/{client,policies,types}.ts`), shared factories
(`src/tools/pim/factories/`), shared format helpers
(`src/tools/pim/format-shared.ts`), shared error helpers
(`src/tools/shared.ts`), and auth tools (`src/tools/auth/`) stayed put.
ADR-0007 carries the new on-disk grouping note. No behaviour change.

Original notes (kept for context):

**Touches:** large rename. Net result:

```
src/features/
  group/
    client.ts         (was src/graph/pim-group.ts)
    format.ts         (was src/tools/pim/group/format.ts)
    tools/            (was src/tools/pim/group/)
      pim-group-eligible-list.ts
      …
    integration.test.ts (was test/integration/group-flow.test.ts, optional move)
  role-entra/         (same shape)
  role-azure/         (same shape, client.ts wraps ARM)
src/http/             (unchanged shared transport)
src/browser/          (unchanged shared loopback)
src/templates/        (unchanged shared layout)
src/auth.ts           (unchanged)
src/scopes.ts         (unchanged)
src/tools/auth/       (unchanged — auth tools are not a PIM surface)
src/tools/pim/factories/ (move into a per-surface folder if only used by one,
                          else keep at src/tools/factories/)
```

- **A-1** Mechanical move + import rewrites. `src/graph/pim-group.ts` →
  `src/features/group/client.ts`, `src/tools/pim/group/format.ts` →
  `src/features/group/format.ts`, etc. ARM and beta-Graph wrappers stay
  shared; only the surface-specific functions move.
- The shared `graph/{client,me,policies,types}.ts` stay in `src/graph/`
  (genuinely cross-surface). Same for `arm/{client,policies,types}.ts`.

Effort: **L**. Diff: large by line count but mechanical (no behavior
change). Best done as one PR to avoid an intermediate inconsistent
layout. Update ADR-0007 to reference the new path layout. Schemas are
regenerated automatically. Tests need only import-path updates.

### Phase 8 — README/manifest tool-table generation

**Touches:** `scripts/generate-tool-docs.ts` (new), `README.md`,
`manifest.json`, `package.json` (`scripts.readme:check`,
`scripts.check`).

- **D-3** Generate the tool tables in README and the `tools[]` array in `manifest.json` from the same tool descriptor list that drives the registry. Add `npm run readme:check` to the `npm run check` chain so drift fails CI.

Effort: **M**. Diff: ~250 lines (one new generator script, mechanical
README rewrite).

### Phase 9 — Optional: error-class collapse + minor polish

**Touches:** `src/http/base-client.ts`, `src/graph/client.ts`,
`src/arm/client.ts`, callers of `instanceof GraphRequestError` /
`instanceof ArmRequestError` (none today).

- **A-4** Collapse `GraphRequestError` and `ArmRequestError` into the shared `RequestError`, leaving the existing `resource` field as the discriminator.
- **S-10** Add `Sec-Fetch-Mode` / `Sec-Fetch-Dest` checks to `validateLoopbackPostHeaders`.
- **D-4** (if not done in Phase 3) finish the ADR tombstone pass.

Effort: **S**. Diff: ~100 lines. Pure cleanup; ship only if Phases 1–8
land cleanly.

## Phase summary

| Phase | Theme                             | Effort | Risk   | Blocks |
| ----- | --------------------------------- | ------ | ------ | ------ |
| 1     | Security baseline + supply-chain  | M      | low    | —      |
| 2     | CI Node + OS matrix               | S      | low    | —      |
| 3     | Repo hygiene meta files           | S      | none   | —      |
| 4     | Authenticator hot-path + schema   | M      | medium | —      |
| 5     | Type-safety polish                | M      | low    | —      |
| 6     | main / library split              | S      | low    | T-3    |
| 7     | Vertical slice refactor           | L      | low    | —      |
| 8     | Tool-table generation             | M      | low    | 7      |
| 9     | Error-class collapse + sec polish | S      | none   | —      |

Phases 1, 2, 3 can ship in any order. Phases 4 and 5 are independent.
Phase 6 should land before Phase 7 to keep the slice refactor from
also moving `main()`. Phase 8 reads the post-Phase-7 layout, so it
ships last among the structural ones. Phase 9 is opportunistic.
