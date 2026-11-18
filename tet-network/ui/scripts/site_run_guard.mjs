// Guard for "Run it" on the public site (app/site/run): the Run panel on every feature card, the
// scripted agent on /machines, and the one-shot model and permit-language sketch on /research.
//
//   node --experimental-strip-types scripts/site_run_guard.mjs
//
// R1. Every registered feature has a run (RUNS) or says why it has none (NO_RUN), never both; a
//     reason that names an open pull request belongs to a feature whose evidence cites one.
// R2. Every run, with the real checkers (the committed WASM ML-DSA-44, lib/verify_anything,
//     lib/machine_log), prints its pinned lines: the expected verdicts and refusal reasons, in order.
//     Control, per run and per checker it depends on: that checker swapped for a fake that accepts
//     everything changes the output, so the pinned lines fail. A run that read the same with a fake
//     checker would not be running the real one.
// R3. The scripted agent: with a permit, one email through and nine refused, each by the permit check
//     with its reason; without permits, ten through. Control: a fake log checker lets ten through.
// R4. The one-shot model: one signature, then the key is used up; a copy made before signing signs a
//     second message; the model's checker refuses a changed bit. Control: a gate that always allows
//     lets the used key sign twice.
// R5. The permit language: the sample parses; each malformed line gets its own reason; more than
//     MAX_RULES rules is refused with the number named; every rule is accepted once and refused the
//     second time and for another agent, by the real check. Control: a fake log checker accepts the
//     second use.
// R6. Every run and every demo ends with Shows / Does not show (non-empty), and each component
//     renders it. Control: a component without it is caught.
// R7. The sign-in port gives signin.py's reasons, word for word (tools/sign-in/signin.py is read);
//     and signin.py has exactly the checks the port has. Control: a reason missing from a copy is caught.
// R8. Japanese for every line a run or demo can print and every list it shows. Control.
// R9. In the tab only: no request, no storage, no animation; the pause between steps is skipped when
//     reduced motion is asked for. Each rule has a control.
// R10. The test key keeps no 12 words: makeTestKey returns only the key ids and a signing function.
// R11. With TET_CLI set: a notebook the page writes is VALID to the real notebook.py verify, and an
//      answer the page signs is accepted by the real signin.py SignInServer.accept. Skipped (and said so)
//      without TET_CLI.

import { register } from "node:module";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

const UI = new URL("../", import.meta.url).pathname;
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const read = (rel) => readFileSync(join(UI, rel), "utf8");

const { SECTIONS } = await import("../app/site/features/index.ts");
const { RUNS, NO_RUN } = await import("../app/site/run/runs.ts");
const K = await import("../app/site/run/page_key.ts");
const AG = await import("../app/site/run/agent_demo.ts");
const OS = await import("../app/site/run/one_shot_model.ts");
const PL = await import("../app/site/run/permit_lang.ts");
const SI = await import("../app/site/run/signin_check.mjs");
// The site's whole Japanese dictionary, as site_guard reads it (a demo may reuse a word another page has).
const TEXT = ["home", "tags", "machines", "keys", "services", "research", "about", "changelog", "numbers", "run"];
const JA = Object.assign({}, ...(await Promise.all(TEXT.map((s) => import(`../app/site/text/${s}.ts`)))).map((m) => m.JA));

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A t() that fills like the site's and records every template it was given. */
function recorder() {
  const seen = new Set();
  const t = (s, v) => {
    seen.add(s);
    return v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s;
  };
  return { t, seen };
}
const TEMPLATES = new Set();

async function runLines(run, c) {
  const { t, seen } = recorder();
  const lines = [];
  await run.run({ t, c, log: async (l, tone = "step") => void lines.push(`[${tone}] ${l}`) });
  for (const s of seen) TEMPLATES.add(s);
  return lines;
}

const REAL = K.REAL_CHECKERS;
const FAKES = {
  checkMachineLog: { ...REAL, checkMachineLog: async () => ({ kind: "verdict", valid: true, problems: [], records: 1, signer: null, uses: [], chain: null, hasDeviceKey: false }) },
  verifyEnvelope: { ...REAL, verifyEnvelope: async (o) => ({ ok: true, edHex: String(o.envelope?.tet?.agent_ed25519_pubkey_hex ?? ""), mldsaPubB64: "", mldsaKeyId: "", payloadType: String(o.envelope?.payloadType ?? "") }) },
  mldsa44Verify: { ...REAL, mldsa44Verify: async () => true },
};

