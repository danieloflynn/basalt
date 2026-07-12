/**
 * Persisted configuration for the graph view — filters, groups, display and
 * forces. The whole object round-trips through one settings key (`graph`).
 * Kept dependency-free (pure types + constants) so `services/settings.ts` can
 * import it without pulling the UI layer into the services layer.
 */

export interface GraphGroup {
  /** Stable id for React keys / reconciliation. */
  id: string;
  /** `tag:x` / `path:prefix` / bare title substring — see matchesGroupQuery. */
  query: string;
  /** CSS color the matching nodes render in. */
  color: string;
}

export interface GraphFilters {
  /** Substring matched against note title/path; '' = no search filter. */
  search: string;
  /** Add one node per tag, linked to the notes carrying it. */
  tags: boolean;
  /** Include attachment files that notes embed/link. */
  attachments: boolean;
  /** ON: only files that exist. OFF: unresolved link targets appear as phantoms. */
  existingOnly: boolean;
  /** ON: show degree-0 notes. OFF: hide them. */
  orphans: boolean;
}

export interface GraphDisplay {
  /** Directed arrowheads on edges (source → target). */
  arrows: boolean;
  /** Label-visibility scale cutoff. */
  textFadeThreshold: number;
  /** Node radius multiplier. */
  nodeSize: number;
  /** Link line-width multiplier. */
  linkThickness: number;
}

export interface GraphForces {
  center: number;
  repel: number;
  link: number;
  linkDistance: number;
}

export interface GraphConfig {
  filters: GraphFilters;
  groups: GraphGroup[];
  display: GraphDisplay;
  forces: GraphForces;
}

/**
 * Defaults chosen to reproduce the original graph rendering exactly: no tag /
 * attachment / phantom nodes, orphans shown, no arrows, and the same force
 * constants the hand-rolled sim shipped with.
 */
export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  filters: {
    search: '',
    tags: false,
    attachments: false,
    existingOnly: true,
    orphans: true,
  },
  groups: [],
  display: {
    arrows: false,
    textFadeThreshold: 0.55,
    nodeSize: 1,
    linkThickness: 1,
  },
  forces: {
    center: 0.005,
    repel: 2200,
    link: 0.02,
    linkDistance: 110,
  },
};

/** Group swatches, harmonious with the basalt palette (ember + celadon kin). */
export const GRAPH_PALETTE = [
  '#e8764a', // ember
  '#85b8a3', // celadon
  '#c9a86a', // sand
  '#7a9cc6', // slate blue
  '#b98ac9', // heather
  '#d4685c', // clay
] as const;

/** Deep-merge a persisted (possibly partial/legacy) value onto the defaults. */
export function mergeGraphConfig(partial: Partial<GraphConfig> | undefined | null): GraphConfig {
  const d = DEFAULT_GRAPH_CONFIG;
  const p = partial ?? {};
  return {
    filters: { ...d.filters, ...p.filters },
    groups: Array.isArray(p.groups) ? p.groups.map((g) => ({ ...g })) : [],
    display: { ...d.display, ...p.display },
    forces: { ...d.forces, ...p.forces },
  };
}

/**
 * Signature of the fields that change the node/edge SET (or node colors).
 * The sim rebuilds only when this changes; forces/display update live.
 */
export function filterGroupSignature(c: GraphConfig): string {
  return JSON.stringify([c.filters, c.groups]);
}
