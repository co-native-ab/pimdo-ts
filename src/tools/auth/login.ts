// MCP tool: login — interactive browser sign-in to Microsoft Graph.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { UserCancelledError } from "../../errors.js";
import type { ServerConfig } from "../../server-config.js";
import { logger } from "../../logger.js";
import type { Tool, ToolDef } from "../../tool-registry.js";
import { formatError } from "../shared.js";

const inputSchema = {
  claims: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Conditional Access claims-challenge JSON, lifted verbatim from a previous tool's " +
        "step-up error. When provided, AAD prompts the user to satisfy the required " +
        "authentication context (MFA, compliant device, etc.) and the new access token " +
        "carries the matching `acrs` claim. After login succeeds, re-invoke the original tool.",
    ),
  loginHint: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Pre-fills AAD's username field, skipping the account picker. Defaults to the " +
        "currently signed-in user when `claims` is provided. Only set this if a different " +
        "account should satisfy the step-up.",
    ),
};

const def: ToolDef = {
  name: "login",
  title: "Login to Microsoft",
  description:
    "Sign in to Microsoft Graph. Call this tool directly whenever authentication " +
    "is needed - do not ask the user for permission first, just proceed with login. " +
    "Opens a browser for interactive sign-in. " +
    "Once signed in, all other tools work automatically. " +
    "If a previous tool returned a Conditional Access step-up error, pass the " +
    "`claims` value from that error here to satisfy the challenge, then re-invoke " +
    "the original tool.",
  requiredScopes: [],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    const claims = args.claims;
    const loginHint = args.loginHint;
    const isStepUp = claims !== undefined && claims.length > 0;
    try {
      // For step-up the user IS already authenticated — that's the
      // whole point — but we still need to drive a fresh interactive
      // flow so the new token carries the required acrs claim. Skip
      // the "already logged in" short-circuit when claims is set.
      if (!isStepUp && (await config.authenticator.isAuthenticated(signal))) {
        return {
          content: [
            {
              type: "text",
              text: "Already logged in. Use the logout tool first if you want to re-authenticate.",
            },
          ],
        };
      }

      const loginResult = await config.authenticator.login(signal, {
        ...(claims !== undefined ? { claims } : {}),
        ...(loginHint !== undefined ? { loginHint } : {}),
      });
      config.onScopesChanged?.(loginResult.grantedScopes);

      logger.info("browser login completed", { stepUp: isStepUp });
      const suffix = isStepUp
        ? "\n\nStep-up completed. Re-invoke the original tool that triggered the challenge."
        : "";
      return { content: [{ type: "text", text: loginResult.message + suffix }] };
    } catch (error: unknown) {
      if (error instanceof UserCancelledError) {
        return { content: [{ type: "text", text: "Login cancelled." }] };
      }
      return formatError("login", error, {
        prefix: "Login failed: ",
        suffix: "\n\nYou can call this tool again if the user would like to retry.",
      });
    }
  };
}

export const loginTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: true },
  handler,
};
