#!/usr/bin/env node
// An agent action allowed once: the machine notebook's one-time permits, used by an agent.
//
//   node tet-agent-sdk/examples/agent_permit_once.mjs        (TET_CLI=path/to/tet-cli, else target/release/tet-cli)
//
// The agent's key is a notebook device key (tools/machine-notebook). The owner's side issues a permit
// for one action; the agent CLAIMS it by writing a notebook record that cites the permit, and only
// then acts. A second claim of the same permit is refused before anything happens, and a log forged
// to use it twice reads INVALID. Every signature and check is `tet-cli agent sign` / `agent verify`,
// run by notebook.py: nothing new is signed here and no new cryptography is added.
//
// Local only: a throwaway notebook in a temp directory, bound to an example chain id no node runs.
// It exits non-zero if any step behaves differently from what is printed. See AGENT_PERMITS.md.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const NOTEBOOK = join(ROOT, "tools/machine-notebook/notebook.py");
const CLI = process.env.TET_CLI || join(ROOT, "target/release/tet-cli");
if (!existsSync(CLI)) {
  console.error(`tet-cli not found at ${CLI}: cargo build -p tet-cli --release, or set TET_CLI`);
  process.exit(2);
}
// An example chain: the binding is part of every signature, so this one is plainly not a real chain.
const CHAIN = { TET_CHAIN_ID: "tet-example-agent-permits", TET_GENESIS_HASH: createHash("sha256").update("tet agent permit example").digest("hex") };

const dir = mkdtempSync(join(tmpdir(), "agent-permit-"));
const nb = (args, input = "") => spawnSync("python3", [NOTEBOOK, "--tet-cli", CLI, ...args, "--dir", dir], { input, encoding: "utf8", env: { ...process.env, ...CHAIN } });
let bad = 0;
const expect = (ok, line) => {
  console.log(`${ok ? "  ok  " : "  !!  "}${line}`);
  if (!ok) bad++;
};

try {
  // 1. The agent's own key (never the owner's): a notebook device key.
  const init = nb(["init"]);
  expect(init.status === 0, `agent key ${init.stdout.trim()}`);

  // 2. A permit for one action, valid up to record 5.
  const permit = nb(["permit", "--action", "send-weekly-report", "--expires-seq", "5"]);
  const permitId = permit.stdout.trim();
  expect(permit.status === 0 && /^[0-9a-f]{32}$/.test(permitId), `permit ${permitId} for "send-weekly-report"`);

  // The agent's action: claim first (a signed record citing the permit), act only if the claim holds.
  let sent = 0;
  const act = () => {
    const claim = nb(["record", "--source", "stdin-json", "--permit", permitId], JSON.stringify({ value: "send-weekly-report", unit: "action" }));
    if (claim.status !== 0) return { acted: false, why: claim.stderr.trim() };
    sent++; // the real action would run here, after the claim is in the log
    return { acted: true, why: claim.stdout.trim() };
  };

  // 3. First use: claimed and done.
  const first = act();
  expect(first.acted && sent === 1, `first use: acted (${first.why})`);

  // 4. Second use: refused before anything happens.
  const second = act();
  expect(!second.acted && sent === 1 && second.why.includes("already used"), `second use: refused (${second.why.replace(/^error: /, "")})`);

  // 5. The log checks out: one action, under one permit.
  const v = nb(["verify"]);
  expect(v.status === 0 && v.stdout.startsWith("VALID"), "verify: VALID");

  // 6. A log forged to use the permit twice (a record written past the agent's own refusal, signed
  //    with the same key) reads INVALID, for that reason.
  const chain = readFileSync(join(dir, "chain.txt"), "utf8").trim().split("\n");
  const rec = { v: 1, kind: "tet_machine_log_v1", seq: chain.length + 1, prev: chain.at(-1), permit: permitId, reading: { source: "stdin-json", value: "send-weekly-report", unit: "action" }, clock_utc: "2026-11-12T00:00:00Z" };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(rec).sort(([a], [b]) => a.localeCompare(b))), (k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));
  const path = join(dir, "records", `${rec.seq}.json`);
  writeFileSync(path, canonical);
  execFileSync(CLI, ["agent", "sign", "--in", path, "--payload-type", "application/vnd.tet.machine-log+json"], { env: { ...process.env, ...CHAIN, TET_MNEMONIC: readFileSync(join(dir, "device.key"), "utf8").trim() }, stdio: "ignore" });
  appendFileSync(join(dir, "chain.txt"), createHash("sha256").update(canonical).digest("hex") + "\n");
  const forged = nb(["verify"]);
  // Exactly one problem, the reuse: the forged record is otherwise well-formed and validly signed.
  const problems = forged.stdout.split("\n").filter((l) => /^  (record \d+|log):/.test(l));
  expect(forged.status === 1 && problems.length === 1 && problems[0].includes(`permit: ${permitId} was already used by record`), `forged second use: INVALID (${problems.join("; ").trim()})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(bad ? `\n${bad} step(s) behaved differently` : "\nThe permit allowed the action once.");
process.exit(bad ? 1 : 0);
