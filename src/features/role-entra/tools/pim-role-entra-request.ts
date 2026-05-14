// MCP tool: pim_role_entra_request — request activation for one or
// more Entra (directory) roles via the requester browser flow. Built
// from {@link buildRequestTool}.

import { GET_MY_OBJECT_ID_SCOPES, getMyObjectId } from "../../../graph/me.js";
import {
  DIRECTORY_SCOPE_ROOT,
  LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
  ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
  listEligibleRoleEntraAssignments,
  requestRoleEntraActivation,
} from "../client.js";
import {
  GET_DIRECTORY_ROLE_MAX_DURATION_SCOPES,
  getDirectoryRoleMaxDuration,
} from "../../../graph/policies.js";
import type { RoleEntraEligibleAssignment } from "../../../graph/types.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { buildRequestTool } from "../../../tools/pim/factories/request.js";

function scopeLabel(directoryScopeId: string | undefined): string {
  if (!directoryScopeId || directoryScopeId === "/") return "Directory";
  return directoryScopeId;
}

export const pimRoleEntraRequestTool = buildRequestTool<RoleEntraEligibleAssignment>({
  def: {
    name: "pim_role_entra_request",
    title: "Request activation for PIM Entra roles",
    description:
      "Open a browser form for the signed-in user to confirm activation of " +
      "one or more PIM-eligible Entra (directory) roles. The user edits " +
      "justification and duration per row, then submits. Each confirmed " +
      "row creates a selfActivate role-assignment-schedule request via Microsoft Graph.",
    // Auto-derived from the four call sites this tool exercises:
    // listEligibleRoleEntraAssignments, getDirectoryRoleMaxDuration,
    // getMyObjectId, requestRoleEntraActivation.
    requiredScopes: deriveRequiredScopes([
      LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
      GET_DIRECTORY_ROLE_MAX_DURATION_SCOPES,
      GET_MY_OBJECT_ID_SCOPES,
      ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
    ]),
  },
  noun: "PIM Entra-role",
  eligibleListToolName: "pim_role_entra_eligible_list",
  emptyStateMessage: "No PIM Entra-role eligibilities are available for activation.",
  listEligible: (config, signal) => listEligibleRoleEntraAssignments(config.graphClient, signal),
  eligibilityId: (e) => e.id,
  toRow: async (config, e, prefill, signal) => {
    const scopeId = e.directoryScopeId ?? DIRECTORY_SCOPE_ROOT;
    const max = await getDirectoryRoleMaxDuration(
      config.graphClient,
      e.roleDefinitionId,
      signal,
      scopeId,
    );
    return {
      id: e.id,
      label: e.roleDefinition?.displayName ?? e.roleDefinitionId,
      subtitle: `${scopeLabel(e.directoryScopeId)} — ${
        e.roleDefinition?.description ?? e.roleDefinitionId
      }`,
      maxDuration: max,
      defaultDuration: prefill.defaultDuration,
      prefilledJustification: prefill.justification,
    };
  },
  label: (e) => e.roleDefinition?.displayName ?? e.roleDefinitionId,
  submit: (config, e, principalId, row, signal) =>
    requestRoleEntraActivation(
      config.graphClient,
      {
        principalId,
        roleDefinitionId: e.roleDefinitionId,
        directoryScopeId: e.directoryScopeId ?? DIRECTORY_SCOPE_ROOT,
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
