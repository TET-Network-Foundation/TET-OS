// Guard for /agents, "Agent and machine control" (app/agents/AgentsControl.tsx, lib/agents_control.mjs,
// and the permit list lib/machine_log.mjs gives it).
//
//   node --experimental-strip-types scripts/agents_control_guard.mjs
//
// P. Permit states follow notebook.py's semantics, on folders built from the fixture the real
//    notebook.py and tet-cli wrote (scripts/fixtures/machine_log_v1.json): used (a citation that
//    checked out), unused (no citation, the next record may still cite it), expired (the log already
//    holds expires_seq records), and a refused citation is never counted as used. Each assertion is
//    also run against a wrong implementation, which it must catch.
// C. The command builder: its flags are notebook.py's argparse names for `permit`, and it agrees with
//    the real notebook.py on every input of a corpus: it gives a command exactly when notebook.py
//    passes argparse and cmd_permit's checks (run for real, stopping at signing because TET_CLI points
//    nowhere), with notebook.py's own wording when it refuses. The command is run through `sh -c`, so
//    a folder with spaces, quotes or `$` in its name reaches notebook.py as typed.
// S. Shows / Does not show: the page's components are rendered (React, server-side), and every card
//    with a verdict, VALID or INVALID, carries both lists, word for word SHOWS / DOES_NOT_SHOW through
//    t(), after the verdict; in Japanese too. The page spells out none of the items itself.
// N. No upload: no fetch / XMLHttpRequest / sendBeacon / WebSocket / EventSource / form in the page or
//    the modules that read the folder; and checking and rendering a folder with every one of those
//    stubbed to record calls makes none. device.key is never read, also by the permit listing.
// L. The status line "prototype, local only" is at the top of the page, in English and in Japanese.
// W. Wording: no money words, no "prove"/"proof" claim, no "untraceable", no AI claim, in English,
//    Japanese and Chinese; every string has Japanese and Hong Kong Chinese with the same placeholders.
// V. Plain reading: one lead sentence (en/ja/zh-HK); "Try with a sample" is the one primary button
//    and adds the two bundled samples; every machine leads with VALID / INVALID and one sentence, with
//    key id, reasons, permission ids and chain only behind "Show details"; no envelope / nullifier /
//    permit_id / canonical outside the fold; "1 record", never "1 records"; the copy button copies
//    exactly the command shown, falls back to the selection, and says when it could not.
// Permit ids in P are read from the fixture, which each regeneration re-keys.

