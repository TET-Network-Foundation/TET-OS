// Guard for /signin, "Sign in with TET" (app/signin; the prototype is tools/sign-in/signin.py).
//
//   node --experimental-strip-types scripts/signin_demo_guard.mjs [--keys]
//
// 1. The status line is at the very top, in English and Japanese, word for word; under the title,
//    one plain sentence (LEAD) says what the page is for, in English and Japanese, word for word.
// 2. "What a site sees" shows a key id, a challenge (domain, nonce, expires_seq) and a verdict, and
//    nothing else: siteSees() returns exactly those fields, drops anything else it is handed, and the
//    column's text never names anyone or says who.
// 3. Shows / Does not show equal tools/sign-in/README.md's lines word for word; the limit sentence
//    is the design's (docs/plans/SIGN_IN_WITH_TET.md).
// 4. "Try with a sample" is the one primary button; it plays the bundled recording step by step and
//    sends nothing; the sample is labelled as a recording, in English and Japanese.
// 5. The page talks to 127.0.0.1 only: no other host in its source, one fetch target (challengeUrl),
//    no other network API, and the modules it imports use none.
// 6. Banned wording, in every language the page shows: "quantum-proof" / "quantum-resistant",
//    passwords (other than the device password), money (try_money_guard's own patterns),
//    prove/proof, untraceable, and AI.
// 7. "Your records" only reads browser storage: no write, no removal, anywhere on the page.
// 8. Every string the page shows has Japanese and Hong Kong Chinese, with the same {placeholders}.
// 9. The result comes first: each case's label (ACCEPTED / REFUSED) and one short sentence, read
//    from the server's recorded answer; the server's own words only behind "Show details"; Shows /
//    Does not show on every result.
// 10. Technical words (envelope, nonce, canonical, payload type, AgentSigEnvelopeV1, in every
//    language) appear only behind "Show details", and the fold starts closed.
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

/** The constants the page passes to t(): never behind a fold, so they must be plain everywhere. */
const constKeys = (text) => [text.STATUS_LINE, text.LEAD, text.SAMPLE_LABEL, text.LIMIT_LINE, ...text.SHOWS, ...text.DOES_NOT_SHOW, ...text.SCENARIOS.map((s) => s.what), ...Object.values(text.VERDICT_SENTENCES)];
/** Every key the page translates: t("…") literals plus the constants it passes to t(). */
function pageKeys(view, text) {
  const keys = new Set(literals(view));
  for (const k of constKeys(text)) keys.add(k);
  return keys;
}
const KEYS = pageKeys(VIEW, T);

if (process.argv.includes("--keys")) {
  for (const k of KEYS) console.log(`${JA[k] ? "J" : "-"}${ZH_HK[k] ? "Z" : "-"} ${JSON.stringify(k)}`);
  process.exit(0);
}

// ── 1. The status line, and the lead sentence ─────────────────────────────────────────────────────
const STATUS_EN = "Status: prototype, design not reviewed, not for real logins.";
function statusAtTop(view, text, ja) {
  assert.equal(text.STATUS_LINE, STATUS_EN);
  assert.ok(typeof ja[text.STATUS_LINE] === "string" && /試作/.test(ja[text.STATUS_LINE]) && /ログイン/.test(ja[text.STATUS_LINE]), "no Japanese status line");
  const line = view.slice(view.indexOf("function StatusLine"), view.indexOf("export function SignInView"));
  assert.match(line, /\{STATUS_LINE\}/, "the status line doesn't show the English line");
  assert.match(line, /translate\("ja", STATUS_LINE\)/, "the status line doesn't show the Japanese line in every language");
  const root = code(view.slice(view.indexOf("export function SignInView")));
  const page = root.indexOf("<PlainPage>");
  assert.ok(page > 0, "no <PlainPage>");
  const first = root.slice(page + "<PlainPage>".length).trimStart();
  assert.ok(first.startsWith("<PlainLead status={<StatusLine />}"), "the status line isn't the first thing on the page");
}
await check("the status line is at the top, in English and Japanese", () => statusAtTop(VIEW, T, JA));
await check("control: a reworded line, a missing Japanese line, or a status line below the page is caught", () => {
  caught(() => statusAtTop(VIEW, { ...T, STATUS_LINE: "Status: beta." }, JA), "reworded");
  caught(() => statusAtTop(VIEW, T, { ...JA, [STATUS_EN]: undefined }), "no Japanese");
  caught(() => statusAtTop(VIEW.replace('<span lang="ja">{translate("ja", STATUS_LINE)}</span>', ""), T, JA), "Japanese not rendered");
  caught(() => statusAtTop(VIEW.replace("<PlainPage>\n", '<PlainPage>\n      <nav aria-label="x" />\n'), T, JA), "something above the status line");
});

