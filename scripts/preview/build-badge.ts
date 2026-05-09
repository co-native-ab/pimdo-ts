// Build provenance badge shown in the index top bar. Tells reviewers
// at a glance whether they are looking at a published PR preview, the
// `main` site, or a contributor's local build.
//
// Rendered server-side (i.e. at generate time) so the badge text and
// link target never depend on JS — useful for screenshot diffs and for
// users who land on a `pr/<n>/` URL and want to confirm they're on the
// right preview before anything loads.

import { escapeHtml } from "../../src/templates/escape.js";
import type { BuildInfo } from "./render.js";

/** Render the topbar build badge from {@link BuildInfo}. */
export function renderBuildBadge(build: BuildInfo): string {
  if (build.kind === "pr") {
    const label = `PR #${build.id}`;
    const href = build.repoUrl ? `${build.repoUrl}/pull/${build.id}` : undefined;
    const title = build.shortSha ? `${label} · ${build.shortSha}` : label;
    return badgeHtml({ label, href, title, variant: "pr" });
  }
  if (build.kind === "main") {
    const label = build.shortSha ? `main · ${build.shortSha}` : "main";
    const href = build.repoUrl && build.sha ? `${build.repoUrl}/commit/${build.sha}` : undefined;
    return badgeHtml({ label, href, title: label, variant: "main" });
  }
  // local
  const label = build.shortSha ? `local · ${build.shortSha}` : "local";
  return badgeHtml({ label, title: label, variant: "local" });
}

interface BadgeOptions {
  label: string;
  title: string;
  variant: "pr" | "main" | "local";
  href?: string;
}

function badgeHtml(opts: BadgeOptions): string {
  const inner = `<span class="build-badge-dot" aria-hidden="true"></span><span class="build-badge-label">${escapeHtml(opts.label)}</span>`;
  const cls = `build-badge build-badge-${opts.variant}`;
  if (opts.href) {
    return `<a class="${cls}" href="${escapeHtml(opts.href)}" title="${escapeHtml(opts.title)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  }
  return `<span class="${cls}" title="${escapeHtml(opts.title)}">${inner}</span>`;
}
