// MCP tool: pim_role_azure_approval_review — review pending PIM
// Azure-role approvals via the approver browser flow. Built from
// {@link buildApprovalReviewTool}.

import { approveRoleAzureAssignment, listRoleAzureApprovalRequests } from "../client.js";
import type { RoleAzureAssignmentRequest } from "../../../arm/types.js";
import { deriveRequiredScopes } from "../../../scopes-runtime.js";
import { ROLE_AZURE_SCOPES } from "../client.js";
import { buildApprovalReviewTool } from "../../../tools/pim/factories/approval-review.js";
import { roleLabel, scopeLabel } from "../format.js";

export const pimRoleAzureApprovalReviewTool = buildApprovalReviewTool<RoleAzureAssignmentRequest>({
  def: {
    name: "pim_role_azure_approval_review",
    title: "Review PIM Azure-role approvals",
    description:
      "Open a browser form for the signed-in user (acting as approver) to " +
      "Approve, Deny, or Skip pending PIM Azure-role activation approvals. " +
      "Each Approve/Deny submits the decision via Azure Resource Manager `/batch`.",
    requiredScopes: deriveRequiredScopes([ROLE_AZURE_SCOPES]),
  },
  noun: "PIM Azure-role",
  approvalListToolName: "pim_role_azure_approval_list",
  listApprovals: (config, signal) => listRoleAzureApprovalRequests(config.armClient, signal),
  approvalId: (r) => r.properties.approvalId,
  toRow: (r, approvalId, prefill) => {
    const expanded = r.properties.expandedProperties;
    return {
      id: approvalId,
      label: roleLabel(r.properties.roleDefinitionId, expanded),
      subtitle: scopeLabel(r.properties.scope, expanded),
      requestor: expanded?.principal?.displayName ?? r.properties.principalId,
      requestorJustification: r.properties.justification ?? "(no justification)",
      prefilledDecision: prefill.decision,
      prefilledJustification: prefill.justification,
    };
  },
  label: (r) => roleLabel(r.properties.roleDefinitionId, r.properties.expandedProperties),
  submit: (config, _r, approvalId, decision, justification, signal) =>
    approveRoleAzureAssignment(config.armClient, approvalId, decision, justification, signal),
});
