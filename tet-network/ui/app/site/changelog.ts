/**
 * The changelog: real merged pull requests, newest first, each in one plain sentence. The PR number and
 * its merge date must be in app/site/data/merged_prs.json, a snapshot of what GitHub listed (checked by
 * scripts/site_guard.mjs, CHG1). Summaries are ours; the titles are on GitHub.
 */
export type Change = { pr: number; merged: string; summary: string };

export const CHANGES: Change[] = [
  { pr: 188, merged: "2026-11-13", summary: "Checks that run every night on GitHub and only report: tests, the guards, and dependency audits." },
  { pr: 187, merged: "2026-11-13", summary: "Python's cache files are no longer left behind by the test runs." },
  { pr: 186, merged: "2026-11-13", summary: "The sign-in prototype says what it shows and does not show in everyday words." },
  { pr: 185, merged: "2026-11-13", summary: "A machine's log says what it shows and does not show in everyday words." },
  { pr: 184, merged: "2026-11-12", summary: "The guard runner refuses to report success while new files are not yet committed." },
  { pr: 175, merged: "2026-11-12", summary: "A research note on keys that can sign only once (an idea, nothing built)." },
  { pr: 174, merged: "2026-11-12", summary: "Sign in with TET as a prototype on your own computer (design not reviewed)." },
  { pr: 173, merged: "2026-11-12", summary: "An example of an agent that may do one named thing once." },
  { pr: 172, merged: "2026-11-12", summary: "One-time permissions in a machine's own log." },
  { pr: 166, merged: "2026-11-08", summary: "The machine log says plainly that it cannot yet put its fingerprint on the chain by itself." },
  { pr: 156, merged: "2026-11-08", summary: "A machine's log works against a real node on the same computer." },
  { pr: 155, merged: "2026-11-08", summary: "A device keeps its own signed log (a prototype)." },
  { pr: 148, merged: "2026-10-15", summary: "Mark a file as genuine and anchor it on the chain without sending the file." },
  { pr: 143, merged: "2026-10-14", summary: "A limit on how many requests one address can send to a node." },
];
