// Plain-text formatters for the pim_role_entra_* read tools.

import type {
  RoleEntraActiveAssignment,
  RoleEntraAssignmentRequest,
  RoleEntraEligibleAssignment,
} from "../../../graph/types.js";

function roleLabel(
  roleDefinitionId: string,
  roleDefinition: { displayName?: string } | undefined,
): string {
  return roleDefinition?.displayName
    ? `${roleDefinition.displayName} (${roleDefinitionId})`
    : roleDefinitionId;
}

function scopeLabel(directoryScopeId: string | undefined): string {
  if (!directoryScopeId || directoryScopeId === "/") return "Directory";
  return directoryScopeId;
}

export function formatEligibleAssignmentsText(
  items: readonly RoleEntraEligibleAssignment[],
): string {
  if (items.length === 0) {
    return "No eligible PIM Entra-role assignments.";
  }
  const lines = items.map((it) => {
    const expiry = it.scheduleInfo?.expiration?.endDateTime;
    const tail = expiry ? ` — eligible until ${expiry}` : "";
    return `- ${roleLabel(it.roleDefinitionId, it.roleDefinition)} @ ${scopeLabel(
      it.directoryScopeId,
    )} [eligibility=${it.id}]${tail}`;
  });
  return [`Eligible PIM Entra-role assignments (${String(items.length)}):`, ...lines].join("\n");
}

export function formatActiveAssignmentsText(items: readonly RoleEntraActiveAssignment[]): string {
  if (items.length === 0) {
    return "No active PIM Entra-role assignments.";
  }
  const lines = items.map((it) => {
    const tail = it.endDateTime ? ` — active until ${it.endDateTime}` : "";
    return `- ${roleLabel(it.roleDefinitionId, it.roleDefinition)} @ ${scopeLabel(
      it.directoryScopeId,
    )} [instance=${it.id}]${tail}`;
  });
  return [`Active PIM Entra-role assignments (${String(items.length)}):`, ...lines].join("\n");
}

export function formatRequestsText(
  items: readonly RoleEntraAssignmentRequest[],
  perspective: "mine" | "approver",
): string {
  if (items.length === 0) {
    return perspective === "mine"
      ? "No pending PIM Entra-role requests submitted by you."
      : "No pending PIM Entra-role approvals assigned to you.";
  }
  const heading =
    perspective === "mine"
      ? `Pending PIM Entra-role requests submitted by you (${String(items.length)}):`
      : `Pending PIM Entra-role approvals assigned to you (${String(items.length)}):`;
  const lines = items.map((it) => {
    const j = it.justification ? ` — "${it.justification}"` : "";
    const approval = it.approvalId ? ` [approval=${it.approvalId}]` : "";
    return `- ${roleLabel(it.roleDefinitionId, it.roleDefinition)} @ ${scopeLabel(
      it.directoryScopeId,
    )} [request=${it.id}] action=${it.action ?? "?"}${approval}${j}`;
  });
  return [heading, ...lines].join("\n");
}
