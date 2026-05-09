// MCP tool: pim_group_deactivate — deactivate one or more active PIM
// group assignments via the confirmer browser flow. Built from
// {@link buildDeactivateTool}.

import { getMyObjectId } from "../../../graph/me.js";
import { listActiveGroupAssignments, requestGroupDeactivation } from "../../../graph/pim-group.js";
import type { GroupActiveAssignment } from "../../../graph/types.js";
import { OAuthScope } from "../../../scopes.js";
import { buildDeactivateTool } from "../factories/deactivate.js";

export const pimGroupDeactivateTool = buildDeactivateTool<GroupActiveAssignment>({
  def: {
    name: "pim_group_deactivate",
    title: "Deactivate active PIM group assignments",
    description:
      "Open a browser form for the signed-in user to confirm deactivation of " +
      "one or more currently-active PIM group assignments. Each confirmed " +
      "row submits a selfDeactivate assignment-schedule request via Graph.",
    requiredScopes: [
      OAuthScope.PrivilegedAccessReadWriteAzureADGroup,
      OAuthScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup,
    ],
  },
  noun: "PIM group",
  activeListToolName: "pim_group_active_list",
  listActive: (config, signal) => listActiveGroupAssignments(config.graphClient, signal),
  instanceId: (a) => a.id,
  toRow: (a, prefilledReason) => ({
    id: a.id,
    label: a.group?.displayName ?? a.groupId,
    subtitle: a.endDateTime ? `Active until ${a.endDateTime}` : a.groupId,
    prefilledReason,
  }),
  label: (a) => a.group?.displayName ?? a.groupId,
  submit: (config, a, principalId, reason, signal) =>
    requestGroupDeactivation(
      config.graphClient,
      { principalId, groupId: a.groupId, justification: reason },
      signal,
    ),
  principalId: (config, signal) => getMyObjectId(config.graphClient, signal),
});
