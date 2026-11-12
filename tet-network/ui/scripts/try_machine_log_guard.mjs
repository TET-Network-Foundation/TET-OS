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

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

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
  "that each record existed before the next one in the same chain",
  "that a permit limits how often this key's log accepts an action (once, and not after it expires)",
];
const PINNED_DOES_NOT_SHOW = [
  "that the reading is true",
  "that the device clock was right",
  "where the device was",
  "who operates the device",
  "that the key was not copied",
  "that a copied key did not write a second log (a permit does not stop that)",
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
  // In this order and nowhere else: heading "Shows", SHOWS rendered through t(), heading "Does not
  // show", DOES_NOT_SHOW rendered through t(). (Order, not a lazy match: two swapped lists must fail.)
  const at = (re) => {
    const all = [...PANEL.matchAll(new RegExp(re.source, "g"))];
    assert.equal(all.length, 1, `${re} appears ${all.length} times`);
    return all[0].index;
  };
  const order = [
    at(/t\("Shows"\)/),
    at(/(?<![A-Z_])SHOWS\.map\(\(s\) => \(\s*<li key=\{s\}>\{t\(s\)\}<\/li>/),
    at(/t\("Does not show"\)/),
    at(/DOES_NOT_SHOW\.map\(\(s\) => \(\s*<li key=\{s\}>\{t\(s\)\}<\/li>/),
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
  return [r.valid ? "VALID" : "INVALID", ...(r.valid ? [`${r.records} records, all signed by ${r.signer}`] : r.problems.map(ml.problemLine))];
}

/** A `signature:` line keeps only its prefix: the reason is the verifier's own wording. */
const comparable = (l) => (/^record \d+: signature: /.test(l) && !/payload type is/.test(l) ? l.replace(/(signature: ).*/, "$1…") : l);

await check(`B1 every fixture case gets notebook.py verify's verdict and problem lines (${FIX.cases.length} cases)`, async () => {
  assert.ok(FIX.cases.length >= 10);
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

await check("B5 a correctly signed record citing a used, an expired, or another key's permit is refused for that reason alone", async () => {
  const one = async (name, re) => {
    const lines = await reasonOf(name);
    assert.equal(lines.length, 1, `${name}: ${lines.join(" | ")}`);
    assert.match(lines[0], re, name);
  };
  await one("permit_reused", /^record 3: permit: [0-9a-f]{32} already used by record 2$/);
  await one("permit_expired", /^record 3: permit: [0-9a-f]{32} expired \(expires_seq 2, cited by record 3\)$/);
  await one("permit_other_key", /^record 3: permit: [0-9a-f]{32} not signed by this device's key \(signed by tet-ed25519:[0-9a-f]{64}\)$/);
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

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