const PID = "[0-9a-f]{32}";
const KEY = "tet-ed25519:[0-9a-f]{64}";
/** Per run: the checkers it depends on, and its lines as regexes, in order. */
const PINNED = {
  "machine-notebook": {
    uses: ["checkMachineLog"],
    lines: [/^\[step\] Test key created/, /^\[step\] Record 1 signed/, /^\[step\] Record 2 signed/, /^\[step\] Record 3 signed/, /^\[ok\] Log checked: VALID\. 3 records, in order, one key\.$/],
  },
  "machine-log-check": {
    uses: ["checkMachineLog"],
    lines: [
      /^\[step\] Test key created/,
      /^\[step\] Three records signed\.$/,
      /^\[ok\] Log checked: VALID\.$/,
      /^\[step\] Record 2's reading changed/,
      /^\[refused\] Log checked: INVALID\. record 2: signature: the content differs from what was signed \(signed \d+ bytes, given \d+\); record 2: chain\.txt: hash differs from the record; record 3: prev: does not name the record before it$/,
      /^\[step\] Record 2 taken out/,
      /^\[refused\] Log checked: INVALID\. record 3: seq: file 3\.json where record 2 should be \(a record is missing\); record 3: seq: says 3, is record 2 in order; record 3: prev: does not name the record before it$/,
    ],
  },
  "log-fingerprint": {
    uses: ["checkMachineLog"],
    lines: [
      /^\[step\] Test key created/,
      /^\[step\] Record 1 signed\. Its fingerprint: [0-9a-f]{64}$/,
      /^\[step\] On a real node/,
      /^\[step\] Changed copy's fingerprint: [0-9a-f]{64}$/,
      /^\[refused\] Log checked: INVALID\. record 1: signature: the content differs from what was signed \(signed \d+ bytes, given \d+\); record 1: chain\.txt: hash differs from the record$/,
    ],
  },
  "one-time-permits": {
    uses: ["checkMachineLog"],
    lines: [
      /^\[step\] Test key created/,
      /^\[step\] Permit created: open-vent/,
      /^\[ok\] Record 1 used the permit: accepted\.$/,
      new RegExp(`^\\[refused\\] Second use refused: permit: ${PID} was already used by record 1$`),
      /^\[step\] Permit created: water/,
      new RegExp(`^\\[refused\\] Use after it ran out refused: permit: ${PID} expired after seq 1$`),
      /^\[step\] A permit from a second test key/,
      new RegExp(`^\\[refused\\] Permit from another key refused: permit: ${PID} is signed by ${KEY}, not this device's ${KEY}$`),
      /^\[ok\] Log checked: VALID\. 1 record, the permit used once\.$/,
    ],
  },
  "agent-permit-once": {
    uses: ["checkMachineLog"],
    lines: [
      /^\[step\] Agent key created/,
      /^\[step\] The owner gives the agent a permit/,
      /^\[step\] The agent is asked .*\(request 1\)\.$/,
      /^\[ok\] Claim written to the log as record 1\./,
      /^\[step\] The agent is asked .*\(request 2\)\.$/,
      new RegExp(`^\\[refused\\] Claim refused, so the agent does nothing: permit: ${PID} was already used by record 1$`),
      /^\[ok\] Actions taken: 1\.$/,
    ],
  },
  "agent-signatures": {
    uses: ["verifyEnvelope", "mldsa44Verify"],
    lines: [
      /^\[step\] Agent key created/,
      /^\[step\] The agent signs a message/,
      /^\[ok\] The message as signed: valid\.$/,
      /^\[refused\] The same message with the Ed25519 half from another message: refused: ed25519 signature does not verify \(on this chain binding\)$/,
      /^\[refused\] The same message with the ML-DSA-44 half from another message: refused: ml-dsa-44 signature does not verify \(on this chain binding\)$/,
    ],
  },
  "sign-in-with-tet": {
    uses: ["verifyEnvelope", "mldsa44Verify"],
    lines: [
      /^\[step\] Test key created/,
      /^\[step\] example\.test asks a question/,
      new RegExp(`^\\[ok\\] The answer: accepted, key tet-ed25519:[0-9a-f]{12}…\\.$`),
      /^\[refused\] The same answer again: refused: nonce: already used$/,
      /^\[refused\] An answer to other\.example's question: refused: domain: the challenge is for 'other\.example', this is 'example\.test'$/,
      /^\[refused\] An answer with the ML-DSA-44 half from another answer: refused: signature: ml-dsa-44 signature does not verify \(on this chain binding\)$/,
      /^\[step\] example\.test asks nine more questions/,
      /^\[refused\] A late answer: refused: expired: seq is 13, the challenge was good to 12$/,
    ],
  },
  "tags-mark-genuine": {
    uses: ["verifyEnvelope"],
    lines: [
      /^\[step\] Test key created/,
      /^\[step\] Text marked: /,
      /^\[ok\] An exact copy: matches\.$/,
      /^\[refused\] A copy with one letter changed: does not match: the content differs from what was signed \(signed \d+ bytes, given \d+\)$/,
    ],
  },
};

