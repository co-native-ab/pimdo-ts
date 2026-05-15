// PIM Group tool barrel.

import type { AnyTool } from "../../../tool-registry.js";
import { pimGroupActiveListTool } from "./pim-group-active-list.js";
import { pimGroupApprovalListTool } from "./pim-group-approval-list.js";
import { pimGroupApprovalReviewTool } from "./pim-group-approval-review.js";
import { pimGroupDeactivateTool } from "./pim-group-deactivate.js";
import { pimGroupEligibleListTool } from "./pim-group-eligible-list.js";
import { pimGroupRequestCancelTool } from "./pim-group-request-cancel.js";
import { pimGroupRequestListTool } from "./pim-group-request-list.js";
import { pimGroupRequestTool } from "./pim-group-request.js";

export {
  pimGroupActiveListTool,
  pimGroupApprovalListTool,
  pimGroupApprovalReviewTool,
  pimGroupDeactivateTool,
  pimGroupEligibleListTool,
  pimGroupRequestCancelTool,
  pimGroupRequestListTool,
  pimGroupRequestTool,
};

export const GROUP_TOOLS: readonly AnyTool[] = [
  pimGroupEligibleListTool,
  pimGroupActiveListTool,
  pimGroupRequestListTool,
  pimGroupRequestTool,
  pimGroupRequestCancelTool,
  pimGroupDeactivateTool,
  pimGroupApprovalListTool,
  pimGroupApprovalReviewTool,
];
