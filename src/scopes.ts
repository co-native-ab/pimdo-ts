// Typed Microsoft Graph + Azure Resource Manager scopes used by pimdo.
//
// pimdo targets two distinct Microsoft resources:
//
//   - Microsoft Graph (https://graph.microsoft.com) — Entra Groups and
//     directory roles via PIM endpoints under
//     /privilegedAccess/aadGroups/* and /roleManagement/directory/*.
//   - Azure Resource Manager (https://management.azure.com) — Azure RBAC
//     role assignments via PIM endpoints under
//     /providers/Microsoft.Authorization/role*.
//
// Both resources use OAuth2 access tokens but with different audiences,
// so the authenticator exposes `tokenForResource(resource, signal)` and
// scopes are tagged with the {@link Resource} they target.

/** The Microsoft resource an access token is scoped to. */
export enum Resource {
  Graph = "graph",
  Arm = "arm",
}

/** Typed enum for all OAuth scopes used by pimdo. */
export enum OAuthScope {
  // Graph — always required
  UserRead = "User.Read",
  OfflineAccess = "offline_access",

  // Graph — PIM for Entra Groups
  //
  // pimdo never creates or deletes group eligibilities, so the
  // eligibility scope is `Read` only. Active-assignment schedules are
  // mutated by self-activate/self-deactivate/approve flows, so that
  // scope must be `ReadWrite` (which implicitly covers list operations).
  // See ADR-0017 for the policy of choosing a single variant per scope
  // family rather than offering both as alternatives.
  PrivilegedAssignmentScheduleReadWriteAzureADGroup = "PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup",
  PrivilegedEligibilityScheduleReadAzureADGroup = "PrivilegedEligibilitySchedule.Read.AzureADGroup",
  RoleManagementPolicyReadAzureADGroup = "RoleManagementPolicy.Read.AzureADGroup",

  // Graph — PIM for Entra (directory) Roles
  //
  // Same single-variant policy as the group scopes above: `Read` for
  // role-eligibility (we never mutate eligibilities), `ReadWrite` for
  // role-assignment (we self-activate/self-deactivate/approve). See
  // ADR-0017.
  RoleManagementPolicyReadDirectory = "RoleManagementPolicy.Read.Directory",
  RoleAssignmentScheduleReadWriteDirectory = "RoleAssignmentSchedule.ReadWrite.Directory",
  RoleEligibilityScheduleReadDirectory = "RoleEligibilitySchedule.Read.Directory",
  // Required at runtime by the BETA approval surface
  // (`/roleManagement/directory/roleAssignmentApprovals/...`) in addition
  // to the documented `RoleAssignmentSchedule.*.Directory` permissions —
  // see the JSDoc on `APPROVE_ROLE_ENTRA_SCOPES` in
  // `src/features/role-entra/client.ts`.
  PrivilegedAccessReadWriteAzureAD = "PrivilegedAccess.ReadWrite.AzureAD",

  // ARM — PIM for Azure (resource) Roles
  ArmUserImpersonation = "https://management.azure.com/user_impersonation",
}

/** Map a scope to the Microsoft resource it targets. */
export function resourceForScope(scope: OAuthScope): Resource {
  return scope === OAuthScope.ArmUserImpersonation ? Resource.Arm : Resource.Graph;
}

/** Filter a list of scopes down to those targeting `resource`. */
export function scopesForResource(scopes: readonly OAuthScope[], resource: Resource): OAuthScope[] {
  return scopes.filter((s) => resourceForScope(s) === resource);
}

/** Human-friendly scope metadata for the login page UI. */
export interface ScopeDefinition {
  scope: OAuthScope;
  label: string;
  description: string;
  /** When true, this scope is always included and cannot be deselected. */
  required: boolean;
}

/** All scopes available for selection, in display order. */
export const AVAILABLE_SCOPES: readonly ScopeDefinition[] = [
  {
    scope: OAuthScope.UserRead,
    label: "User Profile",
    description: "Read your basic profile information",
    required: true,
  },
  {
    scope: OAuthScope.OfflineAccess,
    label: "Stay Signed In",
    description: "Maintain access without re-authenticating",
    required: true,
  },
  {
    scope: OAuthScope.PrivilegedEligibilityScheduleReadAzureADGroup,
    label: "Group PIM (eligible assignments)",
    description: "Read your eligible assignment schedules for Entra groups",
    required: false,
  },
  {
    scope: OAuthScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup,
    label: "Group PIM (active assignments)",
    description: "Read and manage your active assignment schedules for Entra groups",
    required: false,
  },
  {
    scope: OAuthScope.RoleManagementPolicyReadAzureADGroup,
    label: "Group PIM (policy)",
    description: "Read activation policy (max duration, approval) for PIM-managed Entra groups",
    required: false,
  },
  {
    scope: OAuthScope.RoleEligibilityScheduleReadDirectory,
    label: "Entra Roles (eligible assignments)",
    description: "Read your eligible assignment schedules for directory roles",
    required: false,
  },
  {
    scope: OAuthScope.RoleAssignmentScheduleReadWriteDirectory,
    label: "Entra Roles (active assignments)",
    description: "Read and manage your active assignment schedules for directory roles",
    required: false,
  },
  {
    scope: OAuthScope.RoleManagementPolicyReadDirectory,
    label: "Entra Roles (policy)",
    description: "Read activation policy (max duration, approval) for PIM-managed directory roles",
    required: false,
  },
  {
    scope: OAuthScope.PrivilegedAccessReadWriteAzureAD,
    label: "Entra Roles (approvals)",
    description: "Approve or deny Entra-role activation requests assigned to you",
    required: false,
  },
  {
    scope: OAuthScope.ArmUserImpersonation,
    label: "Azure Roles (PIM)",
    description: "Manage your Azure RBAC role assignments via Azure Resource Manager",
    required: false,
  },
];

/** Scopes that are always required and cannot be deselected. */
export const ALWAYS_REQUIRED_SCOPES: readonly OAuthScope[] = AVAILABLE_SCOPES.filter(
  (s) => s.required,
).map((s) => s.scope);

/** Returns all scopes (the default selection). */
export function defaultScopes(): OAuthScope[] {
  return AVAILABLE_SCOPES.map((s) => s.scope);
}

const SCOPE_VALUES = new Set<string>(Object.values(OAuthScope));

/** Type guard: checks whether a string is a valid OAuthScope value. */
export function isOAuthScope(value: string): value is OAuthScope {
  return SCOPE_VALUES.has(value);
}

/** Filter a string array to only valid OAuthScope values. */
export function toOAuthScopes(values: readonly string[]): OAuthScope[] {
  return values.filter(isOAuthScope);
}
