// Guard for the /future concept page ("A guess at the 2030s", app/future), which imagines one-shot
// signing keys (docs/research/ONE_SHOT_TET.md, status: idea).
//
//   node --experimental-strip-types scripts/future_concept_guard.mjs
//
// 1. The banner says exactly "Concept. Nothing here moves value. No token exists. One-shot keys do
//    not run on any machine today." and its Japanese, both rendered unconditionally by <Banner />.
// 2. The banner is on every view: <Banner /> sits outside any `{…}` expression in the page's only
//    return, and again in the explanation's only return.
// 3. Every figure is a sample: a number reaches the page only as t("{n} sample units"), whose ja and
//    zh-HK translations say sample too; no other page string carries a digit (except "2030s" and
//    "STOC 2020") and no raw number is rendered.
// 4. The send button only opens the explanation: type="button", onClick={() => setExplain(true)};
//    the files make no request, navigate nowhere, store nothing, and the sample wallet is constant.
// 5. The three links (the research note, IACR ePrint 2025/486, arXiv 2510.10899) are there.
// 6. "token" appears only in "No token exists." (トークン / 代幣 only in its translations).
// 7. Banned wording, in the page's English, Japanese and Hong Kong Chinese: money words, prices,
//    earn/invest/buy/yield, prove/proof, quantum-proof, AI, guarantee, and no "untraceable" claim.
// (The patterns below spell those claims as character classes, e.g. untrace[a]b, so that
// try_privacy_guard, which scans every tracked file, does not read this list as a claim.)
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

export const BANNER_EN = "Concept. Nothing here moves value. No token exists. One-shot keys do not run on any machine today.";
export const BANNER_JA = "構想です。ここでは価値は何も動きません。トークンは存在しません。ワンショット鍵は、今日どの機械の上でも動いていません。";
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
function failsWith(fn, re, label) {
  let msg = null;
  try {
    fn();
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  assert.ok(msg !== null, `control passed: ${label}`);
  assert.match(msg, re, `control failed for another reason: ${label}: ${msg.split("\n")[0]}`);
}
const code = (src) => src.split("\n").filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join("\n");
/** The t("…") keys a source passes. */
const keys = (src) => [...code(src).matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));

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
/** Asserts `function NAME` has one return, and that `needle` is in it outside any `{…}`. */
function unconditional(src, name, needle) {
  const body = fnBody(src, name);
  const returns = body.match(/\breturn\b/g) ?? [];
  assert.equal(returns.length, 1, `${name} has ${returns.length} returns: a second return is a view without "${needle}"`);
  const ret = body.slice(body.indexOf("return"));
  const at = ret.indexOf(needle);
  assert.ok(at >= 0, `${name} does not render ${needle}`);
  let depth = 0;
  for (const ch of ret.slice(0, at)) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
  assert.equal(depth, 0, `${needle} in ${name} is inside a {…} expression (conditional or mapped)`);
}

