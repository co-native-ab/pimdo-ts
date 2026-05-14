# Security Policy

pimdo-ts brokers delegated Microsoft Entra Privileged Identity Management
(PIM) tokens on behalf of the signed-in user. A bug here can affect
real privileged-access flows, so we take security reports seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Report suspected vulnerabilities privately via
[GitHub Security Advisories](https://github.com/co-native-ab/pimdo-ts/security/advisories/new).
This opens a private channel between you and the maintainers and lets
us coordinate a fix and disclosure.

When reporting, please include:

- A clear description of the issue and its impact.
- Steps to reproduce, ideally with a minimal proof of concept.
- The affected version (commit SHA, release tag, or `npm` version).
- Any suggested mitigations or patches you have in mind.

We will acknowledge new reports within **5 business days** and aim to
provide a status update at least every **7 days** until the report is
resolved.

## Supported versions

Only the latest published version on npm and on the GitHub Releases
page receives security fixes. There is no extended support for older
versions while the project is pre-1.0.

| Version          | Supported          |
| ---------------- | ------------------ |
| `main`           | :white_check_mark: |
| `0.1.x` (latest) | :white_check_mark: |
| Older `0.x`      | :x:                |

## Scope

In scope:

- The MCP server published from this repository (`@co-native-ab/pimdo-ts`
  on npm, the MCPB bundle, and the standalone JS bundle).
- The Microsoft Graph and Azure Resource Manager HTTP clients in
  `src/graph/` and `src/arm/`.
- The MSAL-backed authentication and token-cache code in `src/auth.ts`
  and the loopback browser flows in `src/browser/`.
- Build, release, and CI workflows under `.github/workflows/`.

Out of scope (please report to the upstream project instead):

- Vulnerabilities in `@modelcontextprotocol/sdk`, `@azure/msal-node`,
  `zod`, or `open` themselves.
- Issues caused by user misconfiguration (for example, granting a
  pimdo-ts MSAL app excessive scopes in your tenant).
- Theoretical attacks that require an attacker who already controls the
  user's machine or MSAL token cache on disk.

## Coordinated disclosure

We prefer coordinated disclosure. Once a fix is available we will:

1. Publish a patched release on npm and GitHub Releases.
2. Publish a GitHub Security Advisory (with a CVE if applicable)
   describing the issue, affected versions, and mitigation.
3. Credit the reporter unless they ask to remain anonymous.
