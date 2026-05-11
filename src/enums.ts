// Shared enums for string literals that are duplicated across multiple
// files. Single-use API-contract literals (e.g. `accessId: "member"`) are
// intentionally left inline — see the plan in PR #N for the rationale.
//
// Values match the on-the-wire string contract exactly (case-sensitive),
// so these enums can be substituted for the literal strings without any
// behavioural change. Graph and ARM use different casings for the same
// concept (selfActivate vs SelfActivate); see {@link GraphScheduleAction}
// and {@link ArmScheduleRequestType}.

/**
 * Decision sent to a PIM approval stage/step. Used as a Zod enum on the
 * approver-flow submission schema and as the `reviewResult` value PATCH'd
 * to Graph / PUT inside the ARM `/batch` body. The third value `Skip` is
 * a UI-only choice for the batch approver flow — it is never submitted
 * to Graph or ARM.
 */
export enum ApprovalDecision {
  Approve = "Approve",
  Deny = "Deny",
  Skip = "Skip",
}

/** The two terminal decisions that actually get submitted to Graph/ARM. */
export type SubmittedApprovalDecision = ApprovalDecision.Approve | ApprovalDecision.Deny;

/**
 * `status` value on an approval stage/step. Graph exposes more values
 * (e.g. `Completed`, `Canceled`) but pimdo only filters on the live
 * `InProgress` state.
 */
export enum ApprovalStageStatus {
  InProgress = "InProgress",
}

/**
 * `reviewResult` value on an approval stage/step. `NotReviewed` is the
 * pre-decision state; `Approve` / `Deny` mirror {@link ApprovalDecision}.
 */
export enum ApprovalStageReviewResult {
  NotReviewed = "NotReviewed",
  Approve = "Approve",
  Deny = "Deny",
}

/**
 * Role passed to Microsoft Graph `filterByCurrentUser(on='...')`: either
 * the signed-in user as the principal of an assignment, or as an
 * approver of a pending request.
 */
export enum CurrentUserFilter {
  Principal = "principal",
  Approver = "approver",
}

/**
 * `action` value on a Microsoft Graph PIM `assignmentScheduleRequests`
 * POST body — camelCase per Graph conventions.
 */
export enum GraphScheduleAction {
  SelfActivate = "selfActivate",
  SelfDeactivate = "selfDeactivate",
}

/**
 * `requestType` value on an ARM `roleAssignmentScheduleRequests` PUT
 * body — PascalCase per ARM conventions.
 */
export enum ArmScheduleRequestType {
  SelfActivate = "SelfActivate",
  SelfDeactivate = "SelfDeactivate",
}

/** Whether a PIM assignment is eligible (activatable) or already active. */
export enum AssignmentKind {
  Eligible = "eligible",
  Active = "active",
}
