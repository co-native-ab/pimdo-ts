// Registry mapping each `*_SCOPES` call-site constant to a human-readable
// label and the Microsoft documentation URL. This is the source of truth for
// the README "Required scopes" table — see `scripts/generate-scope-docs.ts`.
//
// When a new call-site DNF is added, register it here so it shows up in the
// generated table. The CI gate (`npm run scopes:check`) will fail otherwise.

import {
  APPROVE_ROLE_ENTRA_SCOPES,
  LIST_ACTIVE_ROLE_ENTRA_SCOPES,
  LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
  LIST_ROLE_ENTRA_REQUESTS_SCOPES,
  ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
} from "./features/role-entra/client.js";
import {
  APPROVE_GROUP_SCOPES,
  LIST_ACTIVE_GROUP_SCOPES,
  LIST_ELIGIBLE_GROUP_SCOPES,
  LIST_GROUP_REQUESTS_SCOPES,
  WRITE_GROUP_SCHEDULE_SCOPES,
} from "./features/group/client.js";
import { ROLE_AZURE_SCOPES } from "./features/role-azure/client.js";
import {
  GET_DIRECTORY_ROLE_MAX_DURATION_SCOPES,
  GET_GROUP_MAX_DURATION_SCOPES,
} from "./graph/policies.js";
import { GET_MY_OBJECT_ID_SCOPES } from "./graph/me.js";
import { ALWAYS_REQUIRED_SCOPES, OAuthScope, Resource, resourceForScope } from "./scopes.js";

/** A documented Graph/ARM call site that requires one or more scope alternatives. */
export interface ScopeCallSite {
  /** Short human-readable label for the call site. */
  readonly label: string;
  /** Microsoft documentation URL for the underlying API. */
  readonly docsUrl: string;
  /** DNF: outer = OR-ed alternatives, inner = AND-ed scopes. */
  readonly scopes: readonly (readonly OAuthScope[])[];
}

const GRAPH_DOCS = "https://learn.microsoft.com/graph/api";
const ARM_DOCS = "https://learn.microsoft.com/azure/role-based-access-control";

/**
 * All Graph + ARM call sites pimdo makes, in display order. The README scope
 * table is generated from this — add an entry here when introducing a new
 * `*_SCOPES` constant.
 */
export const SCOPE_CALL_SITES: readonly ScopeCallSite[] = [
  // ---- Always required (sign-in identity) -------------------------------
  {
    label: "Resolve the signed-in user's object id (`/me`)",
    docsUrl: `${GRAPH_DOCS}/user-get`,
    scopes: GET_MY_OBJECT_ID_SCOPES,
  },

  // ---- Group PIM ---------------------------------------------------------
  {
    label: "List eligible group assignments",
    docsUrl: `${GRAPH_DOCS}/privilegedaccessgroupeligibilityschedule-filterbycurrentuser`,
    scopes: LIST_ELIGIBLE_GROUP_SCOPES,
  },
  {
    label: "List active group assignments",
    docsUrl: `${GRAPH_DOCS}/privilegedaccessgroupassignmentschedule-filterbycurrentuser`,
    scopes: LIST_ACTIVE_GROUP_SCOPES,
  },
  {
    label: "List my group activation requests / list group approval queue",
    docsUrl: `${GRAPH_DOCS}/privilegedaccessgroupassignmentschedulerequest-filterbycurrentuser`,
    scopes: LIST_GROUP_REQUESTS_SCOPES,
  },
  {
    label: "Submit group activation/deactivation schedule request",
    docsUrl: `${GRAPH_DOCS}/privilegedaccessgroup-post-assignmentschedulerequests`,
    scopes: WRITE_GROUP_SCHEDULE_SCOPES,
  },
  {
    label: "Approve or deny a group activation request",
    docsUrl: `${GRAPH_DOCS}/approval-get`,
    scopes: APPROVE_GROUP_SCOPES,
  },
  {
    label: "Read group activation policy (max duration, approval rules)",
    docsUrl: `${GRAPH_DOCS}/policyroot-list-rolemanagementpolicies`,
    scopes: GET_GROUP_MAX_DURATION_SCOPES,
  },

  // ---- Entra (directory) role PIM ---------------------------------------
  {
    label: "List eligible Entra role assignments",
    docsUrl: `${GRAPH_DOCS}/unifiedroleeligibilityschedule-filterbycurrentuser`,
    scopes: LIST_ELIGIBLE_ROLE_ENTRA_SCOPES,
  },
  {
    label: "List active Entra role assignments",
    docsUrl: `${GRAPH_DOCS}/unifiedroleassignmentschedule-filterbycurrentuser`,
    scopes: LIST_ACTIVE_ROLE_ENTRA_SCOPES,
  },
  {
    label: "List my Entra role activation requests / list Entra approval queue",
    docsUrl: `${GRAPH_DOCS}/unifiedroleassignmentschedulerequest-filterbycurrentuser`,
    scopes: LIST_ROLE_ENTRA_REQUESTS_SCOPES,
  },
  {
    label: "Submit Entra role activation/deactivation schedule request",
    docsUrl: `${GRAPH_DOCS}/rbacapplication-post-roleassignmentschedulerequests`,
    scopes: ROLE_ENTRA_SCHEDULE_REQUEST_SCOPES,
  },
  {
    label: "Approve or deny an Entra role activation request (BETA)",
    docsUrl: `${GRAPH_DOCS}/beta/approval-get`,
    scopes: APPROVE_ROLE_ENTRA_SCOPES,
  },
  {
    label: "Read Entra role activation policy (max duration, approval rules)",
    docsUrl: `${GRAPH_DOCS}/policyroot-list-rolemanagementpolicies`,
    scopes: GET_DIRECTORY_ROLE_MAX_DURATION_SCOPES,
  },

  // ---- Azure (resource) role PIM ----------------------------------------
  {
    label: "Read/write Azure role eligibility & assignment schedules (ARM)",
    docsUrl: `${ARM_DOCS}/pim-resource-roles-overview`,
    scopes: ROLE_AZURE_SCOPES,
  },
];

/** Resource bucket for table rendering. */
export function resourceLabel(scope: OAuthScope): string {
  return resourceForScope(scope) === Resource.Graph ? "Graph" : "ARM";
}

/** All scopes reachable from a registered call site (excluding always-required). */
export function callSiteScopes(): Set<OAuthScope> {
  const seen = new Set<OAuthScope>();
  for (const cs of SCOPE_CALL_SITES) {
    for (const alt of cs.scopes) {
      for (const s of alt) {
        if (!ALWAYS_REQUIRED_SCOPES.includes(s)) seen.add(s);
      }
    }
  }
  return seen;
}
