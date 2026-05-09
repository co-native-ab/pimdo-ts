// Shared formatter helpers for `pim_*_*_list` read tools.
//
// All read-list tools render a bullet-list with a heading and an
// "empty state" fallback line. The per-surface format files keep the
// label / ID / column choices, but the list shape is identical and lives
// here.

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
export function expiryTail(
  kind: "eligible" | "active",
  endDateTime: string | null | undefined,
): string {
  return endDateTime ? ` — ${kind} until ${endDateTime}` : "";
}
