// Guard for /signin, "Sign in with TET" (app/signin; the prototype is tools/sign-in/signin.py).
//
//   node --experimental-strip-types scripts/signin_demo_guard.mjs [--keys]
//
// 1. The status line is at the very top, in English and Japanese, word for word.
// 2. "What a site sees" shows a key id, a challenge (domain, nonce, expires_seq) and a verdict, and
//    nothing else: siteSees() returns exactly those fields, drops anything else it is handed, and the
//    column's text never names anyone or says who.
// 3. Shows / Does not show equal tools/sign-in/README.md's lines word for word; the limit sentence
//    is the design's (docs/plans/SIGN_IN_WITH_TET.md).
// 4. The walkthrough is labelled as one, in English and Japanese, and sends nothing.
// 5. The page talks to 127.0.0.1 only: no other host in its source, one fetch target (challengeUrl),
//    no other network API, and the modules it imports use none.
// 6. Banned wording, in every language the page shows: "quantum-proof" / "quantum-resistant",
//    passwords (other than the device password), money (try_money_guard's own patterns),
//    prove/proof, untraceable, and AI.
// 7. "Your records" only reads browser storage: no write, no removal, anywhere on the page.
// 8. Every string the page shows has Japanese and Hong Kong Chinese, with the same {placeholders}.
// Every check has a control beside it: the same check, fed a broken input, must FAIL.
// `--keys` prints every key the page translates, with which dictionaries have it.

import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

const UI = new URL("../", import.meta.url);
const ROOT = new URL("../../../", import.meta.url);
const read = (u) => readFileSync(u, "utf8");

const T = await import("../app/signin/signin_text.ts");
const { JA } = await import("../app/try/i18n_ja.ts");
const { ZH_HK } = await import("../app/try/i18n_zh_hk.ts");

const DIR = new URL("app/signin/", UI);
const SOURCES = Object.fromEntries(readdirSync(DIR).filter((n) => /\.(?:tsx?|mjs)$/.test(n)).map((n) => [n, read(new URL(n, DIR))]));
const VIEW = SOURCES["SignInView.tsx"];
assert.ok(VIEW, "app/signin/SignInView.tsx is missing");

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
/** A control: `fn` must throw (the check catches the broken input). */
const caught = (fn, what) => assert.throws(fn, undefined, `control not caught: ${what}`);

/** Source without comment lines (comments never reach the page). */
const code = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
/** The text between `// <tag>` and `// </tag>` in the view. */
function block(src, tag) {
  const a = src.indexOf(`// <${tag}>`);
  const b = src.indexOf(`// </${tag}>`);
  assert.ok(a >= 0 && b > a, `no <${tag}> block in SignInView.tsx`);
  return src.slice(a, b);
}
/** The literal keys passed to t("…"). */
const literals = (src) => [...code(src).matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));

/** Every key the page translates: t("…") literals plus the constants it passes to t(). */
function pageKeys(view, text) {
  const keys = new Set(literals(view));
  for (const k of [text.STATUS_LINE, text.WALKTHROUGH_LABEL, text.LIMIT_LINE, ...text.SHOWS, ...text.DOES_NOT_SHOW, ...text.SCENARIOS.map((s) => s.what)]) keys.add(k);
  return keys;
}
const KEYS = pageKeys(VIEW, T);

if (process.argv.includes("--keys")) {
  for (const k of KEYS) console.log(`${JA[k] ? "J" : "-"}${ZH_HK[k] ? "Z" : "-"} ${JSON.stringify(k)}`);
  process.exit(0);
}

