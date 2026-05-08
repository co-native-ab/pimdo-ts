// Canonical scenario matrix for the preview site.
//
// Every list-producing surface (browser flow that takes >=1 row OR an
// MCP `*_list` tool) must ship one rendering per scenario id. This is
// the single source of truth for "what scenarios exist" — both the
// generator (`generate.ts`) and the checker (`check.ts`) iterate over
// `LIST_SCENARIOS`. Adding a new scenario id here automatically requires
// every registered surface to provide a fixture for it; the check fails
// with a structured nudge until they do.

/** Ids in the canonical matrix. Order is the order shown in the index. */
export const LIST_SCENARIO_IDS = ["empty", "single", "pair", "full", "next-page"] as const;

export type ListScenarioId = (typeof LIST_SCENARIO_IDS)[number];

export interface ScenarioMeta {
  id: ListScenarioId;
  /** Short human-readable label used in the index sidebar. */
  label: string;
  /** One-sentence description of the intent. */
  description: string;
}

export const LIST_SCENARIOS: readonly ScenarioMeta[] = [
  { id: "empty", label: "Empty", description: "Surface returns zero items." },
  { id: "single", label: "Single", description: "Exactly one item." },
  { id: "pair", label: "Pair", description: "Two items — exercises plural copy." },
  { id: "full", label: "Full page", description: "A typical full first page." },
  {
    id: "next-page",
    label: "Next page",
    description: "Boundary case where a continuation page is implied.",
  },
];

/**
 * Browser-state scenarios (login, logout) don't fit the list-matrix
 * shape, so each browser-view registration declares its own scenario
 * ids inline (see `views.ts`). Keep them deterministic and re-use ids
 * where it is meaningful (e.g. `empty` may also mean "no rows").
 */
