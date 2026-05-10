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
import { Resource, type OAuthScope } from "./scopes.js";
import type { ServerConfig } from "./server-config.js";
import { AUTH_TOOLS } from "./tools/auth/index.js";
import { GROUP_TOOLS } from "./tools/pim/group/index.js";
import { ROLE_AZURE_TOOLS } from "./tools/pim/role-azure/index.js";
import { ROLE_ENTRA_TOOLS } from "./tools/pim/role-entra/index.js";
import type { AnyTool, ToolEntry } from "./tool-registry.js";
import { buildInstructions, registerTool, syncToolState } from "./tool-registry.js";

// Re-exported for backward compatibility — `ServerConfig` lives in
// `./server-config.js` so leaf tool files don't need to import from the
// composition root.
export type { ServerConfig } from "./server-config.js";

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
// MCP Server
// ---------------------------------------------------------------------------

/** Create a configured McpServer instance with all tools registered. */
export async function createMcpServer(
  opts: Omit<ServerConfig, "graphClient" | "graphBetaClient" | "armClient">,
  signal: AbortSignal,
): Promise<McpServer> {
  // All tools the server exposes, in instruction-listing order.
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
  config.onScopesChanged = (grantedScopes: OAuthScope[]) => {
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
// API base URL validation
// ---------------------------------------------------------------------------

/**
 * Allow-list of Microsoft Graph and Azure Resource Manager hostnames that
 * may receive delegated Bearer access tokens. Covers the public cloud and
 * the published sovereign clouds (US Government, US Government DoD, China,
 * and the now-retired Germany cloud — kept for completeness).
 *
 * A misconfigured `PIMDO_*_URL` env var pointing at any other host would
 * silently exfiltrate the user's access token to an arbitrary endpoint,
 * so the default policy is to refuse those URLs. Set
 * `PIMDO_ALLOW_INSECURE_API_HOSTS=true` to opt out (intended for local
 * test harnesses pointing at non-loopback mocks; never for production).
 */
const ALLOWED_API_HOSTS: readonly string[] = [
  // Microsoft Graph (public + sovereign clouds)
  "graph.microsoft.com",
  "graph.microsoft.us",
  "dod-graph.microsoft.us",
  "microsoftgraph.chinacloudapi.cn",
  "graph.microsoft.de",
  // Azure Resource Manager (public + sovereign clouds)
  "management.azure.com",
  "management.usgovcloudapi.net",
  "management.chinacloudapi.cn",
  "management.microsoftazure.de",
];

/**
 * Reject any API base URL that would cause the Graph or ARM HTTP clients
 * to send a delegated Bearer token over plaintext to a non-loopback host
 * or to an unrecognised cloud endpoint.
 *
 * - Must parse as an absolute URL.
 * - `https://` is allowed only when the hostname is in the Microsoft
 *   allow-list above, unless `allowInsecureHosts` is `true`.
 * - `http://` is only allowed when the host is `localhost` or `127.0.0.1`
 *   (the test harness uses loopback HTTP for the mock Graph/ARM servers).
 *
 * Throws on any other value. Called once for each `PIMDO_*_URL` env var
 * before the corresponding HTTP client is constructed.
 */
export function validateApiBaseUrl(envName: string, url: string, allowInsecureHosts = false): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${envName}: not a valid absolute URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol === "https:") {
    if (allowInsecureHosts) return;
    if (ALLOWED_API_HOSTS.includes(parsed.hostname)) return;
    throw new Error(
      `${envName}: host ${parsed.hostname} is not a recognised Microsoft Graph or ARM endpoint. ` +
        `Set PIMDO_ALLOW_INSECURE_API_HOSTS=true to bypass (testing only).`,
    );
  }
  if (parsed.protocol === "http:") {
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1") return;
    throw new Error(
      `${envName}: plain http:// is only allowed for localhost / 127.0.0.1, got ${parsed.hostname}`,
    );
  }
  throw new Error(`${envName}: unsupported protocol ${parsed.protocol}`);
}

/**
 * Resolve the optional `PIMDO_ACCESS_TOKEN` static-token bypass.
 *
 * The static-token path replaces MSAL with a caller-supplied Bearer
 * token. It is intended for local development and integration tests
 * only. To prevent an attacker who can set environment variables (for
 * example via a compromised MCP client config) from silently swapping
 * authentication, the bypass requires an explicit interlock:
 * `PIMDO_ALLOW_STATIC_TOKEN=true` must also be set.
 *
 * Returns the token when both env vars are set correctly, `undefined`
 * when no static token is configured, and throws when the token is set
 * without the interlock.
 */
export function resolveStaticToken(env: Readonly<Record<string, string | undefined>>): {
  token: string | undefined;
} {
  const token = env["PIMDO_ACCESS_TOKEN"];
  if (!token) return { token: undefined };
  if (env["PIMDO_ALLOW_STATIC_TOKEN"] !== "true") {
    throw new Error(
      "PIMDO_ACCESS_TOKEN is set but PIMDO_ALLOW_STATIC_TOKEN=true is required to enable the " +
        "static-token bypass. The static-token path is intended for local development and tests " +
        "only; refusing to start to avoid silently replacing the MSAL login flow.",
    );
  }
  return { token };
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

  const { token: staticToken } = resolveStaticToken(process.env);
  const clientId = process.env["PIMDO_CLIENT_ID"] ?? CLIENT_ID;
  const tenantId = process.env["PIMDO_TENANT_ID"] ?? DEFAULT_TENANT_ID;
  const authenticator: Authenticator = staticToken
    ? new StaticAuthenticator(staticToken)
    : new MsalAuthenticator(clientId, tenantId, cfgDir, openBrowser);

  const graphBaseUrl = process.env["PIMDO_GRAPH_URL"] ?? "https://graph.microsoft.com/v1.0";
  const graphBetaBaseUrl =
    process.env["PIMDO_GRAPH_BETA_URL"] ?? "https://graph.microsoft.com/beta";
  const armBaseUrl = process.env["PIMDO_ARM_URL"] ?? "https://management.azure.com";

  // Defence-in-depth: every API base URL receives a Bearer access token
  // on every request. Refuse plaintext (`http://`) URLs unless they
  // point at a loopback address (used by the test harness), and refuse
  // `https://` URLs whose host is not a recognised Microsoft Graph or
  // ARM endpoint, so a misconfigured `PIMDO_*_URL` env var cannot
  // silently exfiltrate user-delegated tokens to an arbitrary HTTP
  // host. `PIMDO_ALLOW_INSECURE_API_HOSTS=true` opts out for testing.
  const allowInsecureHosts = process.env["PIMDO_ALLOW_INSECURE_API_HOSTS"] === "true";
  validateApiBaseUrl("PIMDO_GRAPH_URL", graphBaseUrl, allowInsecureHosts);
  validateApiBaseUrl("PIMDO_GRAPH_BETA_URL", graphBetaBaseUrl, allowInsecureHosts);
  validateApiBaseUrl("PIMDO_ARM_URL", armBaseUrl, allowInsecureHosts);

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
