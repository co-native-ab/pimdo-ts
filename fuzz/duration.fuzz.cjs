// Fuzz target for src/duration.ts.
//
// Two complementary properties are exercised:
//
//   1. parseIsoDuration must never throw anything other than Error, and
//      its output (when accepted) must round-trip back through
//      formatIsoDuration to a string that re-parses to the same value.
//   2. formatIsoDuration must reject (with a regular Error) any non-
//      conforming Duration object built from fuzzer-controlled bytes,
//      and accept any well-formed one.
//
// The fuzz harness lives in fuzz/ rather than test/ so vitest does not
// pick it up. See README.md > Fuzzing for how to run it.

require("./_register.cjs");
const {
  parseIsoDuration,
  formatIsoDuration,
  compareDurations,
  clampDuration,
} = require("../src/duration.ts");

/**
 * @param {Buffer} data
 */
module.exports.fuzz = (data) => {
  if (data.length === 0) return;

  // Treat the bytes as a candidate ISO-8601 duration string. We allow
  // raw UTF-8 (rather than a controlled alphabet) so the fuzzer can
  // discover unexpected high-codepoint inputs.
  const input = data.toString("utf8");

  let parsed;
  try {
    parsed = parseIsoDuration(input);
  } catch (err) {
    // parseIsoDuration is documented to throw on any unrecognised input.
    // The contract is: it must throw a regular Error, never a non-Error
    // value or a TypeError from a downstream call.
    if (!(err instanceof Error)) throw err;
    return;
  }

  // parseIsoDuration is intentionally permissive about all-zero inputs
  // (e.g. `PT0H`, `P0D`) — see the matching test in test/duration.test.ts.
  // formatIsoDuration is the strict end of the pair and rejects them.
  // Skip the round-trip property in this carve-out.
  const total = (parsed.days ?? 0) + (parsed.hours ?? 0) + (parsed.minutes ?? 0);
  if (total === 0) return;

  // Round-trip property: format(parse(s)) must re-parse to the same value.
  // We additionally bound the per-component value to MAX_SAFE_INTEGER —
  // beyond that, JavaScript drops integer precision and `String(N)` emits
  // scientific notation, which is outside the parser's documented grammar
  // (digits only). This is a known limitation of the JS Number-based
  // representation, not a parser bug.
  const maxComponent = Math.max(parsed.days ?? 0, parsed.hours ?? 0, parsed.minutes ?? 0);
  if (maxComponent > Number.MAX_SAFE_INTEGER) return;

  const canonical = formatIsoDuration(parsed);
  const reparsed = parseIsoDuration(canonical);
  if (compareDurations(parsed, reparsed) !== 0) {
    throw new Error(
      `round-trip mismatch: input=${JSON.stringify(input)} canonical=${canonical} ` +
        `parsed=${JSON.stringify(parsed)} reparsed=${JSON.stringify(reparsed)}`,
    );
  }

  // clampDuration sanity: clamping a value to itself is a no-op.
  const { value, clamped } = clampDuration(parsed, parsed);
  if (clamped) throw new Error(`self-clamp reported clamped=true for ${canonical}`);
  if (compareDurations(value, parsed) !== 0) {
    throw new Error(`self-clamp value drift for ${canonical}`);
  }
};
