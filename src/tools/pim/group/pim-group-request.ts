// MCP tool: pim_group_request — request activation for one or more
// groups via the requester browser flow.
//
// The AI may pre-fill `items` (eligibilityId + justification + duration);
// the user confirms in the browser. Each row's duration is clamped
// client-side to the per-group policy max-duration (looked up via the
// `roleManagementPolicyAssignments` API). Each confirmed row submits a
// `selfActivate` assignment-schedule request.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { UserCancelledError } from "../../../errors.js";
import { getMyObjectId } from "../../../graph/me.js";
import { listEligibleGroupAssignments, requestGroupActivation } from "../../../graph/pim-group.js";
import { getGroupMaxDuration } from "../../../graph/policies.js";
import type { GroupEligibleAssignment } from "../../../graph/types.js";
import type { ServerConfig } from "../../../server-config.js";
import { logger } from "../../../logger.js";
import { GraphScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError, retryHintForBrowserFlowError } from "../../shared.js";
import type { RequesterRowSpec } from "../../../browser/flows/requester.js";
import { runRequesterFlow } from "../../../browser/flows/requester.js";

const ItemSchema = z.object({
  eligibilityId: z
    .string()
    .min(1)
    .describe("The eligibility schedule id from pim_group_eligible_list."),
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
  name: "pim_group_request",
  title: "Request activation for PIM groups",
  description:
    "Open a browser form for the signed-in user to confirm activation of " +
    "one or more PIM-eligible Entra groups. The user edits justification " +
    "and duration per row, then submits. Each confirmed row creates a " +
    "selfActivate assignment-schedule request via Microsoft Graph.",
  requiredScopes: [
    GraphScope.PrivilegedAccessReadWriteAzureADGroup,
    GraphScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup,
    GraphScope.PrivilegedEligibilityScheduleReadWriteAzureADGroup,
    GraphScope.RoleManagementPolicyReadAzureADGroup,
  ],
};

function pickEligibilities(
  all: readonly GroupEligibleAssignment[],
  items: { eligibilityId: string; justification?: string; duration?: string }[] | undefined,
): {
  selected: { eligibility: GroupEligibleAssignment; justification?: string; duration?: string }[];
  missing: string[];
} {
  if (!items || items.length === 0) {
    return {
      selected: all.map((eligibility) => ({ eligibility })),
      missing: [],
    };
  }
  const byId = new Map(all.map((e) => [e.id, e]));
  const selected: {
    eligibility: GroupEligibleAssignment;
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
      const eligibilities = await listEligibleGroupAssignments(config.graphClient, signal);
      const { selected, missing } = pickEligibilities(eligibilities, args.items);

      if (selected.length === 0) {
        const reason =
          missing.length > 0
            ? `None of the requested eligibility ids matched. Unknown ids: ${missing.join(", ")}.`
            : "No PIM group eligibilities are available for activation.";
        return { content: [{ type: "text", text: reason }] };
      }

      const principalId = await getMyObjectId(config.graphClient, signal);

      // Look up max-duration per group in parallel.
      const rows: RequesterRowSpec[] = await Promise.all(
        selected.map(async (s): Promise<RequesterRowSpec> => {
          const max = await getGroupMaxDuration(config.graphClient, s.eligibility.groupId, signal);
          return {
            id: s.eligibility.id,
            label: s.eligibility.group?.displayName ?? s.eligibility.groupId,
            subtitle: s.eligibility.group?.description ?? s.eligibility.groupId,
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
        try {
          const created = await requestGroupActivation(
            config.graphClient,
            {
              principalId,
              groupId: eligibility.groupId,
              justification: row.justification,
              scheduleInfo: {
                startDateTime: new Date().toISOString(),
                expiration: { type: "afterDuration", duration: row.duration },
              },
            },
            signal,
          );
          const label = eligibility.group?.displayName ?? eligibility.groupId;
          summaries.push(`- ${label}: requested for ${row.duration} [request=${created.id}]`);
        } catch (err) {
          const label = eligibility.group?.displayName ?? eligibility.groupId;
          errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const head =
        summaries.length > 0
          ? `Submitted ${String(summaries.length)} PIM group activation request(s):\n${summaries.join("\n")}`
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

export const pimGroupRequestTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
  handler,
};
