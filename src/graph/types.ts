// Microsoft Graph response envelope types and PIM domain shapes.
//
// Type definitions are paired with `loose()` zod schemas so we validate
// the wire shape we actually depend on while ignoring fields Graph
// adds in the future.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

/** Graph API error response envelope. */
export interface GraphErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Generic Graph collection envelope
// ---------------------------------------------------------------------------

/** OData collection envelope: `{ value: T[] }`. */
export const collectionSchema = <T extends z.ZodType>(
  itemSchema: T,
): z.ZodObject<{ value: z.ZodArray<T> }> => z.object({ value: z.array(itemSchema) });

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

/** Minimal Graph user shape used by PIM expansions. */
export interface User {
  id: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
}

export const UserSchema: z.ZodType<User> = z
  .object({
    id: z.string(),
    displayName: z.string().optional(),
    mail: z.string().nullish(),
    userPrincipalName: z.string().optional(),
  })
  .loose();

/** Single-user response from `/me`. */
export const MeSchema = UserSchema;

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

/** Minimal Graph group shape used by PIM expansions. */
export interface Group {
  id: string;
  displayName?: string;
  description?: string | null;
  securityEnabled?: boolean;
  groupTypes?: string[];
}

export const GroupSchema: z.ZodType<Group> = z
  .object({
    id: z.string(),
    displayName: z.string().optional(),
    description: z.string().nullish(),
    securityEnabled: z.boolean().optional(),
    groupTypes: z.array(z.string()).optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// ScheduleInfo (request schedule + expiration)
// ---------------------------------------------------------------------------

/** Expiration discriminator from Microsoft Graph PIM payloads. */
export type ExpirationType = "afterDateTime" | "afterDuration" | "noExpiration" | "notSpecified";

export interface ExpirationPattern {
  type?: ExpirationType;
  /** ISO-8601 duration, e.g. "PT8H". Present when type is `afterDuration`. */
  duration?: string | null;
  /** ISO-8601 instant. Present when type is `afterDateTime`. */
  endDateTime?: string | null;
}

const ExpirationPatternSchema: z.ZodType<ExpirationPattern> = z
  .object({
    type: z.enum(["afterDateTime", "afterDuration", "noExpiration", "notSpecified"]).optional(),
    duration: z.string().nullish(),
    endDateTime: z.string().nullish(),
  })
  .loose();

/** Request schedule used in PIM activation/deactivation requests. */
export interface ScheduleInfo {
  startDateTime?: string | null;
  expiration?: ExpirationPattern;
}

export const ScheduleInfoSchema: z.ZodType<ScheduleInfo> = z
  .object({
    startDateTime: z.string().nullish(),
    expiration: ExpirationPatternSchema.optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// Group eligibility / assignment / request
// ---------------------------------------------------------------------------

/** PIM Entra Groups eligibility schedule (`accessId=member`). */
export interface GroupEligibleAssignment {
  id: string;
  groupId: string;
  principalId: string;
  memberType?: string;
  accessId?: string;
  status?: string;
  scheduleInfo?: ScheduleInfo;
  group?: Group;
  principal?: User;
}

export const GroupEligibleAssignmentSchema: z.ZodType<GroupEligibleAssignment> = z
  .object({
    id: z.string(),
    groupId: z.string(),
    principalId: z.string(),
    memberType: z.string().optional(),
    accessId: z.string().optional(),
    status: z.string().optional(),
    scheduleInfo: ScheduleInfoSchema.optional(),
    group: GroupSchema.optional(),
    principal: UserSchema.optional(),
  })
  .loose();

/** PIM Entra Groups active assignment instance. */
export interface GroupActiveAssignment {
  id: string;
  groupId: string;
  principalId: string;
  accessId?: string;
  assignmentScheduleId?: string;
  assignmentType?: string;
  memberType?: string;
  startDateTime?: string | null;
  endDateTime?: string | null;
  group?: Group;
  principal?: User;
}

export const GroupActiveAssignmentSchema: z.ZodType<GroupActiveAssignment> = z
  .object({
    id: z.string(),
    groupId: z.string(),
    principalId: z.string(),
    accessId: z.string().optional(),
    assignmentScheduleId: z.string().optional(),
    assignmentType: z.string().optional(),
    memberType: z.string().optional(),
    startDateTime: z.string().nullish(),
    endDateTime: z.string().nullish(),
    group: GroupSchema.optional(),
    principal: UserSchema.optional(),
  })
  .loose();

/** PIM Entra Groups assignment-schedule request (activation / deactivation). */
export interface GroupAssignmentRequest {
  id: string;
  groupId: string;
  principalId: string;
  accessId?: string;
  action?: string;
  approvalId?: string | null;
  status?: string;
  justification?: string | null;
  scheduleInfo?: ScheduleInfo | null;
  createdDateTime?: string | null;
  completedDateTime?: string | null;
  group?: Group;
  principal?: User;
}

export const GroupAssignmentRequestSchema: z.ZodType<GroupAssignmentRequest> = z
  .object({
    id: z.string(),
    groupId: z.string(),
    principalId: z.string(),
    accessId: z.string().optional(),
    action: z.string().optional(),
    approvalId: z.string().nullish(),
    status: z.string().optional(),
    justification: z.string().nullish(),
    scheduleInfo: ScheduleInfoSchema.nullish(),
    createdDateTime: z.string().nullish(),
    completedDateTime: z.string().nullish(),
    group: GroupSchema.optional(),
    principal: UserSchema.optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// RoleDefinition (Entra directory roles)
// ---------------------------------------------------------------------------

/** Minimal Graph `unifiedRoleDefinition` shape used by PIM expansions. */
export interface RoleDefinition {
  id: string;
  displayName?: string;
  description?: string | null;
  isBuiltIn?: boolean;
  isEnabled?: boolean;
}

export const RoleDefinitionSchema: z.ZodType<RoleDefinition> = z
  .object({
    id: z.string(),
    displayName: z.string().optional(),
    description: z.string().nullish(),
    isBuiltIn: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// Entra-role eligibility / assignment / request
// ---------------------------------------------------------------------------

/** PIM Entra-role eligibility schedule (`unifiedRoleEligibilitySchedule`). */
export interface RoleEntraEligibleAssignment {
  id: string;
  roleDefinitionId: string;
  principalId: string;
  directoryScopeId?: string;
  memberType?: string;
  status?: string;
  scheduleInfo?: ScheduleInfo;
  roleDefinition?: RoleDefinition;
  principal?: User;
}

export const RoleEntraEligibleAssignmentSchema: z.ZodType<RoleEntraEligibleAssignment> = z
  .object({
    id: z.string(),
    roleDefinitionId: z.string(),
    principalId: z.string(),
    directoryScopeId: z.string().optional(),
    memberType: z.string().optional(),
    status: z.string().optional(),
    scheduleInfo: ScheduleInfoSchema.optional(),
    roleDefinition: RoleDefinitionSchema.optional(),
    principal: UserSchema.optional(),
  })
  .loose();

/** PIM Entra-role active assignment instance (`unifiedRoleAssignmentScheduleInstance`). */
export interface RoleEntraActiveAssignment {
  id: string;
  roleDefinitionId: string;
  principalId: string;
  directoryScopeId?: string;
  assignmentType?: string;
  memberType?: string;
  roleAssignmentOriginId?: string;
  roleAssignmentScheduleId?: string;
  startDateTime?: string | null;
  endDateTime?: string | null;
  roleDefinition?: RoleDefinition;
  principal?: User;
}

export const RoleEntraActiveAssignmentSchema: z.ZodType<RoleEntraActiveAssignment> = z
  .object({
    id: z.string(),
    roleDefinitionId: z.string(),
    principalId: z.string(),
    directoryScopeId: z.string().optional(),
    assignmentType: z.string().optional(),
    memberType: z.string().optional(),
    roleAssignmentOriginId: z.string().optional(),
    roleAssignmentScheduleId: z.string().optional(),
    startDateTime: z.string().nullish(),
    endDateTime: z.string().nullish(),
    roleDefinition: RoleDefinitionSchema.optional(),
    principal: UserSchema.optional(),
  })
  .loose();

/** PIM Entra-role assignment-schedule request (`unifiedRoleAssignmentScheduleRequest`). */
export interface RoleEntraAssignmentRequest {
  id: string;
  roleDefinitionId: string;
  principalId: string;
  directoryScopeId?: string;
  action?: string;
  approvalId?: string | null;
  status?: string;
  justification?: string | null;
  scheduleInfo?: ScheduleInfo | null;
  createdDateTime?: string | null;
  completedDateTime?: string | null;
  targetScheduleId?: string | null;
  roleDefinition?: RoleDefinition;
  principal?: User;
}

export const RoleEntraAssignmentRequestSchema: z.ZodType<RoleEntraAssignmentRequest> = z
  .object({
    id: z.string(),
    roleDefinitionId: z.string(),
    principalId: z.string(),
    directoryScopeId: z.string().optional(),
    action: z.string().optional(),
    approvalId: z.string().nullish(),
    status: z.string().optional(),
    justification: z.string().nullish(),
    scheduleInfo: ScheduleInfoSchema.nullish(),
    createdDateTime: z.string().nullish(),
    completedDateTime: z.string().nullish(),
    targetScheduleId: z.string().nullish(),
    roleDefinition: RoleDefinitionSchema.optional(),
    principal: UserSchema.optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// Approval + stages
// ---------------------------------------------------------------------------

/** Reviewer identity attached to a completed approval stage. */
export interface ApprovalReviewer {
  id?: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
}

const ApprovalReviewerSchema: z.ZodType<ApprovalReviewer> = z
  .object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    mail: z.string().nullish(),
    userPrincipalName: z.string().optional(),
  })
  .loose();

/** A single stage on a PIM assignment approval. */
export interface AssignmentApprovalStage {
  id: string;
  assignedToMe?: boolean;
  reviewResult?: string;
  status?: string;
  justification?: string | null;
  reviewedBy?: ApprovalReviewer | null;
  reviewedDateTime?: string | null;
}

export const AssignmentApprovalStageSchema: z.ZodType<AssignmentApprovalStage> = z
  .object({
    id: z.string(),
    assignedToMe: z.boolean().optional(),
    reviewResult: z.string().optional(),
    status: z.string().optional(),
    justification: z.string().nullish(),
    reviewedBy: ApprovalReviewerSchema.nullish(),
    reviewedDateTime: z.string().nullish(),
  })
  .loose();

/** PIM assignment approval — wraps one or more stages. */
export interface AssignmentApproval {
  id: string;
  stages: AssignmentApprovalStage[];
}

export const AssignmentApprovalSchema: z.ZodType<AssignmentApproval> = z
  .object({
    id: z.string(),
    stages: z.array(AssignmentApprovalStageSchema),
  })
  .loose();

/**
 * PIM role-assignment approval (Entra-role variant).
 *
 * Exposes its decision points as `steps` (not `stages`). Each step has the
 * same shape as a group-approval stage so we reuse {@link AssignmentApprovalStageSchema}.
 */
export interface RoleAssignmentApproval {
  id: string;
  steps: AssignmentApprovalStage[];
}

export const RoleAssignmentApprovalSchema: z.ZodType<RoleAssignmentApproval> = z
  .object({
    id: z.string(),
    steps: z.array(AssignmentApprovalStageSchema),
  })
  .loose();

// ---------------------------------------------------------------------------
// Role-management policy expiration rule (max-duration lookup)
// ---------------------------------------------------------------------------

/** A `RoleManagementPolicyExpirationRule` from Graph. */
export interface UnifiedRoleManagementPolicyExpirationRule {
  id: string;
  isExpirationRequired?: boolean;
  /** ISO-8601 duration. */
  maximumDuration?: string;
}

export const UnifiedRoleManagementPolicyExpirationRuleSchema: z.ZodType<UnifiedRoleManagementPolicyExpirationRule> =
  z
    .object({
      id: z.string(),
      isExpirationRequired: z.boolean().optional(),
      maximumDuration: z.string().optional(),
    })
    .loose();
