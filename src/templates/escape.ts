// HTML escaping helper for browser-facing templates.
//
// All variable interpolation in tool-rendered HTML (forms, row-form pages,
// re-prompts) MUST pass through this helper to prevent XSS. Routes every
// interpolation through one audited helper rather than relying on
// per-template ad-hoc escaping.

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
