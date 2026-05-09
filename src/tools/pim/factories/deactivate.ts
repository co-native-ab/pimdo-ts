// Factory for `pim_<surface>_deactivate` tools.
//
// All three deactivate tools (group / role-entra / role-azure) follow the
// identical pattern: list active assignments, optionally filter by a
// caller-supplied list of instance ids, render the confirmer browser flow,
// and submit a self-deactivate request per confirmed row. Only the data
// types, the list/submit functions, and the wording differ — those are the
// per-surface plug-points captured by {@link DeactivateAdapter}.

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ConfirmerRowSpec } from "../../../browser/flows/confirmer.js";
import { runConfirmerFlow } from "../../../browser/flows/confirmer.js";
import { UserCancelledError } from "../../../errors.js";
import type { ServerConfig } from "../../../server-config.js";
import { logger } from "../../../logger.js";
import type { Tool, ToolDef } from "../../../tool-registry.js";
import { formatError, retryHintForBrowserFlowError } from "../../shared.js";

/** Per-surface plug-points for the deactivate tool factory. */
export interface DeactivateAdapter<Active> {
  /** Tool descriptor (name, title, description, requiredScopes). */
  readonly def: ToolDef;
  /** Friendly noun used in summary messages (e.g. `"PIM group"`). */
  readonly noun: string;
  /** Name of the companion `*_active_list` tool (referenced in the input schema doc). */
  readonly activeListToolName: string;
  /** List currently-active assignments for the signed-in user. */
  readonly listActive: (config: ServerConfig, signal: AbortSignal) => Promise<readonly Active[]>;
  /** Extract the instance id used in the input schema. */
  readonly instanceId: (a: Active) => string;
  /** Render an active assignment as a confirmer row. */
  readonly toRow: (a: Active, prefilledReason: string | undefined) => ConfirmerRowSpec;
  /** Human-readable label used in summaries / error reporting. */
  readonly label: (a: Active) => string;
  /** Submit a self-deactivate request for `a`, returning the created request. */
  readonly submit: (
    config: ServerConfig,
    a: Active,
    principalId: string,
    reason: string,
    signal: AbortSignal,
  ) => Promise<{ id: string }>;
  /** Resolve the principal (object) id for the signed-in user. */
  readonly principalId: (config: ServerConfig, signal: AbortSignal) => Promise<string>;
}

function buildInputSchema(activeListToolName: string) {
  const ItemSchema = z.object({
    instanceId: z
      .string()
      .min(1)
      .describe(`The active assignment instance id from ${activeListToolName}.`),
    reason: z.string().optional().describe("Optional pre-filled reason shown in the browser form."),
  });
  return z.object({
    items: z
      .array(ItemSchema)
      .optional()
      .describe(
        "Optional preselected active instances. When omitted the user picks " +
          "from all active assignments in the browser form.",
      ),
  }).shape;
}

export type DeactivateInputSchema = ReturnType<typeof buildInputSchema>;

/**
 * Build a `pim_<surface>_deactivate` MCP tool from a per-surface adapter.
 * The returned tool annotations are always
 * `{ readOnlyHint: false, destructiveHint: true, idempotentHint: false }`.
 */
export function buildDeactivateTool<Active>(
  adapter: DeactivateAdapter<Active>,
): Tool<DeactivateInputSchema> {
  const inputSchema = buildInputSchema(adapter.activeListToolName);
  const handler = (config: ServerConfig): ToolCallback<DeactivateInputSchema> => {
    return async (args, { signal }) => {
      try {
        const active = await adapter.listActive(config, signal);
        const { selected, missing } = pickInstances(active, args.items, adapter.instanceId);

        if (selected.length === 0) {
          const reason =
            missing.length > 0
              ? `None of the requested instance ids matched. Unknown ids: ${missing.join(", ")}.`
              : `No active ${adapter.noun} assignments to deactivate.`;
          return { content: [{ type: "text", text: reason }] };
        }

        const principalId = await adapter.principalId(config, signal);

        const rows: ConfirmerRowSpec[] = selected.map((s) => adapter.toRow(s.instance, s.reason));

        const handle = await runConfirmerFlow(
          {
            heading: `Deactivate ${adapter.noun} assignments`,
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

        const instanceById = new Map(
          selected.map((s) => [adapter.instanceId(s.instance), s.instance]),
        );
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
          const label = adapter.label(instance);
          try {
            const created = await adapter.submit(
              config,
              instance,
              principalId,
              row.reason || "Deactivated via pimdo",
              signal,
            );
            summaries.push(`- ${label}: deactivation requested [request=${created.id}]`);
          } catch (err) {
            errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const head =
          summaries.length > 0
            ? `Submitted ${String(summaries.length)} ${adapter.noun} deactivation request(s):\n${summaries.join("\n")}`
            : "No deactivations were submitted.";
        const errTail = errors.length > 0 ? `\n\nErrors:\n- ${errors.join("\n- ")}` : "";
        return { content: [{ type: "text", text: `${head}${errTail}${missingTail}` }] };
      } catch (error) {
        if (error instanceof UserCancelledError) {
          return { content: [{ type: "text", text: "Deactivation cancelled." }] };
        }
        return formatError(adapter.def.name, error, {
          prefix: "Deactivation failed: ",
          suffix: retryHintForBrowserFlowError(error),
        });
      }
    };
  };

  return {
    def: adapter.def,
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler,
  };
}

function pickInstances<Active>(
  all: readonly Active[],
  items: { instanceId: string; reason?: string }[] | undefined,
  getId: (a: Active) => string,
): {
  selected: { instance: Active; reason?: string }[];
  missing: string[];
} {
  if (!items || items.length === 0) {
    return { selected: all.map((instance) => ({ instance })), missing: [] };
  }
  const byId = new Map(all.map((i) => [getId(i), i]));
  const selected: { instance: Active; reason?: string }[] = [];
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
