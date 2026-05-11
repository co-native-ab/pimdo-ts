// Plain-text formatters for the pim_role_entra_* read tools.

import { AssignmentKind } from "../../enums.js";
import type {
  RoleEntraActiveAssignment,
  RoleEntraAssignmentRequest,
  RoleEntraEligibleAssignment,
} from "../../graph/types.js";
import {
  approvalTag,
  expiryTail,
  formatBulletList,
  justificationTail,
  namedLabel,
} from "../../tools/pim/format-shared.js";

function scopeLabel(directoryScopeId: string | undefined): string {
  if (!directoryScopeId || directoryScopeId === "/") return "Directory";
  return directoryScopeId;
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
      )} [eligibility=${it.id}]${expiryTail(AssignmentKind.Eligible, it.scheduleInfo?.expiration?.endDateTime)}`,
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
      )} [request=${it.id}] action=${it.action ?? "?"}${approvalTag(it.approvalId)}${justificationTail(it.justification)}`,
  );
}
