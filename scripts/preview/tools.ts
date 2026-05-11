// Registry of MCP `*_list` tools whose textual output is exhibited in
// the preview site. Each entry declares the tool name and a function
// that produces the markdown/text body for a given scenario id.
//
// Reuses the production `format.ts` modules so the preview output is
// byte-identical to what the real tool would return.

import {
  formatActiveAssignmentsText as fmtAzureActive,
  formatEligibleAssignmentsText as fmtAzureEligible,
  formatRequestsText as fmtAzureRequests,
} from "../../src/features/role-azure/format.js";
import {
  formatActiveAssignmentsText as fmtEntraActive,
  formatEligibleAssignmentsText as fmtEntraEligible,
  formatRequestsText as fmtEntraRequests,
} from "../../src/features/role-entra/format.js";
import {
  formatActiveAssignmentsText as fmtGroupActive,
  formatEligibleAssignmentsText as fmtGroupEligible,
  formatRequestsText as fmtGroupRequests,
} from "../../src/features/group/format.js";

import {
  activeFixtures as azureActive,
  eligibleFixtures as azureEligible,
  requestFixtures as azureRequests,
} from "./fixtures/azure-roles/index.js";
import {
  activeFixtures as entraActive,
  eligibleFixtures as entraEligible,
  requestFixtures as entraRequests,
} from "./fixtures/entra-roles/index.js";
import {
  activeFixtures as groupActive,
  eligibleFixtures as groupEligible,
  requestFixtures as groupRequests,
} from "./fixtures/groups/index.js";

import type { ListScenarioId } from "./scenarios.js";

export interface ToolPreview {
  /** MCP tool name (e.g. `pim_group_eligible_list`). */
  name: string;
  /** Surface family for the index sidebar. */
  family: "Group" | "Entra Role" | "Azure Role";
  /** Descriptive blurb shown in the index. */
  description: string;
  /** Pure function: scenario id → text the tool would return. */
  render(scenario: ListScenarioId): string;
}

export const TOOL_PREVIEWS: readonly ToolPreview[] = [
  // -- Group --
  {
    name: "pim_group_eligible_list",
    family: "Group",
    description: "Groups the signed-in user is eligible to activate via PIM.",
    render: (s) => fmtGroupEligible(groupEligible(s)),
  },
  {
    name: "pim_group_active_list",
    family: "Group",
    description: "Currently active PIM group assignments for the signed-in user.",
    render: (s) => fmtGroupActive(groupActive(s)),
  },
  {
    name: "pim_group_request_list",
    family: "Group",
    description: "Pending PIM group requests submitted by the signed-in user.",
    render: (s) => fmtGroupRequests(groupRequests(s, "mine"), "mine"),
  },
  {
    name: "pim_group_approval_list",
    family: "Group",
    description: "Pending PIM group approvals assigned to the signed-in user.",
    render: (s) => fmtGroupRequests(groupRequests(s, "approver"), "approver"),
  },
  // -- Entra Role --
  {
    name: "pim_role_entra_eligible_list",
    family: "Entra Role",
    description: "Entra directory roles the signed-in user is eligible to activate.",
    render: (s) => fmtEntraEligible(entraEligible(s)),
  },
  {
    name: "pim_role_entra_active_list",
    family: "Entra Role",
    description: "Currently active PIM Entra-role assignments for the signed-in user.",
    render: (s) => fmtEntraActive(entraActive(s)),
  },
  {
    name: "pim_role_entra_request_list",
    family: "Entra Role",
    description: "Pending PIM Entra-role requests submitted by the signed-in user.",
    render: (s) => fmtEntraRequests(entraRequests(s, "mine"), "mine"),
  },
  {
    name: "pim_role_entra_approval_list",
    family: "Entra Role",
    description: "Pending PIM Entra-role approvals assigned to the signed-in user.",
    render: (s) => fmtEntraRequests(entraRequests(s, "approver"), "approver"),
  },
  // -- Azure Role --
  {
    name: "pim_role_azure_eligible_list",
    family: "Azure Role",
    description: "Azure resource roles the signed-in user is eligible to activate.",
    render: (s) => fmtAzureEligible(azureEligible(s)),
  },
  {
    name: "pim_role_azure_active_list",
    family: "Azure Role",
    description: "Currently active PIM Azure-role assignments for the signed-in user.",
    render: (s) => fmtAzureActive(azureActive(s)),
  },
  {
    name: "pim_role_azure_request_list",
    family: "Azure Role",
    description: "Pending PIM Azure-role requests submitted by the signed-in user.",
    render: (s) => fmtAzureRequests(azureRequests(s, "mine"), "mine"),
  },
  {
    name: "pim_role_azure_approval_list",
    family: "Azure Role",
    description: "Pending PIM Azure-role approvals assigned to the signed-in user.",
    render: (s) => fmtAzureRequests(azureRequests(s, "approver"), "approver"),
  },
];