import { register, createRequire } from "node:module";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, readdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const UI = new URL("../", import.meta.url);
const ROOT = new URL("../../../", import.meta.url).pathname;
const require = createRequire(new URL("package.json", UI));
register("./lib/ts_hooks.mjs", import.meta.url);
// .tsx under plain Node: TypeScript's own transpiler, JSX to react/jsx-runtime. Registered after
// ts_hooks, so it sees .tsx URLs first and hands everything else on.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { readFileSync } from "node:fs";
      import { fileURLToPath } from "node:url";
      import { createRequire } from "node:module";
      const ts = createRequire(${JSON.stringify(new URL("package.json", UI).pathname)})("typescript");
      export async function load(url, context, next) {
        if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context);
        const out = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          fileName: fileURLToPath(url),
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        });
        return { format: "module", source: out.outputText, shortCircuit: true };
      }`),
);

const ac = await import("../app/lib/agents_control.mjs");
const ml = await import("../app/lib/machine_log.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const { JA } = await import("../app/try/i18n_ja.ts");
const { ZH_HK } = await import("../app/try/i18n_zh_hk.ts");
const { translate } = await import("../app/try/i18n.tsx");
const page = await import("../app/agents/AgentsControl.tsx");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const read = (rel) => readFileSync(new URL(rel, UI), "utf8");
const PAGE = read("app/agents/AgentsControl.tsx");
const LIB = read("app/lib/agents_control.mjs");
const NOTEBOOK = readFileSync(join(ROOT, "tools/machine-notebook/notebook.py"), "utf8");
const FIX = JSON.parse(read("scripts/fixtures/machine_log_v1.json"));

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

// ── folders from the fixture ────────────────────────────────────────────────────────────────────

const b64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const enc = (s) => Buffer.from(s).toString("base64");
function folder(name, extra = {}) {
  const c = name ? FIX.cases.find((x) => x.name === name) : { files: {} };
  assert.ok(c, `no fixture case ${name}`);
  const files = { ...FIX.base, ...c.files, ...extra };
  for (const [k, v] of Object.entries(files)) if (v === null) delete files[k];
  return files;
}
/** The base log cut to its first record: the permit is still open and nothing cites it. */
function firstRecordOnly() {
  const lines = Buffer.from(FIX.base["chain.txt"], "base64").toString().split("\n");
  const drop = {};
  for (const n of [2, 3, 4]) Object.assign(drop, { [`records/${n}.json`]: null, [`records/${n}.json.sig.json`]: null });
  return folder(null, { ...drop, "chain.txt": enc(`${lines[0]}\n`) });
}
async function verdict(files) {
  const reads = [];
  const r = await ml.checkMachineLog({
    paths: Object.keys(files),
    read: async (p) => {
      reads.push(p);
      if (!(p in files)) throw new Error(`read of a path not in the folder: ${p}`);
      return b64(files[p]);
    },
    mldsa44Verify,
  });
  return { r, reads };
}
const statesOf = (r, impl = ac.permitStates) =>
  impl({ records: r.records, permits: r.permits.flatMap((p) => (p.permit ? [p.permit] : [])), citations: r.citations });
// Permit ids are read from the fixture (each regeneration makes new keys, so new ids).
/** The one permit file a case adds to the base log. */
const addedPermit = (name) => {
  const ids = Object.keys(FIX.cases.find((c) => c.name === name).files).map((p) => /^permits\/([0-9a-f]{32})\.json$/.exec(p)?.[1]).filter((x) => x && !(`permits/${x}.json` in FIX.base));
  assert.equal(ids.length, 1, `${name}: ${ids.length} added permits`);
  return ids[0];
};
const BASE_PIDS = Object.keys(FIX.base).map((p) => /^permits\/([0-9a-f]{32})\.json$/.exec(p)?.[1]).filter(Boolean);
assert.equal(BASE_PIDS.length, 1, "the base log holds one permit");
const PID = BASE_PIDS[0]; // the base log's permit: open-valve, open until seq 3
const EXPIRED_PID = addedPermit("permit_expired"); // permit_expired: close-valve, until seq 2, cited by record 3
const FOREIGN_PID = addedPermit("permit_other_key"); // permit_other_key: signed by another device's key

// ── P. permit states ────────────────────────────────────────────────────────────────────────────

const V = {
  valid: await verdict(folder("valid")),
  first: await verdict(firstRecordOnly()),
  expired: await verdict(folder("permit_expired")),
  reused: await verdict(folder("permit_reused")),
  otherKey: await verdict(folder("permit_other_key")),
};

/** Every way an implementation's states differ from notebook.py's. Empty means it agrees. */
function stateProblems(impl) {
  const out = [];
  const want = (label, r, pid, state, by) => {
    const s = statesOf(r, impl).find((x) => x.permitId === pid);
    if (!s) return out.push(`${label}: ${pid} not listed`);
    if (s.state !== state || s.by !== by) out.push(`${label}: ${pid} is ${s.state} (by ${s.by}), want ${state} (by ${by})`);
  };
  want("valid log", V.valid.r, PID, "used", 2);
  want("first record only", V.first.r, PID, "unused", null);
  want("permit_expired", V.expired.r, EXPIRED_PID, "expired", null);
  want("permit_expired", V.expired.r, PID, "used", 2);
  want("permit_reused", V.reused.r, PID, "used", 2);
  // The boundary, as notebook.py: seq <= expires_seq may cite, so a log of expires_seq records is past it.
  const p = { permitId: "a".repeat(32), action: "x", expiresSeq: 3n };
  const one = (records, citations) => impl({ records, permits: [p], citations })[0];
  if (one(2, []).state !== "unused") out.push(`2 records, open until 3: ${one(2, []).state}, want unused`);
  if (one(3, []).state !== "expired") out.push(`3 records, open until 3: ${one(3, []).state}, want expired`);
  // Refused, not expired: notebook.py counts the citation (used.setdefault), so it is not unused either.
  const ref = one(2, [{ seq: 2, permitId: p.permitId, ok: false }]);
  if (ref.state !== "refused" || ref.by !== 2) out.push(`refused citation at 2 of 2, open until 3: ${ref.state} (by ${ref.by}), want refused (by 2)`);
  return out;
}

await check("P1 the fixture's citations are what notebook.py's check found (refused ones marked refused)", () => {
  assert.equal(V.valid.r.valid, true);
  assert.deepEqual(V.valid.r.citations, [{ seq: 2, permitId: PID, ok: true }]);
  assert.equal(V.first.r.valid, true, V.first.r.problems.map(ml.problemLine).join(" | "));
  assert.deepEqual(V.first.r.citations, []);
  assert.deepEqual(V.expired.r.citations, [{ seq: 2, permitId: PID, ok: true }, { seq: 3, permitId: EXPIRED_PID, ok: false }]);
  assert.deepEqual(V.reused.r.citations, [{ seq: 2, permitId: PID, ok: true }, { seq: 3, permitId: PID, ok: false }]);
});

await check("P2 used / unused / expired / cited-refused follow notebook.py; a refused citation is never used", () => {
  assert.deepEqual(stateProblems(ac.permitStates), []);
});

await check("P2 control: wrong implementations are each caught", () => {
  const anyCitationUses = (o) =>
    ac.permitStates({ ...o, citations: o.citations.map((c) => ({ ...c, ok: true })) });
  const strictExpiry = (o) => ac.permitStates({ ...o, records: o.records - 1 }); // records > expires
  const noRefused = (o) => ac.permitStates(o).map((s) => (s.state === "refused" ? { ...s, state: "unused", by: null } : s));
  const lastUse = (o) => ac.permitStates({ ...o, citations: [...o.citations].reverse().map((c) => ({ ...c, ok: !c.ok ? true : c.ok })) });
  for (const [name, impl] of Object.entries({ anyCitationUses, strictExpiry, noRefused, lastUse })) {
    assert.ok(stateProblems(impl).length > 0, `${name} passed`);
  }
});

await check("P3 a permit signed by another key is listed as not this device's, with notebook.py's reason", () => {
  const f = V.otherKey.r.permits.find((p) => p.permitId === FOREIGN_PID);
  assert.ok(f, "not listed");
  assert.equal(f.permit, null);
  assert.match(f.why, new RegExp(`^permit: ${FOREIGN_PID} is signed by tet-ed25519:[0-9a-f]{64}, not this device's tet-ed25519:[0-9a-f]{64}$`));
  assert.ok(!statesOf(V.otherKey.r).some((s) => s.permitId === f.permitId), "it has a state");
});

