# pimdo-ts

Local MCP server (Model Context Protocol) written in TypeScript that gives an AI assistant scoped access to **Microsoft Entra Privileged Identity Management (PIM)** — for groups, Entra roles, and Azure resource roles — without granting it standing access.

> **Status:** v0.1.0 candidate — full PIM surface end-to-end. Seven `pim_group_*`, seven `pim_role_entra_*`, and seven `pim_role_azure_*` tools (21 PIM tools + 3 auth tools = 24 total).

## What pimdo does

pimdo is an MCP server. AI agents that speak MCP can connect to it and use the exposed tools to:

- inspect what role and group assignments the signed-in user is **eligible** to activate, and which are currently **active**,
- **request** a just-in-time elevation,
- as a designated approver, **approve** another user's pending request,
- with explicit human approval, **confirm** that an elevation has been used.

The agent acts as the signed-in human user — it never holds standing privileges. Every PIM action goes through the same approval and audit pipeline as a manual `aka.ms/myaccess` flow.

## Installation

pimdo-ts is distributed in three formats from [GitHub Releases](https://github.com/co-native-ab/pimdo-ts/releases/latest):

### MCPB Bundle (Recommended for Claude Desktop)

The [MCPB](https://github.com/modelcontextprotocol/mcpb) bundle is self-contained — it includes the server and a bundled Node.js runtime. No separate Node.js installation is required.

Download the latest `pimdo-ts-vX.Y.Z.mcpb` file from GitHub Releases.

**Claude Desktop:** Double-click the `.mcpb` file, or open Claude Desktop → **Settings** → **Extensions** → **Install Extension** and select the file.

After installation, `pimdo` appears in your extensions list. Configure optional settings (debug logging, custom client ID, tenant ID) via the extension settings UI.

### npm (Recommended for other MCP clients)

Requires [Node.js](https://nodejs.org/) 22 or later.

```bash
npx @co-native-ab/pimdo-ts
```

Configure in your MCP client:

```json
{
  "command": "npx",
  "args": ["@co-native-ab/pimdo-ts"]
}
```

### Standalone JS bundle

Download `pimdo-ts-vX.Y.Z.js` from GitHub Releases and run directly with Node.js 22+:

```bash
node pimdo-ts-vX.Y.Z.js
```

## Tools

### Authentication

| Tool          | Purpose                                          |
| ------------- | ------------------------------------------------ |
| `login`       | Interactive browser sign-in to Microsoft Entra   |
| `logout`      | Browser-confirmed sign-out and token cache clear |
| `auth_status` | Report current sign-in state and granted scopes  |

### PIM for Entra Groups

| Tool                        | Purpose                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `pim_group_eligible_list`   | List groups the signed-in user is eligible to activate                                  |
| `pim_group_active_list`     | List groups the signed-in user has currently activated                                  |
| `pim_group_request_list`    | List pending PIM group requests submitted by the signed-in user                         |
| `pim_group_request`         | Open a browser form to confirm activation of one or more groups (clamped to policy max) |
| `pim_group_deactivate`      | Open a browser form to confirm deactivation of one or more active group assignments     |
| `pim_group_approval_list`   | List pending PIM group approvals assigned to the signed-in user as approver             |
| `pim_group_approval_review` | Open a browser form to Approve / Deny / Skip pending PIM group approvals                |

The four read tools return plain text the AI can summarise. The three write tools open a loopback browser form ("requester", "approver", "confirmer") so the human always confirms a privilege change before pimdo posts it to Graph.

### PIM for Entra roles

| Tool                             | Purpose                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pim_role_entra_eligible_list`   | List directory roles the signed-in user is eligible to activate                                  |
| `pim_role_entra_active_list`     | List directory roles the signed-in user has currently activated                                  |
| `pim_role_entra_request_list`    | List pending PIM Entra-role requests submitted by the signed-in user                             |
| `pim_role_entra_request`         | Open a browser form to confirm activation of one or more directory roles (clamped to policy max) |
| `pim_role_entra_deactivate`      | Open a browser form to confirm deactivation of one or more active Entra-role assignments         |
| `pim_role_entra_approval_list`   | List pending PIM Entra-role approvals assigned to the signed-in user as approver                 |
| `pim_role_entra_approval_review` | Open a browser form to Approve / Deny / Skip pending PIM Entra-role approvals                    |

The Entra-role approval read/PATCH operations target the Microsoft Graph **`beta`** endpoint, since that is currently the only channel exposing the assignment-approvals surface; the rest of the surface uses `v1.0`.

### PIM for Azure roles

| Tool                             | Purpose                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pim_role_azure_eligible_list`   | List Azure resource roles the signed-in user is eligible to activate                                  |
| `pim_role_azure_active_list`     | List Azure resource roles the signed-in user has currently activated                                  |
| `pim_role_azure_request_list`    | List pending PIM Azure-role requests submitted by the signed-in user                                  |
| `pim_role_azure_request`         | Open a browser form to confirm activation of one or more Azure resource roles (clamped to policy max) |
| `pim_role_azure_deactivate`      | Open a browser form to confirm deactivation of one or more active Azure-role assignments              |
| `pim_role_azure_approval_list`   | List pending PIM Azure-role approvals assigned to the signed-in user as approver                      |
| `pim_role_azure_approval_review` | Open a browser form to Approve / Deny / Skip pending PIM Azure-role approvals                         |

The Azure-role surface talks to the Azure Resource Manager (ARM) API instead of Microsoft Graph. It uses API version `2020-10-01` for the `Microsoft.Authorization/role*` resources, `2021-01-01-preview` for the `roleAssignmentApprovals/.../stages` PUT, and posts approvals via the `2020-06-01` `/batch` endpoint.

JSON Schemas for every tool's input are generated under [`schemas/tools/`](./schemas/tools) from the Zod definitions in `src/tools/` (see `npm run schemas:generate` and the `schemas:check` CI gate).

## Authentication

pimdo uses MSAL (`@azure/msal-node`) to authenticate with Microsoft. When the agent calls the `login` tool:

1. The tool starts a local loopback HTTP server with a branded landing page and opens it in your browser.
2. You click "Sign in with Microsoft", authenticate against Microsoft's OAuth endpoint, and the redirect lands back on the loopback server.
3. Login completes immediately — no manual code entry needed.

pimdo requires a working browser on the workstation it runs on. If pimdo cannot launch a browser, the `login` tool fails with an error — there is no manual URL fallback, no device code, and no headless mode. pimdo-ts is a workstation tool by design; SSH sessions, containers, and other environments without a browser are not supported.

The same login produces tokens for **both** Microsoft Graph and Azure Resource Manager — pimdo calls `Authenticator.tokenForResource(resource, signal)` per request and lets MSAL refresh them silently. To sign out and clear cached tokens, call the `logout` tool.

Use the `auth_status` tool to check whether you are logged in and see the current user, granted scopes, and server version.

## Required scopes

pimdo authenticates against **two resources** from the same login:

- **Microsoft Graph** (`https://graph.microsoft.com`) — used for PIM groups and Entra role assignments.
- **Azure Resource Manager** (`https://management.azure.com`) — used for Azure resource role assignments.

| Scope                                                  | Resource | When required                                                                                   |
| ------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------- |
| `User.Read`                                            | Graph    | always (sign-in identity)                                                                       |
| `offline_access`                                       | Graph    | always (refresh tokens)                                                                         |
| `PrivilegedAccess.Read.AzureADGroup`                   | Graph    | reading group eligibility / active assignments                                                  |
| `PrivilegedAccess.ReadWrite.AzureADGroup`              | Graph    | requesting / approving group elevations                                                         |
| `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup`  | Graph    | submitting group activation/deactivation schedules                                              |
| `PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup` | Graph    | reading/managing group eligibility schedules                                                    |
| `RoleManagementPolicy.Read.AzureADGroup`               | Graph    | reading group activation policy (max duration etc.) — required by `pim_group_request`           |
| `RoleManagement.Read.Directory`                        | Graph    | reading Entra role assignments                                                                  |
| `RoleManagement.ReadWrite.Directory`                   | Graph    | requesting / approving Entra role elevations                                                    |
| `RoleAssignmentSchedule.ReadWrite.Directory`           | Graph    | scheduled Entra role activations                                                                |
| `RoleEligibilitySchedule.Read.Directory`               | Graph    | reading Entra eligibility schedules                                                             |
| `RoleManagementPolicy.Read.Directory`                  | Graph    | reading Entra-role activation policy (max duration etc.) — required by `pim_role_entra_request` |
| `https://management.azure.com/user_impersonation`      | ARM      | all Azure resource role operations                                                              |

The MCP server starts with no PIM tools enabled. As the tenant grants the scopes listed above (typically through admin consent), the corresponding tools light up automatically on the next login.

## Manual Entra app registration

pimdo-ts ships with a default multi-tenant Entra application client ID — `30cdf00b-19c8-4fe6-94bd-2674ee51a3ff`, published by Co-native AB — so most users do **not** need to register their own app. An administrator may need to grant tenant-wide consent for the scopes listed above before non-admin users can sign in.

If your organization requires its own app registration (for example to lock down which tenants can use it), register a multi-tenant Entra application yourself:

1. In the Microsoft Entra admin center, register a new application:
   - **Supported account types:** _Accounts in any organizational directory (multitenant)_.
   - **Platform:** _Mobile and desktop applications_ / public client (no client secret).
   - **Redirect URI:** `http://localhost` — pimdo's loopback server picks an ephemeral port at runtime, and Microsoft accepts any `http://localhost:<port>` redirect under the registered `http://localhost` entry.
   - Enable **"Allow public client flows"** under _Authentication_ (required for the loopback PKCE flow).
2. Under **API permissions**, add the **delegated** permissions listed above for **Microsoft Graph** and **Azure Service Management** (`user_impersonation`).
3. Click **Grant admin consent for [your tenant]** so users can sign in without each individually consenting.
4. Copy the application (client) ID. Provide it to pimdo via:
   - the **Client ID** field in the MCPB extension settings (Claude Desktop), **or**
   - the `PIMDO_CLIENT_ID` environment variable.
   - Optionally set `PIMDO_TENANT_ID` to your tenant GUID (or `organizations`); defaults to `common`.

## Configuration

| Environment variable   | Default                                | Purpose                                                                                                                                                          |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PIMDO_CLIENT_ID`      | `30cdf00b-19c8-4fe6-94bd-2674ee51a3ff` | Entra application client ID (defaults to the shared Co-native multi-tenant pimdo-ts app)                                                                         |
| `PIMDO_TENANT_ID`      | `common`                               | Entra tenant ID (`common` / `organizations` / GUID)                                                                                                              |
| `PIMDO_DEBUG`          | unset                                  | Set to `true` for verbose stderr logging                                                                                                                         |
| `PIMDO_CONFIG_DIR`     | OS-default config dir                  | Override the on-disk config / token-cache location (Linux: `~/.config/pimdo-ts`, macOS: `~/Library/Application Support/pimdo-ts`, Windows: `%APPDATA%/pimdo-ts`) |
| `PIMDO_GRAPH_URL`      | `https://graph.microsoft.com/v1.0`     | Override Microsoft Graph base URL (sovereign clouds, testing)                                                                                                    |
| `PIMDO_GRAPH_BETA_URL` | `https://graph.microsoft.com/beta`     | Override Microsoft Graph beta base URL                                                                                                                           |
| `PIMDO_ARM_URL`        | `https://management.azure.com`         | Override Azure Resource Manager base URL                                                                                                                         |
| `PIMDO_ACCESS_TOKEN`   | unset                                  | Static access token for testing (bypasses MSAL); not for production use                                                                                          |

## Security model

- **No standing access.** pimdo only ever holds tokens scoped to the granted permissions and acts as the signed-in user.
- **Human-in-the-loop for every privilege change.** `request`, `deactivate`, and `approval_review` always open a loopback browser form so you confirm or override the AI's intent before pimdo issues the API call.
- **Loopback hardening.** The browser flow ships CSRF + Content-Security-Policy + strict header parsing (see `src/browser/security.ts`).
- **Tool gating.** Every PIM tool declares the scopes it needs; the registry enables a tool only when all required scopes are present in the granted set, then re-syncs after every login.

## Development

```sh
npm install
npm run check          # format + icons + schemas + lint + typecheck + tests
npm run build          # produces dist/index.js
npm run mcpb           # produces pimdo.mcpb (uses dist/)
node dist/index.js     # starts the MCP server on stdio
```

`npm run schemas:generate` regenerates `schemas/tools/*.json` from the Zod input schemas in `src/tools/`. The matching `schemas:check` runs in CI to detect drift.

## FAQ

**Do I need to register my own Entra app?** No — pimdo-ts ships with a shared multi-tenant Entra application (client ID `30cdf00b-19c8-4fe6-94bd-2674ee51a3ff`, published by Co-native AB). Most users can sign in directly. Some tenants require an administrator to grant tenant-wide consent first; an admin can pre-consent the scopes listed above for the shared app, or you can register your own and override `PIMDO_CLIENT_ID` (see "Manual Entra app registration").

**Does pimdo store any of my data?** It caches MSAL tokens (encrypted by MSAL) in your OS config dir under `pimdo-ts/`. No PIM resources, no listings, no approvals. Logout clears the token cache.

**Why both Graph and ARM tokens?** Entra Groups and Entra Roles live in Microsoft Graph; Azure resource roles live in Azure Resource Manager. The same MSAL account gets a token for each resource silently, so login is still one click.

**Can I use a personal Microsoft account?** No — Entra PIM is a work/school feature. Use a tenant where PIM is enabled.

**Why do some tools target Microsoft Graph `beta`?** The Entra-role assignment-approvals surface is currently only available on `beta`. Everything else uses `v1.0`.

## License

MIT — see `LICENSE`.
