/**
 * The public site's shared types. Every feature the site names carries a status, and the status must
 * match the repository (scripts/site_guard.mjs checks both).
 */

/** running: works today for anyone · prototype: built, local only · planned: decided, not built · idea: not decided. */
export type Status = "running" | "prototype" | "planned" | "idea";
export const STATUSES: readonly Status[] = ["running", "prototype", "planned", "idea"];

/**
 * Where the repository shows a feature exists. `path` must be a committed file in this tree.
 * `pr` names an open pull request when the code is not on main yet; the guard prints it, and the
 * status is only fully checked once that PR merges.
 */
export type Evidence = { path: string } | { pr: number; what: string };

export type Feature = {
  /** Stable id, unique across the site. */
  id: string;
  /** English text; the section's text file gives the Japanese. */
  title: string;
  summary: string;
  status: Status;
  /** running and prototype need at least one; planned and idea may cite a design document. */
  evidence: Evidence[];
  /** What a check of this feature shows, and what it does not. Both required, both non-empty. */
  shows: string[];
  doesNot: string[];
  /** A real page of ours to try it on, if one exists. */
  link?: { href: string; label: string };
};

export type Section = {
  /** "/tags", "/machines", "/keys", "/services", "/research" */
  href: string;
  title: string;
  /** The one plain sentence on its home card and at the top of its page. */
  sentence: string;
};
