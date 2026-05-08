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
export enum GraphScope {
  // Graph — always required
  UserRead = "User.Read",
  OfflineAccess = "offline_access",

  // Graph — PIM for Entra Groups
  PrivilegedAccessReadWriteAzureADGroup = "PrivilegedAccess.ReadWrite.AzureADGroup",
  PrivilegedAssignmentScheduleReadWriteAzureADGroup = "PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup",
  PrivilegedEligibilityScheduleReadWriteAzureADGroup = "PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup",

  // Graph — PIM for Entra (directory) Roles
  RoleManagementReadDirectory = "RoleManagement.Read.Directory",
  RoleManagementReadWriteDirectory = "RoleManagement.ReadWrite.Directory",
  RoleAssignmentScheduleReadWriteDirectory = "RoleAssignmentSchedule.ReadWrite.Directory",
  RoleEligibilityScheduleReadWriteDirectory = "RoleEligibilitySchedule.ReadWrite.Directory",

  // ARM — PIM for Azure (resource) Roles
  ArmUserImpersonation = "https://management.azure.com/user_impersonation",
}

/** Map a scope to the Microsoft resource it targets. */
export function resourceForScope(scope: GraphScope): Resource {
  return scope === GraphScope.ArmUserImpersonation ? Resource.Arm : Resource.Graph;
}

/** Filter a list of scopes down to those targeting `resource`. */
export function scopesForResource(scopes: readonly GraphScope[], resource: Resource): GraphScope[] {
  return scopes.filter((s) => resourceForScope(s) === resource);
}

/** Human-friendly scope metadata for the login page UI. */
export interface ScopeDefinition {
  scope: GraphScope;
  label: string;
  description: string;
  /** When true, this scope is always included and cannot be deselected. */
  required: boolean;
}

/** All scopes available for selection, in display order. */
export const AVAILABLE_SCOPES: readonly ScopeDefinition[] = [
  {
    scope: GraphScope.UserRead,
    label: "User Profile",
    description: "Read your basic profile information",
    required: true,
  },
  {
    scope: GraphScope.OfflineAccess,
    label: "Stay Signed In",
    description: "Maintain access without re-authenticating",
    required: true,
  },
  {
    scope: GraphScope.PrivilegedAccessReadWriteAzureADGroup,
    label: "Group PIM",
    description: "Manage your eligibility and activations for PIM-managed Entra groups",
    required: false,
  },
  {
    scope: GraphScope.PrivilegedAssignmentScheduleReadWriteAzureADGroup,
    label: "Group PIM (active assignments)",
    description: "Read and manage your active assignment schedules for Entra groups",
    required: false,
  },
  {
    scope: GraphScope.PrivilegedEligibilityScheduleReadWriteAzureADGroup,
    label: "Group PIM (eligible assignments)",
    description: "Read and manage your eligible assignment schedules for Entra groups",
    required: false,
  },
  {
    scope: GraphScope.RoleManagementReadDirectory,
    label: "Entra Roles (read)",
    description: "Read directory role definitions and assignments",
    required: false,
  },
  {
    scope: GraphScope.RoleManagementReadWriteDirectory,
    label: "Entra Roles (PIM)",
    description: "Manage your eligibility and activations for PIM-managed directory roles",
    required: false,
  },
  {
    scope: GraphScope.RoleAssignmentScheduleReadWriteDirectory,
    label: "Entra Roles (active assignments)",
    description: "Read and manage your active assignment schedules for directory roles",
    required: false,
  },
  {
    scope: GraphScope.RoleEligibilityScheduleReadWriteDirectory,
    label: "Entra Roles (eligible assignments)",
    description: "Read and manage your eligible assignment schedules for directory roles",
    required: false,
  },
  {
    scope: GraphScope.ArmUserImpersonation,
    label: "Azure Roles (PIM)",
    description: "Manage your Azure RBAC role assignments via Azure Resource Manager",
    required: false,
  },
];

/** Scopes that are always required and cannot be deselected. */
export const ALWAYS_REQUIRED_SCOPES: readonly GraphScope[] = AVAILABLE_SCOPES.filter(
  (s) => s.required,
).map((s) => s.scope);

/** Returns all scopes (the default selection). */
export function defaultScopes(): GraphScope[] {
  return AVAILABLE_SCOPES.map((s) => s.scope);
}

const SCOPE_VALUES = new Set<string>(Object.values(GraphScope));

/** Type guard: checks whether a string is a valid GraphScope value. */
export function isGraphScope(value: string): value is GraphScope {
  return SCOPE_VALUES.has(value);
}

/** Filter a string array to only valid GraphScope values. */
export function toGraphScopes(values: readonly string[]): GraphScope[] {
  return values.filter(isGraphScope);
}