await check(`P4 more than ${ml.MAX_PERMITS} permit files: the listing is refused with the count, not cut short`, async () => {
  const files = folder("valid");
  const extra = Array.from({ length: ml.MAX_PERMITS + 1 }, (_, i) => `permits/${i.toString(16).padStart(32, "0")}.json`);
  const r = await ml.checkMachineLog({
    paths: [...Object.keys(files), ...extra],
    read: async (p) => b64(files[p]),
    mldsa44Verify,
  });
  assert.equal(r.permitsTooMany, ml.MAX_PERMITS + 2); // the base permit too
  assert.deepEqual(r.permits, []);
  assert.equal(r.valid, true, "the verdict is unaffected");
});

// ── C. the command ──────────────────────────────────────────────────────────────────────────────

/** The `permit` subparser's arguments in notebook.py: [{ flag, required, type }]. */
function permitArgs(src) {
  const m = /s = sub\.add_parser\("permit"\)\n((?:\s+s\.add_argument\(.*\)\n)+)/.exec(src);
  if (!m) throw new Error("no permit subparser in notebook.py");
  return [...m[1].matchAll(/s\.add_argument\("(--[a-z-]+)"(.*)\)/g)].map((x) => ({ flag: x[1], required: /required=True/.test(x[2]), type: /type=int/.test(x[2]) ? "int" : "str" }));
}

await check("C1 the command uses notebook.py's argparse names for permit, every one, each required", () => {
  const args = permitArgs(NOTEBOOK);
  assert.deepEqual(args.map((a) => a.flag).sort(), ["--action", "--dir", "--expires-seq"]);
  assert.ok(args.every((a) => a.required), "an argument is optional");
  assert.equal(args.find((a) => a.flag === "--expires-seq").type, "int");
  assert.deepEqual(Object.values(ac.PERMIT_FLAGS).sort(), args.map((a) => a.flag).sort());
  const c = ac.permitCommand({ dir: "nb", action: "open-valve", expiresSeq: "3" });
  assert.equal(c.command, "python3 tools/machine-notebook/notebook.py permit --dir nb --action open-valve --expires-seq 3");
  const used = [...c.command.matchAll(/\s(--[a-z-]+)\s/g)].map((x) => x[1]).sort();
  assert.deepEqual(used, args.map((a) => a.flag).sort());
  assert.ok(existsSync(join(ROOT, c.command.split(" ")[1])), "the script path in the command does not exist");
});

await check("C1 control: a renamed flag, or a missing one, is caught", () => {
  assert.notDeepEqual(permitArgs(NOTEBOOK.replace('"--expires-seq", type=int', '"--expires", type=int')).map((a) => a.flag).sort(), ["--action", "--dir", "--expires-seq"]);
  const used = [..."python3 x permit --dir nb --action a --expires_seq 3".matchAll(/\s(--[a-z-]+)\s/g)].map((x) => x[1]).sort();
  assert.notDeepEqual(used, ["--action", "--dir", "--expires-seq"]);
});

// The real notebook.py, on every input: does it get past argparse and cmd_permit's checks? With
// TET_CLI pointing nowhere it then stops at signing, with "tet-cli not found", and removes the permit
// file it wrote. A notebook folder here is a device.key (mode 0600, never a real phrase) and a chain.json.
const TMP = mkdtempSync(join(tmpdir(), "agents-guard-"));
const NOWHERE = join(TMP, "no-such-tet-cli");
function deviceDir(name) {
  const d = join(TMP, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "device.key"), "not a phrase\n");
  chmodSync(join(d, "device.key"), 0o600);
  writeFileSync(join(d, "chain.json"), JSON.stringify(FIX.chain));
  return d;
}
const env = { ...process.env, TET_CLI: NOWHERE };
/** notebook.py's outcome for argv: "accepted" or its stderr. */
function notebook(argv) {
  const p = spawnSync("python3", ["tools/machine-notebook/notebook.py", ...argv], { cwd: ROOT, env, encoding: "utf8" });
  return p.stderr.includes(`tet-cli not found at ${NOWHERE}`) ? "accepted" : p.stderr.trim() || `exit ${p.status}`;
}
/** The builder's command run through the shell, as a visitor would paste it. */
function shell(command) {
  const p = spawnSync("sh", ["-c", command], { cwd: ROOT, env, encoding: "utf8" });
  return p.stderr.includes(`tet-cli not found at ${NOWHERE}`) ? "accepted" : p.stderr.trim() || `exit ${p.status}`;
}

