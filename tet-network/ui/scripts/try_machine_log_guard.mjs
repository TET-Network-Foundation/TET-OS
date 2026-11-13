// Guard for "Check a machine's log" on the try page (app/try/MachineLogPanel.tsx,
// app/lib/machine_log.mjs).
//
//   node --experimental-strip-types scripts/try_machine_log_guard.mjs
//
// A. The two lists, Shows and Does not show, are notebook.py verify's, word for word and in order:
//    1. machine_log.mjs's SHOWS / DOES_NOT_SHOW equal the lists in tools/machine-notebook/notebook.py,
//       and the copies pinned below (so neither side can change without this file changing too);
//    2. they equal what the real `notebook.py verify` printed (the fixture's captured output);
//    3. the panel renders exactly these constants, under "Shows" and "Does not show", and keeps no
//       wording of its own;
//    4. every item has Japanese and Hong Kong Chinese.
//    Control: a changed word, a dropped item, two items swapped, and the lists swapped are each caught.
//
// B. The verdict is notebook.py's. scripts/fixtures/machine_log_v1.json holds notebook folders the
//    real notebook.py and tet-cli wrote, each with what `notebook.py verify` printed. For every case
//    the page's check gives the same VALID / INVALID and the same problem lines. A `signature:` line is
//    compared up to its reason: there the page reports its own verifier's wording, tet-cli's differs.
//    ML-DSA-44 is the real verifier (the committed WASM); one case swaps in a valid ML-DSA half from
//    another record, and a control shows that case passes with ML-DSA checking switched off, so it
//    measures that half alone. The same for Ed25519.
//
// C. device.key is never read, and is reported; a log longer than MAX_RECORDS is refused with the
//    number named, not cut short.
//
// D. The tab reads plainly (components rendered with React, server-side, in en / ja / zh-HK):
//    1. one plain lead sentence under the title, in English and Japanese (and Hong Kong Chinese);
//    2. "Try with a sample" is the one primary button, and it checks the samples bundled in the page
//       (lib/machine_log_samples.mjs, made by the real notebook.py and tet-cli): the first VALID and
//       consistent, the second INVALID only because its one-time permission was used twice, each as
//       the real notebook.py verify printed it; checking them makes no request;
//    3. every result leads with its label (VALID / INVALID) and one short sentence, then the
//       "Show details" fold; the reasons, key ids, permits and chain are behind it, not before;
//       Shows / Does not show follow every verdict;
//    4. no "envelope", "nullifier", "permit_id" or "canonical" outside the fold, in any language.
//    Each has a control that must be caught.

