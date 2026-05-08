// Hand-rolled ISO-8601 duration parser/formatter for the subset Microsoft
// PIM uses.
//
// PIM activation durations are always one of:
//
//   - PT<H>H            — N hours       (e.g. PT8H, PT0.5H)
//   - PT<M>M            — N minutes     (rare, used by some role policies)
//   - P<D>D             — N days        (e.g. P5D)
//   - P<D>DT<H>H        — D days + H hours
//
// We deliberately do not implement the full ISO-8601 Period grammar
// (weeks, months, years, mixed minutes+seconds, sub-second precision),
// because PIM doesn't use them. Keeping the parser narrow keeps the
// behaviour easy to reason about and gives clearer error messages.
//
// Internally every duration is normalised to a non-negative integer
// number of minutes so comparison and clamping are trivial. Callers
// see the original `{ days?, hours?, minutes? }` view via
// {@link parseIsoDuration}.

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/**
 * Structured view of a parsed PIM duration. All fields are
 * non-negative integers, and at least one is non-zero.
 */
export interface Duration {
  /** Whole days. */
  days?: number;
  /** Whole hours (0–23 if `days` is set, otherwise unbounded). */
  hours?: number;
  /** Whole minutes (0–59 if `hours` is set, otherwise unbounded). */
  minutes?: number;
}

/**
 * Parse an ISO-8601 PIM duration string into its component parts.
 *
 * Throws on any value the parser does not recognise, including
 * empty strings, fractional components, leading/trailing whitespace,
 * weeks/months/years/seconds, and negative values.
 */
export function parseIsoDuration(input: string): Duration {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error(`invalid ISO-8601 duration: ${JSON.stringify(input)}`);
  }
  // P[<days>D][T[<hours>H][<minutes>M]]
  const re = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/;
  const m = re.exec(input);
  if (!m) {
    throw new Error(`invalid ISO-8601 duration: ${JSON.stringify(input)}`);
  }
  const [, daysS, hoursS, minutesS] = m;
  if (daysS === undefined && hoursS === undefined && minutesS === undefined) {
    // Matches "P" or "PT" — both technically match the regex but carry
    // no value. Reject as malformed.
    throw new Error(`invalid ISO-8601 duration: ${JSON.stringify(input)}`);
  }
  const out: Duration = {};
  if (daysS !== undefined) out.days = Number(daysS);
  if (hoursS !== undefined) out.hours = Number(hoursS);
  if (minutesS !== undefined) out.minutes = Number(minutesS);
  return out;
}

/**
 * Format a {@link Duration} back into its canonical ISO-8601 string.
 *
 * Throws if the duration has no non-zero components.
 */
export function formatIsoDuration(d: Duration): string {
  const days = d.days ?? 0;
  const hours = d.hours ?? 0;
  const minutes = d.minutes ?? 0;
  if (days < 0 || hours < 0 || minutes < 0) {
    throw new Error(`negative duration component: ${JSON.stringify(d)}`);
  }
  if (!Number.isInteger(days) || !Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error(`non-integer duration component: ${JSON.stringify(d)}`);
  }
  if (days === 0 && hours === 0 && minutes === 0) {
    throw new Error(`zero duration: ${JSON.stringify(d)}`);
  }
  let s = "P";
  if (days > 0) s += `${String(days)}D`;
  if (hours > 0 || minutes > 0) {
    s += "T";
    if (hours > 0) s += `${String(hours)}H`;
    if (minutes > 0) s += `${String(minutes)}M`;
  }
  return s;
}

/** Total number of whole minutes a duration represents. */
function toMinutes(d: Duration): number {
  return (d.days ?? 0) * MINUTES_PER_DAY + (d.hours ?? 0) * MINUTES_PER_HOUR + (d.minutes ?? 0);
}

/**
 * Compare two durations.
 *
 * Returns -1 / 0 / 1 in the usual {@link Array.sort} convention.
 */
export function compareDurations(a: Duration, b: Duration): -1 | 0 | 1 {
  const am = toMinutes(a);
  const bm = toMinutes(b);
  if (am < bm) return -1;
  if (am > bm) return 1;
  return 0;
}

/**
 * Clamp `requested` to be at most `max`.
 *
 * - Returns the original `requested` when it is already within range.
 * - Returns `max` (with `clamped: true`) when `requested` exceeds it.
 *
 * Used by the request flow: the AI may suggest a duration, but the
 * policy's max is the hard upper bound.
 */
export function clampDuration(
  requested: Duration,
  max: Duration,
): { value: Duration; clamped: boolean } {
  if (compareDurations(requested, max) <= 0) {
    return { value: requested, clamped: false };
  }
  return { value: max, clamped: true };
}
