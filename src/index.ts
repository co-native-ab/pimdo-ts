// pimdo-ts - MCP server providing AI agents with scoped access to
// Microsoft Entra PIM (Privileged Identity Management).
//
// Entry point: stdio-based MCP server with MSAL authentication
// (browser-only) and a hand-rolled HTTP client per resource (Microsoft
// Graph + Azure Resource Manager).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { Authenticator } from "./auth.js";
import { MsalAuthenticator, StaticAuthenticator, DEFAULT_TENANT_ID } from "./auth.js";
import { ArmClient } from "./arm/client.js";
import { openBrowser } from "./browser/open.js";
import { configDir, migrateConfig } from "./config.js";
import { GraphClient } from "./graph/client.js";
import { logger, setLogLevel } from "./logger.js";
import { Resource, type GraphScope } from "./scopes.js";
import { AUTH_TOOLS } from "./tools/auth/index.js";
import { GROUP_TOOLS } from "./tools/pim/group/index.js";
import { ROLE_AZURE_TOOLS } from "./tools/pim/role-azure/index.js";
import { ROLE_ENTRA_TOOLS } from "./tools/pim/role-entra/index.js";
import type { AnyTool, ToolEntry } from "./tool-registry.js";
import { buildInstructions, registerTool, syncToolState } from "./tool-registry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

declare const __VERSION__: string;
export const VERSION: string = __VERSION__;

/**
 * Azure AD (Entra ID) multi-tenant app registration client ID for the
 * shared `pimdo-ts` Entra application. Override via `PIMDO_CLIENT_ID`
 * to use a custom registration in your own tenant.
 */
export const CLIENT_ID = "30cdf00b-19c8-4fe6-94bd-2674ee51a3ff";

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

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
  onScopesChanged?: (grantedScopes: GraphScope[]) => void;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