const DIRS = ["nb", "dev one", "it's", "a$b", 'q"uote', "x;y", "back\\slash", "*"].map((n) => [n, deviceDir(n)]);
const NB = DIRS[0][1];
const CORPUS = [
  // [dir, action, expires-seq]
  ...DIRS.map(([, d]) => [d, "open-valve", "3"]),
  [NB, "a", "1"],
  [NB, "x".repeat(64), "9"],
  [NB, "A.b_c-9", "12"],
  [NB, "-1", "4"], // argparse reads a negative number as a value
  [NB, "-1.5", "4"],
  [NB, "open-valve", " 7 "],
  [NB, "open-valve", "+5"],
  [NB, "open-valve", "1_000"],
  [NB, "open-valve", "007"],
  [NB, "open-valve", "99999999999999999999999"],
  [NB, "", "3"],
  [NB, "x".repeat(65), "3"],
  [NB, "open valve", "3"],
  [NB, "ü", "3"],
  [NB, "a/b", "3"],
  [NB, "a\nb", "3"],
  [NB, "-x", "3"],
  [NB, "--", "3"],
  [NB, "open-valve", "0"],
  [NB, "open-valve", "-3"],
  [NB, "open-valve", "-0"],
  [NB, "open-valve", "abc"],
  [NB, "open-valve", "1.5"],
  [NB, "open-valve", "1__0"],
  [NB, "open-valve", "_1"],
  [NB, "open-valve", "1_"],
  [NB, "open-valve", ""],
  [NB, "open-valve", "0x10"],
  [NB, "open-valve", "-x"],
  // Folders the builder refuses (stricter than notebook.py, which refuses them later or never finds a key).
  ["", "open-valve", "3"],
  ["-x", "open-valve", "3"],
  ["-a b", "open-valve", "3"],
];

/** Every input where the builder and the real notebook.py disagree. Empty means they agree. */
function commandProblems(build) {
  const out = [];
  for (const [dir, action, seq] of CORPUS) {
    const c = build({ dir, action, expiresSeq: seq });
    const real = notebook(["permit", "--dir", dir, "--action", action, "--expires-seq", seq]);
    const label = JSON.stringify([dir.replace(TMP, "$TMP"), action, seq]);
    if (c.ok) {
      if (real !== "accepted") out.push(`${label}: builder gives a command, notebook.py refuses: ${real.split("\n").pop()}`);
      const viaShell = shell(c.command);
      if (viaShell !== "accepted") out.push(`${label}: the command, run through sh, is refused: ${viaShell.split("\n").pop()}`);
    } else {
      if (real === "accepted") out.push(`${label}: builder refuses (${c.why}), notebook.py accepts`);
      else if (c.field !== "dir" && !real.endsWith(c.why)) out.push(`${label}: builder says "${c.why}", notebook.py says "${real.split("\n").pop()}"`);
    }
  }
  return out;
}

await check(`C2 the builder agrees with the real notebook.py on ${CORPUS.length} inputs, in its wording, and the command survives the shell`, () => {
  const bad = commandProblems(ac.permitCommand);
  assert.deepEqual(bad, [], bad.join("\n     "));
  // Nothing was signed, and the permit files notebook.py wrote before stopping were removed.
  for (const [, d] of DIRS) assert.deepEqual(existsSync(join(d, "permits")) ? readdirSync(join(d, "permits")) : [], [], `${d}: permits left behind`);
});

await check("C2 control: a builder that skips the action rule, the seq rule, or the quoting is caught", () => {
  const noAction = (o) => ac.permitCommand({ ...o, action: "ok" }).ok ? { ...ac.permitCommand({ ...o, action: "ok" }), command: ac.permitCommand({ ...o, action: "ok" }).command.replace("--action ok", `--action '${o.action}'`) } : ac.permitCommand(o);
  const zeroOk = (o) => (String(o.expiresSeq).trim() === "0" ? { ok: true, command: `python3 tools/machine-notebook/notebook.py permit --dir ${ac.shQuote(o.dir)} --action ${o.action} --expires-seq 0` } : ac.permitCommand(o));
  const noQuote = (o) => {
    const c = ac.permitCommand(o);
    return c.ok ? { ...c, command: `python3 tools/machine-notebook/notebook.py ${c.argv.join(" ")}` } : c;
  };
  for (const [name, impl] of Object.entries({ noAction, zeroOk, noQuote })) assert.ok(commandProblems(impl).length > 0, `${name} passed`);
});

// ── S. Shows / Does not show under every verdict ────────────────────────────────────────────────

const tEn = (en, v) => translate("en", en, v);
const tJa = (en, v) => translate("ja", en, v);
const html = (el) => renderToStaticMarkup(el);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const card = (r, t = tEn) => html(React.createElement(page.DeviceCard, { device: { key: 1, name: "nb", files: 9, sample: null, result: r, error: "" }, t }));

/** Problems with one rendered card: both lists, every item once, after the verdict, in order. */
function listsProblems(h, t) {
  const out = [];
  const verdictAt = Math.max(h.indexOf(">VALID<"), h.indexOf(">INVALID<"));
  if (verdictAt < 0) out.push("no verdict");
  let at = verdictAt;
  for (const s of [t("Shows"), ...ml.SHOWS.map((x) => t(x)), t("Does not show"), ...ml.DOES_NOT_SHOW.map((x) => t(x))]) {
    const i = h.indexOf(`>${esc(s)}<`, at);
    if (i < 0) out.push(`missing, or out of order: ${s}`);
    else at = i;
  }
  return out;
}

await check("S1 every verdict, VALID and INVALID, is followed by Shows / Does not show, in English and Japanese", () => {
  const cases = { valid: V.valid.r, first: V.first.r, reused: V.reused.r, expired: V.expired.r, otherKey: V.otherKey.r };
  for (const [name, r] of Object.entries(cases)) {
    for (const [lang, t] of [["en", tEn], ["ja", tJa]]) {
      const bad = listsProblems(card(r, t), t);
      assert.deepEqual(bad, [], `${name} (${lang}): ${bad.join("; ")}`);
    }
  }
  assert.ok(card(V.valid.r).includes(">VALID<") && card(V.reused.r).includes(">INVALID<"));
});

