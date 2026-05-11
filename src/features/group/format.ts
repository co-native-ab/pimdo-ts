// Plain-text formatters for the pim_group_* read tools.

import { AssignmentKind } from "../../enums.js";
import type {
  GroupActiveAssignment,
  GroupAssignmentRequest,
  GroupEligibleAssignment,
} from "../../graph/types.js";
import {
  approvalTag,
  expiryTail,
  formatBulletList,
  justificationTail,
  namedLabel,
} from "../../tools/pim/format-shared.js";

export function formatEligibleAssignmentsText(items: readonly GroupEligibleAssignment[]): string {
  return formatBulletList(
    items,
    `Eligible PIM group assignments (${String(items.length)}):`,
    "No eligible PIM group assignments.",
    (it) =>
      `- ${namedLabel(it.groupId, it.group)} [eligibility=${it.id}]${expiryTail(
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
      `- ${namedLabel(it.groupId, it.group)} [request=${it.id}] action=${it.action ?? "?"}${approvalTag(it.approvalId)}${justificationTail(it.justification)}`,
  );
}
