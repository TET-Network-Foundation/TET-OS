// Guard for the /future concept page ("A guess at the 2030s", app/future), which imagines one-shot
// signing keys (docs/research/ONE_SHOT_TET.md, status: idea) and lets a visitor try a sample wallet.
//
//   node --experimental-strip-types scripts/future_concept_guard.mjs
//
// 1. The banner says exactly "Concept. Nothing here moves value. No token exists. One-shot keys do
//    not run on any machine today." and its Japanese, both rendered unconditionally by <Banner />.
// 2. The banner is on every view, including after a note is handed over: FutureView has one return,
//    <Banner /> sits in it outside any `{…}`, handing a note only sets state (the same return renders
//    it), only the wallet's own parts are conditional, and the banner is sticky (stays in sight).
// 3. The lead sentence is exact in English and Japanese, and is PlainLead's lead.
// 4. Every figure is a sample: a number reaches the page only as t("{n} sample units"), whose ja and
//    zh-HK say sample; no other page string carries a digit (except "2030s" and "STOC 2020"); no raw
//    number is rendered; the model's keys are letters.
// 5. The sample wallet makes no request and uses no storage: no request, navigation, storage or
//    cookie in the page, its model or the kit (source); and the model run with every such browser
//    API replaced by a trap touches none of them (run time). The view changes state only through
//    wallet_model.ts.
// 6. Handing a note over (wallet_model.ts, run here): marks the sender's key used, the note arrives
//    once, a used key cannot hand a second note and nothing changes, the input is never changed, and
//    the units on the two sides add up to the same total before and after.
// 7. The model line under the wallet is exact in English and Japanese, unconditional, and sits
//    inside the wallet's card after the wallet.
// 8. Shows / Does not show: the headings reuse the existing "Shows" / "Does not show" keys (each
//    defined once per dictionary), and both lists are pinned word for word; the over-reaching
//    "the key was a one-shot key" line is gone.
// 9. The three links (the research note, IACR ePrint 2025/486, arXiv 2510.10899) are there.
// 10. "token" appears only in "No token exists." (トークン / 代幣 only in its translations).
// 11. Banned wording, in the page's English, Japanese and Hong Kong Chinese: money words, prices,
//    earn/invest/buy/yield, prove/proof, quantum-proof, AI, guarantee, and no "untraceable" claim.
// 12. No key is defined twice in either dictionary (a duplicate breaks the build).
// (This file quotes those words on purpose; try_privacy_guard lists it in NOT_CLAIMS.)
// Each check has a control below: the check is run on a broken copy and must fail.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
const { JA } = await import("../app/try/i18n_ja.ts");
const { ZH_HK } = await import("../app/try/i18n_zh_hk.ts");

const UI = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, UI), "utf8");
const VIEW = read("app/future/FutureView.tsx");
const PAGE = read("app/future/page.tsx");
const MODEL = read("app/future/wallet_model.ts");
const CSS = read("app/future/future.module.css");
const KIT = read("app/components/plain/Plain.tsx");
const JA_SRC = read("app/try/i18n_ja.ts");
const ZH_SRC = read("app/try/i18n_zh_hk.ts");

