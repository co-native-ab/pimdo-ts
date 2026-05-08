// PIM Entra-role tool barrel.

import type { AnyTool } from "../../../tool-registry.js";
import { pimRoleEntraActiveListTool } from "./pim-role-entra-active-list.js";
import { pimRoleEntraApprovalListTool } from "./pim-role-entra-approval-list.js";
import { pimRoleEntraApprovalReviewTool } from "./pim-role-entra-approval-review.js";
import { pimRoleEntraDeactivateTool } from "./pim-role-entra-deactivate.js";
import { pimRoleEntraEligibleListTool } from "./pim-role-entra-eligible-list.js";
import { pimRoleEntraRequestListTool } from "./pim-role-entra-request-list.js";
import { pimRoleEntraRequestTool } from "./pim-role-entra-request.js";

export {
  pimRoleEntraActiveListTool,
  pimRoleEntraApprovalListTool,
  pimRoleEntraApprovalReviewTool,
  pimRoleEntraDeactivateTool,
  pimRoleEntraEligibleListTool,
  pimRoleEntraRequestListTool,
  pimRoleEntraRequestTool,
};

export const ROLE_ENTRA_TOOLS: readonly AnyTool[] = [
  pimRoleEntraEligibleListTool,
  pimRoleEntraActiveListTool,
  pimRoleEntraRequestListTool,
  pimRoleEntraRequestTool,
  pimRoleEntraDeactivateTool,
  pimRoleEntraApprovalListTool,
  pimRoleEntraApprovalReviewTool,
];