await check("S2 the lists come from machine_log.mjs through t(); the page spells out none of the items", () => {
  // Into the kit's ShowsBlock, in order: Shows, SHOWS, Does not show, DOES_NOT_SHOW (S1 renders it).
  assert.match(PAGE, /<ShowsBlock showsTitle=\{t\("Shows"\)\} shows=\{SHOWS\.map\(\(s\) => t\(s\)\)\} doesNotTitle=\{t\("Does not show"\)\} doesNot=\{DOES_NOT_SHOW\.map\(\(s\) => t\(s\)\)\} \/>/);
  for (const s of [...ml.SHOWS, ...ml.DOES_NOT_SHOW]) assert.ok(!PAGE.includes(s), `the page spells out ${JSON.stringify(s)}`);
});

await check("S control: a card missing an item, or with the lists swapped, is caught", () => {
  const h = card(V.valid.r);
  assert.ok(listsProblems(h.replace(esc(ml.SHOWS[1]), "x"), tEn).length > 0, "missing item");
  const a = h.indexOf(">Shows<");
  const b = h.indexOf(">Does not show<");
  const swapped = h.slice(0, a) + h.slice(b) + h.slice(a, b);
  assert.ok(listsProblems(swapped, tEn).length > 0, "swapped lists");
  assert.ok(listsProblems(h.replace(">VALID<", ">X<"), tEn).length > 0, "no verdict");
});

// ── N. no upload; device.key never read ─────────────────────────────────────────────────────────

const NET = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bWebSocket\b|\bEventSource\b|<form\b|\.submit\(\)|navigator\.share\b/;
const netLines = (files) =>
  files.flatMap(([f, src]) => src.split("\n").map((l, i) => [f, i + 1, l]).filter(([, , l]) => !/^\s*(\/\/|\*|\/\*)/.test(l) && NET.test(l)).map(([ff, n, l]) => `${ff}:${n}: ${l.trim()}`));
const FOLDER_READERS = ["app/agents/AgentsControl.tsx", "app/agents/page.tsx", "app/lib/agents_control.mjs", "app/lib/machine_log.mjs", "app/lib/verify_anything.mjs", "app/try/MachineLogPanel.tsx", "app/lib/dropped_folder.ts"];

await check("N1 the page and the modules that read the folder have no fetch / XMLHttpRequest / sendBeacon / socket / form", () => {
  const bad = netLines(FOLDER_READERS.map((f) => [f, read(f)]));
  assert.deepEqual(bad, [], bad.join("\n     "));
});

await check("N2 checking and rendering a folder makes no request, and never reads device.key", async () => {
  const calls = [];
  const saved = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket, EventSource: globalThis.EventSource };
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.fetch = async (...a) => { calls.push(["fetch", String(a[0])]); throw new Error("no network"); };
  globalThis.XMLHttpRequest = class { constructor() { calls.push(["XMLHttpRequest"]); } };
  globalThis.WebSocket = class { constructor(u) { calls.push(["WebSocket", u]); } };
  globalThis.EventSource = class { constructor(u) { calls.push(["EventSource", u]); } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: (u) => calls.push(["sendBeacon", u]) } });
  try {
    for (const name of ["valid", "permit_expired", "permit_other_key"]) {
      const { r, reads } = await verdict(folder(name, { "device.key": enc("not read") }));
      assert.ok(!reads.includes("device.key"), `${name}: device.key was read`);
      assert.equal(r.hasDeviceKey, true);
      card(r);
    }
  } finally {
    Object.assign(globalThis, saved);
    if (nav) Object.defineProperty(globalThis, "navigator", nav);
  }
  assert.deepEqual(calls, []);
});

await check("N control: each way of sending is caught", () => {
  for (const s of ['await fetch("/x", { method: "POST", body: f })', "new XMLHttpRequest()", "navigator.sendBeacon(u, b)", "new WebSocket(u)", "new EventSource(u)", "<form action='/x'>"]) {
    assert.equal(netLines([["x.tsx", s]]).length, 1, s);
  }
});

// ── L. the status line ──────────────────────────────────────────────────────────────────────────

const STATUS = "prototype, local only";
await check("L1 the status line says \"prototype, local only\", in English and in Japanese, at the top of the page", () => {
  const en = html(React.createElement(page.StatusLine, { t: tEn }));
  const ja = html(React.createElement(page.StatusLine, { t: tJa }));
  assert.ok(en.includes(STATUS), en);
  assert.ok(typeof JA[STATUS] === "string" && JA[STATUS] !== STATUS, "no Japanese");
  assert.ok(ja.includes(esc(JA[STATUS])) && !ja.includes(STATUS), ja);
  // At the top: the kit's header (PlainLead's status pill, above the title), before the drop zone.
  for (const t of [tEn, tJa]) {
    const bad = statusProblems(html(React.createElement(page.AgentsBody, { t })), t);
    assert.deepEqual(bad, [], bad.join("; "));
  }
  assert.match(PAGE, /status=\{<StatusLine t=\{t\} \/>\}/, "the status line is not PlainLead's status");
});