export const BANNER_EN = "Concept. Nothing here moves value. No token exists. One-shot keys do not run on any machine today.";
export const BANNER_JA = "構想です。ここでは価値は何も動きません。トークンは存在しません。ワンショット鍵は、今日どの機械の上でも動いていません。";
export const LEAD_EN = "This page lets you try a sample wallet whose keys each work only once, so you can see what that idea would change and what it would not.";
export const LEAD_JA = "このページでは、鍵がそれぞれ1回しか使えないサンプルのウォレットを試して、その考え方で何が変わり、何が変わらないかを確かめられます。";
export const MODEL_EN = "This is a model on an ordinary computer, so a copy could be used twice. A real one-shot key could not be copied. That difference is the whole idea.";
export const MODEL_JA = "これは普通のコンピューター上の模型なので、コピーすれば2回使えてしまいます。本物のワンショット鍵はコピーできません。その違いこそが、この考え方のすべてです。";
export const SHOWS = [
  "Which key signed, and that the signature fits this exact message.",
  "Only if the idea works as the research note describes: that this key could not sign a second time.",
];
export const DOES_NOT_SHOW = [
  "Who holds the key, or held it.",
  "Whether the message is true. The key limits how often something is said, not whether it is true.",
  "When it was signed. That still needs a chain.",
  "Which member of a group acted. Hiding one among many is a different tool's job.",
  "That one-shot keys exist. No machine runs them today.",
];
const LINKS = [
  "https://github.com/TET-Network-Foundation/TET-OS/blob/main/docs/research/ONE_SHOT_TET.md",
  "https://eprint.iacr.org/2025/486",
  "https://arxiv.org/abs/2510.10899",
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

/** A control: `fn` must throw, and for the reason named by `re` (not some earlier check). */
async function failsWith(fn, re, label) {
  let msg = null;
  try {
    await fn();
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  assert.ok(msg !== null, `control passed: ${label}`);
  assert.match(msg, re, `control failed for another reason: ${label}: ${msg.split("\n")[0]}`);
}
/** Each [broken, re] pair must differ from `orig` and make `fn(broken)` fail for reason `re`. */
async function controls(orig, pairs, fn, what) {
  for (const [i, [b, re]] of pairs.entries()) {
    assert.notEqual(b, orig, `${what} control ${i}: anchor gone`);
    await failsWith(() => fn(b), re, `${what} ${i}`);
  }
}
const code = (src) => src.split("\n").filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join("\n");
/** The t("…") keys a source passes. */
const keys = (src) => [...code(src).matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The body of `function NAME(…) { … }` in src. */
function fnBody(src, name) {
  const at = src.search(new RegExp(`function ${name}\\s*\\(`));
  assert.ok(at >= 0, `no function ${name}`);
  const open = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unbalanced ${name}`);
}
/** Asserts `function NAME` has one return, and that `needle` is in it outside any `{…}`. Returns the
 *  offset of `needle` in that return. */
function unconditional(src, name, needle) {
  const body = fnBody(src, name);
  const returns = body.match(/\breturn\b/g) ?? [];
  assert.equal(returns.length, 1, `${name} has ${returns.length} returns: a second return is a view without "${needle.slice(0, 40)}"`);
  const ret = body.slice(body.indexOf("return"));
  const at = ret.indexOf(needle);
  assert.ok(at >= 0, `${name} does not render ${needle.slice(0, 60)}`);
  let depth = 0;
  for (const ch of ret.slice(0, at)) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
  assert.equal(depth, 0, `${needle.slice(0, 60)} in ${name} is inside a {…} expression (conditional or mapped)`);
  return at;
}

// ── 1 + 2. Banner ─────────────────────────────────────────────────────────────────────────────────
const CONDITIONAL_OK = ["PrimaryButton", "ResultCard", "SecondaryButton", "Side"];
function bannerChecks(src, css = CSS) {
  assert.ok(src.includes(`export const BANNER_EN = ${JSON.stringify(BANNER_EN)};`), "BANNER_EN is not the exact text");
  assert.ok(src.includes(`export const BANNER_JA = ${JSON.stringify(BANNER_JA)};`), "BANNER_JA is not the exact text");
  unconditional(src, "Banner", "{BANNER_EN}");
  unconditional(src, "Banner", "{BANNER_JA}");
  unconditional(src, "FutureView", "<Banner />");
  // Only the wallet's own parts appear and disappear; the frame (banner, language switch) never does.
  for (const m of fnBody(src, "FutureView").matchAll(/(?:&&|\?|:)\s*\(?\s*<([A-Z]\w*)/g)) {
    assert.ok(CONDITIONAL_OK.includes(m[1]), `<${m[1]}> is rendered conditionally`);
  }
  // Handing a note over only sets state: the one return above renders the result, banner included.
  const hand = fnBody(src, "hand");
  assert.ok(!/\breturn\b|<|\bwindow\b|\bdocument\b/.test(hand), "hand() does more than set state (a return, markup or the DOM)");
  assert.ok(/\.banner\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/.test(css), "the banner is not sticky at the top: it can scroll out of sight");
}
await check("the banner is exact in English and Japanese, and on every view, including after a hand-over", () => bannerChecks(VIEW));
await check("control: a changed, conditional, scrolled-away or missing banner is caught", async () => {
  await controls(
    VIEW,
    [
      [VIEW.replace("No token exists.", "No token exists yet."), /BANNER_EN is not the exact text/],
      [VIEW.replace("ワンショット鍵は、今日", "ワンショット鍵は今日"), /BANNER_JA is not the exact text/],
      [VIEW.replace("      <Banner />\n      <PlainPage>", "      {last ? null : <Banner />}\n      <PlainPage>"), /<Banner \/> in FutureView is inside/],
      [VIEW.replace("      <Banner />\n      <PlainPage>", "      <PlainPage>"), /FutureView does not render <Banner \/>/],
      [VIEW.replace('<p lang="ja">{BANNER_JA}</p>', '{lang === "ja" && <p lang="ja">{BANNER_JA}</p>}'), /\{BANNER_JA\} in Banner is inside/],
      [VIEW.replace("  const totals = wallets", "  if (last?.ok) return <ResultCard tone=\"ok\" label=\"\" sentence=\"\" detailsLabel=\"\" hideLabel=\"\" />;\n  const totals = wallets"), /FutureView has 2 returns/],
      [VIEW.replace("            <LangSwitch />", "            {last ? null : <LangSwitch />}"), /<LangSwitch> is rendered conditionally/],
      [VIEW.replace("      setLast(r);\n", "      setLast(r);\n      document.body.replaceChildren();\n"), /hand\(\) does more than set state/],
    ],
    (b) => bannerChecks(b),
    "banner",
  );
  await failsWith(() => bannerChecks(VIEW, CSS.replace("position: sticky;", "position: static;")), /the banner is not sticky/, "banner not sticky");
});

// ── 3. The lead sentence ──────────────────────────────────────────────────────────────────────────
function leadChecks(src, ja, zh) {
  assert.ok(new RegExp(`<PlainLead[^>]*\\blead=\\{t\\(${esc(JSON.stringify(LEAD_EN))}\\)\\}`).test(code(src)), "the lead sentence is not PlainLead's lead, word for word");
  unconditional(src, "FutureView", "<PlainLead");
  assert.equal(ja[LEAD_EN], LEAD_JA, "the Japanese lead is not the exact text");
  assert.ok(zh[LEAD_EN], "the lead has no Hong Kong Chinese");
}
await check("the lead sentence is exact in English and Japanese, and leads the page", () => leadChecks(VIEW, JA, ZH_HK));
await check("control: a changed or missing lead is caught", async () => {
  await controls(
    VIEW,
    [
      [VIEW.replace("so you can see what that idea", "so you see what that idea"), /the lead sentence is not PlainLead's lead/],
      [VIEW.replace("        <PlainLead\n", "        {wallets ? null : <PlainLead\n").replace("would not.\")}\n        />", "would not.\")}\n        />}"), /<PlainLead in FutureView is inside/],
    ],
    (b) => leadChecks(b, JA, ZH_HK),
    "lead",
  );
  await failsWith(() => leadChecks(VIEW, { ...JA, [LEAD_EN]: LEAD_JA.replace("確かめられます", "確かめます") }, ZH_HK), /the Japanese lead is not the exact text/, "ja lead");
  const { [LEAD_EN]: _gone, ...zhNoLead } = ZH_HK;
  await failsWith(() => leadChecks(VIEW, JA, zhNoLead), /the lead has no Hong Kong Chinese/, "zh lead");
});

// ── 4. Every figure is a sample ───────────────────────────────────────────────────────────────────
const UNITS = "{n} sample units";
const K_KEYS = ["Sample key {k}", "Note from sample key {k}"];
function figureChecks(src, ja, zh, model = MODEL) {
  const bad = [];
  for (const k of keys(src)) {
    const ph = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (ph.includes("n") && k !== UNITS) bad.push(`a number outside "${UNITS}": ${k}`);
    if (ph.some((p) => p !== "n" && !(p === "k" && K_KEYS.includes(k)))) bad.push(`unexpected placeholder: ${k}`);
    if (/\d/.test(k.replace(/\b2030s\b|\bSTOC 2020\b/g, ""))) bad.push(`a digit in page text: ${k}`);
    if (/\bunits?\b/i.test(k) && k !== UNITS) bad.push(`units without the sample label: ${k}`);
  }
  const c = code(src);
  // Every { n: … } passed to t() goes through the sample-units string.
  for (const m of c.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*\{([^}]*)\}/g)) {
    if (/\bn\s*:/.test(m[2]) && m[1] !== UNITS) bad.push(`{ n } passed to ${m[1]}`);
  }
  // No figure rendered raw: a JSX {expr} that is a units / total value on its own.
  for (const m of c.matchAll(/\{\s*([\w.?]*(?:units|mine|theirs|[Tt]otals?))\s*\}/g)) {
    // <Side total={…}> renders {props.total}: allowed only while every total passed in is the sample-units string.
    if (m[1] === "props.total") continue;
    bad.push(`a figure rendered without t(): {${m[1]}}`);
  }
  for (const m of c.matchAll(/\btotal=\{([^\n]*?)\}>/g)) if (!m[1].startsWith(`t(${JSON.stringify(UNITS)}, {`)) bad.push(`a side total that is not "${UNITS}": ${m[1]}`);
  if (/\{props\.total\}/.test(c) && !/\btotal=\{t\(/.test(c)) bad.push("{props.total} rendered, but no total is passed through t()");
  for (const m of c.matchAll(/>([^<>{}]*\d[^<>{}]*)</g)) {
    const txt = m[1].trim();
    if (txt && !["IACR ePrint 2025/486", "arXiv 2510.10899"].includes(txt)) bad.push(`JSX text with a digit: ${txt}`);
  }
  // The model's keys are letters, not numbers.
  for (const m of code(model).matchAll(/\{\s*id:\s*"([^"]*)"/g)) if (!/^[A-Z]$/.test(m[1])) bad.push(`sample key id "${m[1]}" is not a letter`);
  if (!keys(src).includes(UNITS)) bad.push(`"${UNITS}" is gone`);
  if (!keys(src).includes("A concept page. Every figure on it is a sample.")) bad.push("the every-figure-is-a-sample line is gone");
  if (!/サンプル/.test(ja[UNITS] ?? "")) bad.push(`ja "${UNITS}" doesn't say sample: ${ja[UNITS]}`);
  if (!/樣本/.test(zh[UNITS] ?? "")) bad.push(`zh-HK "${UNITS}" doesn't say sample: ${zh[UNITS]}`);
  assert.deepEqual(bad, []);
}
await check("every figure is labelled sample, in every language", () => figureChecks(VIEW, JA, ZH_HK));
await check("control: an unlabelled figure is caught", async () => {
  await controls(
    VIEW,
    [
      [VIEW.replace('t("Total")', 't("Total: 165 units")'), /a digit in page text: Total: 165 units/],
      [VIEW.replace('total={t("{n} sample units", { n: totals.mine })}', 'total={t("{n} units", { n: totals.mine })}'), /a number outside "\{n\} sample units": \{n\} units/],
      [VIEW.replace('{t("{n} sample units", { n: n.units })}', "{n.units}"), /a figure rendered without t\(\): \{n\.units\}/],
      [VIEW.replace('t("Total")', 't("Total", { n: totals.theirs })'), /\{ n \} passed to Total/],
      [VIEW.replace('total={t("{n} sample units", { n: totals.theirs })}', "total={String(totals.theirs)}"), /a side total that is not "\{n\} sample units"/],
      [VIEW.replace('{t("Hand this note over")}</SecondaryButton>', "Hand 1 note</SecondaryButton>"), /JSX text with a digit: Hand 1 note/],
    ],
    (b) => figureChecks(b, JA, ZH_HK),
    "figure",
  );
  await failsWith(() => figureChecks(VIEW, JA, ZH_HK, MODEL.replace('{ id: "A", units', '{ id: "1", units')), /sample key id "1" is not a letter/, "numeric key id");
  await failsWith(() => figureChecks(VIEW, { ...JA, [UNITS]: "{n} 単位" }, ZH_HK), /ja "\{n\} sample units" doesn't say sample/, "ja without sample");
  await failsWith(() => figureChecks(VIEW, JA, { ...ZH_HK, [UNITS]: "{n} 個單位" }), /zh-HK "\{n\} sample units" doesn't say sample/, "zh-HK without sample");
});

// ── 5. No request, no storage ─────────────────────────────────────────────────────────────────────
const NETWORK =
  /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bWebSocket\b|\bEventSource\b|window\.open|\blocation\b|useRouter|\brouter\.|\bhistory\.|<form\b|<Link\b|localStorage|sessionStorage|indexedDB|\bcookie|\bcaches\b|serviceWorker|navigator\.storage|BroadcastChannel|postMessage|\bsetUi\b|\bgetUi\b|\bimport\s*\(|from\s+"\.\.\/lib\//;
function storageChecks(src, page, model, kit) {
  for (const [f, s] of [["FutureView.tsx", src], ["page.tsx", page], ["wallet_model.ts", model], ["Plain.tsx", kit]]) {
    const m = NETWORK.exec(code(s));
    assert.ok(!m, `${f}: "${m?.[0]}" (a request, a navigation or storage)`);
  }
  const imports = [...code(src).matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["../components/plain/Plain", "../try/i18n", "./future.module.css", "./wallet_model", "react"], "FutureView imports something else");
  assert.ok(!/^\s*import\b/m.test(code(model)), "wallet_model.ts imports something");
  // The wallet lives in two pieces of state, changed only through wallet_model.ts.
  assert.equal((code(src).match(/\buseState\b/g) ?? []).length, 3, "state other than the wallet and the last result (import + two useState)");
  const setW = [...code(src).matchAll(/setWallets\(([^)]*\)?)\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(setW, ["makeSampleWallets()", "r.wallets"], `setWallets called with ${setW.join(", ")}`);
  const setL = [...code(src).matchAll(/setLast\(([^)]*)\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(setL, ["null", "r"], `setLast called with ${setL.join(", ")}`);
  assert.ok(/const r = handOver\(wallets, id\);/.test(src), "the hand-over result does not come from handOver");
  assert.ok(!/\bwallets\.\w+(?:\[[^\]]*\])?(?:\.\w+)?\s*=[^=>]|\bwallets\.\w+\.(?:push|pop|splice|shift|unshift|sort|reverse)\(/.test(code(src)), "the view changes the wallet itself");
}
await check("the sample wallet makes no request and stores nothing (source: page, model and kit)", () => storageChecks(VIEW, PAGE, MODEL, KIT));
await check("control: a request, storage or a wallet changed outside the model is caught", async () => {
  const run = ([v, p, m, k]) => storageChecks(v, p, m, k);
  const base = [VIEW, PAGE, MODEL, KIT];
  const pairs = [
    [[VIEW.replace("      setLast(r);\n", '      setLast(r);\n      void fetch("/tet-node-api/tx/submit");\n'), PAGE, MODEL, KIT], /FutureView.tsx: "fetch\("/],
    [[VIEW.replace("      setLast(r);\n", '      setLast(r);\n      localStorage.setItem("w", "1");\n'), PAGE, MODEL, KIT], /FutureView.tsx: "localStorage"/],
    [[VIEW.replace("      setLast(r);\n", '      setLast(r);\n      sessionStorage.setItem("w", "1");\n'), PAGE, MODEL, KIT], /FutureView.tsx: "sessionStorage"/],
    [[VIEW.replace("      setLast(r);\n", '      setLast(r);\n      document.cookie = "w=1";\n'), PAGE, MODEL, KIT], /FutureView.tsx: "cookie"/],
    [[VIEW, PAGE, MODEL.replace("export function makeSampleWallets(): SampleWallets {", 'export function makeSampleWallets(): SampleWallets {\n  void indexedDB.open("w");'), KIT], /wallet_model.ts: "indexedDB"/],
    [[VIEW, PAGE, MODEL.replace("export function handOver(", 'import { setUi } from "../lib/device_store";\nexport function handOver('), KIT], /wallet_model.ts: "(?:setUi|from "\.\.\/lib\/)"/],
    [[VIEW, PAGE.replace("export default function Future() {", 'export default function Future() {\n  void fetch("/x");'), MODEL, KIT], /page.tsx: "fetch\("/],
    [[VIEW, PAGE, MODEL, KIT.replace("const [open, setOpen] = useState(false);", 'const [open, setOpen] = useState(false);\n  void navigator.sendBeacon("/x");')], /Plain.tsx: "sendBeacon"/],
    [[VIEW.replace('import { useState, type ReactNode } from "react";', 'import { useState, type ReactNode } from "react";\nimport { pickLang } from "../try/pick";'), PAGE, MODEL, KIT], /FutureView imports something else/],
    [[VIEW.replace("  const [last, setLast]", "  const [count, setCount] = useState(0);\n  const [last, setLast]"), PAGE, MODEL, KIT], /state other than the wallet/],
    [[VIEW.replace("      setWallets(r.wallets);", "      setWallets({ ...r.wallets, theirs: [] });"), PAGE, MODEL, KIT], /setWallets called with/],
    [[VIEW.replace("const r = handOver(wallets, id);", "const r = { ok: true as const, wallets, key: id, units: 0 };"), PAGE, MODEL, KIT], /the hand-over result does not come from handOver/],
    [[VIEW.replace("    if (wallets) {\n", "    if (wallets) {\n      wallets.theirs.push({ from: id, units: 1 });\n"), PAGE, MODEL, KIT], /the view changes the wallet itself/],
  ];
  for (const [i, [b, re]] of pairs.entries()) {
    assert.ok(b.some((x, j) => x !== base[j]), `storage control ${i}: anchor gone`);
    await failsWith(() => run(b), re, `storage ${i}`);
  }
});

// Run time: the model, with every request and storage API replaced by a trap.
const TRAPPED = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "localStorage", "sessionStorage", "indexedDB", "caches", "document", "navigator", "BroadcastChannel", "postMessage"];
async function withTraps(fn) {
  const touched = [];
  const saved = TRAPPED.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]);
  const trap = (name) =>
    new Proxy(function () {}, {
      get: (_t, p) => {
        touched.push(`${name}.${String(p)}`);
        return trap(`${name}.${String(p)}`);
      },
      set: (_t, p) => (touched.push(`${name}.${String(p)}=`), true),
      apply: () => (touched.push(`${name}()`), undefined),
      construct: () => (touched.push(`new ${name}`), {}),
    });
  for (const n of TRAPPED) Object.defineProperty(globalThis, n, { value: trap(n), configurable: true, writable: true });
  try {
    await fn();
  } finally {
    for (const [n, d] of saved) {
      if (d) Object.defineProperty(globalThis, n, d);
      else delete globalThis[n];
    }
  }
  return touched;
}
/** A full visit in the model: make, hand A, hand A again, hand B, an unknown key, start again. */
function visit(api) {
  let w = api.makeSampleWallets();
  for (const id of ["A", "A", "B", "Z", "C"]) w = api.handOver(w, id).wallets;
  api.sideTotals(w);
  api.makeSampleWallets();
}
const model = await import("../app/future/wallet_model.ts");
async function runtimeChecks(api) {
  const touched = await withTraps(() => visit(api));
  assert.deepEqual(touched, [], `the model touched ${touched.slice(0, 5).join(", ")}`);
}
await check("the sample wallet makes no request and stores nothing (run time: every such API is a trap)", () => runtimeChecks(model));
await check("control: a model that stores or requests at run time is caught", async () => {
  const leaky = (what) => ({ ...model, handOver: (w, id) => (what(), model.handOver(w, id)) });
  await failsWith(() => runtimeChecks(leaky(() => globalThis.localStorage.setItem("w", "1"))), /the model touched localStorage\.setItem/, "localStorage at run time");
  await failsWith(() => runtimeChecks(leaky(() => globalThis.sessionStorage.setItem("w", "1"))), /the model touched sessionStorage\.setItem/, "sessionStorage at run time");
  await failsWith(() => runtimeChecks(leaky(() => void globalThis.fetch("/x"))), /the model touched fetch\(\)/, "fetch at run time");
  await failsWith(() => runtimeChecks(leaky(() => (globalThis.document.cookie = "w=1"))), /the model touched document\.cookie=/, "cookie at run time");
  await failsWith(() => runtimeChecks(leaky(() => globalThis.indexedDB.open("w"))), /the model touched indexedDB\.open/, "indexedDB at run time");
});

// ── 6. Handing a note over ────────────────────────────────────────────────────────────────────────
function modelChecks(api) {
  const fresh = api.makeSampleWallets();
  const snapshot = JSON.stringify(fresh);
  assert.ok(fresh.mine.length >= 2 && fresh.mine.every((k) => !k.used && Number.isInteger(k.units) && k.units > 0), "a fresh wallet is not a few unused keys holding sample units");
  assert.equal(fresh.theirs.length, 0, "the other person starts with something");
  const total = (w) => api.sideTotals(w).mine + api.sideTotals(w).theirs;
  const start = total(fresh);

  const r1 = api.handOver(fresh, "A");
  assert.equal(JSON.stringify(fresh), snapshot, "handOver changed its input");
  assert.equal(r1.ok, true, "an unused key was refused");
  const a = r1.wallets.mine.find((k) => k.id === "A");
  assert.equal(a.used, true, "handing a note over did not mark the sender's key used");
  assert.equal(a.units, 0, "the used key still holds its units");
  assert.deepEqual(r1.wallets.theirs, [{ from: "A", units: fresh.mine[0].units }], "the note did not arrive on the other side exactly once");
  for (const k of r1.wallets.mine.filter((k) => k.id !== "A")) assert.deepEqual(k, fresh.mine.find((f) => f.id === k.id), `key ${k.id} changed`);
  assert.equal(total(r1.wallets), start, "units appeared or vanished in the hand-over");

  const r2 = api.handOver(r1.wallets, "A");
  assert.equal(r2.ok, false, "a used key handed a second note");
  assert.equal(r2.reason, "used", `a used key was refused for another reason: ${r2.reason}`);
  assert.equal(r2.wallets, r1.wallets, "a refused hand-over changed the wallets");
  assert.equal(r2.wallets.theirs.filter((n) => n.from === "A").length, 1, "the note arrived twice");

  const r3 = api.handOver(r1.wallets, "Z");
  assert.equal(r3.ok, false, "an unknown key handed a note");
  assert.equal(r3.reason, "unknown", "an unknown key was refused as used");

  let w = r1.wallets;
  for (const id of ["B", "C", "B", "A", "C"]) w = api.handOver(w, id).wallets;
  assert.equal(total(w), start, "units appeared or vanished over several hand-overs");
  assert.equal(new Set(w.theirs.map((n) => n.from)).size, w.theirs.length, "some note arrived twice");
  assert.ok(w.mine.every((k) => k.used), "a key that handed its note is not marked used");
}
await check("handing a note over uses the key up, the note arrives once, and a used key cannot hand a second", () => modelChecks(model));
await check("control: a key left unused, a second hand-over, a mutated input or lost units are caught", async () => {
  const H = model.handOver;
  const broken = [
    [{ ...model, handOver: (w, id) => { const r = H(w, id); return r.ok ? { ...r, wallets: { ...r.wallets, mine: w.mine } } : r; } }, /did not mark the sender's key used/],
    [{ ...model, handOver: (w, id) => { const k = w.mine.find((x) => x.id === id); return k?.used ? { ok: true, key: id, units: 0, wallets: { mine: w.mine, theirs: [...w.theirs, { from: id, units: 0 }] } } : H(w, id); } }, /a used key handed a second note/],
    [{ ...model, handOver: (w, id) => { const r = H(w, id); return r.ok ? { ...r, wallets: { ...r.wallets, theirs: [...r.wallets.theirs, ...r.wallets.theirs.slice(-1)] } } : r; } }, /the note did not arrive on the other side exactly once/],
    [{ ...model, handOver: (w, id) => { const r = H(w, id); if (r.ok) w.mine[0] = { ...w.mine[0], used: true }; return r; } }, /handOver changed its input/],
    [{ ...model, handOver: (w, id) => { const r = H(w, id); return r.ok ? { ...r, wallets: { ...r.wallets, theirs: r.wallets.theirs.map((n) => ({ ...n, units: n.units + 1 })) } } : r; } }, /the note did not arrive|units appeared or vanished/],
    [{ ...model, handOver: (w, id) => { const r = H(w, id); return r.ok ? r : { ...r, wallets: { ...w } }; } }, /a refused hand-over changed the wallets/],
  ];
  for (const [i, [api, re]] of broken.entries()) await failsWith(() => modelChecks(api), re, `model ${i}`);
});

// ── 7. The model line under the wallet ────────────────────────────────────────────────────────────
function modelLineChecks(src, ja, zh) {
  const needle = `{t(${JSON.stringify(MODEL_EN)})}`;
  assert.ok(src.includes(needle), "the model line is not the exact text");
  const at = unconditional(src, "FutureView", needle);
  const ret = fnBody(src, "FutureView");
  const view = ret.slice(ret.indexOf("return"));
  const wallet = view.indexOf("<Side");
  const cardEnd = view.indexOf("</PlainCard>");
  assert.ok(wallet >= 0 && wallet < at && at < cardEnd, "the model line is not under the wallet, inside the wallet's card");
  assert.ok(view.lastIndexOf('t("Start again")', at) > wallet, "the model line is not after the wallet's last part");
  assert.equal(ja[MODEL_EN], MODEL_JA, "the Japanese model line is not the exact text");
  assert.ok(/コピー/.test(ja[MODEL_EN] ?? ""), "the Japanese model line lost the copy");
  assert.ok(/複製/.test(zh[MODEL_EN] ?? ""), "the Hong Kong Chinese model line is missing or lost the copy");
}
await check("the model line sits under the wallet, exact in English and Japanese", () => modelLineChecks(VIEW, JA, ZH_HK));
await check("control: a changed, conditional, moved or untranslated model line is caught", async () => {
  const line = `          <p className="mt-5 rounded-xl`;
  const block = VIEW.slice(VIEW.indexOf(line), VIEW.indexOf("</p>", VIEW.indexOf(line)) + 5);
  await controls(
    VIEW,
    [
      [VIEW.replace("so a copy could be used twice.", "so a copy might be used twice."), /the model line is not the exact text/],
      [VIEW.replace(block, `{wallets ? null : (${block})}`), /is inside a \{…\} expression/],
      [VIEW.replace(block, "").replace('<p className="text-center text-sm', `${block}\n        <p className="text-center text-sm`), /the model line is not under the wallet/],
    ],
    (b) => modelLineChecks(b, JA, ZH_HK),
    "model line",
  );
  await failsWith(() => modelLineChecks(VIEW, { ...JA, [MODEL_EN]: MODEL_JA.replace("すべてです", "核心です") }, ZH_HK), /the Japanese model line is not the exact text/, "ja model line");
  await failsWith(() => modelLineChecks(VIEW, JA, { ...ZH_HK, [MODEL_EN]: "這是模型。" }), /Hong Kong Chinese model line/, "zh model line");
});

// ── 8. Shows / Does not show ──────────────────────────────────────────────────────────────────────
/** The t("…") strings in `name={[ … ]}`. */
function listProp(src, name) {
  const m = code(src).match(new RegExp(`\\b${name}=\\{\\[([\\s\\S]*?)\\]\\}`));
  assert.ok(m, `no ${name} list`);
  return keys(m[1]);
}
const defs = (dictSrc, k) => dictSrc.split("\n").filter((l) => l.startsWith(`  ${JSON.stringify(k)}:`)).length;
function showsChecks(src, ja, zh, jaSrc = JA_SRC, zhSrc = ZH_SRC) {
  assert.ok(/showsTitle=\{t\("Shows"\)\}/.test(src) && /doesNotTitle=\{t\("Does not show"\)\}/.test(src), 'the headings are not t("Shows") / t("Does not show")');
  for (const k of ["Shows", "Does not show"]) {
    assert.equal(defs(jaSrc, k), 1, `ja defines "${k}" ${defs(jaSrc, k)} times (reuse the one key)`);
    assert.equal(defs(zhSrc, k), 1, `zh-HK defines "${k}" ${defs(zhSrc, k)} times (reuse the one key)`);
  }
  assert.deepEqual(listProp(src, "shows"), SHOWS, "the Shows list is not the pinned wording");
  assert.deepEqual(listProp(src, "doesNot"), DOES_NOT_SHOW, "the Does not show list is not the pinned wording");
  assert.ok(!/key was a one-shot key/i.test(src), 'the over-reaching "the key was a one-shot key" line is back');
  for (const k of [...SHOWS, ...DOES_NOT_SHOW]) assert.ok(ja[k] && zh[k], `no translation for: ${k}`);
}
await check("Shows / Does not show: the existing headings, and both lists word for word", () => showsChecks(VIEW, JA, ZH_HK));
await check("control: a changed list, a second heading key or the old over-reaching line is caught", async () => {
  await controls(
    VIEW,
    [
      [VIEW.replace("Only if the idea works as the research note describes: ", ""), /the Shows list is not the pinned wording/],
      [VIEW.replace('t("That one-shot keys exist. No machine runs them today."),\n', ""), /the Does not show list is not the pinned wording/],
      [VIEW.replace('t("Which key signed, and that the signature fits this exact message."),', 't("Which key signed, and that the signature fits this exact message."),\n              t("That the key was a one-shot key: it cannot have signed anything else."),'), /the Shows list is not the pinned wording/],
      [VIEW.replace('showsTitle={t("Shows")}', 'showsTitle={t("What it shows")}'), /the headings are not/],
    ],
    (b) => showsChecks(b, JA, ZH_HK),
    "shows",
  );
  await failsWith(() => showsChecks(VIEW, JA, ZH_HK, JA_SRC.replace("};\n", '  "Shows": "示すもの",\n};\n')), /ja defines "Shows" 2 times/, "duplicate ja heading");
  await failsWith(() => showsChecks(VIEW, JA, ZH_HK, JA_SRC, ZH_SRC.replace("};\n", '  "Does not show": "不顯示",\n};\n')), /zh-HK defines "Does not show" 2 times/, "duplicate zh heading");
  await failsWith(() => showsChecks(VIEW.replace("Hiding one among many", "Hiding one among many (the key was a one-shot key)"), JA, ZH_HK), /Does not show list|over-reaching/, "old line");
  await failsWith(() => showsChecks(VIEW, { ...JA, [SHOWS[1]]: "" }, ZH_HK), /no translation for: Only if/, "missing translation");
});

// ── 9. The three links ────────────────────────────────────────────────────────────────────────────
function linkChecks(src) {
  for (const url of LINKS) {
    const name = code(src).match(new RegExp(`const (\\w+) = "${esc(url)}";`))?.[1];
    assert.ok(name, `${url} is not on the page`);
    assert.ok(new RegExp(`<a href=\\{${name}\\} target="_blank" rel="noopener noreferrer"`).test(code(src)), `${url} is not linked`);
  }
}
await check("the research note, IACR ePrint 2025/486 and arXiv 2510.10899 are linked", () => linkChecks(VIEW));
await check("control: a missing or unlinked reference is caught", async () => {
  await controls(
    VIEW,
    [
      [VIEW.replace('2510.10899";', '2510.10898";'), /arxiv.org\/abs\/2510.10899 is not on the page/],
      [VIEW.replace("<a href={EPRINT_URL}", "<a href={NOTE_URL}"), /eprint.iacr.org\/2025\/486 is not linked/],
      [VIEW.replace("/docs/research/ONE_SHOT_TET.md", "/README.md"), /ONE_SHOT_TET.md is not on the page/],
    ],
    linkChecks,
    "link",
  );
});

// ── 10 + 11. Wording ──────────────────────────────────────────────────────────────────────────────
const TOKEN_OK = ["No token exists.", "トークンは存在しません。", "不存在任何代幣。"];
const TOKEN = /token|トークン|代幣|代币/i;
export const BANNED = new RegExp(
  [
    "\\b(?:money|pay(?:s|ing|ment|ments|out)?|paid|coins?|funds?|cash|dollars?|currency|currencies)\\b",
    "\\b(?:price[sd]?|pricing|earn(?:s|ed|ing|ings)?|invest(?:s|ed|ing|ment|ments|or|ors)?|buy(?:s|ing)?|bought|purchase[sd]?|yield(?:s)?|profit(?:s|able)?|returns? on)\\b",
    "\\bprov(?:e|es|ed|en|ing|ably)\\b|\\bproofs?\\b",
    "untraceab|untrackab|\\banonymous\\b",
    "quantum[- ](?:proof|safe|secure|resistant)|unbreakable|\\bimpossible to (?:break|forge|copy)\\b",
    "\\bguarantee",
    "お金|支払|コイン|価格|値段|稼|投資|儲|利回り|購入|買|証明|追跡(?:不可能|できない|されない)|耐量子|量子耐性|保証|通貨|円",
    "金錢|付款|支付|硬幣|價格|價錢|賺|投資|收益|購買|買|證明|無法追蹤|不可追蹤|抗量子|保證|貨幣",
  ].join("|"),
  "i",
);
const AI = /\bAI\b|人工知能|人工智能/;
/** Every string the page shows, in every language: English keys and literals, and their ja / zh-HK. */
function shown(src, page, ja, zh) {
  const out = [];
  for (const [f, s] of [["FutureView.tsx", src], ["page.tsx", page]]) {
    for (const m of code(s).matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.push([f, JSON.parse(`"${m[1]}"`)]);
    for (const m of code(s).matchAll(/>([^<>{}]+)</g)) if (m[1].trim()) out.push([f, m[1].trim()]);
  }
  for (const k of keys(src)) {
    out.push([`ja "${k.slice(0, 30)}"`, ja[k] ?? ""]);
    out.push([`zh-HK "${k.slice(0, 30)}"`, zh[k] ?? ""]);
  }
  return out;
}
function wordingChecks(src, page, ja, zh) {
  const bad = [];
  for (const [where, s] of shown(src, page, ja, zh)) {
    let rest = s;
    for (const ok of TOKEN_OK) rest = rest.split(ok).join("");
    if (TOKEN.test(rest)) bad.push(`${where}: "token" outside "No token exists.": ${s.slice(0, 80)}`);
    const m = BANNED.exec(s) ?? AI.exec(s);
    if (m) bad.push(`${where}: "${m[0]}" in ${s.slice(0, 80)}`);
  }
  assert.deepEqual(bad, []);
}
await check('"token" only in "No token exists.", and no banned wording, in English, Japanese and Hong Kong Chinese', () => wordingChecks(VIEW, PAGE, JA, ZH_HK));
await check("control: a stray token and each kind of banned wording are caught", async () => {
  const strays = ["Each key is a token.", "This proves who signed.", "A proof of the hand-over.", "Earn sample units.", "Invest in one-shot keys.", "Buy a key.", "Yield per key.", "Paid in sample units.", "A note that is not untraceable.", "Quantum-proof keys.", "AI cannot copy a key.", "Guaranteed once."];
  for (const s of strays) await failsWith(() => wordingChecks(VIEW.replace('t("Total")', `t(${JSON.stringify(s)})`), PAGE, { ...JA, [s]: "x" }, { ...ZH_HK, [s]: "x" }), new RegExp(`FutureView.tsx: .*${esc(s.slice(0, 20))}`), s);
  for (const s of ["トークンで送る", "署名を証明します", "価格", "お金", "保証します", "耐量子の鍵"]) await failsWith(() => wordingChecks(VIEW, PAGE, { ...JA, Total: s }, ZH_HK), new RegExp(`ja "Total": .*${esc(s)}`), s);
  for (const s of ["代幣", "證明", "賺取", "付款", "抗量子"]) await failsWith(() => wordingChecks(VIEW, PAGE, JA, { ...ZH_HK, Total: s }), new RegExp(`zh-HK "Total": .*${esc(s)}`), s);
  await failsWith(() => wordingChecks(VIEW, PAGE.replace("No token exists.", "No token exists yet; a token may come."), JA, ZH_HK), /page.tsx: "token" outside/, "page.tsx token");
});

// ── 12. No key defined twice ──────────────────────────────────────────────────────────────────────
function duplicateKeys(dictSrc) {
  const seen = new Map();
  for (const m of dictSrc.matchAll(/^\s+("(?:[^"\\]|\\.)*"):/gm)) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dup, [], `defined twice: ${dup.join(", ")}`);
}
await check("no key is defined twice in the ja or zh-HK dictionary", () => {
  duplicateKeys(JA_SRC);
  duplicateKeys(ZH_SRC);
});
await check("control: a key defined twice is caught", async () => {
  await failsWith(() => duplicateKeys(JA_SRC.replace("};\n", '  "Start again": "もう一度",\n};\n')), /defined twice: "Start again"/, "ja duplicate");
  await failsWith(() => duplicateKeys(ZH_SRC.replace("};\n", '  "Start again": "再來",\n};\n')), /defined twice: "Start again"/, "zh duplicate");
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
