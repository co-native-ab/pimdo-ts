// Fuzz target for src/templates/escape.ts.
//
// escapeHtml is the single audited helper through which every variable
// interpolation in tool-rendered HTML must pass to prevent XSS. We
// fuzz two invariants:
//
//   1. The function must never throw.
//   2. The output must not contain any of the five raw characters
//      (& < > " ') outside of a recognised HTML entity sequence.

require("./_register.cjs");
const { escapeHtml } = require("../src/templates/escape.ts");

const KNOWN_ENTITIES = new Set(["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"]);

/**
 * Strip every recognised entity, leaving any unrecognised raw character
 * behind so we can detect a leak.
 *
 * @param {string} s
 */
function stripKnownEntities(s) {
  for (const e of KNOWN_ENTITIES) {
    s = s.split(e).join("");
  }
  return s;
}

/**
 * @param {Buffer} data
 */
module.exports.fuzz = (data) => {
  const input = data.toString("utf8");
  const out = escapeHtml(input);

  const leaked = stripKnownEntities(out);
  for (const ch of ["<", ">", '"', "'", "&"]) {
    if (leaked.includes(ch)) {
      throw new Error(
        `escapeHtml leaked raw ${JSON.stringify(ch)} in output ${JSON.stringify(out)} ` +
          `(input ${JSON.stringify(input)})`,
      );
    }
  }
};
