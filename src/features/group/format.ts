// Plain-text formatters for the pim_group_* read tools.

import { AssignmentKind } from "../../enums.js";
import type {
  GroupActiveAssignment,
  GroupAssignmentRequest,
  GroupEligibleAssignment,
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
  staleTag,
  statusTag,
  type RequesterIdentity,
} from "../../tools/pim/format-shared.js";

function graphRequester(principal: User | undefined, principalId: string): RequesterIdentity {
  return {
    upnOrEmail: principal?.userPrincipalName ?? principal?.mail ?? undefined,
    displayName: principal?.displayName,
    id: principal?.id ?? principalId,
  };
}

export function formatEligibleAssignmentsText(items: readonly GroupEligibleAssignment[]): string {
  return formatBulletList(
    items,
    `Eligible PIM group assignments (${String(items.length)}):`,
    "No eligible PIM group assignments.",
    (it) =>
      `- ${namedLabel(it.groupId, it.group)} [eligibility=${it.id}]${statusTag(it.status)}${expiryTail(
        AssignmentKind.Eligible,
        it.scheduleInfo?.expiration?.endDateTime,
      )}`,
  );
}

export function formatActiveAssignmentsText(items: readonly GroupActiveAssignment[]): string {
  return formatBulletList(
    items,
    `Active PIM group assignments (${String(items.length)}):`,
    "No active PIM group assignments.",
    (it) =>
      `- ${namedLabel(it.groupId, it.group)} [instance=${it.id}]${expiryTail(AssignmentKind.Active, it.endDateTime)}`,
  );
}

export function formatRequestsText(
  items: readonly GroupAssignmentRequest[],
  perspective: "mine" | "approver",
  staleIds: ReadonlySet<string> = new Set(),
): string {
  const empty =
    perspective === "mine"
      ? "No pending PIM group requests submitted by you."
      : "No pending PIM group approvals assigned to you.";
  const heading =
    perspective === "mine"
      ? `Pending PIM group requests submitted by you (${String(items.length)}):`
      : `Pending PIM group approvals assigned to you (${String(items.length)}):`;
  return formatBulletList(
    items,
    heading,
    empty,
    (it) =>
      `- ${namedLabel(it.groupId, it.group)} [request=${it.id}] action=${it.action ?? "?"}${statusTag(it.status)}${
        perspective === "approver" ? requesterTag(graphRequester(it.principal, it.principalId)) : ""
      }${createdTag(it.createdDateTime)}${completedTag(it.completedDateTime, it.createdDateTime)}${approvalTag(it.approvalId)}${staleTag(staleIds.has(it.id))}${justificationTail(it.justification)}`,
  );
}
