// Plain-text formatters for the pim_role_entra_* read tools.

import { AssignmentKind } from "../../enums.js";
import type {
  RoleEntraActiveAssignment,
  RoleEntraAssignmentRequest,
  RoleEntraEligibleAssignment,
  User,
} from "../../graph/types.js";
import {
  approvalTag,
  completedTag,
  createdTag,
  expiryTail,
  formatBulletList,
  justificationTail,
  namedLabel,
  requesterTag,
  statusTag,
  type RequesterIdentity,
} from "../../tools/pim/format-shared.js";

function scopeLabel(directoryScopeId: string | undefined): string {
  if (!directoryScopeId || directoryScopeId === "/") return "Directory";
  return directoryScopeId;
}

function graphRequester(principal: User | undefined, principalId: string): RequesterIdentity {
  return {
    upnOrEmail: principal?.userPrincipalName ?? principal?.mail ?? undefined,
    displayName: principal?.displayName,
    id: principal?.id ?? principalId,
  };
}

export function formatEligibleAssignmentsText(
  items: readonly RoleEntraEligibleAssignment[],
): string {
  return formatBulletList(
    items,
    `Eligible PIM Entra-role assignments (${String(items.length)}):`,
    "No eligible PIM Entra-role assignments.",
    (it) =>
      `- ${namedLabel(it.roleDefinitionId, it.roleDefinition)} @ ${scopeLabel(
        it.directoryScopeId,
      )} [eligibility=${it.id}]${statusTag(it.status)}${expiryTail(AssignmentKind.Eligible, it.scheduleInfo?.expiration?.endDateTime)}`,
  );
}

export function formatActiveAssignmentsText(items: readonly RoleEntraActiveAssignment[]): string {
  return formatBulletList(
    items,
    `Active PIM Entra-role assignments (${String(items.length)}):`,
    "No active PIM Entra-role assignments.",
    (it) =>
      `- ${namedLabel(it.roleDefinitionId, it.roleDefinition)} @ ${scopeLabel(
        it.directoryScopeId,
      )} [instance=${it.id}]${expiryTail(AssignmentKind.Active, it.endDateTime)}`,
  );
}

export function formatRequestsText(
  items: readonly RoleEntraAssignmentRequest[],
  perspective: "mine" | "approver",
): string {
  const empty =
    perspective === "mine"
      ? "No pending PIM Entra-role requests submitted by you."
      : "No pending PIM Entra-role approvals assigned to you.";
  const heading =
    perspective === "mine"
      ? `Pending PIM Entra-role requests submitted by you (${String(items.length)}):`
      : `Pending PIM Entra-role approvals assigned to you (${String(items.length)}):`;
  return formatBulletList(
    items,
    heading,
    empty,
    (it) =>
      `- ${namedLabel(it.roleDefinitionId, it.roleDefinition)} @ ${scopeLabel(
        it.directoryScopeId,
      )} [request=${it.id}] action=${it.action ?? "?"}${statusTag(it.status)}${
        perspective === "approver" ? requesterTag(graphRequester(it.principal, it.principalId)) : ""
      }${createdTag(it.createdDateTime)}${completedTag(it.completedDateTime, it.createdDateTime)}${approvalTag(it.approvalId)}${justificationTail(it.justification)}`,
  );
}