import { register, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const UI = new URL("../", import.meta.url);
const require = createRequire(new URL("package.json", UI));
register("./lib/ts_hooks.mjs", import.meta.url);
// .tsx under plain Node: TypeScript's own transpiler, JSX to react/jsx-runtime (as agents_control_guard).
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

const ml = await import("../app/lib/machine_log.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const { JA } = await import("../app/try/i18n_ja.ts");
const { ZH_HK } = await import("../app/try/i18n_zh_hk.ts");

const NOTEBOOK = readFileSync(new URL("../../../tools/machine-notebook/notebook.py", import.meta.url), "utf8");
const PANEL = readFileSync(new URL("../app/try/MachineLogPanel.tsx", import.meta.url), "utf8");
const FIX = JSON.parse(readFileSync(new URL("./fixtures/machine_log_v1.json", import.meta.url), "utf8"));

// Pinned here on purpose: changing the wording means changing notebook.py, machine_log.mjs, both
// translations and this file, in one reviewed commit.
const PINNED_SHOWS = [
  "which key signed each record",
  "that the records are in this order",
  "that each record was written before the next one",
  "that no one-time permission was used twice in this log, or after it ran out",
];
const PINNED_DOES_NOT_SHOW = [
  "that the reading is true",
  "that the machine's clock was right",
  "where the machine was",
  "who runs the machine",
  "that the key was not copied",
  "that a copied key did not use the same permission in another log",
];

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

/** A Python list of plain double-quoted strings, `NAME = [ … ]`, from notebook.py. */
function pyList(src, name) {
  const m = new RegExp(`^${name} = \\[\\n([\\s\\S]*?)\\n\\]`, "m").exec(src);
  if (!m) throw new Error(`${name} not found in notebook.py`);
  return m[1].split("\n").map((l) => JSON.parse(l.trim().replace(/,$/, "")));
}

/** The two lists out of `notebook.py verify`'s stdout. */
function printedLists(stdout) {
  const lines = stdout.split("\n");
  const block = (head) => {
    const out = [];
    for (let i = lines.indexOf(head) + 1; i > 0 && i < lines.length && lines[i].startsWith("  - "); i++) out.push(lines[i].slice(4));
    return out;
  };
  return { shows: block("Shows:"), doesNot: block("Does not show:") };
}

/** Every difference between a pair of lists and the pinned pair. Empty means identical. */
function listProblems(shows, doesNot) {
  const out = [];
  const cmp = (name, got, want) => {
    if (got.length !== want.length) out.push(`${name}: ${got.length} items, want ${want.length}`);
    for (let i = 0; i < Math.max(got.length, want.length); i++) {
      if (got[i] !== want[i]) out.push(`${name}[${i}]: ${JSON.stringify(got[i])} ≠ ${JSON.stringify(want[i])}`);
    }
  };
  cmp("Shows", shows, PINNED_SHOWS);
  cmp("Does not show", doesNot, PINNED_DOES_NOT_SHOW);
  return out;
}

// ── A. the lists ──────────────────────────────────────────────────────────────────────────────────

await check("A1 the page's lists are notebook.py's SHOWS / DOES_NOT_SHOW, and the pinned copies", () => {
  assert.deepEqual(listProblems(pyList(NOTEBOOK, "SHOWS"), pyList(NOTEBOOK, "DOES_NOT_SHOW")), [], "notebook.py differs from the pinned lists");
  assert.deepEqual(listProblems(ml.SHOWS, ml.DOES_NOT_SHOW), [], "machine_log.mjs differs from the pinned lists");
});

await check("A2 they are what the real notebook.py verify printed, for a valid log and an invalid one", () => {
  for (const name of ["valid", "permit_reused"]) {
    const c = FIX.cases.find((x) => x.name === name);
    const p = printedLists(c.verify.stdout);
    assert.deepEqual(listProblems(p.shows, p.doesNot), [], `${name}: printed lists differ`);
  }
});

await check("A3 the panel renders exactly these constants, under Shows and Does not show, with no wording of its own", () => {
  const imp = /import \{([^}]*)\} from "\.\.\/lib\/machine_log\.mjs"/.exec(PANEL);
  assert.ok(imp, "the panel does not import from lib/machine_log.mjs");
  const names = imp[1].split(",").map((x) => x.trim());
  assert.ok(names.includes("SHOWS") && names.includes("DOES_NOT_SHOW"), `imports ${names.join(", ")}`);
  // In this order and nowhere else: heading "Shows", SHOWS through t(), heading "Does not show",
  // DOES_NOT_SHOW through t(), all into the kit's ShowsBlock. (Order: two swapped lists must fail.)
  // D3 renders it: the lists follow every verdict.
  const at = (re) => {
    const all = [...PANEL.matchAll(new RegExp(re.source, "g"))];
    assert.equal(all.length, 1, `${re} appears ${all.length} times`);
    return all[0].index;
  };
  const order = [
    at(/t\("Shows"\)/),
    at(/(?<![A-Z_])shows=\{SHOWS\.map\(\(s\) => t\(s\)\)\}/),
    at(/t\("Does not show"\)/),
    at(/doesNot=\{DOES_NOT_SHOW\.map\(\(s\) => t\(s\)\)\}/),
  ];
  assert.deepEqual([...order].sort((x, y) => x - y), order, "Shows / SHOWS / Does not show / DOES_NOT_SHOW are out of order");
  for (const s of [...PINNED_SHOWS, ...PINNED_DOES_NOT_SHOW]) assert.ok(!PANEL.includes(s), `the panel spells out ${JSON.stringify(s)} itself`);
});

await check("A4 every item, and both headings, have Japanese and Hong Kong Chinese", () => {
  for (const k of [...PINNED_SHOWS, ...PINNED_DOES_NOT_SHOW, "Shows", "Does not show"]) {
    assert.ok(typeof JA[k] === "string" && JA[k].trim(), `ja: missing ${JSON.stringify(k)}`);
    assert.ok(typeof ZH_HK[k] === "string" && ZH_HK[k].trim(), `zh-HK: missing ${JSON.stringify(k)}`);
  }
});

await check("A control: a changed word, a dropped item, two items swapped, the lists swapped are each caught", () => {
  const S = [...PINNED_SHOWS];
  const D = [...PINNED_DOES_NOT_SHOW];
  assert.ok(listProblems(S.map((s, i) => (i === 2 ? s.replace("before", "after") : s)), D).length > 0, "changed word");
  assert.ok(listProblems(S, D.slice(0, -1)).length > 0, "dropped item");
  assert.ok(listProblems([S[1], S[0], ...S.slice(2)], D).length > 0, "swapped items");
  assert.ok(listProblems(D, S).length > 0, "swapped lists");
  assert.ok(printedLists("VALID\nShows:\n  - x\nDoes not show:\n  - y\n").shows[0] === "x", "stdout parser");
});

// ── B. the verdict ────────────────────────────────────────────────────────────────────────────────

const b64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

/** A case's folder: the base log with its files replaced (null: removed). */
function folder(c, extra = {}) {
  const files = { ...FIX.base, ...c.files, ...extra };
  for (const [k, v] of Object.entries(files)) if (v === null) delete files[k];
  return files;
}

async function runCase(files, verifier = mldsa44Verify, opts = {}) {
  const reads = [];
  const r = await ml.checkMachineLog({
    paths: Object.keys(files),
    read: async (p) => {
      reads.push(p);
      if (!(p in files)) throw new Error(`read of a path not in the folder: ${p}`);
      return b64(files[p]);
    },
    mldsa44Verify: verifier,
    ...opts,
  });
  return { r, reads };
}

/** notebook.py verify's verdict lines (status, then problems or the summary), indent stripped. */
function cliLines(stdout) {
  const lines = stdout.split("\n");
  return lines.slice(0, lines.indexOf("Shows:")).map((l) => l.replace(/^  /, ""));
}

/** The page's verdict in the same lines. */
function pageLines(r) {
  if (r.kind !== "verdict") return [`error: ${r.error}`];
  return [r.valid ? "VALID" : "INVALID", ...(r.valid ? [`${r.records} records, all signed by ${r.signer}`, ...r.uses.map(ml.useLine)] : r.problems.map(ml.problemLine))];
}

/**
 * A `signature:` line keeps only its prefix: the reason is the verifier's own wording. That holds for a
 * record's envelope and for a cited permit's (`record N: permit: <id>: signature: …`).
 */
const comparable = (l) =>
  /^record \d+: (permit: [0-9a-f]{32}: )?signature: /.test(l) && !/payload type is/.test(l) ? l.replace(/(signature: ).*/, "$1…") : l;

await check(`B1 every fixture case gets notebook.py verify's verdict and problem lines (${FIX.cases.length} cases)`, async () => {
  assert.ok(FIX.cases.length >= 14);
  for (const c of FIX.cases) {
    const { r } = await runCase(folder(c));
    assert.deepEqual(pageLines(r).map(comparable), cliLines(c.verify.stdout).map(comparable), c.name);
    assert.equal(r.valid, c.verify.exit === 0, `${c.name}: exit ${c.verify.exit}`);
  }
});

await check("B2 the valid log is valid by the device key, on the chain in chain.json", async () => {
  const { r } = await runCase(folder(FIX.cases[0]));
  assert.equal(r.valid, true);
  assert.equal(r.signer, FIX.keyid);
  assert.deepEqual(r.chain, { chainId: FIX.chain.chain_id, genesisHash: FIX.chain.genesis_hash });
});

const reasonOf = async (name) => {
  const { r } = await runCase(folder(FIX.cases.find((c) => c.name === name)));
  return r.problems.map(ml.problemLine);
};

await check("B3 a valid ML-DSA-44 half from another record is refused by the ML-DSA check, and only by it", async () => {
  assert.deepEqual(await reasonOf("mldsa_half_swapped"), ["record 1: signature: ml-dsa-44 signature does not verify (on this chain binding)"]);
  const off = await runCase(folder(FIX.cases.find((c) => c.name === "mldsa_half_swapped")), async () => true);
  assert.equal(off.r.valid, true, "control: with ML-DSA checking off, this case must pass (else it measures something else)");
});

await check("B4 a valid Ed25519 half from another record is refused by the Ed25519 check, and only by it", async () => {
  assert.deepEqual(await reasonOf("ed25519_half_swapped"), ["record 1: signature: ed25519 signature does not verify (on this chain binding)"]);
});

await check("B5 a correctly signed record citing a used, expired, foreign, edited, copied, missing or wrongly typed permit is refused for that reason alone", async () => {
  const one = async (name, re) => {
    const lines = await reasonOf(name);
    assert.equal(lines.length, 1, `${name}: ${lines.join(" | ")}`);
    assert.match(lines[0], re, name);
  };
  await one("permit_reused", /^record 3: permit: [0-9a-f]{32} was already used by record 2$/);
  await one("permit_expired", /^record 3: permit: [0-9a-f]{32} expired after seq 2$/);
  await one("permit_other_key", /^record 3: permit: [0-9a-f]{32} is signed by tet-ed25519:[0-9a-f]{64}, not this device's tet-ed25519:[0-9a-f]{64}$/);
  await one("permit_edited", /^record 2: permit: [0-9a-f]{32}: signature: /);
  await one("permit_copied", /^record 3: permit: 0{31}1\.json holds permit [0-9a-f]{32}$/);
  await one("permit_missing", /^record 3: permit: f{32} is not in this notebook$/);
  await one("permit_wrong_type", /^record 3: permit: [0-9a-f]{32}: payload type is 'application\/vnd\.tet\.machine-log\+json', not application\/vnd\.tet\.machine-permit\+json$/);
});

await check("B6 Python's canonical JSON is reproduced exactly (21.0, 1e-05, non-ASCII stay as notebook.py wrote them)", () => {
  for (const p of ["records/2.json", "records/3.json", "records/4.json"]) {
    const text = Buffer.from(FIX.base[p], "base64").toString("utf8");
    assert.equal(ml.pyCanonical(ml.parsePyJson(text)), text, p);
  }
  assert.equal(ml.pyCanonical(ml.parsePyJson('{"a":21.0}')), '{"a":21.0}');
  assert.equal(ml.pyCanonical(ml.parsePyJson('{"a":21}')), '{"a":21}');
  assert.equal(ml.pyCanonical(ml.parsePyJson('{"b":1,"a":"°"}')), '{"a":"\\u00b0","b":1}');
});

// ── C. the folder ─────────────────────────────────────────────────────────────────────────────────

await check("C1 device.key is never read, and its presence is reported", async () => {
  const { r, reads } = await runCase(folder(FIX.cases[0], { "device.key": Buffer.from("not read").toString("base64") }));
  assert.ok(!reads.includes("device.key"), "device.key was read");
  assert.equal(r.hasDeviceKey, true);
  assert.equal(r.valid, true);
});

await check("C2 a dropped folder's top directory is stripped; loose files are kept as they are", () => {
  assert.deepEqual(ml.notebookPaths(["nb/chain.json", "nb/records/1.json"]), ["chain.json", "records/1.json"]);
  assert.deepEqual(ml.notebookPaths(["chain.json", "records/1.json"]), ["chain.json", "records/1.json"]);
  // Picked one by one (a phone): places follow from the names.
  const pid = "0123456789abcdef0123456789abcdef";
  assert.deepEqual(
    ml.notebookPaths(["chain.json", "chain.txt", "device.keyid", "device.key", "1.json", "1.json.sig.json", "1.hash.sig.json", `${pid}.json`, `${pid}.json.sig.json`]),
    ["chain.json", "chain.txt", "device.keyid", "device.key", "records/1.json", "records/1.json.sig.json", "records/1.hash.sig.json", `permits/${pid}.json`, `permits/${pid}.json.sig.json`],
  );
});

await check(`C3 more than ${ml.MAX_RECORDS} records is refused with the count named, not cut short`, async () => {
  const paths = ["chain.json", ...Array.from({ length: ml.MAX_RECORDS + 1 }, (_, i) => `records/${i + 1}.json`)];
  const r = await ml.checkMachineLog({ paths, read: async () => { throw new Error("nothing is read for a log this long"); }, mldsa44Verify });
  assert.deepEqual(r, { kind: "error", error: "too_many", records: ml.MAX_RECORDS + 1, hasDeviceKey: false });
});

// ── D. the tab reads plainly ──────────────────────────────────────────────────────────────────────

const panel = await import("../app/try/MachineLogPanel.tsx");
const { translate } = await import("../app/try/i18n.tsx");
const { MACHINE_LOG_SAMPLES } = await import("../app/lib/machine_log_samples.mjs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const SAMPLES_SRC = readFileSync(new URL("../app/lib/machine_log_samples.mjs", import.meta.url), "utf8");

const T = { en: (en, v) => translate("en", en, v), ja: (en, v) => translate("ja", en, v), "zh-HK": (en, v) => translate("zh-HK", en, v) };
const html = (el) => renderToStaticMarkup(el);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const DICT = { ja: JA, "zh-HK": ZH_HK };

/** Problems with a rendered lead: the title, then the lead sentence in this language, in a <p>. */
function leadProblems(h, t, lang) {
  const out = [];
  const title = h.indexOf(`>${esc(t("Check a machine's log"))}</h1>`);
  const lead = h.indexOf(`>${esc(t(panel.LEAD))}</p>`);
  if (title < 0) out.push("no title");
  if (lead < 0) out.push("no lead sentence");
  if (lead >= 0 && title >= 0 && lead < title) out.push("lead before the title");
  if (lang !== "en" && h.includes(esc(panel.LEAD))) out.push(`${lang}: the lead is in English`);
  return out;
}

await check("D1 one plain lead sentence under the title, in English, Japanese and Hong Kong Chinese", () => {
  assert.ok(PANEL.includes(`t(${JSON.stringify(panel.LEAD)})`), "the page does not render LEAD through t()");
  assert.ok(panel.LEAD.split(/[.:]\s/).length <= 3 && panel.LEAD.length < 220, "the lead is not short");
  for (const lang of ["en", "ja", "zh-HK"]) {
    if (lang !== "en") assert.ok(typeof DICT[lang][panel.LEAD] === "string" && DICT[lang][panel.LEAD] !== panel.LEAD, `${lang}: no translation`);
    const bad = leadProblems(html(React.createElement(panel.MachineLogLead, { t: T[lang] })), T[lang], lang);
    assert.deepEqual(bad, [], `${lang}: ${bad.join("; ")}`);
  }
});

await check("D1 control: a dictionary without the Japanese lead, and a page without the lead, are caught", () => {
  const noJa = (en, v) => (en === panel.LEAD ? en : T.ja(en, v));
  assert.ok(leadProblems(html(React.createElement(panel.MachineLogLead, { t: noJa })), noJa, "ja").length > 0, "missing ja");
  const h = html(React.createElement(panel.MachineLogLead, { t: T.en })).replace(esc(panel.LEAD), "x");
  assert.ok(leadProblems(h, T.en, "en").length > 0, "missing lead");
});

/** Every way a set of checked samples differs from what the two samples must give. */
function sampleProblems(got) {
  const out = [];
  if (got.length !== 2) return [`${got.length} samples, want 2`];
  const [a, b] = got;
  if (a.sample !== "consistent" || b.sample !== "reused") out.push(`samples are ${a.sample}, ${b.sample}`);
  if (!(a.result?.kind === "verdict" && a.result.valid === true && ml.verdictKind(a.result) === "consistent" && a.result.uses.length === 1)) out.push("sample 1 is not VALID with its permission used once");
  const lines = b.result?.kind === "verdict" ? b.result.problems.map(ml.problemLine) : [];
  if (!(b.result?.valid === false && lines.length === 1 && /^record 3: permit: [0-9a-f]{32} was already used by record 2$/.test(lines[0]) && ml.verdictKind(b.result) === "reused")) {
    out.push(`sample 2 is not INVALID for the reused permission alone: ${lines.join(" | ")}`);
  }
  // Each as the real notebook.py verify printed it, for the same folder.
  for (const [c, s] of [[a, MACHINE_LOG_SAMPLES.samples[0]], [b, MACHINE_LOG_SAMPLES.samples[1]]]) {
    if (c.result && JSON.stringify(pageLines(c.result)) !== JSON.stringify(cliLines(s.verify.stdout))) out.push(`${c.sample}: page says ${pageLines(c.result).join(" | ")}`);
  }
  return out;
}

const sampleCalls = [];
let SAMPLE_RESULTS;
await check("D2 \"Try with a sample\" is the primary button; it checks the bundled samples, VALID and INVALID for the right reason, with no request", async () => {
  // The button, and what it runs.
  const btn = /<PrimaryButton onClick=\{\(\) => void run\(\(\) => checkSamples\(\)\)\}[^>]*>\s*\{t\("Try with a sample"\)\}\s*<\/PrimaryButton>/;
  assert.match(PANEL, btn, "the primary button does not run checkSamples()");
  assert.equal([...PANEL.matchAll(/<PrimaryButton\b/g)].length, 1, "more than one primary button");
  assert.match(PANEL, /await import\("\.\.\/lib\/machine_log_samples\.mjs"\)/, "checkSamples does not load the bundled samples");
  // The bundled data: what the generator wrote, no device.key, and the real verify output.
  assert.match(SAMPLES_SRC, /^\/\/ GENERATED by scripts\/make_machine_log_samples\.py/);
  for (const s of MACHINE_LOG_SAMPLES.samples) {
    assert.ok(!Object.keys(s.files).some((p) => p.endsWith("device.key")), `${s.id}: holds device.key`);
    const p = printedLists(s.verify.stdout);
    assert.deepEqual(listProblems(p.shows, p.doesNot), [], `${s.id}: printed lists differ`);
  }
  assert.deepEqual(MACHINE_LOG_SAMPLES.samples.map((s) => s.verify.exit), [0, 1]);
  // Checked with every way of sending stubbed to record calls.
  const saved = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket };
  globalThis.fetch = async (u) => { sampleCalls.push(["fetch", String(u)]); throw new Error("no network"); };
  globalThis.XMLHttpRequest = class { constructor() { sampleCalls.push(["XMLHttpRequest"]); } };
  globalThis.WebSocket = class { constructor(u) { sampleCalls.push(["WebSocket", u]); } };
  try {
    SAMPLE_RESULTS = await panel.checkSamples(mldsa44Verify);
  } finally {
    Object.assign(globalThis, saved);
  }
  assert.deepEqual(sampleCalls, []);
  const bad = sampleProblems(SAMPLE_RESULTS);
  assert.deepEqual(bad, [], bad.join("\n     "));
});

await check("D2 control: samples swapped, a sample INVALID for another reason, or ML-DSA switched off, are caught", async () => {
  const [a, b] = SAMPLE_RESULTS;
  assert.ok(sampleProblems([b, a]).length > 0, "swapped");
  const other = (await runCase(folder(FIX.cases.find((c) => c.name === "reading_changed")))).r;
  assert.ok(sampleProblems([a, { ...b, result: other }]).length > 0, "another reason");
  assert.ok(sampleProblems([a]).length > 0, "one sample");
  // The reused sample also carries a valid signature: only the one-time rule refuses it.
  const lax = await panel.checkSamples(async () => true);
  assert.deepEqual(sampleProblems(lax), [], "ML-DSA off changes nothing here: the samples are genuinely signed");
});

const FOLD = "Show details";
/** Results to render: the samples and every fixture case, each as a Checked. */
const RENDERED = [
  ...(SAMPLE_RESULTS ?? []),
  // Named nb-<i>: a fixture case's name (record_not_canonical) is the folder's name, not page text.
  ...(await Promise.all(FIX.cases.map(async (c, i) => ({ name: `nb-${i}`, files: 9, sample: null, result: (await runCase(folder(c))).r, error: "" })))),
];

/** What only the details may show for this result: key ids, problem lines, permit ids, chain id. */
function detailOnly(r) {
  if (r.kind !== "verdict") return [];
  return [
    ...(r.signer ? [r.signer] : []),
    ...r.problems.map(ml.problemLine),
    ...r.uses.map((u) => u.permit.permitId),
    ...(r.chain ? [r.chain.chainId] : []),
  ];
}

/** Problems with one rendered (closed) result: label and sentence first, details only behind the fold. */
function layoutProblems(c, t, h = html(React.createElement(panel.ResultView, { c, t }))) {
  const out = [];
  const head = panel.headline(c.result, t);
  const label = h.indexOf(`>${head.label}<`);
  const sentence = h.indexOf(`>${esc(head.sentence)}<`);
  const fold = h.indexOf(`>${esc(t(FOLD))}</button>`);
  if (label < 0) out.push("no label");
  if (sentence < 0) out.push("no sentence");
  if (fold < 0) out.push("no Show details fold");
  if (label > fold || sentence > fold || sentence < label) out.push("label and sentence do not come first");
  if (!/^(VALID|INVALID|NOT CHECKED)$/.test(head.label)) out.push(`label ${head.label}`);
  if (c.result.kind === "verdict" && head.label !== (c.result.valid ? "VALID" : "INVALID")) out.push(`label ${head.label} for valid=${c.result.valid}`);
  for (const s of detailOnly(c.result)) if (h.includes(esc(s))) out.push(`outside the fold: ${s.slice(0, 60)}`);
  const d = html(React.createElement(panel.ResultDetails, { c, t }));
  for (const s of detailOnly(c.result)) if (!d.includes(esc(s))) out.push(`not in the details: ${s.slice(0, 60)}`);
  // Shows / Does not show after every verdict, every item once, in order.
  if (c.result.kind === "verdict") {
    let at = Math.max(label, fold);
    for (const s of [t("Shows"), ...ml.SHOWS.map((x) => t(x)), t("Does not show"), ...ml.DOES_NOT_SHOW.map((x) => t(x))]) {
      const i = h.indexOf(`>${esc(s)}<`, at);
      if (i < 0) out.push(`list missing, or out of order: ${s}`);
      else at = i;
    }
  }
  return out;
}

await check(`D3 every result (${RENDERED.length}, en/ja/zh-HK) leads with VALID / INVALID and one sentence; details only behind the fold; the lists follow`, () => {
  const bad = [];
  for (const c of RENDERED) for (const lang of ["en", "ja", "zh-HK"]) for (const p of layoutProblems(c, T[lang])) bad.push(`${c.sample ?? c.name} (${lang}): ${p}`);
  assert.deepEqual(bad, [], bad.slice(0, 8).join("\n     "));
  const kinds = RENDERED.map((c) => ml.verdictKind(c.result));
  for (const k of ["consistent", "reused", "expired", "inconsistent"]) assert.ok(kinds.includes(k), `no result of kind ${k}`);
});

await check("D3 control: details rendered in the open, the sentence after the fold, a dropped list item, a wrong label, are caught", () => {
  const c = RENDERED.find((x) => x.sample === "reused");
  const h = html(React.createElement(panel.ResultView, { c, t: T.en }));
  const open = h.replace(`>${esc(FOLD)}</button>`, `>${esc(FOLD)}</button>${html(React.createElement(panel.ResultDetails, { c, t: T.en }))}`);
  assert.ok(layoutProblems(c, T.en, open).some((p) => p.startsWith("outside the fold")), "details in the open");
  const head = panel.headline(c.result, T.en);
  const late = h.replace(`>${esc(head.sentence)}<`, "><") + `<p>${esc(head.sentence)}</p>`;
  assert.ok(layoutProblems(c, T.en, late).length > 0, "sentence after the fold");
  assert.ok(layoutProblems(c, T.en, h.replace(`>${esc(ml.DOES_NOT_SHOW[2])}<`, "><")).length > 0, "dropped item");
  assert.ok(layoutProblems(c, T.en, h.replace(">INVALID<", ">VALID<")).length > 0, "wrong label");
});

const JARGON = /envelope|nullifier|permit_id|canonical|エンベロープ|ナリファイア|正規化|封套|信封|規範化|作廢值/i;
const jargonIn = (h) => (h.replace(/<[^>]+>/g, " ").match(JARGON) ?? []).map((m) => m);

await check("D4 no envelope / nullifier / permit_id / canonical outside the fold: the landing and every result, en/ja/zh-HK", () => {
  const bad = [];
  for (const lang of ["en", "ja", "zh-HK"]) {
    const landing = html(React.createElement(panel.MachineLogBody, { t: T[lang] }));
    assert.ok(landing.includes(`>${esc(T[lang]("Try with a sample"))}</button>`), `${lang}: no sample button`);
    for (const w of jargonIn(landing)) bad.push(`landing (${lang}): ${w}`);
    for (const c of RENDERED) for (const w of jargonIn(html(React.createElement(panel.ResultView, { c, t: T[lang] })))) bad.push(`${c.sample ?? c.name} (${lang}): ${w}`);
    const all = html(React.createElement(panel.MachineLogBody, { t: T[lang], initial: RENDERED }));
    for (const w of jargonIn(all)) bad.push(`page with every result (${lang}): ${w}`);
  }
  assert.deepEqual(bad, [], bad.slice(0, 8).join("\n     "));
});

await check("D4 control: each jargon word, planted in the visible page, is caught", () => {
  for (const w of ["envelope", "nullifier", "permit_id", "canonical", "Canonical JSON"]) assert.ok(jargonIn(`<p>the ${w} here</p>`).length > 0, w);
  assert.deepEqual(jargonIn(`<p translate="no" class="canonical">ok</p>`), [], "attributes are not text");
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
