// Guard for the offline notice page (deploy/notice/index.html), served at tetnet.org while there is
// no host. One static file, English and Japanese.
//
//   node scripts/notice_page_guard.mjs
//
// 1. Nothing runs and nothing is loaded: no <script>, no event handlers, no javascript: URLs, no
//    <link>/<img>/<iframe>/<object>/<embed>/<form>, no @import or url(); the only URLs are links
//    to the TET repository on GitHub; a Content-Security-Policy of default-src 'none'. No trackers
//    by construction. Controls: a script, an external image, a tracker link.
// 2. Both languages say each thing the page is for: offline; the account closed after a late
//    payment; the servers and their data are gone; signatures made earlier still check offline;
//    "before block N" on the old chain can't be checked against a live node; a new test chain is
//    planned; the GitHub link. Control: a page without the Japanese section.
// 3. The site's wording: no money words (try_money_guard's pattern), no "first", no "untraceable",
//    never "prove"/"証明", no absolute AI claims. Controls: each rule catches its phrase.
// 4. No date promises: no year, month, weekday, "soon" or "next week", in either language.
//    Controls: an English and a Japanese promise.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const PAGE = readFileSync(new URL("../../../deploy/notice/index.html", import.meta.url), "utf8");
const MONEY = (() => {
  const src = readFileSync(new URL("./try_money_guard.mjs", import.meta.url), "utf8");
  const m = src.match(/export const MONEY = (new RegExp\([\s\S]*?\n\);)/);
  if (!m) throw new Error("try_money_guard.mjs: MONEY pattern not found");
  return (0, eval)(m[1]);
})();

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

const REPO = "https://github.com/TET-Network-Foundation/TET-OS";

// ---- 1. nothing runs, nothing loads ---------------------------------------------------------------
function loadProblems(html) {
  const out = [];
  if (/<script\b/i.test(html)) out.push("a <script>");
  if (/\son[a-z]+\s*=/i.test(html)) out.push("an event handler attribute");
  if (/javascript:/i.test(html)) out.push("a javascript: URL");
  for (const tag of ["link", "img", "iframe", "object", "embed", "form", "video", "audio", "source", "picture"])
    if (new RegExp(`<${tag}\\b`, "i").test(html)) out.push(`a <${tag}>`);
  if (/@import|url\s*\(/i.test(html)) out.push("CSS that loads something");
  for (const m of html.matchAll(/(?:href|src|action|srcset)\s*=\s*"([^"]*)"/gi)) {
    const u = m[1];
    if (u.startsWith("#")) continue;
    if (!(u === REPO || u.startsWith(`${REPO}/`))) out.push(`a URL that isn't the TET repository: ${u}`);
  }
  if (!/http-equiv="Content-Security-Policy" content="default-src 'none';/.test(html)) out.push("no CSP with default-src 'none'");
  return out;
}
check("nothing runs and nothing is loaded; the only links are to the repository", () => assert.deepEqual(loadProblems(PAGE), []));
check("controls: a script, an external image and a tracker link are caught", () => {
  assert.ok(loadProblems(PAGE.replace("</body>", "<script>1</script></body>")).includes("a <script>"));
  assert.ok(loadProblems(PAGE.replace("</body>", '<img src="https://example.com/p.gif"></body>')).length >= 1);
  assert.ok(loadProblems(PAGE.replace("</body>", '<a href="https://tracker.example/?id=1">x</a></body>')).some((p) => p.includes("tracker.example")));
});

// ---- 2. what each language must say ---------------------------------------------------------------
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
const section = (html, lang) => (html.match(new RegExp(`<section id="${lang}" lang="${lang}">([\\s\\S]*?)</section>`)) || [])[1];
const MUST = {
  en: [
    ["offline", /test network is offline/],
    ["closed after a late payment", /closed the account after a payment was late/],
    ["servers and data gone", /servers and everything stored on them are gone/],
    ["signatures still check offline", /signature made earlier still checks offline/],
    ["block N can't be checked live", /existed before block N of the old test chain can no longer be checked against a live node/],
    ["a new chain is planned", /new test chain is planned/],
  ],
  ja: [
    ["offline", /テストネットワークは停止しています/],
    ["closed after a late payment", /支払いの遅れを理由にアカウントを閉じました/],
    ["servers and data gone", /サーバーと、そこに保存されていたものはすべて失われました/],
    ["signatures still check offline", /以前に付けた署名は、今もオフラインで確かめられます/],
    ["block N can't be checked live", /ブロック N より前にあった[\s\S]*動いているノードで確かめることができません/],
    ["a new chain is planned", /新しいテストチェーンを計画しています/],
  ],
};
function contentProblems(html) {
  const out = [];
  for (const lang of ["en", "ja"]) {
    const s = section(html, lang);
    if (!s) {
      out.push(`no ${lang} section`);
      continue;
    }
    for (const [what, re] of MUST[lang]) if (!re.test(text(s))) out.push(`${lang}: doesn't say "${what}"`);
    if (!s.includes(`href="${REPO}"`)) out.push(`${lang}: no link to the repository`);
  }
  return out;
}
check("both languages say what the page is for, and link to GitHub", () => assert.deepEqual(contentProblems(PAGE), []));
check("control: a page without the Japanese section is caught", () =>
  assert.ok(contentProblems(PAGE.replace(/<section id="ja"[\s\S]*?<\/section>/, "")).includes("no ja section")));

// ---- 3. wording -----------------------------------------------------------------------------------
const RULES = [
  ["money wording", MONEY],
  ["a \"first\" claim", /\bfirst\b|世界初|初の/i],
  ["\"untraceable\"", /untraceable|追跡不可能|追跡できない/i],
  ["\"prove\"", /\bprov(?:e|es|ed|en|ing)\b|証明/i],
  ["an absolute AI claim", /\bAI\s+(?:cannot|can't)\b|AI\s*(?:は|が)\s*(?:アクセスできない|アクセスできません)/i],
];
const wording = (t) => RULES.filter(([, re]) => re.test(t)).map(([w]) => w);
check("the page keeps the site's wording rules", () => assert.deepEqual(wording(text(PAGE)), []));
check("controls: each wording rule catches its phrase", () => {
  for (const [x, want] of [
    ["Earn TET by running a node.", "money wording"],
    ["The first network with this.", "a \"first\" claim"],
    ["Messages are untraceable.", "\"untraceable\""],
    ["A mark proves you made it.", "\"prove\""],
    ["印は作者を証明します。", "\"prove\""],
    ["AI cannot access TET.", "an absolute AI claim"],
  ])
    assert.ok(wording(x).includes(want), x);
});

// ---- 4. no date promises --------------------------------------------------------------------------
const DATES = [
  /\b(?:19|20)\d\d\b/,
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/,
  /\b(?:soon|shortly|tomorrow|next (?:week|month|year)|this (?:week|month|year)|within \w+ (?:days?|weeks?|months?))\b/i,
  /まもなく|近日|近いうち|もうすぐ|来(?:週|月|年)|今(?:週|月|年)中|\d+\s*(?:年|月|日|週間)/,
];
const datePromises = (t) => DATES.filter((re) => re.test(t)).map(String);
check("no date promises in either language", () => assert.deepEqual(datePromises(text(PAGE)), []));
check("controls: an English and a Japanese date promise are caught", () => {
  for (const x of ["Back online soon.", "The new chain starts in December.", "Expected by 2027.", "来月再開します。", "近日公開予定です。", "3 月に再開します。"])
    assert.ok(datePromises(x).length > 0, x);
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
