// MCP tool: pim_role_entra_deactivate — deactivate one or more active
// PIM Entra-role assignments via the confirmer browser flow. Built from
// {@link buildDeactivateTool}.

import { GET_MY_OBJECT_ID_SCOPES, getMyObjectId } from "../../../graph/me.js";
import {
  DIRECTORY_SCOPE_ROOT,
  LIST_ACTIVE_ROLE_ENTRA_SCOPES,
  ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
  listActiveRoleEntraAssignments,
  requestRoleEntraDeactivation,
} from "../client.js";
import type { RoleEntraActiveAssignment } from "../../../graph/types.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { buildDeactivateTool } from "../../../tools/pim/factories/deactivate.js";

function scopeLabel(directoryScopeId: string | undefined): string {
  if (!directoryScopeId || directoryScopeId === "/") return "Directory";
  return directoryScopeId;
}

export const pimRoleEntraDeactivateTool = buildDeactivateTool<RoleEntraActiveAssignment>({
  def: {
    name: "pim_role_entra_deactivate",
    title: "Deactivate active PIM Entra-role assignments",
    description:
      "Open a browser form for the signed-in user to confirm deactivation of " +
      "one or more currently-active PIM Entra-role assignments. Each confirmed " +
      "row submits a selfDeactivate role-assignment-schedule request via Graph.",
    requiredScopes: deriveRequiredScopes([
      LIST_ACTIVE_ROLE_ENTRA_SCOPES,
      GET_MY_OBJECT_ID_SCOPES,
      ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
    ]),
  },
  noun: "PIM Entra-role",
  activeListToolName: "pim_role_entra_active_list",
  listActive: (config, signal) => listActiveRoleEntraAssignments(config.graphClient, signal),
  instanceId: (a) => a.id,
  toRow: (a, prefilledReason) => ({
    id: a.id,
    label: a.roleDefinition?.displayName ?? a.roleDefinitionId,
    subtitle: a.endDateTime
      ? `${scopeLabel(a.directoryScopeId)} — Active until ${a.endDateTime}`
      : scopeLabel(a.directoryScopeId),
    prefilledReason,
  }),
  label: (a) => a.roleDefinition?.displayName ?? a.roleDefinitionId,
  submit: (config, a, principalId, reason, signal) =>
    requestRoleEntraDeactivation(
      config.graphClient,
      {
        principalId,
        roleDefinitionId: a.roleDefinitionId,
        directoryScopeId: a.directoryScopeId ?? DIRECTORY_SCOPE_ROOT,
        justification: reason,
      },
      signal,
    ),
  principalId: (config, signal) => getMyObjectId(config.graphClient, signal),
});
