// Shared classifier for "stale" PIM schedule requests.
//
// Issue #40: `pim_*_request_list` and `pim_*_approval_list` may return
// pending entries the caller can no longer act on:
//
//   - principal side: a `selfActivate` request for a target the caller
//     has lost eligibility for. The user can't approve (they aren't an
//     approver) and can't re-activate (no eligibility). They can still
//     `pim_*_request_cancel` (#39) to retract the entry.
//   - approver side: a pending request whose approval no longer has a
//     live stage/step assigned to the caller (e.g. the caller was
//     removed from the role/group's approval policy after submission).
//
// This module exposes the small, surface-agnostic classifier used by
// the request-list and approval-list tools. Per-surface adapters
// supply the eligibility-key extractors and the per-approval probe.
//
// Errors propagate. The list-tool handlers wrap these calls in their
// existing `formatError` so the user sees what failed (Q9 in plan).

const SELF_ACTIVATE_ACTIONS: ReadonlySet<string> = new Set(["selfActivate", "SelfActivate"]);

/** True for a Graph `selfActivate` or ARM `SelfActivate` action/requestType. */
export function isSelfActivate(action: string | null | undefined): boolean {
  return typeof action === "string" && SELF_ACTIVATE_ACTIONS.has(action);
}

// ---------------------------------------------------------------------------
// Principal side: request_list classification
// ---------------------------------------------------------------------------

/** Per-surface plug-points for principal-side stale classification. */
export interface PrincipalStaleAdapter<Request> {
  /** Stable key identifying "the same target" on a request (e.g. groupId). */
  readonly requestKey: (r: Request) => string;
  /** Action / requestType field. Only `selfActivate`/`SelfActivate` is classifiable. */
  readonly action: (r: Request) => string | null | undefined;
  /** Stable id used to mark the request stale in the returned set. */
  readonly requestId: (r: Request) => string;
  /**
   * Fetch the keys (matching the same shape as `requestKey`) of the
   * caller's current eligibilities. Called lazily and only when at
   * least one classifiable request is present.
   */
  readonly liveEligibilityKeys: (signal: AbortSignal) => Promise<ReadonlySet<string>>;
}

/**
 * Return the set of request ids that are stale by the principal-side
 * rule: `selfActivate` (or ARM `SelfActivate`) AND no current
 * eligibility matches the request's target key. `selfDeactivate` and
 * any other action are intentionally never tagged — the matching
 * signal there would be the active-assignments list, not eligibility.
 *
 * Skips the eligibility fetch entirely when there are no
 * classification-eligible requests (Q4 in plan).
 */
export async function classifyStalePrincipalRequests<Request>(
  requests: readonly Request[],
  adapter: PrincipalStaleAdapter<Request>,
  signal: AbortSignal,
): Promise<Set<string>> {
  const stale = new Set<string>();
  const candidates = requests.filter((r) => isSelfActivate(adapter.action(r)));
  if (candidates.length === 0) return stale;

  const liveKeys = await adapter.liveEligibilityKeys(signal);

  for (const r of candidates) {
    if (!liveKeys.has(adapter.requestKey(r))) {
      stale.add(adapter.requestId(r));
    }
  }
  return stale;
}

// ---------------------------------------------------------------------------
// Approver side: approval_list classification
// ---------------------------------------------------------------------------

/** Per-surface plug-points for approver-side stale classification. */
export interface ApproverStaleAdapter<Request> {
  /** Stable id used to mark the request stale in the returned set. */
  readonly requestId: (r: Request) => string;
  /**
   * Return true when the caller still has a live stage/step on the
   * request's approval. Implementations typically GET the approval and
   * inspect its stages. Errors propagate (Q9b in plan).
   *
   * Returning false (or the absence of an `approvalId` on the request)
   * marks the request stale.
   */
  readonly hasLiveStage: (r: Request, signal: AbortSignal) => Promise<boolean>;
}

/**
 * Return the set of request ids that are stale by the approver-side
 * rule: no live stage/step assigned to the caller on the underlying
 * approval. One probe per row — kept sequential so a transient failure
 * surfaces as the same hard-fail as the eligibility path.
 */
export async function classifyStaleApproverRequests<Request>(
  requests: readonly Request[],
  adapter: ApproverStaleAdapter<Request>,
  signal: AbortSignal,
): Promise<Set<string>> {
  const stale = new Set<string>();
  for (const r of requests) {
    const live = await adapter.hasLiveStage(r, signal);
    if (!live) stale.add(adapter.requestId(r));
  }
  return stale;
}