// ── 1 + 2. Banner ─────────────────────────────────────────────────────────────────────────────────
function bannerChecks(src) {
  assert.ok(src.includes(`export const BANNER_EN = ${JSON.stringify(BANNER_EN)};`), "BANNER_EN is not the exact text");
  assert.ok(src.includes(`export const BANNER_JA = ${JSON.stringify(BANNER_JA)};`), "BANNER_JA is not the exact text");
  unconditional(src, "Banner", "{BANNER_EN}");
  unconditional(src, "Banner", "{BANNER_JA}");
  unconditional(src, "FutureView", "<Banner />");
  unconditional(src, "Explanation", "<Banner />");
  // The explanation is the only thing the page shows conditionally besides text.
  for (const m of fnBody(src, "FutureView").matchAll(/(?:&&|\?|:)\s*\(?\s*<([A-Z]\w*)/g)) assert.equal(m[1], "Explanation", `<${m[1]}> is rendered conditionally`);
}
await check("the banner is exact in English and Japanese, and on every view (page and explanation)", () => bannerChecks(VIEW));
await check("control: a changed, conditional or missing banner is caught", () => {
  const broken = [
    [VIEW.replace("No token exists.", "No token exists yet."), /BANNER_EN is not the exact text/],
    [VIEW.replace("ワンショット鍵は、今日", "ワンショット鍵は今日"), /BANNER_JA is not the exact text/],
    [VIEW.replace("      <Banner />\n      <div className={s.wrap}>", "      {!explain && <Banner />}\n      <div className={s.wrap}>"), /<Banner \/> in FutureView is inside/],
    [VIEW.replace("      <Banner />\n      <h3>", "      <h3>"), /Explanation does not render <Banner \/>/],
    [VIEW.replace('<p lang="ja">{BANNER_JA}</p>', '{lang === "ja" && <p lang="ja">{BANNER_JA}</p>}'), /\{BANNER_JA\} in Banner is inside/],
    [VIEW.replace("  const [explain, setExplain] = useState(false);\n", "  const [explain, setExplain] = useState(false);\n  if (explain) return <Explanation onClose={() => setExplain(false)} />;\n"), /FutureView has 2 returns/],
    [VIEW.replace("<span className={s.lang}>\n                  <LangSwitch />", "<span className={s.lang}>\n                  {explain ? null : <LangSwitch />}"), /<LangSwitch> is rendered conditionally/],
  ];
  for (const [i, [b, re]] of broken.entries()) {
    assert.notEqual(b, VIEW, `banner control ${i}: anchor gone`);
    failsWith(() => bannerChecks(b), re, `banner ${i}`);
  }
});

// ── 3. Every figure is a sample ───────────────────────────────────────────────────────────────────
const UNITS = "{n} sample units";
function figureChecks(src, ja, zh) {
  const bad = [];
  for (const k of keys(src)) {
    const ph = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (ph.includes("n") && k !== UNITS) bad.push(`a number outside "${UNITS}": ${k}`);
    if (ph.some((p) => p !== "n" && !(p === "k" && k === "Sample key {k}"))) bad.push(`unexpected placeholder: ${k}`);
    if (/\d/.test(k.replace(/\b2030s\b|\bSTOC 2020\b/g, ""))) bad.push(`a digit in page text: ${k}`);
    if (/\bunits?\b/i.test(k) && k !== UNITS) bad.push(`units without the sample label: ${k}`);
  }
  // Every figure passed to t() goes through the sample-units string.
  const c = code(src);
  for (const m of c.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*\{([^}]*)\}/g)) {
    if (/\bn\s*:/.test(m[2]) && m[1] !== UNITS) bad.push(`{ n } passed to ${m[1]}`);
  }
  // No number rendered raw, no JSX text with a digit except the two link labels.
  if (/\{\s*[\w.[\]]*(?:units|TOTAL|total)\s*\}/.test(c)) bad.push("a figure rendered without t()");
  for (const m of c.matchAll(/>([^<>{}]*\d[^<>{}]*)</g)) {
    const txt = m[1].trim();
    if (txt && !["IACR ePrint 2025/486", "arXiv 2510.10899"].includes(txt)) bad.push(`JSX text with a digit: ${txt}`);
  }
  // Sample key labels are letters, not numbers.
  for (const m of c.matchAll(/\{\s*id:\s*"([^"]*)"/g)) if (!/^[A-Z]$/.test(m[1])) bad.push(`sample key id "${m[1]}" is not a letter`);
  if (!keys(src).includes(UNITS)) bad.push(`"${UNITS}" is gone`);
  if (!keys(src).includes("A concept page. Every figure on it is a sample.")) bad.push("the every-figure-is-a-sample line is gone");
  if (!/サンプル/.test(ja[UNITS] ?? "")) bad.push(`ja "${UNITS}" doesn't say sample: ${ja[UNITS]}`);
  if (!/樣本/.test(zh[UNITS] ?? "")) bad.push(`zh-HK "${UNITS}" doesn't say sample: ${zh[UNITS]}`);
  assert.deepEqual(bad, []);
}
await check("every figure is labelled sample, in every language", () => figureChecks(VIEW, JA, ZH_HK));
await check("control: an unlabelled figure is caught", () => {
  const broken = [
    [VIEW.replace('t("Total")', 't("Total: 140 units")'), /a digit in page text: Total: 140 units/],
    [VIEW.replace('t("{n} sample units", { n: SAMPLE_TOTAL })', 't("{n} units", { n: SAMPLE_TOTAL })'), /a number outside "\{n\} sample units": \{n\} units/],
    [VIEW.replace('<b>{t("{n} sample units", { n: SAMPLE_TOTAL })}</b>', "<b>{SAMPLE_TOTAL}</b>"), /a figure rendered without t\(\)/],
    [VIEW.replace('t("Total")', 't("Total", { n: SAMPLE_TOTAL })'), /\{ n \} passed to Total/],
    [VIEW.replace('{ id: "A", used', '{ id: "1", used'), /sample key id "1" is not a letter/],
    [VIEW.replace("<b>{t(\"Total\")}</b>", "<b>Total 140</b>"), /JSX text with a digit: Total 140/],
  ];
  for (const [i, [b, re]] of broken.entries()) {
    assert.notEqual(b, VIEW, `figure control ${i}: anchor gone`);
    failsWith(() => figureChecks(b, JA, ZH_HK), re, `figure ${i}`);
  }
  failsWith(() => figureChecks(VIEW, { ...JA, [UNITS]: "{n} 単位" }, ZH_HK), /ja "\{n\} sample units" doesn't say sample/, "ja without sample");
  failsWith(() => figureChecks(VIEW, JA, { ...ZH_HK, [UNITS]: "{n} 個單位" }), /zh-HK "\{n\} sample units" doesn't say sample/, "zh-HK without sample");
});

// ── 4. Send opens only an explanation ─────────────────────────────────────────────────────────────
const NETWORK = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bWebSocket\b|\bEventSource\b|window\.open|\blocation\b|useRouter|\brouter\.|\bhistory\.|<form\b|<Link\b|localStorage|sessionStorage|indexedDB|\bsetUi\b|\bimport\s*\(|from\s+"\.\.\/lib\//;
function sendChecks(src, page) {
  for (const [f, s] of [["FutureView.tsx", src], ["page.tsx", page]]) {
    const m = NETWORK.exec(code(s));
    assert.ok(!m, `${f}: "${m?.[0]}" (a request, a navigation or storage)`);
  }
  const imports = [...code(src).matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["../try/i18n", "./future.module.css", "react"], "FutureView imports something else");
  const btn = code(src).match(/<button[^\n]*id="future-send"[^\n]*/);
  assert.ok(btn, "no send button (id=\"future-send\")");
  assert.ok(/\btype="button"/.test(btn[0]), "the send button is not type=\"button\"");
  assert.ok(/onClick=\{\(\) => setExplain\(true\)\}/.test(btn[0]), "the send button does more than open the explanation");
  assert.ok(!/\b(?:href|formAction)=/.test(btn[0]), "the send button navigates");
  // The explanation flag is set only to open/close it, and read only to show it.
  const sets = [...code(src).matchAll(/setExplain\(([^)]*)\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(sets, ["false", "true"], `setExplain used as ${sets.join(", ")}`);
  const reads = [...code(src).matchAll(/(?<!\.)\bexplain\b(?!\s*,)/g)].length;
  assert.equal(reads, 1, "explain is read somewhere besides showing the explanation");
  assert.ok(/\{explain && <Explanation /.test(src), "explain doesn't show the explanation");
  // The sample wallet is a constant: nothing reassigns or mutates it, and there is no other state.
  assert.ok(/const SAMPLE_KEYS = \[[\s\S]*?\] as const;/.test(src), "SAMPLE_KEYS is not a const tuple");
  assert.ok(!/(?<!const )SAMPLE_KEYS(?:\[[^\]]*\])?(?:\.\w+)?\s*=[^=]|SAMPLE_KEYS\.(?:push|pop|splice|shift|unshift)/.test(code(src)), "SAMPLE_KEYS is changed");
  assert.equal((code(src).match(/\buseState\b/g) ?? []).length, 2, "state other than the explanation flag (import + one useState)");
}
await check("the send button only opens an explanation: no request, navigation or storage; nothing pretends to move", () => sendChecks(VIEW, PAGE));
await check("control: a request, a navigation or a moved balance on send is caught", () => {
  const broken = [
    [VIEW.replace("onClick={() => setExplain(true)}", 'onClick={() => { setExplain(true); void navigator.sendBeacon("/tet-node-api/tx/submit"); }}'), PAGE, /FutureView.tsx: "sendBeacon"/],
    [VIEW.replace("onClick={() => setExplain(true)}", 'onClick={() => { setExplain(true); fetch("/tet-node-api/tx/submit"); }}'), PAGE, /FutureView.tsx: "fetch\("/],
    [VIEW.replace("onClick={() => setExplain(true)}", 'onClick={() => { window.location.href = "/try"; }}'), PAGE, /FutureView.tsx: "(?:window\.open|location)"/],
    [VIEW.replace("onClick={() => setExplain(true)}", "onClick={() => { setExplain(true); alert(1); }}"), PAGE, /the send button does more than open the explanation/],
    [VIEW.replace('type="button" id="future-send"', 'type="submit" id="future-send"'), PAGE, /the send button is not type="button"/],
    [VIEW.replace("{k.used ? t(\"nothing\")", "{explain || k.used ? t(\"nothing\")"), PAGE, /explain is read somewhere besides/],
    [VIEW.replace("  const [explain, setExplain] = useState(false);", "  const [explain, setExplain] = useState(false);\n  const [sent, setSent] = useState(0);"), PAGE, /state other than the explanation flag/],
    [VIEW.replace('  { id: "A", used: false, units: 100 },\n', '  { id: "A", used: false, units: 100 },\n').replace("const SAMPLE_TOTAL", "SAMPLE_KEYS[0].units = 0;\nconst SAMPLE_TOTAL"), PAGE, /SAMPLE_KEYS is changed/],
    [VIEW.replace('import { useState } from "react";', 'import { useState } from "react";\nimport { pickLang } from "../try/pick";'), PAGE, /FutureView imports something else/],
    [VIEW.replace('import { useState } from "react";', 'import { useState } from "react";\nimport { getUi } from "../lib/device_store";'), PAGE, /FutureView.tsx: "from "\.\.\/lib\//],
    [VIEW, PAGE.replace("export default function Future() {", 'export default function Future() {\n  void fetch("/x");'), /page.tsx: "fetch\("/],
  ];
  for (const [i, [v, p, re]] of broken.entries()) {
    assert.ok(v !== VIEW || p !== PAGE, `send control ${i}: anchor gone`);
    failsWith(() => sendChecks(v, p), re, `send ${i}`);
  }
});

// ── 5. The three links ────────────────────────────────────────────────────────────────────────────
function linkChecks(src) {
  for (const url of LINKS) {
    const name = code(src).match(new RegExp(`const (\\w+) = "${url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}";`))?.[1];
    assert.ok(name, `${url} is not on the page`);
    assert.ok(new RegExp(`<a href=\\{${name}\\} target="_blank" rel="noopener noreferrer"`).test(code(src)), `${url} is not linked`);
  }
}
await check("the research note, IACR ePrint 2025/486 and arXiv 2510.10899 are linked", () => linkChecks(VIEW));
await check("control: a missing or unlinked reference is caught", () => {
  const broken = [
    [VIEW.replace('2510.10899";', '2510.10898";'), /arxiv.org\/abs\/2510.10899 is not on the page/],
    [VIEW.replace("<a href={EPRINT_URL}", "<a href={NOTE_URL}"), /eprint.iacr.org\/2025\/486 is not linked/],
    [VIEW.replace("/docs/research/ONE_SHOT_TET.md", "/README.md"), /ONE_SHOT_TET.md is not on the page/],
  ];
  for (const [i, [b, re]] of broken.entries()) {
    assert.notEqual(b, VIEW, `link control ${i}: anchor gone`);
    failsWith(() => linkChecks(b), re, `link ${i}`);
  }
});

// ── 6 + 7. Wording ────────────────────────────────────────────────────────────────────────────────
const TOKEN_OK = ["No token exists.", "トークンは存在しません。", "不存在任何代幣。"];
const TOKEN = /token|トークン|代幣|代币/i;
export const BANNED = new RegExp(
  [
    "\\b(?:money|pay(?:s|ing|ment|ments|out)?|paid|coins?|funds?|cash|dollars?|currency|currencies)\\b",
    "\\b(?:price[sd]?|pricing|earn(?:s|ed|ing|ings)?|invest(?:s|ed|ing|ment|ments|or|ors)?|buy(?:s|ing)?|bought|purchase[sd]?|yield(?:s)?|profit(?:s|able)?|returns? on)\\b",
    "\\bprov(?:e|es|ed|en|ing|ably)\\b|\\bproofs?\\b",
    "untrace[a]b|untrack[a]b|\\banonymous\\b",
    "quantum[- ](?:proof|safe|secure|resistant)|unbreakable|\\bimpossible to (?:break|forge|copy)\\b",
    "\\bguarantee",
    "お金|支払|コイン|価格|値段|稼|投資|儲|利回り|購入|買|証明|追跡(?:不可能|できない|されない)|耐量子|量子耐性|保証|通貨|円",
    "金錢|付款|支付|硬幣|價格|價錢|賺|投資|收益|購買|買|證明|無法追[蹤]|不可追[蹤]|抗量子|保證|貨幣",
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
await check("control: a stray token and each kind of banned wording are caught", () => {
  const strays = ["Each key is a token.", "This proves who signed.", "A proof of the hand-over.", "Earn sample units.", "Invest in one-shot keys.", "Buy a key.", "Yield per key.", "Paid in sample units.", "A note that is not untraceable.", "Quantum-proof keys.", "AI cannot copy a key.", "Guaranteed once."];
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const s of strays) failsWith(() => wordingChecks(VIEW.replace('t("Total")', `t(${JSON.stringify(s)})`), PAGE, { ...JA, [s]: "x" }, { ...ZH_HK, [s]: "x" }), new RegExp(`FutureView.tsx: .*${esc(s.slice(0, 20))}`), s);
  for (const s of ["トークンで送る", "署名を証明します", "価格", "お金", "保証します", "耐量子の鍵"]) failsWith(() => wordingChecks(VIEW, PAGE, { ...JA, Total: s }, ZH_HK), new RegExp(`ja "Total": .*${esc(s)}`), s);
  for (const s of ["代幣", "證明", "賺取", "付款", "抗量子"]) failsWith(() => wordingChecks(VIEW, PAGE, JA, { ...ZH_HK, Total: s }), new RegExp(`zh-HK "Total": .*${esc(s)}`), s);
  failsWith(() => wordingChecks(VIEW, PAGE.replace("No token exists.", "No token exists yet; a token may come."), JA, ZH_HK), /page.tsx: "token" outside/, "page.tsx token");
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
