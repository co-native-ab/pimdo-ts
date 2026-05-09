// MCP tool: pim_role_azure_request — request activation for one or
// more Azure resource roles via the requester browser flow.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  listEligibleRoleAzureAssignments,
  requestRoleAzureActivation,
} from "../../../arm/pim-role-azure.js";
import { getAzureRoleMaxDuration } from "../../../arm/policies.js";
import type { RoleAzureEligibleAssignment } from "../../../arm/types.js";
import { UserCancelledError } from "../../../errors.js";
import { getMyObjectId } from "../../../graph/me.js";
import type { ServerConfig } from "../../../server-config.js";
import { logger } from "../../../logger.js";
import { GraphScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError, retryHintForBrowserFlowError } from "../../shared.js";
import type { RequesterRowSpec } from "../../../browser/flows/requester.js";
import { runRequesterFlow } from "../../../browser/flows/requester.js";
import { roleLabel, scopeFromAssignment, scopeLabel } from "./format.js";

const ItemSchema = z.object({
  eligibilityId: z
    .string()
    .min(1)
    .describe("The eligibility schedule id from pim_role_azure_eligible_list."),
  justification: z
    .string()
    .optional()
    .describe("Optional pre-filled justification shown in the browser form."),
  duration: z
    .string()
    .optional()
    .describe("Optional ISO-8601 duration prefilled in the form (clamped to policy max)."),
});

const inputSchema = z.object({
  items: z
    .array(ItemSchema)
    .optional()
    .describe(
      "Optional preselected eligibilities. When omitted the user picks from " +
        "all eligibilities in the browser form.",
    ),
}).shape;

const def: ToolDef = {
  name: "pim_role_azure_request",
  title: "Request activation for PIM Azure roles",
  description:
    "Open a browser form for the signed-in user to confirm activation of " +
    "one or more PIM-eligible Azure resource roles. The user edits " +
    "justification and duration per row, then submits. Each confirmed " +
    "row creates a SelfActivate role-assignment-schedule request via Azure Resource Manager.",
  requiredScopes: [GraphScope.ArmUserImpersonation],
};

function pickEligibilities(
  all: readonly RoleAzureEligibleAssignment[],
  items: { eligibilityId: string; justification?: string; duration?: string }[] | undefined,
): {
  selected: {
    eligibility: RoleAzureEligibleAssignment;
    justification?: string;
    duration?: string;
  }[];
  missing: string[];
} {
  if (!items || items.length === 0) {
    return { selected: all.map((eligibility) => ({ eligibility })), missing: [] };
  }
  const byId = new Map(all.map((e) => [e.id, e]));
  const selected: {
    eligibility: RoleAzureEligibleAssignment;
    justification?: string;
    duration?: string;
  }[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const eligibility = byId.get(item.eligibilityId);
    if (!eligibility) {
      missing.push(item.eligibilityId);
      continue;
    }
    selected.push({
      eligibility,
      justification: item.justification,
      duration: item.duration,
    });
  }
  return { selected, missing };
}

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const eligibilities = await listEligibleRoleAzureAssignments(config.armClient, signal);
      const { selected, missing } = pickEligibilities(eligibilities, args.items);

      if (selected.length === 0) {
        const reason =
          missing.length > 0
            ? `None of the requested eligibility ids matched. Unknown ids: ${missing.join(", ")}.`
            : "No PIM Azure-role eligibilities are available for activation.";
        return { content: [{ type: "text", text: reason }] };
      }

      const principalId = await getMyObjectId(config.graphClient, signal);

      // Look up max-duration per (scope, role) in parallel.
      const rows: RequesterRowSpec[] = await Promise.all(
        selected.map(async (s): Promise<RequesterRowSpec> => {
          const scope = scopeFromAssignment(s.eligibility);
          if (!scope) {
            throw new Error(
              `eligibility ${s.eligibility.id} has no resolvable ARM scope (missing properties.scope and expandedProperties.scope.id)`,
            );
          }
          const max = await getAzureRoleMaxDuration(
            config.armClient,
            scope,
            s.eligibility.properties.roleDefinitionId,
            signal,
          );
          const label = roleLabel(
            s.eligibility.properties.roleDefinitionId,
            s.eligibility.properties.expandedProperties,
          );
          return {
            id: s.eligibility.id,
            label,
            subtitle: scopeLabel(
              s.eligibility.properties.scope,
              s.eligibility.properties.expandedProperties,
            ),
            maxDuration: max,
            defaultDuration: s.duration,
            prefilledJustification: s.justification,
          };
        }),
      );

      const handle = await runRequesterFlow({ rows }, signal);
      try {
        await config.openBrowser(handle.url);
      } catch (err) {
        logger.warn("failed to open browser; URL still printed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const result = await handle.result;

      const eligibilityById = new Map(selected.map((s) => [s.eligibility.id, s.eligibility]));
      const summaries: string[] = [];
      const errors: string[] = [];
      const missingTail =
        missing.length > 0 ? `\n\nIgnored unknown eligibility ids: ${missing.join(", ")}.` : "";

      for (const row of result.rows) {
        const eligibility = eligibilityById.get(row.id);
        if (!eligibility) {
          errors.push(`unknown eligibility id ${row.id}`);
          continue;
        }
        const scope = scopeFromAssignment(eligibility);
        if (!scope) {
          errors.push(`eligibility ${row.id} has no resolvable ARM scope`);
          continue;
        }
        try {
          const created = await requestRoleAzureActivation(
            config.armClient,
            scope,
            {
              principalId,
              roleDefinitionId: eligibility.properties.roleDefinitionId,
              justification: row.justification,
              scheduleInfo: {
                startDateTime: new Date().toISOString(),
                expiration: { type: "AfterDuration", duration: row.duration },
              },
            },
            signal,
          );
          const label = roleLabel(
            eligibility.properties.roleDefinitionId,
            eligibility.properties.expandedProperties,
          );
          summaries.push(`- ${label}: requested for ${row.duration} [request=${created.id}]`);
        } catch (err) {
          const label = roleLabel(
            eligibility.properties.roleDefinitionId,
            eligibility.properties.expandedProperties,
          );
          errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const head =
        summaries.length > 0
          ? `Submitted ${String(summaries.length)} PIM Azure-role activation request(s):\n${summaries.join("\n")}`
          : "No requests were submitted.";
      const errTail = errors.length > 0 ? `\n\nErrors:\n- ${errors.join("\n- ")}` : "";
      return { content: [{ type: "text", text: `${head}${errTail}${missingTail}` }] };
    } catch (error) {
      if (error instanceof UserCancelledError) {
        return { content: [{ type: "text", text: "Request cancelled." }] };
      }
      return formatError(def.name, error, {
        prefix: "Request failed: ",
        suffix: retryHintForBrowserFlowError(error),
      });
    }
  };
}

export const pimRoleAzureRequestTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
  handler,
};
