// MCP tool: pim_group_request_list — list pending PIM group activation
// requests submitted by the signed-in user.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listMyGroupRequests } from "../../../graph/pim-group.js";
import type { ServerConfig } from "../../../server-config.js";
import { OAuthScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../shared.js";
import { formatRequestsText } from "./format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_group_request_list",
  title: "List my pending PIM group requests",
  description:
    "List PIM group activation/deactivation requests the signed-in user " +
    "has submitted that are still pending approval.",
  requiredScopes: [OAuthScope.PrivilegedAccessReadWriteAzureADGroup],
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listMyGroupRequests(config.graphClient, signal);
      return {
        content: [{ type: "text", text: formatRequestsText(items, "mine") }],
      };
    } catch (error) {
      return formatError(def.name, error);
    }
  };
}

export const pimGroupRequestListTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  handler,
};
