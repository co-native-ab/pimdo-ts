// Configuration object passed to every MCP tool handler.
//
// Lives in its own module (rather than `src/index.ts`) so leaf tool files
// never have to import from the composition root. `index.ts` re-exports
// {@link ServerConfig} for backward compatibility.

import type { Authenticator } from "./auth.js";
import type { ArmClient } from "./arm/client.js";
import type { GraphClient } from "./graph/client.js";
import type { OAuthScope } from "./scopes.js";
import type { ToolDef } from "./tool-registry.js";

/** Configuration for the MCP server - all dependencies injected here. */
export interface ServerConfig {
  authenticator: Authenticator;
  graphBaseUrl: string;
  /** Beta-channel Microsoft Graph base URL (e.g., `https://graph.microsoft.com/beta`). */
  graphBetaBaseUrl: string;
  armBaseUrl: string;
  configDir: string;
  /**
   * Single GraphClient instance shared across all tool handlers.
   * Uses the authenticator as a TokenCredential — tokens are fetched (and
   * silently refreshed) on every Graph API request, which is correct for
   * long-running MCP server instances.
   */
  graphClient: GraphClient;
  /**
   * Beta-channel Microsoft Graph client. Used by the small set of PIM
   * features that are only available on `https://graph.microsoft.com/beta`
   * (notably the Entra-role assignment-approvals surface).
   */
  graphBetaClient: GraphClient;
  /**
   * Single ArmClient instance shared across all tool handlers. Like
   * {@link graphClient} but targets Azure Resource Manager via
   * `tokenForResource(Resource.Arm, …)`.
   */
  armClient: ArmClient;
  /** Opens a URL in the system browser. Injected for testability. */
  openBrowser: (url: string) => Promise<void>;
  /** Set by createMcpServer() — login/logout tools call this to sync tool visibility. */
  onScopesChanged?: (grantedScopes: OAuthScope[]) => void;
  /**
   * Set by createMcpServer() — the static metadata for every tool the
   * server knows about. Used by `auth_status` to surface tools that are
   * currently hidden because their `requiredScopes` are not satisfied
   * by the granted scope set, including which scopes are missing.
   */
  toolDefs?: readonly ToolDef[];
}
