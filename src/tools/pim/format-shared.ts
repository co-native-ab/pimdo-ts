// Shared formatter helpers for `pim_*_*_list` read tools.
//
// All read-list tools render a bullet-list with a heading and an
// "empty state" fallback line. The per-surface format files keep the
// label / ID / column choices, but the list shape is identical and lives
// here.

import type { AssignmentKind } from "../../enums.js";

/**
 * Render `items` as a bullet list with `heading` on top, or `emptyMessage`
 * when the list is empty.
 *
 * Heading/emptyMessage are passed verbatim; callers handle pluralisation.
 */
export function formatBulletList<T>(
  items: readonly T[],
  heading: string,
  emptyMessage: string,
  renderLine: (item: T) => string,
): string {
  if (items.length === 0) return emptyMessage;
  const lines = items.map(renderLine);
  return [heading, ...lines].join("\n");
}

/**
 * Render an `entity (id)` style label, or just `id` when no display name
 * is provided. Used by every per-surface formatter for groups, role
 * definitions, and Azure role definitions.
 */
export function namedLabel(id: string, named: { displayName?: string } | undefined): string {
  return named?.displayName ? `${named.displayName} (${id})` : id;
}

/** Produce the trailing `— "<justification>"` segment for request lines. */
export function justificationTail(justification: string | null | undefined): string {
  return justification ? ` — "${justification}"` : "";
}

/** Produce the trailing ` [approval=<id>]` segment for request lines. */
export function approvalTag(approvalId: string | null | undefined): string {
  return approvalId ? ` [approval=${approvalId}]` : "";
}

/** Produce the trailing ` — <kind> until <when>` segment when bounded. */
export function expiryTail(kind: AssignmentKind, endDateTime: string | null | undefined): string {
  return endDateTime ? ` — ${kind} until ${endDateTime}` : "";
}

/**
 * Normalised view of the requesting principal, regardless of whether the
 * source is Microsoft Graph (`userPrincipalName`) or ARM
 * (`expandedProperties.principal.email`). Per-surface formatters resolve
 * the surface-specific field into this shape and pass it to
 * {@link requesterTag}.
 */
export interface RequesterIdentity {
  /** UPN (Graph) or email (ARM). May be null/undefined when not surfaced. */
  upnOrEmail?: string | null;
  /** Friendly display name when present. */
  displayName?: string;
  /** Principal object ID (GUID). Always available as a last-resort fallback. */
  id?: string;
}

/**
 * Produce the trailing ` by=<best-available>` segment for approver-perspective
 * rows. Falls back through UPN/email → displayName → object ID; renders the
 * empty string when nothing is available (defensive — should never happen in
 * practice because every PIM payload carries a `principalId`).
 */
export function requesterTag(principal: RequesterIdentity | undefined): string {
  if (!principal) return "";
  const candidates = [principal.upnOrEmail, principal.displayName, principal.id];
  for (const candidate of candidates) {
    if (candidate) return ` by=${candidate}`;
  }
  return "";
}

/**
 * Produce the trailing ` status=<value>` segment for rows that carry a
 * status. The boring steady-state value `Provisioned` is suppressed so
 * eligible / active rows don't emit redundant `status=Provisioned` noise.
 */
export function statusTag(status: string | null | undefined): string {
  if (!status || status === "Provisioned") return "";
  return ` status=${status}`;
}

/** Produce the trailing ` created=<iso>` segment when a timestamp is present. */
export function createdTag(iso: string | null | undefined): string {
  return iso ? ` created=${iso}` : "";
}

/**
 * Produce the trailing ` completed=<iso>` segment when a completion timestamp is
 * present and meaningfully different from the creation timestamp. Suppressed
 * when absent, or when equal to `createdIso` (which would just duplicate the
 * created tag).
 */
export function completedTag(
  iso: string | null | undefined,
  createdIso: string | null | undefined,
): string {
  if (!iso) return "";
  if (createdIso && iso === createdIso) return "";
  return ` completed=${iso}`;
}