function linesProblem(lines, pins) {
  if (lines.length !== pins.length) return `${lines.length} lines, expected ${pins.length}:\n       ${lines.join("\n       ")}`;
  for (const [i, re] of pins.entries()) if (!re.test(lines[i])) return `line ${i + 1}: ${lines[i]}\n       does not match ${re}`;
  return null;
}

// ── R1 ────────────────────────────────────────────────────────────────────────────────────────────
const ALL = SECTIONS.flatMap((s) => s.features);
function coverageProblems(features, runs, noRun) {
  const out = [];
  for (const f of features) {
    const r = f.id in runs;
    const n = f.id in noRun;
    if (r === n) out.push(`${f.id}: ${r ? "both a run and a reason for none" : "neither a run nor a reason for none"}`);
    if (n && /pull request/.test(noRun[f.id]) && !(f.evidence ?? []).some((e) => "pr" in e)) out.push(`${f.id}: says its code is in a pull request, but its evidence cites none`);
  }
  const ids = new Set(features.map((f) => f.id));
  for (const id of [...Object.keys(runs), ...Object.keys(noRun)]) if (!ids.has(id)) out.push(`${id}: not a registered feature`);
  return out;
}
await check(`R1 every feature has a run or says why not (${Object.keys(RUNS).length} runs, ${Object.keys(NO_RUN).length} without)`, () => {
  assert.deepEqual(coverageProblems(ALL, RUNS, NO_RUN), []);
});
await check("R1 control: a feature with neither, with both, and a pull-request reason without a PR are caught", () => {
  const f = { id: "x", evidence: [] };
  assert.match(coverageProblems([f], {}, {}).join(), /neither/);
  assert.match(coverageProblems([f], { x: {} }, { x: "y" }).join(), /both/);
  assert.match(coverageProblems([f], {}, { x: "its code is in an open pull request" }).join(), /cites none/);
});

// ── R2 ────────────────────────────────────────────────────────────────────────────────────────────
for (const [id, pin] of Object.entries(PINNED)) {
  await check(`R2 ${id}: the run with the real checkers prints its pinned lines`, async () => {
    assert.ok(RUNS[id], `no run ${id}`);
    const p = linesProblem(await runLines(RUNS[id], REAL), pin.lines);
    assert.equal(p, null, p ?? "");
  });
  for (const which of pin.uses) {
    await check(`R2 control ${id}: with a fake ${which} the pinned lines fail`, async () => {
      assert.notEqual(linesProblem(await runLines(RUNS[id], FAKES[which]), pin.lines), null, `${id} reads the same with a fake ${which}`);
    });
  }
}
await check("R2 every run is pinned", () => assert.deepEqual(Object.keys(RUNS).filter((id) => !PINNED[id]), []));

