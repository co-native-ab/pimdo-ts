// MCP tool: pim_group_deactivate — deactivate one or more active PIM
// group assignments via the confirmer browser flow.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { UserCancelledError } from "../../../errors.js";
import { getMyObjectId } from "../../../graph/me.js";
import { listActiveGroupAssignments, requestGroupDeactivation } from "../../../graph/pim-group.js";
import type { GroupActiveAssignment } from "../../../graph/types.js";
import type { ServerConfig } from "../../../index.js";
import { logger } from "../../../logger.js";
import { GraphScope } from "../../../scopes.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError, retryHintForBrowserFlowError } from "../../shared.js";
import type { ConfirmerRowSpec } from "../../../browser/flows/confirmer.js";
import { runConfirmerFlow } from "../../../browser/flows/confirmer.js";

const ItemSchema = z.object({
  instanceId: z
    .string()
    .min(1)
    .describe("The active assignment instance id from pim_group_active_list."),
  reason: z.string().optional().describe("Optional pre-filled reason shown in the browser form."),
});

const inputSchema = z.object({
  items: z
    .array(ItemSchema)
    .optional()
    .describe(
      "Optional preselected active instances. When omitted the user picks " +
        "from all active assignments in the browser form.",
    ),
}).shape;

const def: ToolDef = {
  name: "pim_group_deactivate",
  title: "Deactivate active PIM group assignments",
  description:
    "Open a browser form for the signed-in user to confirm deactivation of " +
    "one or more currently-active PIM group assignments. Each confirmed " +
    "row submits a selfDeactivate assignment-schedule request via Graph.",
  requiredScopes: [
    GraphScope.PrivilegedAccessReadWriteAzureADGroup,
    GraphScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup,
  ],
};

function pickInstances(
  all: readonly GroupActiveAssignment[],
  items: { instanceId: string; reason?: string }[] | undefined,
): {
  selected: { instance: GroupActiveAssignment; reason?: string }[];
  missing: string[];
} {
  if (!items || items.length === 0) {
    return { selected: all.map((instance) => ({ instance })), missing: [] };
  }
  const byId = new Map(all.map((i) => [i.id, i]));
  const selected: { instance: GroupActiveAssignment; reason?: string }[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const instance = byId.get(item.instanceId);
    if (!instance) {
      missing.push(item.instanceId);
      continue;
    }
    selected.push({ instance, reason: item.reason });
  }
  return { selected, missing };
}

function handler(config: ServerConfig): ToolCallback<typeof inputSchema> {
  return async (args, { signal }) => {
    try {
      const active = await listActiveGroupAssignments(config.graphClient, signal);
      const { selected, missing } = pickInstances(active, args.items);

      if (selected.length === 0) {
        const reason =
          missing.length > 0
            ? `None of the requested instance ids matched. Unknown ids: ${missing.join(", ")}.`
            : "No active PIM group assignments to deactivate.";
        return { content: [{ type: "text", text: reason }] };
      }

      const principalId = await getMyObjectId(config.graphClient, signal);

      const rows: ConfirmerRowSpec[] = selected.map(
        (s): ConfirmerRowSpec => ({
          id: s.instance.id,
          label: s.instance.group?.displayName ?? s.instance.groupId,
          subtitle: s.instance.endDateTime
            ? `Active until ${s.instance.endDateTime}`
            : s.instance.groupId,
          prefilledReason: s.reason,
        }),
      );

      const handle = await runConfirmerFlow(
        {
          heading: "Deactivate PIM group assignments",
          subtitle: "Confirm which active assignments to deactivate.",
          submitLabel: "Deactivate",
          reasonLabel: "Reason",
          rows,
        },
        signal,
      );
      try {
        await config.openBrowser(handle.url);
      } catch (err) {
        logger.warn("failed to open browser; URL still printed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const result = await handle.result;

      const instanceById = new Map(selected.map((s) => [s.instance.id, s.instance]));
      const summaries: string[] = [];
      const errors: string[] = [];
      const missingTail =
        missing.length > 0 ? `\n\nIgnored unknown instance ids: ${missing.join(", ")}.` : "";

      for (const row of result.rows) {
        const instance = instanceById.get(row.id);
        if (!instance) {
          errors.push(`unknown instance id ${row.id}`);
          continue;
        }
        try {
          const created = await requestGroupDeactivation(
            config.graphClient,
            {
              principalId,
              groupId: instance.groupId,
              justification: row.reason || "Deactivated via pimdo",
            },
            signal,
          );
          const label = instance.group?.displayName ?? instance.groupId;
          summaries.push(`- ${label}: deactivation requested [request=${created.id}]`);
        } catch (err) {
          const label = instance.group?.displayName ?? instance.groupId;
          errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const head =
        summaries.length > 0
          ? `Submitted ${String(summaries.length)} PIM group deactivation request(s):\n${summaries.join("\n")}`
          : "No deactivations were submitted.";
      const errTail = errors.length > 0 ? `\n\nErrors:\n- ${errors.join("\n- ")}` : "";
      return { content: [{ type: "text", text: `${head}${errTail}${missingTail}` }] };
    } catch (error) {
      if (error instanceof UserCancelledError) {
        return { content: [{ type: "text", text: "Deactivation cancelled." }] };
      }
      return formatError(def.name, error, {
        prefix: "Deactivation failed: ",
        suffix: retryHintForBrowserFlowError(error),
      });
    }
  };
}

export const pimGroupDeactivateTool: Tool<typeof inputSchema> = {
  def,
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  handler,
};