// ── 1. The status line ────────────────────────────────────────────────────────────────────────────
const STATUS_EN = "Status: prototype, design not reviewed, not for real logins.";
function statusAtTop(view, text, ja) {
  assert.equal(text.STATUS_LINE, STATUS_EN);
  assert.ok(typeof ja[text.STATUS_LINE] === "string" && /試作/.test(ja[text.STATUS_LINE]) && /ログイン/.test(ja[text.STATUS_LINE]), "no Japanese status line");
  const banner = view.slice(view.indexOf("function StatusBanner"), view.indexOf("export function SignInView"));
  assert.match(banner, /\{STATUS_LINE\}/, "the banner doesn't show the English line");
  assert.match(banner, /translate\("ja", STATUS_LINE\)/, "the banner doesn't show the Japanese line in every language");
  const root = view.slice(view.indexOf("export function SignInView"));
  const first = root.indexOf("<StatusBanner />");
  assert.ok(first > 0 && first < root.indexOf("<main") && first < root.indexOf("<header"), "the status banner isn't the first thing on the page");
}
await check("the status line is at the top, in English and Japanese", () => statusAtTop(VIEW, T, JA));
await check("control: a reworded line, a missing Japanese line, or a banner below the page is caught", () => {
  caught(() => statusAtTop(VIEW, { ...T, STATUS_LINE: "Status: beta." }, JA), "reworded");
  caught(() => statusAtTop(VIEW, T, { ...JA, [STATUS_EN]: undefined }), "no Japanese");
  caught(() => statusAtTop(VIEW.replace('<p lang="ja">{translate("ja", STATUS_LINE)}</p>', ""), T, JA), "Japanese not rendered");
  caught(() => statusAtTop(VIEW.replace("<StatusBanner />\n", "").replace("</main>", "<StatusBanner />\n</main>"), T, JA), "banner moved down");
});

// ── 2. What a site sees ───────────────────────────────────────────────────────────────────────────
const WHO_EN = /\b(?:who|whom|whose|names?|named|person|people|identity|identities|user|username|owner|holder|signed in as)\b/i;
const WHO_JA = /誰|名前|氏名|本人|身元|ユーザー/;
const WHO_ZH = /誰|名字|姓名|身分|身份|本人|用戶/;
function siteSeesOnlyTheFour(siteSees, scenarios) {
  for (const s of scenarios) {
    const v = siteSees({ ...s, name: "Alice Example", holder: "Alice Example", email: "alice@example.test" });
    assert.deepEqual(Object.keys(v), [...T.SITE_SEES_FIELDS], `${s.id}: fields ${Object.keys(v)}`);
    assert.ok(!JSON.stringify(v).includes("Alice"), `${s.id}: a name passed through`);
    assert.equal(v.domain, s.signed.domain);
    assert.equal(v.nonce, s.signed.nonce);
    assert.equal(v.expiresSeq, s.signed.expires_seq);
    assert.match(v.keyId, /^tet-ed25519:[0-9a-f]{64}$/);
    assert.equal(v.verdict, s.status === 200 ? "accepted" : `refused: ${JSON.parse(s.answer).refused}`);
  }
}
function columnSaysNoWho(view, ja, zh) {
  const col = block(view, "site-sees");
  const bad = [];
  for (const k of literals(col)) {
    if (WHO_EN.test(k)) bad.push(`en: ${k}`);
    if (WHO_JA.test(ja[k] ?? "")) bad.push(`ja: ${ja[k]}`);
    if (WHO_ZH.test(zh[k] ?? "")) bad.push(`zh-HK: ${zh[k]}`);
  }
  // JSX text outside t() (labels like expires_seq).
  for (const m of code(col).matchAll(/>([^<>{}]+)</g)) if (WHO_EN.test(m[1])) bad.push(`text: ${m[1].trim()}`);
  assert.deepEqual(bad, []);
  assert.ok(literals(col).includes("This key answered this challenge for this domain:"), "the column doesn't say what it shows");
  // Values come only from siteSees(): the scenario itself is read nowhere else.
  assert.deepEqual([...code(col).matchAll(/props\.s\b(?!\))/g)].map((m) => m[0]), [], "the column reads the scenario other than through siteSees()");
  for (const m of code(col).matchAll(/\{v\.(\w+)\}/g)) assert.ok(T.SITE_SEES_FIELDS.includes(m[1]), `shows v.${m[1]}`);
}
await check("SECURITY: what a site sees is a key id, a challenge and a verdict, nothing else", () => siteSeesOnlyTheFour(T.siteSees, T.SCENARIOS));
await check("control: a siteSees that passes the scenario's extras through is caught", () => {
  caught(() => siteSeesOnlyTheFour((s) => ({ ...T.siteSees(s), name: s.name }), T.SCENARIOS), "name field");
  caught(() => siteSeesOnlyTheFour((s) => ({ ...T.siteSees(s), verdict: `accepted as ${s.holder}` }), T.SCENARIOS), "name in verdict");
});
await check("SECURITY: the column never names anyone or says who", () => columnSaysNoWho(VIEW, JA, ZH_HK));
await check("control: a name or a who in the column is caught, in each language", () => {
  const add = (line) => VIEW.replace("// </site-sees>", `${line}\n// </site-sees>`);
  caught(() => columnSaysNoWho(add('{t("Signed in as {name}")}'), JA, ZH_HK), "signed in as");
  caught(() => columnSaysNoWho(add('{t("who answered")}'), JA, ZH_HK), "who");
  caught(() => columnSaysNoWho(VIEW, { ...JA, "key id": "本人の鍵" }, ZH_HK), "ja 本人");
  caught(() => columnSaysNoWho(VIEW, JA, { ...ZH_HK, "key id": "用戶名字" }), "zh 名字");
  caught(() => columnSaysNoWho(add("<dd>{props.s.what}</dd>"), JA, ZH_HK), "reads the scenario directly");
});