const LEAD_EN = "This page shows how a website can check that your key answered its question, without learning who you are.";
const LEAD_JA = "このページでは、ウェブサイトがあなたが誰かを知らないまま、自分の質問にあなたの鍵が答えたことを確かめる仕組みを見られます。";
function leadSentence(view, text, ja) {
  assert.equal(text.LEAD, LEAD_EN, "the lead sentence changed");
  assert.equal(ja[text.LEAD], LEAD_JA, "the Japanese lead sentence changed");
  assert.match(code(view), /<PlainLead status=\{<StatusLine \/>\} title=\{t\("Sign in with TET"\)\} lead=\{t\(LEAD\)\} \/>/, "the lead sentence isn't the PlainLead's lead");
}
await check("the lead sentence says what the page is for, in English and Japanese, under the title", () => leadSentence(VIEW, T, JA));
await check("control: a reworded lead, a changed Japanese lead, or a lead not shown is caught", () => {
  caught(() => leadSentence(VIEW, { ...T, LEAD: "Sign in with TET, the post-quantum login." }, JA), "reworded");
  caught(() => leadSentence(VIEW, T, { ...JA, [LEAD_EN]: "TET でサインイン。" }), "Japanese reworded");
  caught(() => leadSentence(VIEW.replace("lead={t(LEAD)}", 'lead={t("Sign in with TET")}'), T, JA), "not shown");
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
  assert.ok(literals(col).includes("This key answered this question for this site:"), "the column doesn't say what it shows");
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
  caught(() => columnSaysNoWho(VIEW, { ...JA, key: "本人の鍵" }, ZH_HK), "ja 本人");
  caught(() => columnSaysNoWho(VIEW, JA, { ...ZH_HK, key: "用戶名字" }), "zh 名字");
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
  // On every result: the one ShowsBlock sits inside the one ResultCard, which every case renders.
  const c = code(view);
  const rc = c.slice(c.indexOf("<ResultCard"), c.indexOf("</ResultCard>"));
  assert.equal(c.split("<ResultCard").length, 2, "not exactly one ResultCard");
  assert.match(rc, /<ShowsBlock showsTitle=\{t\("Shows"\)\} doesNotTitle=\{t\("Does not show"\)\} shows=\{SHOWS\.map\(\(x\) => t\(x\)\)\} doesNot=\{DOES_NOT_SHOW\.map\(\(x\) => t\(x\)\)\} \/>/, "the result doesn't show both lists");
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

// ── 4. "Try with a sample" plays the bundled recording and sends nothing ────────────────────────────
const SAMPLE_EN = "Sample: a recording of a real run. This page signs nothing and sends nothing.";
const SENDS = /\bfetch\s*\(|\bprobe\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\bimport\s*\(|challengeUrl|<LiveCheck/;
function samplePlaysBundledOnly(view, text, ja) {
  assert.equal(text.SAMPLE_LABEL, SAMPLE_EN);
  assert.ok(/サンプル/.test(ja[SAMPLE_EN] ?? "") && /送/.test(ja[SAMPLE_EN] ?? ""), "no Japanese label");
  const c = code(view);
  const sample = code(block(view, "sample"));
  // One primary button on the page, in the sample block, labelled, playing the bundled first case.
  assert.equal(c.split("<PrimaryButton").length, 2, "not exactly one primary button");
  assert.match(sample, /<PrimaryButton onClick=\{\(\) => play\(SCENARIOS\[0\]\)\}>\{t\("Try with a sample"\)\}<\/PrimaryButton>/, "the primary button isn't \"Try with a sample\" playing the recording");
  assert.match(sample, /\{t\(SAMPLE_LABEL\)\}/, "the sample isn't labelled as a recording");
  assert.doesNotMatch(sample, SENDS, "the sample sends something");
  // play() itself: sets the case and the step, on timers; nothing else.
  const play = c.slice(c.indexOf("const play = (x: Scenario) => {"), c.indexOf("return (", c.indexOf("const play = (x: Scenario) => {")));
  assert.ok(play.length > 40, "no play()");
  assert.doesNotMatch(play, SENDS, "play() sends something");
  const calls = [...play.matchAll(/(\w+)\s*(?:\?\.)?\(/g)].map((m) => m[1]);
  for (const f of calls) assert.ok(["if", "forEach", "setS", "setStep", "setTimeout", "matchMedia", "clearTimeout"].includes(f), `play() calls ${f}`);
  // Every case's data is bundled: the recording parses, and its verdict is computed from it here.
  for (const s of text.SCENARIOS) {
    JSON.parse(s.served);
    JSON.parse(s.answer);
    assert.ok(text.verdict(s).label, `${s.id}: no verdict`);
  }
}
await check("the sample button plays the bundled recording step by step and sends nothing", () => samplePlaysBundledOnly(VIEW, T, JA));
await check("control: a sample that fetches, a play() that probes, a second primary button, or an unlabelled sample is caught", () => {
  caught(() => samplePlaysBundledOnly(VIEW.replace("const v = verdict(s);", 'const v = verdict(s);\n  void fetch("http://127.0.0.1:8765/challenge");'), T, JA), "sample fetches");
  caught(() => samplePlaysBundledOnly(VIEW.replace("setS(x);", "setS(x);\n    void probe(8765);"), T, JA), "play probes");
  caught(() => samplePlaysBundledOnly(VIEW.replace("setS(x);", "setS(x);\n    void challengeUrl(8765);"), T, JA), "play calls challengeUrl");
  caught(() => samplePlaysBundledOnly(VIEW.replace("<SecondaryButton onClick={props.live}>", "<PrimaryButton onClick={props.live}>").replace("{t(\"Or check a server on this computer\")}</SecondaryButton>", "{t(\"Or check a server on this computer\")}</PrimaryButton>"), T, JA), "second primary");
  caught(() => samplePlaysBundledOnly(VIEW.replace("{t(SAMPLE_LABEL)}", ""), T, JA), "label not shown");
  caught(() => samplePlaysBundledOnly(VIEW, { ...T, SAMPLE_LABEL: "Sample" }, JA), "label reworded");
});

// ── 5. The page talks to 127.0.0.1 only ───────────────────────────────────────────────────────────
const NET_API = /\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\bimportScripts\b|\bnew\s+Worker\b|<form\b|<iframe\b|<img\b|<script\b|\bwindow\.open\s*\(|\blocation\.(?:href|assign|replace)\b/;
const IMPORTS_OK = new Set(["react", "next", "../lib/device_store", "../try/i18n", "../components/plain/Plain", "./signin_text", "./SignInView"]);
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
  caught(() => onlyLoopback(v('import { translate, useLang } from "../try/i18n";', 'import { translate, useLang } from "../try/i18n";\nimport { BASE } from "../try/wallet";'), T, readImport), "import");
  caught(() => onlyLoopback(SOURCES, { ...T, challengeUrl: (p) => `http://localhost:${p}/challenge` }, readImport), "challengeUrl host");
  caught(() => onlyLoopback(SOURCES, T, (s) => (s === "../components/plain/Plain" ? 'fetch("https://x")' : readImport(s))), "an import that fetches");
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

// ── 9. The result first ───────────────────────────────────────────────────────────────────────────
const SENTENCES = {
  accepted: "The site accepted this answer",
  used: "Refused: this answer was already used",
  site: "Refused: the answer was for another site",
  expired: "Refused: the question had expired",
  other: "Refused: the site did not accept this answer",
};
/** What each recorded case must read as, from the server's own reason (not the case's name). */
const EXPECT = { accepted: ["ACCEPTED", "ok", "accepted"], replay: ["REFUSED", "bad", "used"], domain: ["REFUSED", "bad", "site"], expired: ["REFUSED", "bad", "expired"] };
/** Fold regions in code(view): <Details …>…</Details> and details={…}. */
function folds(c) {
  const out = [];
  for (let i = c.indexOf("<Details"); i >= 0; i = c.indexOf("<Details", i + 1)) out.push([i, c.indexOf("</Details>", i)]);
  for (let i = c.indexOf("details={"); i >= 0; i = c.indexOf("details={", i + 1)) {
    let d = 0;
    let j = i + "details=".length;
    for (; j < c.length; j++) {
      if (c[j] === "{") d++;
      else if (c[j] === "}" && --d === 0) break;
    }
    out.push([i, j]);
  }
  for (const [a, b] of out) assert.ok(b > a, "an unclosed fold");
  return out;
}
const inFold = (fs, i) => fs.some(([a, b]) => i > a && i < b);
function resultFirst(view, text, ja, zh) {
  assert.deepEqual({ ...text.VERDICT_SENTENCES }, SENTENCES, "the result sentences changed");
  for (const s of text.SCENARIOS) {
    const [label, tone, key] = EXPECT[s.id];
    const v = text.verdict(s);
    assert.deepEqual([v.label, v.tone, v.sentence], [label, tone, SENTENCES[key]], `${s.id}: ${JSON.stringify(v)}`);
    // The same recording with the server's verdict flipped reads the other way: it is read from the answer.
    const flipped = s.status === 200 ? { ...s, status: 403, answer: '{"refused": "nonce: already used"}' } : { ...s, status: 200, answer: '{"accepted": true}' };
    assert.notEqual(text.verdict(flipped).label, label, `${s.id}: the verdict ignores the answer`);
  }
  for (const k of Object.values(SENTENCES)) {
    const refused = k.startsWith("Refused");
    assert.ok(refused ? /拒否/.test(ja[k] ?? "") : /受け入れ/.test(ja[k] ?? ""), `ja: ${k}`);
    assert.ok(refused ? /拒絕/.test(zh[k] ?? "") : /接受/.test(zh[k] ?? ""), `zh-HK: ${k}`);
  }
  const c = code(view);
  const rc = c.slice(c.indexOf("<ResultCard"), c.indexOf("</ResultCard>"));
  assert.match(rc, /tone=\{v\.tone\}\s+label=\{v\.label\}\s+sentence=\{t\(v\.sentence\)\}/, "the label and the sentence aren't the result's first line");
  assert.match(c, /const v = verdict\(s\);/, "the result isn't verdict(s)");
  const fs = folds(c);
  // The server's own words (status and answer) only behind the fold.
  for (const re of [/\{s\.answer\}/g, /\{s\.served\}/g, /\{v\.verdict\}/g, /status: s\.status/g]) {
    const hits = [...c.matchAll(re)];
    assert.ok(hits.length > 0 || re.source.includes("served") === false, `no ${re.source}`);
    for (const m of hits) assert.ok(inFold(fs, m.index), `${m[0]} outside "Show details"`);
  }
  assert.ok(!inFold(fs, c.indexOf("sentence={t(v.sentence)}")), "the sentence is behind the fold");
  assert.ok(!inFold(fs, c.indexOf("label={v.label}")), "the label is behind the fold");
}
await check("each case's label and short sentence come first, read from the recorded answer; details behind the fold", () => resultFirst(VIEW, T, JA, ZH_HK));
await check("control: a verdict from the case name, a reworded sentence, the answer out of the fold, or the sentence into it is caught", () => {
  caught(() => resultFirst(VIEW, { ...T, verdict: (s) => (s.id === "accepted" ? { label: "ACCEPTED", tone: "ok", sentence: SENTENCES.accepted } : { label: "REFUSED", tone: "bad", sentence: SENTENCES[{ replay: "used", domain: "site", expired: "expired" }[s.id]] }) }, JA, ZH_HK), "verdict from the case name");
  caught(() => resultFirst(VIEW, { ...T, verdict: (s) => ({ ...T.verdict(s), label: "REFUSED" }) }, JA, ZH_HK), "wrong label");
  caught(() => resultFirst(VIEW, { ...T, VERDICT_SENTENCES: { ...T.VERDICT_SENTENCES, used: "Refused: nonce reuse" } }, JA, ZH_HK), "reworded sentence");
  caught(() => resultFirst(VIEW.replace("<SamplePlayer s={s} step={step} />", "<SamplePlayer s={s} step={step} />\n      <pre>{s.answer}</pre>"), T, JA, ZH_HK), "answer outside the fold");
  caught(() => resultFirst(VIEW.replace("sentence={t(v.sentence)}", "sentence={null}").replace("details={\n", "details={\n              <>{t(v.sentence)}</>\n"), T, JA, ZH_HK), "sentence moved into the fold");
  caught(() => resultFirst(VIEW, T, { ...JA, [SENTENCES.site]: "別のサイト" }, ZH_HK), "Japanese without 拒否");
});

// ── 10. Technical words only behind "Show details" ──────────────────────────────────────────────────
const JARGON = /envelope|\bnonces?\b|canonical|payload[ -]?types?|AgentSigEnvelope|エンベロープ|ノンス|正規形|ペイロード|封包|隨機數/i;
/** Rendered things that carry the recording's raw words. */
const RAW = /\{s\.served\}|\{s\.answer\}|\{canonical\(|\{deviceCommand\(|\{v\.nonce\}|\{v\.verdict\}|\{PAYLOAD_TYPE\}/g;
function jargonOnlyInFolds(view, text, ja, zh, plain) {
  const c = code(view);
  const fs = folds(c);
  const bad = [];
  const jargon = (k) => JARGON.test(k) || JARGON.test(ja[k] ?? "") || JARGON.test(zh[k] ?? "");
  for (const m of c.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    const k = JSON.parse(`"${m[1]}"`);
    if (jargon(k) && !inFold(fs, m.index)) bad.push(`t("${k.slice(0, 50)}")`);
  }
  for (const m of c.matchAll(/>([^<>{}]+)</g)) if (JARGON.test(m[1]) && !inFold(fs, m.index)) bad.push(`text: ${m[1].trim()}`);
  for (const m of c.matchAll(RAW)) if (!inFold(fs, m.index)) bad.push(m[0]);
  for (const k of constKeys(text)) if (jargon(k)) bad.push(`constant: ${k.slice(0, 50)}`);
  assert.deepEqual(bad, []);
  // The fold starts closed (the kit's Details): what is behind it is not on the surface.
  assert.match(plain, /export function Details[\s\S]*?useState\(false\)/, "Details doesn't start closed");
  assert.ok(fs.length >= 4, `only ${fs.length} folds`);
}
const PLAIN_KIT = read(new URL("app/components/plain/Plain.tsx", UI));
await check("envelope / nonce / canonical / payload type / AgentSigEnvelopeV1 appear only behind \"Show details\", in every language", () => jargonOnlyInFolds(VIEW, T, JA, ZH_HK, PLAIN_KIT));
await check("control: a technical word on the surface, in English, Japanese, a constant or raw data, or a fold that starts open, is caught", () => {
  const at = '<p className={quiet}>{t("example.test sends your device a one-time question to sign.")}</p>';
  caught(() => jargonOnlyInFolds(VIEW.replace(at, `${at}\n          <p>{t("The device signs the envelope.")}</p>`), T, JA, ZH_HK, PLAIN_KIT), "en t()");
  caught(() => jargonOnlyInFolds(VIEW, T, { ...JA, "2. Your key answers": "2. 鍵がエンベロープを返します" }, ZH_HK, PLAIN_KIT), "ja");
  caught(() => jargonOnlyInFolds(VIEW, T, JA, { ...ZH_HK, "1. The site asks a question": "1. 網站發出隨機數" }, PLAIN_KIT), "zh-HK");
  caught(() => jargonOnlyInFolds(VIEW, { ...T, LEAD: "A website checks a canonical challenge." }, JA, ZH_HK, PLAIN_KIT), "constant");
  caught(() => jargonOnlyInFolds(VIEW.replace(at, `${at}\n          <pre className={pre}>{canonical(s.signed)}</pre>`), T, JA, ZH_HK, PLAIN_KIT), "raw bytes on the surface");
  caught(() => jargonOnlyInFolds(VIEW.replace(at, `${at}\n          <p>nonce</p>`), T, JA, ZH_HK, PLAIN_KIT), "JSX text");
  caught(() => jargonOnlyInFolds(VIEW, T, JA, ZH_HK, PLAIN_KIT.replace("const [open, setOpen] = useState(false);", "const [open, setOpen] = useState(true);")), "fold starts open");
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
