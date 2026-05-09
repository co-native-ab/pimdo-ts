// MCP tool: pim_group_request — request activation for one or more
// groups via the requester browser flow. Built from {@link buildRequestTool}.

import { getMyObjectId } from "../../../graph/me.js";
import { listEligibleGroupAssignments, requestGroupActivation } from "../../../graph/pim-group.js";
import { getGroupMaxDuration } from "../../../graph/policies.js";
import type { GroupEligibleAssignment } from "../../../graph/types.js";
import { GraphScope } from "../../../scopes.js";
import { buildRequestTool } from "../factories/request.js";

export const pimGroupRequestTool = buildRequestTool<GroupEligibleAssignment>({
  def: {
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
  },
  noun: "PIM group",
  eligibleListToolName: "pim_group_eligible_list",
  emptyStateMessage: "No PIM group eligibilities are available for activation.",
  listEligible: (config, signal) => listEligibleGroupAssignments(config.graphClient, signal),
  eligibilityId: (e) => e.id,
  toRow: async (config, e, prefill, signal) => {
    const max = await getGroupMaxDuration(config.graphClient, e.groupId, signal);
    return {
      id: e.id,
      label: e.group?.displayName ?? e.groupId,
      subtitle: e.group?.description ?? e.groupId,
      maxDuration: max,
      defaultDuration: prefill.defaultDuration,
      prefilledJustification: prefill.justification,
    };
  },
  label: (e) => e.group?.displayName ?? e.groupId,
  submit: (config, e, principalId, row, signal) =>
    requestGroupActivation(
      config.graphClient,
      {
        principalId,
        groupId: e.groupId,
        justification: row.justification,
        scheduleInfo: {
          startDateTime: new Date().toISOString(),
          expiration: { type: "afterDuration", duration: row.duration },
        },
      },
      signal,
    ),
  principalId: (config, signal) => getMyObjectId(config.graphClient, signal),
});
