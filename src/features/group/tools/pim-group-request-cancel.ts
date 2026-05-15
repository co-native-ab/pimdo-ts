// MCP tool: pim_group_request_cancel — cancel one or more pending PIM
// group activation requests via the confirmer browser flow. Built from
// {@link buildCancelTool}.

import {
  cancelGroupAssignmentRequest,
  LIST_GROUP_REQUESTS_SCOPES,
  WRITE_GROUP_SCHEDULE_SCOPES,
  listMyGroupRequests,
} from "../client.js";
import type { GroupAssignmentRequest } from "../../../graph/types.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { buildCancelTool } from "../../../tools/pim/factories/cancel.js";

function requestLabel(r: GroupAssignmentRequest): string {
  return r.group?.displayName ?? r.groupId;
}

export const pimGroupRequestCancelTool = buildCancelTool<GroupAssignmentRequest>({
  def: {
    name: "pim_group_request_cancel",
    title: "Cancel pending PIM group requests",
    description:
      "Open a browser form for the signed-in user to confirm cancellation of " +
      "one or more PIM group activation/deactivation requests that are still " +
      "waiting for approval. Each confirmed row POSTs the cancel sub-resource " +
      "via Microsoft Graph.",
    requiredScopes: deriveRequiredScopes([LIST_GROUP_REQUESTS_SCOPES, WRITE_GROUP_SCHEDULE_SCOPES]),
  },
  noun: "PIM group",
  requestListToolName: "pim_group_request_list",
  listPending: (config, signal) => listMyGroupRequests(config.graphClient, signal),
  requestId: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    label: requestLabel(r),
    subtitle: `${r.action ?? "?"} · ${r.status ?? "?"}`,
  }),
  label: requestLabel,
  submit: (config, r, signal) => cancelGroupAssignmentRequest(config.graphClient, r.id, signal),
});
