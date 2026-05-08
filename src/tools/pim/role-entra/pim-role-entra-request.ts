// MCP tool: pim_role_entra_request — request activation for one or
// more Entra (directory) roles via the requester browser flow.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { UserCancelledError } from "../../../errors.js";
import { getMyObjectId } from "../../../graph/me.js";
import {
  DIRECTORY_SCOPE_ROOT,
  listEligibleRoleEntraAssignments,
  requestRoleEntraActivation,
} from "../../../graph/pim-role-entra.js";
import { getDirectoryRoleMaxDuration } from "../../../graph/policies.js";
import type { RoleEntraEligibleAssignment } from "../../../graph/types.js";
import type { ServerConfig } from "../../../index.js";
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
    .describe("The eligibility schedule id from pim_role_entra_eligible_list."),
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
  name: "pim_role_entra_request",
  title: "Request activation for PIM Entra roles",
  description:
    "Open a browser form for the signed-in user to confirm activation of " +
    "one or more PIM-eligible Entra (directory) roles. The user edits " +
    "justification and duration per row, then submits. Each confirmed " +
    "row creates a selfActivate role-assignment-schedule request via Microsoft Graph.",
  requiredScopes: [
    GraphScope.RoleManagementReadWriteDirectory,
    GraphScope.RoleAssignmentScheduleReadWriteDirectory,
    GraphScope.RoleEligibilityScheduleReadWriteDirectory,
  ],
};

function pickEligibilities(
  all: readonly RoleEntraEligibleAssignment[],
  items: { eligibilityId: string; justification?: string; duration?: string }[] | undefined,
): {
  selected: {
    eligibility: RoleEntraEligibleAssignment;
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
    eligibility: RoleEntraEligibleAssignment;
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

function scopeLabel(directoryScopeId: string | undefined): string {
  if (!directoryScopeId || directoryScopeId === "/") return "Directory";
  return directoryScopeId;
}

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const eligibilities = await listEligibleRoleEntraAssignments(config.graphClient, signal);
      const { selected, missing } = pickEligibilities(eligibilities, args.items);

      if (selected.length === 0) {
        const reason =
          missing.length > 0
            ? `None of the requested eligibility ids matched. Unknown ids: ${missing.join(", ")}.`
            : "No PIM Entra-role eligibilities are available for activation.";
        return { content: [{ type: "text", text: reason }] };
      }

      const principalId = await getMyObjectId(config.graphClient, signal);

      // Look up max-duration per (role, scope) in parallel.
      const rows: RequesterRowSpec[] = await Promise.all(
        selected.map(async (s): Promise<RequesterRowSpec> => {
          const scopeId = s.eligibility.directoryScopeId ?? DIRECTORY_SCOPE_ROOT;
          const max = await getDirectoryRoleMaxDuration(
            config.graphClient,
            s.eligibility.roleDefinitionId,
            signal,
            scopeId,
          );
          const label = s.eligibility.roleDefinition?.displayName ?? s.eligibility.roleDefinitionId;
          return {
            id: s.eligibility.id,
            label,
            subtitle: `${scopeLabel(s.eligibility.directoryScopeId)} — ${
              s.eligibility.roleDefinition?.description ?? s.eligibility.roleDefinitionId
            }`,
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
          const created = await requestRoleEntraActivation(
            config.graphClient,
            {
              principalId,
              roleDefinitionId: eligibility.roleDefinitionId,
              directoryScopeId: eligibility.directoryScopeId ?? DIRECTORY_SCOPE_ROOT,
              justification: row.justification,
              scheduleInfo: {
                startDateTime: new Date().toISOString(),
                expiration: { type: "afterDuration", duration: row.duration },
              },
            },
            signal,
          );
          const label = eligibility.roleDefinition?.displayName ?? eligibility.roleDefinitionId;
          summaries.push(`- ${label}: requested for ${row.duration} [request=${created.id}]`);
        } catch (err) {
          const label = eligibility.roleDefinition?.displayName ?? eligibility.roleDefinitionId;
          errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const head =
        summaries.length > 0
          ? `Submitted ${String(summaries.length)} PIM Entra-role activation request(s):\n${summaries.join("\n")}`
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

export const pimRoleEntraRequestTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
  handler,
};