// ── R3 ────────────────────────────────────────────────────────────────────────────────────────────
async function agent(permits, c) {
  const { t, seen } = recorder();
  const lines = [];
  const r = await AG.runAgent({ permits, t, c, log: async (l, tone = "step") => void lines.push(`[${tone}] ${l}`) });
  for (const s of seen) TEMPLATES.add(s);
  return { ...r, lines };
}
const agentProblem = (r) => {
  if (r.sent !== 1 || r.refused !== 9) return `sent ${r.sent}, refused ${r.refused}`;
  const refusals = r.lines.filter((l) => l.startsWith("[refused] Email "));
  if (refusals.length !== 9 || !refusals.every((l) => new RegExp(`: refused, not sent: permit: ${PID} was already used by record 1$`).test(l))) return `refusals:\n${refusals.join("\n")}`;
  if (!r.lines.some((l) => /^\[ok\] The agent's log, checked: VALID\./.test(l))) return "the log was not checked VALID";
  return null;
};
await check("R3 the scripted agent: with a one-time permit, 1 email through and 9 refused by the permit check, each with its reason", async () => {
  const p = agentProblem(await agent(true, REAL));
  assert.equal(p, null, p ?? "");
});
await check("R3 without permits, the same agent sends all 10", async () => {
  const r = await agent(false, REAL);
  assert.deepEqual([r.sent, r.refused], [10, 0]);
  assert.equal(AG.TARGETS.length, 10);
  for (const to of AG.TARGETS) assert.ok(AG.INJECTION.includes(to) && to.endsWith("@example.test"));
});
await check("R3 control: with a fake log checker the permitted agent sends 10, and the check fails", async () => {
  assert.notEqual(agentProblem(await agent(true, FAKES.checkMachineLog)), null);
});

// ── R4 ────────────────────────────────────────────────────────────────────────────────────────────
/** A fixed random source, so a run of the model is repeatable. */
function seeded(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function oneShotProblems(gate) {
  const out = [];
  const rand = seeded(7);
  const { key, prepared } = OS.makeKey(rand);
  const copy = OS.copyKey(key, "copy");
  const s1 = OS.sign(key, "message 1", rand, gate);
  if (!s1.ok) out.push("the fresh key did not sign");
  else if (!OS.check(prepared, s1.sig).ok) out.push("the model's checker refused an honest signature");
  const s2 = OS.sign(key, "message 2", rand, gate);
  if (s2.ok) out.push("the used key signed a second time");
  else if (s2.why !== "its qubits were measured by the first signature, so the key is gone") out.push(`wrong reason: ${s2.why}`);
  const s3 = OS.sign(copy, "message 2", rand, gate);
  if (!s3.ok || !OS.check(prepared, s3.sig).ok) out.push("the copy made before signing did not sign a second message");
  if (s1.ok) {
    const i = s1.sig.bases.findIndex((b, j) => b === prepared[j].basis);
    const bad = { ...s1.sig, bits: s1.sig.bits.map((b, j) => (j === i ? 1 - b : b)) };
    if (i < 0 || OS.check(prepared, bad).ok) out.push("a changed bit was not refused");
  }
  return out;
}
await check("R4 the one-shot model: signs once, then refuses; a copy signs again; a changed bit is refused", () => {
  assert.deepEqual(oneShotProblems(OS.REAL_GATE), []);
  // Measuring in the prepared basis gives the prepared bit, every time (the Born rule, not a coin).
  for (let s = 1; s < 50; s++) {
    const rand = seeded(s);
    const { key, prepared } = OS.makeKey(rand);
    const r = OS.sign(key, `m${s}`, rand);
    assert.ok(r.ok && OS.check(prepared, r.sig).ok, `seed ${s}`);
  }
});
await check("R4 control: a gate that always allows lets the used key sign twice, and the check fails", () => {
  assert.match(oneShotProblems({ canSign: () => ({ ok: true }) }).join(), /used key signed a second time/);
});

// ── R5 ────────────────────────────────────────────────────────────────────────────────────────────
await check("R5 the permit language: the sample parses, each bad line gets its own reason, and the rule limit is named", () => {
  const s = PL.parse(PL.SAMPLE);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.rules.map((r) => [r.agent, r.action, r.beforeBlock]), [["shopper", "buy", 5000], ["mailer", "send-email", 3]]);
  const why = (line) => PL.parse(line).errors.map((e) => e.why);
  assert.deepEqual(why('allow agent "a" to "b" twice, before block 9'), ['only "once": every permit here is one-time']);
  assert.deepEqual(why('allow agent "a" to "b" once'), ['a permit needs an end: add "before block <N>"']);
  assert.deepEqual(why('deny agent "a" to "b" once, before block 9'), ['a rule starts with "allow"']);
  assert.deepEqual(why('allow agent "a" to "b" once, before block 1'), ["before block 1 leaves no block to use it in"]);
  assert.deepEqual(why('allow agent "a b" to "c" once, before block 9'), ['not understood; the form is: allow agent "name" to "action" once, before block N']);
  const many = Array.from({ length: PL.MAX_RULES + 1 }, (_, i) => `allow agent "a" to "x${i}" once, before block 9`).join("\n");
  const e = PL.parse(many).errors;
  assert.deepEqual(e, [{ line: 0, why: "this sketch reads at most {max} rules; the text has {n}", vars: { max: PL.MAX_RULES, n: PL.MAX_RULES + 1 } }]);
});
async function rules(c) {
  const { t, seen } = recorder();
  const lines = [];
  await PL.runRules({ rules: PL.parse(PL.SAMPLE).rules, t, c, log: async (l, tone = "step") => void lines.push(`[${tone}] ${l}`) });
  for (const s of seen) TEMPLATES.add(s);
  return lines;
}
const RULE_PINS = [
  /^\[step\] Agent "shopper": test key/,
  /^\[step\] Agent "mailer": test key/,
  /^\[step\] Line 1: permit for "shopper" to "buy", once, open up to record 4999\.$/,
  /^\[ok\] Used once: accepted\.$/,
  new RegExp(`^\\[refused\\] Used again: refused: permit: ${PID} was already used by record 1$`),
  new RegExp(`^\\[refused\\] "mailer" using this permit: refused: permit: ${PID} is signed by ${KEY}, not this device's ${KEY}$`),
  /^\[step\] Line 2: permit for "mailer" to "send-email", once, open up to record 2\.$/,
  /^\[ok\] Used once: accepted\.$/,
  new RegExp(`^\\[refused\\] Used again: refused: permit: ${PID} (?:was already used by record 1|expired after seq 2)$`),
  new RegExp(`^\\[refused\\] "shopper" using this permit: refused: permit: ${PID} is signed by ${KEY}, not this device's ${KEY}$`),
];
await check("R5 every rule becomes a permit the real check accepts once and refuses the second time and for another agent", async () => {
  const p = linesProblem(await rules(REAL), RULE_PINS);
  assert.equal(p, null, p ?? "");
});
await check("R5 control: with a fake log checker the second use is accepted, and the pinned lines fail", async () => {
  assert.notEqual(linesProblem(await rules(FAKES.checkMachineLog), RULE_PINS), null);
});

// ── R6 ────────────────────────────────────────────────────────────────────────────────────────────
const VIEWS = read("app/site/run/RunViews.tsx");
/** The body of each exported component, by name. */
function components(src) {
  const out = {};
  const re = /export function (\w+)\(/g;
  const starts = [...src.matchAll(re)].map((m) => [m[1], m.index]);
  for (const [i, [name, at]] of starts.entries()) out[name] = src.slice(at, starts[i + 1]?.[1] ?? src.length);
  return out;
}
const endsProblems = (src) => ["RunSlot", "AgentDemo", "OneShotDemo", "PermitSketch"].filter((n) => !/<RunEnd\b[^>]*shows=\{[^}]+\}[^>]*doesNot=\{[^}]+\}/.test(components(src)[n] ?? "")).map((n) => `${n} does not end with Shows / Does not show`);
await check("R6 every run and demo ends with Shows / Does not show, non-empty", () => {
  for (const [id, r] of Object.entries(RUNS)) assert.ok(r.shows.length && r.doesNot.length, id);
  for (const l of [AG.AGENT_DEMO_SHOWS, AG.AGENT_DEMO_DOES_NOT, OS.ONE_SHOT_SHOWS, OS.ONE_SHOT_DOES_NOT, PL.PERMIT_LANG_SHOWS, PL.PERMIT_LANG_DOES_NOT]) assert.ok(l.length);
  assert.deepEqual(endsProblems(VIEWS), []);
  assert.match(VIEWS, /function RunEnd[\s\S]*?<ShowsDoesNot shows=\{props\.shows\} doesNot=\{props\.doesNot\} \/>/);
});
await check("R6 control: a demo without Shows / Does not show is caught", () => {
  const broken = VIEWS.replace(/\{r\.state === "done" \? <RunEnd shows=\{AGENT_DEMO_SHOWS\} doesNot=\{AGENT_DEMO_DOES_NOT\} \/> : null\}/, "");
  assert.notEqual(broken, VIEWS);
  assert.deepEqual(endsProblems(broken), ["AgentDemo does not end with Shows / Does not show"]);
});
await check("R6 the labels the owner asked for are on the demos", () => {
  const c = components(VIEWS);
  assert.match(c.AgentDemo, /label="Prototype"/);
  assert.match(c.AgentDemo, /Scripted agent, not a language model\./);
  assert.match(c.OneShotDemo, /label="Idea, model only"/);
  assert.match(c.OneShotDemo, /an unknown quantum state cannot be copied/);
  assert.match(c.PermitSketch, /label="Idea"/);
});

// ── R7 ────────────────────────────────────────────────────────────────────────────────────────────
const SIGNIN_PY = readFileSync(join(ROOT, "tools/sign-in/signin.py"), "utf8");
/** The fixed text of each reason the port gives (the variable parts left out). */
const REASONS = [
  "payload type: not ",
  "signature: ",
  "signature: no single Ed25519 key id",
  "challenge: not JSON",
  "challenge: not a canonical ",
  "domain: the challenge is for ",
  ", this is ",
  "nonce: not issued here",
  "challenge: not the one issued for this nonce",
  "nonce: already used",
  "expired: seq is ",
  ", the challenge was good to ",
];
const reasonProblems = (py, port) => {
  const out = REASONS.filter((r) => !py.includes(r)).map((r) => `not in signin.py: ${JSON.stringify(r)}`);
  out.push(...REASONS.filter((r) => !port.includes(r)).map((r) => `not in the port: ${JSON.stringify(r)}`));
  const n = (s) => (s.match(/raise Refused\(|throw new Refused\(/g) ?? []).length;
  if (n(py) !== n(port)) out.push(`signin.py raises Refused ${n(py)} times, the port ${n(port)}`);
  return out;
};
await check("R7 the sign-in port gives signin.py's reasons, and has exactly its checks", () => {
  assert.deepEqual(reasonProblems(SIGNIN_PY, read("app/site/run/signin_check.mjs")), []);
  assert.equal(SI.KIND, /KIND = "([^"]+)"/.exec(SIGNIN_PY)[1]);
  assert.equal(SI.PAYLOAD_TYPE, /PAYLOAD_TYPE = "([^"]+)"/.exec(SIGNIN_PY)[1]);
  assert.equal(SI.TTL, Number(/TTL = (\d+)/.exec(SIGNIN_PY)[1]));
});
await check("R7 control: a reason missing from the port, and a check added to signin.py, are caught", () => {
  const port = read("app/site/run/signin_check.mjs");
  assert.match(reasonProblems(SIGNIN_PY, port.replace("nonce: already used", "nonce: used")).join(), /not in the port: "nonce: already used"/);
  assert.match(reasonProblems(`${SIGNIN_PY}\n            raise Refused("new check")`, port).join(), /raises Refused 11 times, the port 10/);
});

// ── R8 ────────────────────────────────────────────────────────────────────────────────────────────
// Everything a run or demo can show: what the runs above printed (TEMPLATES), the demo's own
// sentences and buttons (t("…") and label="…" in RunViews), and every list.
function viewStrings(src) {
  const out = new Set();
  for (const m of src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
  for (const m of src.matchAll(/\b(?:t|label)\(?[=(]?\s*'((?:[^'\\]|\\.)*)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\blabel="((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
  // The one-shot model's key names, shown through t(k.key.label).
  for (const m of src.matchAll(/\b(?:makeKey|copyKey)\([^,]*,\s*"([^"]+)"\)/g)) out.add(m[1]);
  // A computed label (label={r.state === "running" ? "Running…" : "Run it"}): every capitalised string
  // inside it (the lower-case ones are the state names it compares against).
  for (const m of src.matchAll(/\blabel=\{([^}]*)\}/g)) for (const q of m[1].matchAll(/"([A-Z](?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${q[1]}"`));
  return out;
}
function allShown() {
  const s = new Set([...TEMPLATES, ...viewStrings(VIEWS)]);
  for (const r of Object.values(RUNS)) for (const x of [...r.shows, ...r.doesNot]) s.add(x);
  for (const x of Object.values(NO_RUN)) s.add(x);
  for (const x of [...AG.AGENT_DEMO_SHOWS, ...AG.AGENT_DEMO_DOES_NOT, ...OS.ONE_SHOT_SHOWS, ...OS.ONE_SHOT_DOES_NOT, ...PL.PERMIT_LANG_SHOWS, ...PL.PERMIT_LANG_DOES_NOT]) s.add(x);
  for (const line of ['allow agent "a" to "b" twice, before block 9', 'allow agent "a" to "b" once', "deny", 'allow agent "a" to "b" once, before block 1', 'allow agent "a b" to "c" once, before block 9'])
    for (const e of PL.parse(line).errors) s.add(e.why);
  s.add("this sketch reads at most {max} rules; the text has {n}");
  s.add(OS.REAL_GATE.canSign({ used: true }).why);
  // The one-shot demo's lines (it runs on clicks, so its templates are listed from its source).
  return s;
}
const jaMissing = (strings, ja) => [...strings].filter((s) => /[A-Za-z]{3,}/.test(s) && !(s in ja));
await check("R8 every line a run or demo prints, and every list it shows, has Japanese", () => {
  assert.deepEqual(jaMissing(allShown(), JA), []);
});
await check("R8 control: a line without Japanese is caught", () => {
  const { ["Second use refused: {why}"]: _, ...less } = JA;
  assert.deepEqual(jaMissing(allShown(), less), ["Second use refused: {why}"]);
});

// ── R9 ────────────────────────────────────────────────────────────────────────────────────────────
const RUN_FILES = ["runs.ts", "page_key.ts", "page_notebook.ts", "signin_check.mjs", "agent_demo.ts", "one_shot_model.ts", "permit_lang.ts", "RunViews.tsx"];
const SRC = Object.fromEntries(RUN_FILES.map((f) => [f, read(`app/site/run/${f}`)]));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function tabOnlyProblems(src) {
  const out = [];
  const rules = [
    [/\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie|caches\.open/, "storage beyond the tab"],
    [/\bfetch\(|XMLHttpRequest|\bWebSocket\b|\bEventSource\b|sendBeacon|navigator\.serviceWorker/, "a request"],
    [/\banimate-|\btransition\b|\btransition-|@keyframes/, "an animation"],
  ];
  for (const [f, s0] of Object.entries(src)) {
    const s = strip(s0);
    for (const [re, why] of rules) if (re.test(s)) out.push(`${f}: ${why}`);
  }
  const v = strip(src["RunViews.tsx"] ?? "");
  if (!/matchMedia\("\(prefers-reduced-motion: reduce\)"\)/.test(v)) out.push("RunViews.tsx: does not ask for reduced motion");
  if (!/if \(!reduceRef\.current\) await new Promise/.test(v)) out.push("RunViews.tsx: the pause between steps is not skipped for reduced motion");
  return out;
}
await check(`R9 in the tab only: no request, no storage, no animation, and reduced motion skips the pause (${RUN_FILES.length} files)`, () => {
  assert.deepEqual(tabOnlyProblems(SRC), []);
});
await check("R9 control: storage, a request, an animation and an unconditional pause are each caught", () => {
  for (const [add, re] of [
    ["localStorage.setItem('k', 'v');", /storage/],
    ["fetch('/x');", /a request/],
    ['const c = "animate-pulse";', /an animation/],
  ]) assert.match(tabOnlyProblems({ ...SRC, "x.ts": add }).join(), re, add);
  const v = SRC["RunViews.tsx"].replace("if (!reduceRef.current) await new Promise", "await new Promise");
  assert.match(tabOnlyProblems({ ...SRC, "RunViews.tsx": v }).join(), /not skipped for reduced motion/);
});

// ── R10 ───────────────────────────────────────────────────────────────────────────────────────────
await check("R10 the test key keeps no 12 words: only key ids and a signing function", async () => {
  const k = await K.makeTestKey();
  assert.deepEqual(Object.keys(k).sort(), ["edHex", "keyid", "mlPubB64", "sign"]);
  for (const v of Object.values(k)) if (typeof v === "string") assert.ok(!/^[a-z]+( [a-z]+){11}$/.test(v));
  assert.match(k.keyid, /^tet-ed25519:[0-9a-f]{64}$/);
});

// ── R11 ───────────────────────────────────────────────────────────────────────────────────────────
const CLI = process.env.TET_CLI;
if (!CLI) {
  console.log("skip R11 the real notebook.py and signin.py read what the page writes (TET_CLI is not set)");
} else {
  // notebook.py verify needs --pin: both key ids of the expected signer, from a file kept outside
  // the folder. The pin is built from the test key itself (its Ed25519 key id, and the ML-DSA-44 key
  // id computed from its public key), never read out of the envelopes being checked, so the check
  // is not circular.
  const { mldsa44KeyId } = await import("../app/lib/verify_anything.mjs");
  const pinOf = (key) => [key.keyid, mldsa44KeyId(key.mlPubB64)];
  async function verifyPageNotebook(key, pin) {
    const N = await import("../app/site/run/page_notebook.ts");
    const nb = N.newNotebook(key, K.RUN_CHAIN);
    const pid = await N.addPermit(nb, "open-vent", 3);
    await N.addRecord(nb, { value: 21, unit: "celsius" }, REAL);
    await N.addRecord(nb, { value: "open-vent", unit: "action" }, REAL, pid);
    const dir = mkdtempSync(join(tmpdir(), "site-run-nb-"));
    const pinDir = mkdtempSync(join(tmpdir(), "site-run-pin-"));
    try {
      for (const [p, b] of nb.files) {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), b);
      }
      writeFileSync(join(dir, "chain.txt"), nb.hashes.map((h) => `${h}\n`).join(""));
      const args = [join(ROOT, "tools/machine-notebook/notebook.py"), "--tet-cli", CLI, "verify", "--dir", dir];
      if (pin) {
        writeFileSync(join(pinDir, "device.pin"), typeof pin === "string" ? pin : `${pin[0]}\n${pin[1]}\n`);
        args.push("--pin", join(pinDir, "device.pin"));
      }
      return { ...spawnSync("python3", args, { encoding: "utf8" }), permitId: pid };
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(pinDir, { recursive: true, force: true });
    }
  }
  await check("R11 a notebook the page writes is VALID to the real notebook.py verify, pinned to the page's key (tet-cli)", async () => {
    const key = await K.makeTestKey();
    const r = await verifyPageNotebook(key, pinOf(key));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^VALID\\n  2 records, all signed by ${key.keyid}\\n  permit ${r.permitId} \\(open-vent\\): used once, by record 2`));
  });
  // Every envelope in the notebook (record 1, record 2, and the permit record 2 uses) must be
  // refused, each on its own line: a regex that any one line could satisfy would stay green if
  // records, or permits, or all but one record went unpinned. A near-miss id (last hex digit
  // changed) catches a check that compares only part of a key id.
  const problemLines = (out) => out.split("\nShows:\n")[0].split("\n").slice(1);
  const nearMiss = (id) => id.slice(0, -1) + (id.endsWith("0") ? "1" : "0");
  await check("R11 control: a pin wrong in one half only, or not a full pin, is refused for that reason on every envelope (tet-cli)", async () => {
    const key = await K.makeTestKey();
    const [ed, ml] = pinOf(key);
    const [otherEd, otherMl] = pinOf(await K.makeTestKey());
    assert.notEqual(ed, otherEd);
    assert.notEqual(ml, otherMl);
    const cases = [
      ["another key's ML-DSA-44 id", [ed, otherMl], (pinned) => `its ML-DSA-44 half is signed by ${ml}, not this device's ${pinned[1]}`],
      ["a near-miss ML-DSA-44 id", [ed, nearMiss(ml)], (pinned) => `its ML-DSA-44 half is signed by ${ml}, not this device's ${pinned[1]}`],
      ["another key's Ed25519 id", [otherEd, ml], (pinned) => `signed by ${ed}, not this device's ${pinned[0]}`],
      ["a near-miss Ed25519 id", [nearMiss(ed), ml], (pinned) => `signed by ${ed}, not this device's ${pinned[0]}`],
    ];
    for (const [name, pinned, why] of cases) {
      const r = await verifyPageNotebook(key, pinned);
      assert.notEqual(r.status, 0, `${name}: ${r.stdout}`);
      assert.match(r.stdout, /^INVALID\n/, name);
      assert.deepEqual(problemLines(r.stdout), [
        `  record 1: key: ${why(pinned)}`,
        `  record 2: key: ${why(pinned)}`,
        // notebook.py words an Ed25519 refusal of a permit as "permit: <id> is signed by ...".
        why(pinned).startsWith("signed") ? `  record 2: permit: ${r.permitId} is ${why(pinned)}` : `  record 2: permit: ${r.permitId}: ${why(pinned)}`,
      ], name);
    }
    const oneLine = await verifyPageNotebook(key, `${ed}\n`);
    assert.equal(oneLine.status, 2, oneLine.stdout + oneLine.stderr);
    assert.match(oneLine.stderr, /is not a pin file: two lines, tet-ed25519:<64 hex> and tet-mldsa44:<64 hex>/);
    const none = await verifyPageNotebook(key, null);
    assert.equal(none.status, 2, none.stdout + none.stderr);
    assert.match(none.stderr, /the following arguments are required: --pin/);
  });
  await check("R11 an answer the page signs is accepted by the real signin.py SignInServer.accept (tet-cli)", async () => {
    const chain = { chainId: "tet-example-sign-in", genesisHash: (await import("node:crypto")).createHash("sha256").update("tet sign-in prototype").digest("hex") };
    const site = SI.newSite("example.test", chain);
    const ch = SI.issue(site);
    const env = await K.signEnvelope(await K.makeTestKey(), chain, SI.PAYLOAD_TYPE, SI.challengeBytes(ch));
    const py = [
      "import json, sys, importlib.util",
      `spec = importlib.util.spec_from_file_location("signin", ${JSON.stringify(join(ROOT, "tools/sign-in/signin.py"))})`,
      "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "d = json.load(sys.stdin)",
      `st = m.SignInServer("example.test", cli=${JSON.stringify(CLI)})`,
      "st.seq = 1; st.issued[d['ch']['nonce']] = m.canonical(d['ch'])",
      "print(st.accept(d['env']))",
      "try:\n    st.accept(d['env'])\nexcept m.Refused as e:\n    print('refused:', e)",
    ].join("\n");
    const r = spawnSync("python3", ["-c", py], { input: JSON.stringify({ ch, env }), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `tet-ed25519:${env.tet.agent_ed25519_pubkey_hex}\nrefused: nonce: already used\n`);
  });
}

console.log(failed ? `\nsite_run_guard: ${failed} FAILED` : "\nsite_run_guard: all green");
process.exit(failed ? 1 : 0);
