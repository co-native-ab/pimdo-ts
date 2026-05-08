// Generic Microsoft Graph response envelope types.
//
// PIM-specific Graph types (groups, directory roles, schedules,
// approvals, policies) live alongside the modules that consume them
// (added in phases 2 and 3).

/** Graph API error response envelope. */
export interface GraphErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}