/** Problems with the status line's place in a rendered page: inside <header>, before <h1>, before the drop zone. */
function statusProblems(h, t) {
  const out = [];
  const header = h.indexOf("<header");
  const s = h.indexOf(esc(t(STATUS)));
  const h1 = h.indexOf("<h1");
  const zone = h.indexOf("data-dropzone");
  if (header < 0 || s < header || s > h.indexOf("</header>")) out.push("the status line is not in the header");
  if (!(s < h1)) out.push("the status line is not above the title");
  if (!(zone > s)) out.push("the status line is not before the drop zone");
  return out;
}

await check("L control: a dictionary without the Japanese line shows English, and is caught; a status line moved below the drop zone is caught", () => {
  const ja = html(React.createElement(page.StatusLine, { t: (en, v) => (en === STATUS ? en : translate("ja", en, v)) }));
  assert.ok(ja.includes(STATUS), "control did not take");
  const h = html(React.createElement(page.AgentsBody, { t: tEn }));
  const st = html(React.createElement(page.StatusLine, { t: tEn }));
  assert.ok(h.includes(st), "control anchor");
  assert.ok(statusProblems(h.replace(st, "") + st, tEn).length > 0, "moved to the end");
});

// ── W. wording and languages ────────────────────────────────────────────────────────────────────

