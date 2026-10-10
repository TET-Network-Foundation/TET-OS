// Guard: the supply chain rules (docs/THREAT_MODEL.md rule 9) hold in the repository.
//
//   node scripts/supply_chain_guard.mjs
//
// 1. Every GitHub Action is pinned by a full commit SHA (a tag can be moved; a SHA can't).
// 2. Every `npm ci` in CI runs with --ignore-scripts (no package runs code at install time).
// 3. The lockfiles are committed.
// 4. CODEOWNERS names a reviewer for every manifest, lockfile and workflow.
// Negative control (run by hand, recorded in the commit): one Action back on its tag → FAILED.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const read = (p) => readFileSync(`${ROOT}/${p}`, "utf8");
const workflows = readdirSync(`${ROOT}/.github/workflows`).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, read(`.github/workflows/${f}`)]);
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}
check("every Action is pinned by a full commit SHA", () => {
  const bad = workflows.flatMap(([f, s]) =>
    [...s.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((m) => m[1]).filter((u) => !u.startsWith("./") && !/@[0-9a-f]{40}$/.test(u)).map((u) => `${f}: ${u}`),
  );
  assert.deepEqual(bad, []);
});
check("every npm ci runs with --ignore-scripts", () => {
  const bad = workflows.flatMap(([f, s]) => [...s.matchAll(/\bnpm ci\b[^\n]*/g)].map((m) => m[0]).filter((l) => !l.includes("--ignore-scripts")).map((l) => `${f}: ${l}`));
  assert.deepEqual(bad, []);
});
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
check("the lockfiles are committed", () => {
  for (const f of ["Cargo.lock", "tet-network/ui/package-lock.json", "tet-agent-sdk/package-lock.json"]) assert.ok(tracked.includes(f), `${f} isn't committed`);
});
check("CODEOWNERS names a reviewer for manifests, lockfiles and workflows", () => {
  const owners = read(".github/CODEOWNERS");
  for (const p of ["/Cargo.lock", "/tet-network/ui/package-lock.json", "/tet-agent-sdk/package-lock.json", "/tet-network/ui/package.json", "/tet-agent-sdk/package.json", "/.github/", "**/Cargo.toml"]) {
    assert.match(owners, new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s+@\\S+`, "m"), `no owner for ${p}`);
  }
});
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