// ── 3. Shows / Does not show, and the limit sentence ──────────────────────────────────────────────
/** The bullets under a `## heading` of the README, as plain text (bold marks removed, lines joined). */
function readmeBullets(md, heading) {
  const lines = md.split("\n");
  const i = lines.indexOf(`## ${heading}`);
  assert.ok(i >= 0, `README has no "## ${heading}"`);
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (l.startsWith("## ")) break;
    if (l.startsWith("- ")) out.push(l.slice(2));
    else if (/^\s+\S/.test(l) && out.length) out[out.length - 1] += ` ${l.trim()}`;
  }
  return out.map((s) => s.replace(/\*\*/g, "").trim());
}
const README = read(new URL("tools/sign-in/README.md", ROOT));
function showsWordForWord(md, text, view) {
  assert.deepEqual(text.SHOWS, readmeBullets(md, "What it shows"));
  assert.deepEqual(text.DOES_NOT_SHOW, readmeBullets(md, "What it does not show"));
  assert.match(view, /\{t\("Shows"\)\}[\s\S]*SHOWS\.map\(\(x\) => \([\s\S]*\{t\(x\)\}[\s\S]*\{t\("Does not show"\)\}[\s\S]*DOES_NOT_SHOW\.map\(\(x\) => \([\s\S]*\{t\(x\)\}/, "the page doesn't render both lists");
}
await check("Shows / Does not show are tools/sign-in/README.md's lines, word for word", () => showsWordForWord(README, T, VIEW));
await check("control: a changed word, a dropped line, or a README change is caught", () => {
  caught(() => showsWordForWord(README, { ...T, SHOWS: ["This person answered this challenge for this domain, once, before it expired."] }, VIEW), "changed word");
  caught(() => showsWordForWord(README, { ...T, DOES_NOT_SHOW: T.DOES_NOT_SHOW.slice(0, 2) }, VIEW), "dropped line");
  caught(() => showsWordForWord(README.replace("Anyone with the 12 words can answer.", "Only you can answer."), T, VIEW), "README changed");
  caught(() => showsWordForWord(README, T, VIEW.replace("DOES_NOT_SHOW.map", "[].map")), "list not rendered");
});
// The design wraps its lines; compare with whitespace runs folded to one space.
const DESIGN = read(new URL("docs/plans/SIGN_IN_WITH_TET.md", ROOT)).replace(/\s+/g, " ");
function limitLine(design, text, view) {
  assert.ok(design.includes(`"${text.LIMIT_LINE}"`), "not the design's limit sentence");
  assert.match(view, /\{t\(LIMIT_LINE\)\}/, "the page doesn't show the limit sentence");
}
await check("the limit sentence is the design's, and it is on the page", () => limitLine(DESIGN, T, VIEW));
await check("control: a different limit sentence, or none on the page, is caught", () => {
  caught(() => limitLine(DESIGN, { ...T, LIMIT_LINE: "If you lose your passphrase (12 words), support can help." }, VIEW), "reworded");
  caught(() => limitLine(DESIGN, T, VIEW.replace("{t(LIMIT_LINE)}", "")), "not shown");
});

// ── 4. The walkthrough is labelled as one, and sends nothing ──────────────────────────────────────
const LABEL_EN = "Walkthrough: no server, nothing is signed or sent";
function walkthroughLabelled(view, text, ja) {
  assert.equal(text.WALKTHROUGH_LABEL, LABEL_EN);
  assert.ok(/ウォークスルー|説明/.test(ja[LABEL_EN] ?? "") && /送/.test(ja[LABEL_EN] ?? ""), "no Japanese label");
  const w = view.slice(view.indexOf("function Walkthrough"), view.indexOf("// <site-sees>"));
  assert.ok(w.length > 100, "no Walkthrough component");
  const h = w.indexOf('<h2 id="walk"');
  assert.ok(h > 0 && w.indexOf("{WALKTHROUGH_LABEL}") > h && w.indexOf("{WALKTHROUGH_LABEL}") < w.indexOf("</h2>", h), "the walkthrough's heading isn't the label");
  assert.match(w, /translate\("ja", WALKTHROUGH_LABEL\)/, "no Japanese label on the walkthrough");
  assert.doesNotMatch(code(w), /\bfetch\s*\(|probe\s*\(|XMLHttpRequest|sendBeacon/, "the walkthrough sends something");
}
await check("the walkthrough is labelled as one, in English and Japanese, and sends nothing", () => walkthroughLabelled(VIEW, T, JA));
await check("control: an unlabelled walkthrough, or one that sends, is caught", () => {
  caught(() => walkthroughLabelled(VIEW.replace("{WALKTHROUGH_LABEL}\n", '{t("How it works")}\n'), T, JA), "label replaced");
  caught(() => walkthroughLabelled(VIEW, { ...T, WALKTHROUGH_LABEL: "Walkthrough" }, JA), "label reworded");
  caught(() => walkthroughLabelled(VIEW.replace('<p lang="ja" className="text-[15px] font-semibold text-[#1c1f23]">\n        {translate("ja", WALKTHROUGH_LABEL)}', "<p>"), T, JA), "no Japanese");
  caught(() => walkthroughLabelled(VIEW.replace("const { s } = props;", 'const { s } = props;\n  void fetch("http://127.0.0.1:8765/signin");'), T, JA), "sends");
});

// ── 5. The page talks to 127.0.0.1 only ───────────────────────────────────────────────────────────
const NET_API = /\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\bimportScripts\b|\bnew\s+Worker\b|<form\b|<iframe\b|<img\b|<script\b|\bwindow\.open\s*\(|\blocation\.(?:href|assign|replace)\b/;
const IMPORTS_OK = new Set(["react", "next", "../lib/device_store", "../try/i18n", "../try/ui", "./signin_text", "./SignInView"]);
function onlyLoopback(sources, text, readImport) {
  const bad = [];
  for (const [f, src] of Object.entries(sources)) {
    const c = code(src);
    for (const m of c.matchAll(/\b(?:https?|wss?):\/\/([^/:"'`\s)]+)/g)) if (m[1] !== "127.0.0.1" && m[1] !== "${SIGNIN_HOST}") bad.push(`${f}: host ${m[1]}`);
    for (const m of c.matchAll(/\bfetch\s*\(\s*([^,)]+)/g)) if (m[1].trim() !== "url") bad.push(`${f}: fetch(${m[1].trim()})`);
    if (/\bfetch\s*\(/.test(c) && !/const url = challengeUrl\(port\);/.test(c)) bad.push(`${f}: fetch without challengeUrl`);
    if (NET_API.test(c)) bad.push(`${f}: ${c.match(NET_API)[0]}`);
    for (const m of c.matchAll(/^import[^"]*"([^"]+)"/gm)) {
      if (!IMPORTS_OK.has(m[1])) bad.push(`${f}: imports ${m[1]}`);
      else if (m[1].startsWith("../")) {
        const dep = code(readImport(m[1]));
        if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(dep)) bad.push(`${f}: ${m[1]} uses the network`);
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.equal(text.SIGNIN_HOST, "127.0.0.1");
  assert.equal(text.challengeUrl(8765), "http://127.0.0.1:8765/challenge");
  for (const p of ["8765@evil.test", "80/x", "0", "65536", "-1", "1e3", " 8765 x"]) assert.equal(text.asPort(p), null, `port ${p}`);
  assert.throws(() => text.challengeUrl("8765@evil.test"));
}
const readImport = (spec) => {
  for (const ext of [".ts", ".tsx", ".mjs"]) {
    try {
      return read(new URL(`app/${spec.replace(/^\.\.\//, "")}${ext}`, UI));
    } catch {
      /* next extension */
    }
  }
  throw new Error(`can't read ${spec}`);
};
await check("SECURITY: the page talks to 127.0.0.1 only", () => onlyLoopback(SOURCES, T, readImport));
await check("control: another host, another fetch target, another network API or import is caught", () => {
  const v = (from, to) => ({ ...SOURCES, "SignInView.tsx": VIEW.replace(from, to) });
  caught(() => onlyLoopback(v('href="/try?tab=verify"', 'href="https://tetnet.org/try?tab=verify"'), T, readImport), "https host");
  caught(() => onlyLoopback(v("const r = await fetch(url,", 'const r = await fetch("/tet-node-api/challenge",'), T, readImport), "relative fetch");
  caught(() => onlyLoopback(v("setTimeout(() => c.abort(), 3000);", "setTimeout(() => c.abort(), 3000); new WebSocket(u);"), T, readImport), "WebSocket");
  caught(() => onlyLoopback(v('import { FOCUS, INK, MONO, cx } from "../try/ui";', 'import { FOCUS, INK, MONO, cx } from "../try/ui";\nimport { BASE } from "../try/wallet";'), T, readImport), "import");
  caught(() => onlyLoopback(SOURCES, { ...T, challengeUrl: (p) => `http://localhost:${p}/challenge` }, readImport), "challengeUrl host");
  caught(() => onlyLoopback(SOURCES, T, (s) => (s === "../try/ui" ? 'fetch("https://x")' : readImport(s))), "an import that fetches");
});

// ── 6. Banned wording, in every language shown ────────────────────────────────────────────────────
/** try_money_guard's own patterns, read from its source so the two can't drift apart. */
function moneyPatterns() {
  const src = read(new URL("scripts/try_money_guard.mjs", UI));
  const arr = src.slice(src.indexOf("export const MONEY = new RegExp("), src.indexOf('].join("|"),'));
  const parts = [...code(arr).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
  assert.ok(parts.length >= 6, "couldn't read try_money_guard's MONEY");
  const w = src.match(/export const MONEY_WORDS = \/(.+)\/i;/);
  assert.ok(w, "couldn't read try_money_guard's MONEY_WORDS");
  return [new RegExp(parts.join("|"), "i"), new RegExp(w[1], "i")];
}
const BANNED = [
  /quantum[- ]?(?:proof|safe|resistant|resistance)|耐量子|量子耐性|抗量子/i,
  /\bpasswords?\b(?<!device passwords?)|(?<!端末)パスワード|(?<!裝置)密碼/i,
  /\bprov(?:e|es|ed|en|ing)\b|\bproofs?\b|証明|證明/i,
  /untraceab|\bunlinkable\b|追跡(?:不可能|できない|されない)|無法追蹤|不可追蹤/i,
  /\bA\.?I\b|人工知能|人工智能/,
  ...moneyPatterns(),
];
/** Everything the page can show: its source text (comments out) and every key's translations. */
function shownText(sources, keys, ja, zh) {
  const out = Object.entries(sources).map(([f, s]) => [f, code(s)]);
  for (const k of keys) out.push(["ja", ja[k] ?? ""], ["zh-HK", zh[k] ?? ""]);
  return out;
}
function noBannedWording(entries) {
  const bad = [];
  for (const [f, s] of entries) for (const re of BANNED) { const m = s.match(re); if (m) bad.push(`${f}: "${m[0]}"`); }
  assert.deepEqual(bad, []);
}
await check("no quantum-proof / password / money / prove / untraceable / AI wording, in any language", () => noBannedWording(shownText(SOURCES, KEYS, JA, ZH_HK)));
await check("control: each banned phrase is caught; the device password is not", () => {
  for (const s of ["a quantum-proof login", "fully quantum-resistant", "TET checks your password", "TET stores passwords", "Earn TET by signing in", "pay with TET", "this proves who you are", "a proof of identity", "untraceable sign-in", "AI can't sign in", "パスワードを TET が保管", "誰かを証明", "追跡不可能", "支払い", "價格", "TET 會檢查密碼"]) {
    caught(() => noBannedWording([["x", s]]), s);
  }
  noBannedWording([["x", "An ID remembered on this device, encrypted with your device password: yes"], ["ja", "端末パスワード"], ["zh", "裝置密碼"]]);
});

// ── 7. Your records only reads ────────────────────────────────────────────────────────────────────
const WRITES = /\.setItem\s*\(|\.removeItem\s*\(|\.clear\s*\(|\bsetUi\b|\brememberKey\b|\bforgetDevice\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie|\bcaches\b|\bsetLang\b|\bLangSwitch\b/;
function readsOnly(sources, view) {
  const bad = Object.entries(sources).filter(([, s]) => WRITES.test(code(s))).map(([f, s]) => `${f}: ${code(s).match(WRITES)[0]}`);
  assert.deepEqual(bad, []);
  const imp = view.match(/import \{([^}]*)\} from "\.\.\/lib\/device_store";/);
  assert.ok(imp, "the records column doesn't read device_store");
  assert.deepEqual(imp[1].split(",").map((s) => s.trim()).filter(Boolean).sort(), ["getUi", "hasRememberedKey"]);
  const rec = block(view, "your-records");
  assert.match(rec, /getUi\("tet\.ui\.v1\.lang"\)/, "the records column doesn't read the existing storage");
}
await check("SECURITY: \"Your records\" only reads browser storage; the page writes and removes nothing", () => readsOnly(SOURCES, VIEW));
await check("control: a write, a removal, a language switch that stores, or a wider import is caught", () => {
  const v = (from, to) => [{ ...SOURCES, "SignInView.tsx": VIEW.replace(from, to) }, VIEW.replace(from, to)];
  const at = "const t0 = setTimeout(() => setKept(readKept()), 0);";
  caught(() => readsOnly(...v(at, `${at} window.localStorage.setItem("tet.records", "1");`)), "setItem");
  caught(() => readsOnly(...v(at, `${at} window.localStorage.removeItem("tet.vault.v1");`)), "removeItem");
  caught(() => readsOnly(...v('import { getUi, hasRememberedKey } from "../lib/device_store";', 'import { getUi, hasRememberedKey, forgetDevice } from "../lib/device_store";')), "forgetDevice import");
  caught(() => readsOnly(...v("const { t, lang } = useLang();\n  const [s, setS]", "const { t, lang, setLang } = useLang();\n  const [s, setS]")), "setLang");
});

// ── 8. Every string has Japanese and Hong Kong Chinese ────────────────────────────────────────────
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
function translated(keys, ja, zh) {
  const bad = [];
  for (const k of keys) {
    for (const [n, d] of [["ja", ja], ["zh-HK", zh]]) {
      const v = d[k];
      if (typeof v !== "string" || !v.trim()) bad.push(`${n}: missing "${k}"`);
      else if (placeholders(v) !== placeholders(k)) bad.push(`${n}: placeholders differ for "${k}"`);
    }
  }
  assert.deepEqual(bad.slice(0, 20), []);
}
await check(`every string on /signin has Japanese and Hong Kong Chinese (${KEYS.size} strings)`, () => translated(KEYS, JA, ZH_HK));
await check("control: a missing translation or a dropped placeholder is caught", () => {
  const k = "Check {host}:{port}";
  caught(() => translated([k], { ...JA, [k]: undefined }, ZH_HK), "missing ja");
  caught(() => translated([k], JA, { ...ZH_HK, [k]: "檢查 {host}" }), "dropped placeholder");
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