const KEYS = [...new Set([...PAGE.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)))];
const LIB_TEXT = [...LIB.matchAll(/why: (?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g)].map((m) => m[1] ?? m[2]);
const SHOWN = [...KEYS, ...KEYS.map((k) => JA[k]), ...KEYS.map((k) => ZH_HK[k]), ...LIB_TEXT].filter((s) => typeof s === "string");

// Money words (the pattern of scripts/try_money_guard.mjs, both parts), "prove"/"proof" as a claim,
// "untraceable", and any AI claim (this page names no AI at all).
const BANNED = [
  /\b(?:price[sd]?|pricing|priced)\b|\bearn(?:s|ed|ing|ings)?\b|\binvest(?:s|ed|ing|ment|ments|or|ors)?\b|\b(?:profit(?:s|able)?|yield(?:s)?|APY|APR|ROI)\b|\b(?:buy|buying|purchase|purchasing)\b|\b(?:presale|pre-sale|token sale|market cap)\b/i,
  /価格|値段|稼(?:ぐ|げ|ぎ|い)|投資|儲(?:け|か)|利回り|購入|價格|價錢|賺|收益|購買/,
  /\bmoney\b|\bpay(?:s|ing|ment|ments|out|outs)?\b|\bpaid\b|\bcoins?\b|\bfunds?\b|お金|支払|コイン|金錢|付款|支付|硬幣/i,
  /\bprov(?:e|es|ed|en|ing)\b|\bproofs?\b|証明|證明|立証/i,
  /untraceable|追跡不可能|追跡できない|無法追蹤|不可追蹤/i,
  /\bAI\b|人工知能|人工智能|guarantee|保証|保證|擔保/i,
];
const wordingProblems = (strings) => strings.flatMap((s) => BANNED.filter((re) => re.test(s)).map((re) => `${re.source.slice(0, 30)}…: ${s.slice(0, 90)}`));

await check(`W1 no money word, "prove"/"proof", "untraceable" or AI claim in what /agents shows (${SHOWN.length} strings, en/ja/zh-HK)`, () => {
  assert.ok(KEYS.length > 30 && LIB_TEXT.length >= 5, `${KEYS.length} keys, ${LIB_TEXT.length} library messages`);
  const bad = wordingProblems(SHOWN);
  assert.deepEqual(bad, [], bad.join("\n     "));
});

// W1 reads only t() keys. Text written straight into the page (a JSX text node, or a string literal
// outside t()) would not be in SHOWN, so every literal and text fragment of the page's own source is
// checked too.
const SOURCE_TEXT = (src) => {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...s.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
};
await check("W1b no banned wording written straight into the page's source (JSX text and literals outside t())", () => {
  const bad = wordingProblems([...SOURCE_TEXT(PAGE), ...SOURCE_TEXT(read("app/agents/page.tsx"))]);
  assert.deepEqual(bad, [], bad.join("\n     "));
});
await check("W1b control: a sentence written as JSX text is caught", () => {
  const planted = PAGE.replace("<AgentsLead t={t} />", "<p>This proves the reading.</p>\n<AgentsLead t={t} />");
  assert.notEqual(planted, PAGE, "the control's anchor is gone");
  assert.ok(wordingProblems(SOURCE_TEXT(planted)).length > wordingProblems(SOURCE_TEXT(PAGE)).length, "JSX text is not scanned");
});

await check("W control: each kind of wording is caught", () => {
  for (const s of ["Free to use, no payment", "This proves the reading", "untraceable devices", "AI can't read it", "価格", "お金", "證明", "購買", "guaranteed"]) {
    assert.ok(wordingProblems([s]).length > 0, s);
  }
  assert.deepEqual(wordingProblems(["used, by record 2", "This page signs nothing."]), []);
});

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const dictProblems = (dict, name) =>
  KEYS.flatMap((k) => (typeof dict[k] !== "string" || !dict[k].trim() ? [`${name}: missing ${JSON.stringify(k)}`] : placeholders(dict[k]) !== placeholders(k) ? [`${name}: placeholders differ for ${JSON.stringify(k)}`] : []));

await check(`W2 every string on /agents (${KEYS.length}) has Japanese and Hong Kong Chinese, with the same placeholders`, () => {
  const bad = [...dictProblems(JA, "ja"), ...dictProblems(ZH_HK, "zh-HK")];
  assert.deepEqual(bad, [], bad.join("\n     "));
});

await check("W2 control: a missing translation and a dropped placeholder are caught", () => {
  const ja = { ...JA };
  delete ja["Give a machine a new one-time permission"];
  assert.ok(dictProblems(ja, "ja").length > 0, "missing");
  assert.ok(dictProblems({ ...JA, "{n} records": "記録" }, "ja").length > 0, "placeholder");
});

// ── V. the page reads plainly ───────────────────────────────────────────────────────────────────
// One lead sentence; "Try with a sample" (the bundled samples) as the one primary button; each machine's
// result leads with VALID / INVALID and one sentence, details behind the fold; no jargon outside it;
// "1 record", not "1 records"; the copy button copies exactly the command shown.

const panel = await import("../app/try/MachineLogPanel.tsx");
const tZh = (en, v) => translate("zh-HK", en, v);
const LANGS = { en: tEn, ja: tJa, "zh-HK": tZh };

function leadProblems(h, t, lang) {
  const out = [];
  const title = h.indexOf(`>${esc(t("Agent and machine control"))}</h1>`);
  const lead = h.indexOf(`>${esc(t(page.LEAD))}</p>`);
  if (title < 0) out.push("no title");
  if (lead < 0) out.push("no lead sentence");
  if (lead >= 0 && lead < title) out.push("lead before the title");
  if (lang !== "en" && h.includes(esc(page.LEAD))) out.push(`${lang}: the lead is in English`);
  return out;
}

await check("V1 one plain lead sentence under the title, in English, Japanese and Hong Kong Chinese", () => {
  assert.ok(PAGE.includes(`t(${JSON.stringify(page.LEAD)})`), "the page does not render LEAD through t()");
  for (const [lang, t] of Object.entries(LANGS)) {
    const bad = leadProblems(html(React.createElement(page.AgentsLead, { t })), t, lang);
    assert.deepEqual(bad, [], `${lang}: ${bad.join("; ")}`);
  }
});
await check("V1 control: a dictionary without the Japanese lead is caught", () => {
  const noJa = (en, v) => (en === page.LEAD ? en : tJa(en, v));
  assert.ok(leadProblems(html(React.createElement(page.AgentsLead, { t: noJa })), noJa, "ja").length > 0);
});

const SAMPLES = (await panel.checkSamples(mldsa44Verify)).map((c, i) => ({ ...c, key: i + 1 }));
const DEVICES = [
  ...SAMPLES,
  ...(await Promise.all(FIX.cases.map(async (c, i) => ({ key: 100 + i, name: `nb-${i}`, files: 9, sample: null, result: (await verdict(folder(c.name))).r, error: "" })))),
];

await check("V2 \"Try with a sample\" is the one primary button and adds the two bundled samples: VALID with its permission used, INVALID for the permission used twice", () => {
  assert.match(PAGE, /<PrimaryButton onClick=\{\(\) => void add\(\(\) => checkSamples\(\)\)\}[^>]*>\s*\{t\("Try with a sample"\)\}\s*<\/PrimaryButton>/);
  assert.equal([...PAGE.matchAll(/<PrimaryButton\b/g)].length, 1, "more than one primary button");
  const h = html(React.createElement(page.AgentsBody, { t: tEn, initial: SAMPLES }));
  const a = h.indexOf(">VALID<");
  const b = h.indexOf(">INVALID<");
  assert.ok(a > 0 && b > a, "VALID then INVALID");
  assert.ok(h.includes(esc("This log is consistent, and its one-time permission was used once.")), "sample 1 sentence");
  assert.ok(h.includes(esc("A one-time permission in this log was used twice.")), "sample 2 sentence");
  const st = SAMPLES.map((d) => statesOf(d.result).map((s) => `${s.action}:${s.state}:${s.by}`));
  assert.deepEqual(st, [["open-vent:used:2"], ["open-vent:used:2"]], JSON.stringify(st));
});

function layoutProblems(d, t, h = html(React.createElement(page.DeviceCard, { device: d, t }))) {
  const out = [];
  const head = panel.headline(d.result, t);
  const label = h.indexOf(`>${head.label}<`);
  const sentence = h.indexOf(`>${esc(head.sentence)}<`);
  const fold = h.indexOf(`>${esc(t("Show details"))}</button>`);
  if (label < 0 || sentence < 0 || fold < 0) out.push(`missing: label ${label}, sentence ${sentence}, fold ${fold}`);
  if (!(label < sentence && sentence < fold)) out.push("label and sentence do not come first");
  const r = d.result;
  const hidden = r.kind === "verdict" ? [...(r.keyid ? [r.keyid] : []), ...r.problems.map(ml.problemLine), ...r.permits.map((p) => p.permitId), ...(r.chain ? [r.chain.chainId] : [])] : [];
  for (const s of hidden) if (h.includes(esc(s))) out.push(`outside the fold: ${s.slice(0, 50)}`);
  const det = html(React.createElement(page.DeviceDetails, { device: d, t }));
  for (const s of hidden) if (!det.includes(esc(s))) out.push(`not in the details: ${s.slice(0, 50)}`);
  return out;
}

await check(`V3 every machine (${DEVICES.length}, en/ja/zh-HK) leads with VALID / INVALID and one sentence; key id, reasons, permission ids, chain only behind the fold`, () => {
  const bad = [];
  for (const d of DEVICES) for (const [lang, t] of Object.entries(LANGS)) for (const p of layoutProblems(d, t)) bad.push(`${d.sample ?? d.name} (${lang}): ${p}`);
  assert.deepEqual(bad, [], bad.slice(0, 8).join("\n     "));
});
await check("V3 control: details in the open, or the sentence after the fold, are caught", () => {
  const d = SAMPLES[1];
  const h = html(React.createElement(page.DeviceCard, { device: d, t: tEn }));
  const open = h + html(React.createElement(page.DeviceDetails, { device: d, t: tEn }));
  assert.ok(layoutProblems(d, tEn, open).some((p) => p.startsWith("outside the fold")), "details in the open");
  const s = esc(panel.headline(d.result, tEn).sentence);
  assert.ok(layoutProblems(d, tEn, h.replace(`>${s}<`, "><") + `<p>${s}</p>`).length > 0, "sentence late");
});

const JARGON = /envelope|nullifier|permit_id|canonical|エンベロープ|ナリファイア|正規化|封套|信封|規範化/i;
const jargonIn = (h) => h.replace(/<[^>]+>/g, " ").match(JARGON) ?? [];
await check("V4 no envelope / nullifier / permit_id / canonical outside the fold, on the page and every machine, en/ja/zh-HK", () => {
  const bad = [];
  for (const [lang, t] of Object.entries(LANGS)) {
    for (const w of jargonIn(html(React.createElement(page.AgentsBody, { t, initial: DEVICES })))) bad.push(`${lang}: ${w}`);
  }
  assert.deepEqual(bad, [], bad.join("; "));
});
await check("V4 control: a planted jargon word is caught; attributes are not text", () => {
  for (const w of ["envelope", "nullifier", "permit_id", "canonical"]) assert.ok(jargonIn(`<p>a ${w}</p>`).length > 0, w);
  assert.deepEqual(jargonIn(`<p class="canonical">x</p>`), []);
});

const oneRecord = (() => {
  const files = firstRecordOnly();
  return verdict(files);
})();
await check("V5 one record reads \"1 record\" (en), never \"1 records\"; other counts plural; ja and zh-HK have it", async () => {
  const { r } = await oneRecord;
  assert.equal(r.records, 1);
  for (const [lang, t] of Object.entries(LANGS)) {
    const h = html(React.createElement(page.DeviceCard, { device: { key: 1, name: "nb", files: 3, sample: null, result: r, error: "" }, t }));
    assert.ok(h.includes(esc(` · ${t("1 record")}`)), `${lang}: no "1 record"`);
    assert.ok(!h.includes("1 records"), `${lang}: "1 records"`);
  }
  assert.equal(page.recordsLabel(1, tEn), "1 record");
  assert.equal(page.recordsLabel(3, tEn), "3 records");
  assert.equal(page.recordsLabel(0, tEn), "0 records");
});
await check("V5 control: a label without the singular is caught", () => {
  const noSingular = (n, t) => t("{n} records", { n });
  assert.equal(noSingular(1, tEn), "1 records", "control did not take");
  assert.notEqual(noSingular(1, tEn), page.recordsLabel(1, tEn));
});

/** Problems with a copy function: it must put exactly the text on the clipboard, or say it could not. */
async function copyProblems(copy) {
  const out = [];
  const cmd = ac.permitCommand({ dir: "my sensor", action: "open-vent", expiresSeq: "6" }).command;
  let got = null;
  const ok1 = await copy(cmd, { clipboard: { writeText: async (s) => { got = s; } } });
  if (!ok1 || got !== cmd) out.push(`clipboard: ${ok1} ${JSON.stringify(got)}`);
  let viaSel = null;
  const ok2 = await copy(cmd, { clipboard: { writeText: async () => { throw new Error("denied"); } }, execCopy: (s) => { viaSel = s; return true; } });
  if (!ok2 || viaSel !== cmd) out.push(`fallback: ${ok2} ${JSON.stringify(viaSel)}`);
  const ok3 = await copy(cmd, { execCopy: () => false });
  if (ok3 !== false) out.push("reports a copy that did not happen");
  return out;
}
await check("V6 the copy button copies exactly the command shown (Clipboard API, else the selection), and says when it could not", async () => {
  assert.deepEqual(await copyProblems(page.copyText), []);
  assert.match(PAGE, /copyText\(c\.command, \{ clipboard: navigator\.clipboard, execCopy \}\)/, "the button does not copy c.command");
  assert.match(PAGE, /\{c\.command\}\s*<\/pre>/, "the command shown is not c.command");
  assert.match(PAGE, /copied === "no" \? <p role="alert">\{t\("This browser did not let the page copy\./);
});
await check("V6 control: a copy that trims, one that never falls back, and one that always says yes, are caught", async () => {
  const trims = (s, e) => page.copyText(s.slice(0, -1), e);
  const noFallback = (s, e) => page.copyText(s, { clipboard: e.clipboard });
  const alwaysYes = async (s, e) => (await page.copyText(s, e), true);
  for (const [n, f] of Object.entries({ trims, noFallback, alwaysYes })) assert.ok((await copyProblems(f)).length > 0, n);
});

rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