/** Create a configured McpServer instance with all tools registered. */
export async function createMcpServer(
  opts: Omit<ServerConfig, "graphClient" | "graphBetaClient" | "armClient">,
  signal: AbortSignal,
): Promise<McpServer> {
  // All tools the server exposes, in instruction-listing order.
  // PIM tool surfaces (group / role-entra / role-azure) are added in
  // phases 2-4; phase 4 adds the seven Azure-role tools.
  const allTools: readonly AnyTool[] = [
    ...AUTH_TOOLS,
    ...GROUP_TOOLS,
    ...ROLE_ENTRA_TOOLS,
    ...ROLE_AZURE_TOOLS,
  ];

  const mcpServer = new McpServer(
    { name: "pimdo", version: VERSION },
    {
      capabilities: { logging: {} },
      instructions: buildInstructions(allTools.map((t) => t.def)),
    },
  );

  // Single client per resource for the lifetime of this server. Each
  // client treats the authenticator as a per-resource TokenCredential.
  const graphClient = new GraphClient(opts.graphBaseUrl, {
    getToken: (s: AbortSignal) => opts.authenticator.tokenForResource(Resource.Graph, s),
  });
  const graphBetaClient = new GraphClient(opts.graphBetaBaseUrl, {
    getToken: (s: AbortSignal) => opts.authenticator.tokenForResource(Resource.Graph, s),
  });
  const armClient = new ArmClient(opts.armBaseUrl, {
    getToken: (s: AbortSignal) => opts.authenticator.tokenForResource(Resource.Arm, s),
  });

  const config: ServerConfig = { ...opts, graphClient, graphBetaClient, armClient };

  // Register every tool descriptor in a single loop. The descriptor is the
  // single source of truth for metadata, schemas, annotations, and handler.
  const registry: ToolEntry[] = allTools.map((tool) => registerTool(mcpServer, config, tool));

  // Disable all scope-gated tools initially
  for (const entry of registry) {
    if (entry.requiredScopes.length > 0) {
      entry.registeredTool.disable();
    }
  }

  // Wire up the callback that login/logout tools use to sync tool visibility
  config.onScopesChanged = (grantedScopes: GraphScope[]) => {
    syncToolState(registry, grantedScopes, mcpServer);
  };

  // Forward-compatible startup migration hook. Currently a no-op (pimdo
  // has no on-disk schema yet); kept so adding versioned config later
  // is a single-file change. The status is intentionally ignored until
  // a real migration is added.
  try {
    await migrateConfig(opts.configDir, signal);
  } catch (err: unknown) {
    logger.warn("startup config migration failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Check startup auth state — if already authenticated, enable matching tools
  try {
    if (await opts.authenticator.isAuthenticated(signal)) {
      const scopes = await opts.authenticator.grantedScopes(signal);
      if (scopes.length > 0) {
        syncToolState(registry, scopes, mcpServer);
      }
    }
  } catch {
    // Startup check failure is non-fatal — tools stay disabled
    logger.debug("startup auth check failed, tools remain disabled");
  }

  return mcpServer;
}

// ---------------------------------------------------------------------------
// Shutdown wiring
// ---------------------------------------------------------------------------

/**
 * Signal sources that trigger a graceful shutdown. Narrower than
 * `NodeJS.Process` / `NodeJS.ReadStream` so tests can pass stand-ins.
 */
export interface ShutdownProcess {
  once(event: "SIGINT" | "SIGTERM" | "SIGHUP", listener: () => void): unknown;
}
export interface ShutdownStdin {
  once(event: "end" | "close", listener: () => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
}

/**
 * Subscribe `shutdown` to every signal source that should terminate the
 * MCP server: SIGINT, SIGTERM, SIGHUP, and stdin end/close/error. The
 * stdin hooks matter on Copilot CLI reload — the CLI closes our pipe
 * but does not always deliver SIGTERM, and `StdioServerTransport.onclose`
 * does not always fire. Without this, orphan pimdo-ts processes
 * survive the reload and hold resources hostage.
 *
 * Idempotent per controller: repeated triggers after abort are no-ops.
 * Exported for unit testing; wire with the live process/stdin in main.
 */
export function wireShutdownSignals(
  shutdown: AbortController,
  proc: ShutdownProcess,
  stdin: ShutdownStdin,
): void {
  const trigger = (name: string): void => {
    if (shutdown.signal.aborted) return;
    logger.info("shutdown signal received", { signal: name });
    shutdown.abort(new Error(name));
  };
  proc.once("SIGINT", () => trigger("SIGINT"));
  proc.once("SIGTERM", () => trigger("SIGTERM"));
  proc.once("SIGHUP", () => trigger("SIGHUP"));
  stdin.once("end", () => trigger("stdin-end"));
  stdin.once("close", () => trigger("stdin-close"));
  stdin.on("error", (err: Error) => {
    logger.warn("stdin error", { error: err.message });
    trigger("stdin-error");
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.env["PIMDO_DEBUG"] === "true") {
    setLogLevel("debug");
  }

  const shutdown = new AbortController();
  wireShutdownSignals(shutdown, process, process.stdin);

  const cfgDir = configDir(process.env["PIMDO_CONFIG_DIR"]);
  logger.debug("config directory", { path: cfgDir });

  const staticToken = process.env["PIMDO_ACCESS_TOKEN"];
  const clientId = process.env["PIMDO_CLIENT_ID"] ?? CLIENT_ID;
  const tenantId = process.env["PIMDO_TENANT_ID"] ?? DEFAULT_TENANT_ID;
  const authenticator: Authenticator = staticToken
    ? new StaticAuthenticator(staticToken)
    : new MsalAuthenticator(clientId, tenantId, cfgDir, openBrowser);

  const graphBaseUrl = process.env["PIMDO_GRAPH_URL"] ?? "https://graph.microsoft.com/v1.0";
  const graphBetaBaseUrl =
    process.env["PIMDO_GRAPH_BETA_URL"] ?? "https://graph.microsoft.com/beta";
  const armBaseUrl = process.env["PIMDO_ARM_URL"] ?? "https://management.azure.com";

  const server = await createMcpServer(
    {
      authenticator,
      graphBaseUrl,
      graphBetaBaseUrl,
      armBaseUrl,
      configDir: cfgDir,
      openBrowser,
    },
    shutdown.signal,
  );
  const transport = new StdioServerTransport();

  await server.connect(transport);
  logger.info("server started on stdio");

  await new Promise<void>((resolve) => {
    transport.onclose = () => {
      logger.info("transport closed");
      resolve();
    };
    shutdown.signal.addEventListener(
      "abort",
      () => {
        logger.info("shutting down");
        resolve();
      },
      { once: true },
    );
  });
}

// Auto-start only when running as the entry point (not when imported by tests).
if (!process.env["VITEST"]) {
  main().catch((err: unknown) => {
    logger.error("fatal", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
