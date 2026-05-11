// pimdo-ts entry point — wires the live process environment, MSAL /
// static authenticator, and stdio transport to the library entry in
// `./index.ts`. Kept thin: anything reusable from a test harness or an
// embedding host belongs in the library half.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { Authenticator } from "./auth.js";
import { MsalAuthenticator, StaticAuthenticator, DEFAULT_TENANT_ID } from "./auth.js";
import { openBrowser } from "./browser/open.js";
import { configDir } from "./config.js";
import {
  CLIENT_ID,
  createMcpServer,
  resolveStaticToken,
  validateApiBaseUrl,
  wireShutdownSignals,
} from "./index.js";
import { logger, setLogLevel } from "./logger.js";

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

main().catch((err: unknown) => {
  logger.error("fatal", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
