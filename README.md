# pimdo-ts

Local MCP server (Model Context Protocol) written in TypeScript that gives an AI assistant scoped access to **Microsoft Entra Privileged Identity Management (PIM)** — for groups, Entra roles, and Azure resource roles — without granting it standing access.

> **Phase 1 status:** This release only ships the authentication tools (`login`, `logout`, `auth_status`). The PIM-specific surfaces (eligible/active assignments, request-elevation, approve, confirm) are implemented in later phases as outlined in `.tmp/roadmap.md`.

## What pimdo does

pimdo is an MCP server. AI agents that speak MCP can connect to it and use the exposed tools to:

- inspect what role and group assignments the signed-in user is **eligible** to activate, and which are currently **active**,
- **request** a just-in-time elevation,
- as a designated approver, **approve** another user's pending request,
- with explicit human approval, **confirm** that an elevation has been used.

The agent acts as the signed-in human user — it never holds standing privileges. Every PIM action goes through the same approval and audit pipeline as a manual `aka.ms/myaccess` flow.

pimdo borrows its authentication, browser-loopback, and HTTP-client architecture from [`graphdo-ts`](https://github.com/co-native-ab/graphdo-ts) and is informed by the [`pimctl`](https://github.com/co-native-ab/pimctl) CLI.

## Required scopes

pimdo authenticates against **two resources** from the same login:

- **Microsoft Graph** (`https://graph.microsoft.com`) — used for PIM groups and Entra role assignments.
- **Azure Resource Manager** (`https://management.azure.com`) — used for Azure resource role assignments.

| Scope                                             | Resource | When required                                  |
| ------------------------------------------------- | -------- | ---------------------------------------------- |
| `User.Read`                                       | Graph    | always (sign-in identity)                      |
| `offline_access`                                  | Graph    | always (refresh tokens)                        |
| `PrivilegedAccess.Read.AzureADGroup`              | Graph    | reading group eligibility / active assignments |
| `PrivilegedAccess.ReadWrite.AzureADGroup`         | Graph    | requesting / approving group elevations        |
| `RoleManagement.Read.Directory`                   | Graph    | reading Entra role assignments                 |
| `RoleManagement.ReadWrite.Directory`              | Graph    | requesting / approving Entra role elevations   |
| `RoleAssignmentSchedule.ReadWrite.Directory`      | Graph    | scheduled Entra role activations               |
| `RoleEligibilitySchedule.Read.Directory`          | Graph    | reading Entra eligibility schedules            |
| `https://management.azure.com/user_impersonation` | ARM      | all Azure resource role operations             |

The MCP server starts with no PIM tools enabled. As the user consents to additional scopes during interactive login, the corresponding tools light up automatically.

## Manual Entra app registration (phase 1)

Phase 1 does **not** ship a pre-published app registration. Until that lands you must register a multi-tenant Entra application yourself and pre-consent the scopes above for your tenant:

1. In the Microsoft Entra admin center, register a new application (multi-tenant, public client / native).
2. Under **API permissions**, add the delegated permissions listed above for **Microsoft Graph** and **Azure Service Management** (`user_impersonation`).
3. Grant admin consent for your tenant.
4. Set `PIMDO_CLIENT_ID` (or the `client_id` user config in the MCP manifest) to your application's client ID, and `PIMDO_TENANT_ID` to your tenant GUID (or `organizations`).

## Installation & build

```sh
npm install
npm run build       # produces dist/index.js
npm run check       # format + lint + typecheck + tests
node dist/index.js  # starts the MCP server on stdio
```

## License

MIT — see `LICENSE`.
