// MCP tool: pim_group_request_list — list pending PIM group activation
// requests submitted by the signed-in user.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  LIST_ELIGIBLE_GROUP_SCOPES,
  LIST_GROUP_REQUESTS_SCOPES,
  listEligibleGroupAssignments,
  listMyGroupRequests,
} from "../client.js";
import type { ServerConfig } from "../../../server-config.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError } from "../../../tools/shared.js";
import { classifyStalePrincipalRequests } from "../../../tools/pim/stale.js";
import { formatRequestsText } from "../format.js";

const inputSchema = z.object({}).shape;

const def: ToolDef = {
  name: "pim_group_request_list",
  title: "List my pending PIM group requests",
  description:
    "List PIM group activation/deactivation requests the signed-in user " +
    "has submitted that are still pending approval. Stale requests " +
    "(selfActivate where the user has lost eligibility) are flagged " +
    "[stale] — they can be retracted via pim_group_request_cancel.",
  requiredScopes: deriveRequiredScopes([LIST_GROUP_REQUESTS_SCOPES, LIST_ELIGIBLE_GROUP_SCOPES]),
};

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (_args, { signal }) => {
    try {
      const items = await listMyGroupRequests(config.graphClient, signal);
      const stale = await classifyStalePrincipalRequests(
        items,
        {
          requestKey: (r) => r.groupId,
          action: (r) => r.action,
          requestId: (r) => r.id,
          liveEligibilityKeys: async (sig) => {
            const eligibilities = await listEligibleGroupAssignments(config.graphClient, sig);
            return new Set(eligibilities.map((e) => e.groupId));
          },
        },
        signal,
      );
      return {
        content: [{ type: "text", text: formatRequestsText(items, "mine", stale) }],
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
