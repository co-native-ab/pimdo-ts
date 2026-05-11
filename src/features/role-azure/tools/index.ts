// PIM Azure-role tool barrel.

import type { AnyTool } from "../../../tool-registry.js";
import { pimRoleAzureActiveListTool } from "./pim-role-azure-active-list.js";
import { pimRoleAzureApprovalListTool } from "./pim-role-azure-approval-list.js";
import { pimRoleAzureApprovalReviewTool } from "./pim-role-azure-approval-review.js";
import { pimRoleAzureDeactivateTool } from "./pim-role-azure-deactivate.js";
import { pimRoleAzureEligibleListTool } from "./pim-role-azure-eligible-list.js";
import { pimRoleAzureRequestListTool } from "./pim-role-azure-request-list.js";
import { pimRoleAzureRequestTool } from "./pim-role-azure-request.js";

export {
  pimRoleAzureActiveListTool,
  pimRoleAzureApprovalListTool,
  pimRoleAzureApprovalReviewTool,
  pimRoleAzureDeactivateTool,
  pimRoleAzureEligibleListTool,
  pimRoleAzureRequestListTool,
  pimRoleAzureRequestTool,
};

export const ROLE_AZURE_TOOLS: readonly AnyTool[] = [
  pimRoleAzureEligibleListTool,
  pimRoleAzureActiveListTool,
  pimRoleAzureRequestListTool,
  pimRoleAzureRequestTool,
  pimRoleAzureDeactivateTool,
  pimRoleAzureApprovalListTool,
  pimRoleAzureApprovalReviewTool,
];
