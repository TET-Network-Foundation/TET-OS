// Guard for the public site (the home page and /tags, /machines, /keys, /services, /research).
//
//   node --experimental-strip-types scripts/site_guard.mjs
//
// F. Features. Every feature the site names is registered in app/site/features/<section>.ts with a
//    status (running / prototype / planned / idea) and non-empty Shows / Does not show; ids are
//    unique. The status must match the repository: a prototype cites a committed file (or an open PR
//    by number), every cited path is committed, and nothing is "running" unless its id is in
//    RUNNING_OK below (empty: there is no host; nothing runs for anyone today).
// P. Pages. A feature is shown only through <FeatureCard id="…"> with a registered id (the card always
//    renders the status and Shows / Does not show). Images only from /site/…; no photographs (.jpg,
//    .jpeg, .webp) under public/site; no remote images.
// W. Wording, in English and Japanese: no "company", "team", "customer(s)", "pricing"; no money
//    wording or money words (the patterns of scripts/try_money_guard.mjs, read from that file); no
//    testimonials or quoted users; no promised dates.
// J. Every string the site shows has Japanese.
// Every check has a control here: the check run on a broken copy must fail.

import { register } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

const UI = new URL("../", import.meta.url).pathname;
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = new Set(execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean));
const read = (rel) => readFileSync(join(UI, rel), "utf8");
const walk = (dir) => (existsSync(join(UI, dir)) ? readdirSync(join(UI, dir)).flatMap((n) => (statSync(join(UI, dir, n)).isDirectory() ? walk(`${dir}/${n}`) : [`${dir}/${n}`])) : []);

const { SECTIONS } = await import("../app/site/features/index.ts");
const { STATUSES } = await import("../app/site/types.ts");
const TEXT = ["home", "tags", "machines", "keys", "services", "research"];
const JA = Object.assign({}, ...(await Promise.all(TEXT.map((s) => import(`../app/site/text/${s}.ts`)))).map((m) => m.JA));

/** Ids allowed to say "running". Empty on purpose: since the hosting account closed (2026-11-10) nothing runs for anyone. */
const RUNNING_OK = new Set();

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

// ── F. features ─────────────────────────────────────────────────────────────────────────────────
const ALL = SECTIONS.flatMap((s) => s.features.map((f) => ({ ...f, section: s.section.href })));

function featureProblems(list, trackedSet = tracked) {
  const out = [];
  const seen = new Set();
  for (const f of list) {
    const at = `${f.section ?? "?"} ${f.id ?? "(no id)"}`;
    if (!f.id) out.push(`${at}: no id`);
    if (seen.has(f.id)) out.push(`${at}: id used twice`);
    seen.add(f.id);
    if (!STATUSES.includes(f.status)) out.push(`${at}: no status label (got ${JSON.stringify(f.status)})`);
    if (!f.title || !f.summary) out.push(`${at}: no title or summary`);
    if (!Array.isArray(f.shows) || !f.shows.length) out.push(`${at}: no "Shows"`);
    if (!Array.isArray(f.doesNot) || !f.doesNot.length) out.push(`${at}: no "Does not show"`);
    const ev = Array.isArray(f.evidence) ? f.evidence : [];
    for (const e of ev) if ("path" in e && !trackedSet.has(e.path)) out.push(`${at}: evidence ${e.path} is not a committed file`);
    if ((f.status === "prototype" || f.status === "running") && !ev.length) out.push(`${at}: "${f.status}" needs evidence in the repository`);
    if (f.status === "running" && !RUNNING_OK.has(f.id)) out.push(`${at}: "running", but nothing runs for anyone today`);
  }
  return out;
}

await check(`F1 every feature has a status, Shows / Does not show, and evidence that matches the repository (${ALL.length} features)`, () => {
  assert.deepEqual(featureProblems(ALL), []);
  for (const f of ALL) for (const e of f.evidence) {
    if ("pr" in e) console.log(`     note: ${f.id} cites PR #${e.pr} (${e.what}); checked once it merges`);
    if ("branch" in e) console.log(`     note: ${f.id} cites branch ${e.branch} (${e.what}); no PR yet`);
  }
});
await check("F control: a feature without a status, an uncommitted path, a bare prototype and a false \"running\" are each caught", () => {
  const ok = { id: "x", section: "/t", title: "T", summary: "S", status: "idea", evidence: [], shows: ["a"], doesNot: ["b"] };
  assert.deepEqual(featureProblems([ok], new Set()), []);
  assert.match(featureProblems([{ ...ok, status: undefined }], new Set()).join(), /no status label/);
  assert.match(featureProblems([{ ...ok, evidence: [{ path: "no/such/file" }] }], new Set()).join(), /not a committed file/);
  assert.match(featureProblems([{ ...ok, status: "prototype" }], new Set()).join(), /needs evidence/);
  assert.match(featureProblems([{ ...ok, status: "running", evidence: [{ pr: 1, what: "x" }] }], new Set()).join(), /nothing runs/);
  assert.match(featureProblems([{ ...ok, doesNot: [] }], new Set()).join(), /Does not show/);
});

// ── P. pages ────────────────────────────────────────────────────────────────────────────────────
const PAGES = [...walk("app/(site)"), ...walk("app/site")].filter((p) => /\.tsx?$/.test(p) && !/\/(features|text)\//.test(p));
const SRC = Object.fromEntries(PAGES.map((p) => [p, read(p)]));
const IDS = new Set(ALL.map((f) => f.id));

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
function pageProblems(src) {
  const out = [];
  for (const [p, raw] of Object.entries(src)) {
    const s = stripComments(raw);
    for (const m of s.matchAll(/<FeatureCard\b([^>]*)>/g)) {
      const id = /\bid="([^"]+)"/.exec(m[1])?.[1];
      if (!id) out.push(`${p}: <FeatureCard> without a literal id="…"`);
      else if (!IDS.has(id)) out.push(`${p}: <FeatureCard id="${id}"> is not a registered feature`);
    }
    for (const m of s.matchAll(/\bsrc=(?:\{`|")([^"`]+)/g)) if (!m[1].startsWith("/site/")) out.push(`${p}: image ${m[1]} is not under /site/`);
    if (/<img\b[^>]*src=\{(?!`\/site\/)/.test(s) && !p.endsWith("app/site/kit.tsx")) out.push(`${p}: an <img> with a computed src`);
    if (/https?:\/\/[^\s"'`]+\.(?:jpe?g|png|webp|gif)\b/i.test(s)) out.push(`${p}: a remote image`);
  }
  return out;
}
await check(`P1 features only through <FeatureCard id>, images only from /site/ (${PAGES.length} files)`, () => {
  assert.deepEqual(pageProblems(SRC), []);
  const photos = walk("public/site").filter((p) => /\.(?:jpe?g|webp)$/i.test(p));
  assert.deepEqual(photos, [], "photographs under public/site (the site uses drawings and screenshots of our own pages)");
});
/** Ids each section's own page shows through <FeatureCard id>, from app/(site)/<section>/**. */
function shownOnOwnPage(src) {
  const out = new Map();
  for (const [p, s] of Object.entries(src)) {
    const m = /^app\/\(site\)\/([a-z-]+)\//.exec(p);
    if (!m) continue;
    for (const c of stripComments(s).matchAll(/<FeatureCard\b[^>]*\bid="([^"]+)"/g)) out.set(c[1], `/${m[1]}`);
  }
  return out;
}
const missingFromOwnPage = (features, src) => features.filter((f) => shownOnOwnPage(src).get(f.id) !== f.section).map((f) => `${f.section} ${f.id}: not shown with its status on ${f.section}`);
await check("P2 every registered feature is shown, with its status, on its own section's page", () => {
  assert.deepEqual(missingFromOwnPage(ALL, SRC), []);
});
await check("P2 control: a feature registered but never shown through <FeatureCard> on its page is caught", () => {
  const f = { id: "x", section: "/tags" };
  assert.deepEqual(missingFromOwnPage([f], {}), ["/tags x: not shown with its status on /tags"]);
  assert.deepEqual(missingFromOwnPage([f], { "app/(site)/tags/page.tsx": '<FeatureCard id="x" />' }), []);
});
await check("P control: an unregistered or id-less FeatureCard and a remote or off-site image are caught", () => {
  assert.match(pageProblems({ "x.tsx": '<FeatureCard id="no-such-feature" />' }).join(), /not a registered feature/);
  assert.match(pageProblems({ "x.tsx": "<FeatureCard {...f} />" }).join(), /without a literal id/);
  assert.match(pageProblems({ "x.tsx": '<Figure src="/images/team.png" alt="x" />' }).join(), /not under \/site\//);
  assert.match(pageProblems({ "x.tsx": 'const u = "https://example.org/people.jpg";' }).join(), /remote image/);
});

// ── W. wording ──────────────────────────────────────────────────────────────────────────────────
// The money patterns are read from scripts/try_money_guard.mjs (a committed file of this repository,
// not input) so the two guards cannot drift apart; eval only turns those regex literals back into values.
const moneySrc = read("scripts/try_money_guard.mjs");
const MONEY = new RegExp(eval(moneySrc.match(/export const MONEY = new RegExp\(\s*(\[[\s\S]*?\])\.join/)[1]).join("|"), "i");
const MONEY_WORDS = eval(moneySrc.match(/export const MONEY_WORDS = (\/.*\/i);/)[1]);
const BANNED = [
  [/\b(?:compan(?:y|ies)|teams?|customers?|pricing)\b|会社|企業|チーム|顧客/i, "company / team / customers / pricing"],
  [MONEY, "money wording"],
  [MONEY_WORDS, "money words"],
  [/testimonial|お客様の声|利用者の声|[“"「][^”"」]{8,}[”"」]\s*[—–-]{1,2}\s*[A-Z][a-z]+/i, "a testimonial or a quoted user"],
  [/\b(?:soon|coming soon|next (?:week|month|quarter|year)|later this year|by (?:the )?(?:end of )?20\d\d|in 20[2-9]\d|(?:Q[1-4]|H[12]) 20\d\d)\b|まもなく|近日|来年|来月|今年中|年内|20[2-9]\d年(?:に|まで)/i, "a promised date"],
];
/** Every string the site shows: t("…") arguments, string props of the kit's components, and the registry. */
function shown() {
  const out = [];
  for (const [p, s] of Object.entries(SRC)) {
    // The page's <head> metadata is not shown in a language the visitor picks; leave it out.
    const code = stripComments(s).replace(/export const metadata[\s\S]*?\n\};\n/, "");
    for (const m of code.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) out.push([p, JSON.parse(`"${m[1]}"`)]);
    for (const m of code.matchAll(/\b(?:title|sentence|lead|alt|caption|text|label|means)[=:]\s*"((?:[^"\\]|\\.)*)"/g)) out.push([p, JSON.parse(`"${m[1]}"`)]);
    for (const m of code.matchAll(/>([^<>{}\n;=()]*[A-Za-z]{3,}[^<>{}\n;=()]*)</g)) if (m[1].trim()) out.push([p, m[1].trim()]);
  }
  for (const s of SECTIONS) {
    out.push([s.section.href, s.section.title], [s.section.href, s.section.sentence]);
    for (const f of s.features) for (const x of [f.title, f.summary, ...f.shows, ...f.doesNot, f.link?.label].filter(Boolean)) out.push([`${s.section.href} ${f.id}`, x]);
  }
  return out;
}
const SHOWN = shown();
const wordingProblems = (list) =>
  list.flatMap(([where, s]) => BANNED.filter(([re]) => re.test(s)).map(([, why]) => `${where}: ${why}: ${s.slice(0, 90)}`));
await check(`W1 no company/team/customers/pricing, money, testimonial or promised-date wording, EN and JA (${SHOWN.length} strings)`, () => {
  const all = [...SHOWN, ...SHOWN.filter(([, s]) => JA[s]).map(([w, s]) => [`${w} (ja)`, JA[s]])];
  const bad = wordingProblems(all);
  assert.deepEqual(bad, []);
});
await check("W control: each kind of banned wording is caught, in English and Japanese", () => {
  for (const s of ["Built by a small team.", "Our customers love it.", "See pricing.", "Earn TET by posting.", "Pay with TET.", "“It changed my life,” — Maria", "Coming soon.", "Ships in 2027.", "会社について", "お金", "まもなく公開"]) {
    assert.ok(wordingProblems([["x", s]]).length > 0, s);
  }
  assert.deepEqual(wordingProblems([["x", "Keys for machines and agents: what each key may do, and how many times."]]), []);
});

// W2. /market (W2's prototype, linked from /services) uses the site's words too: no customer, no
// company (配送会社), no money or promised dates, in English, Japanese and Hong Kong Chinese. It merges
// from its own branch, so in a tree without app/market this check says so and has nothing to read.
const MARKET = walk("app/market").filter((p) => /\.(?:tsx?|mjs)$/.test(p)).map((p) => [p, read(p)]);
function marketShown(files) {
  const out = [];
  for (const [p, s] of files) {
    const code = stripComments(s);
    for (const m of code.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) out.push([p, JSON.parse(`"${m[1]}"`)]);
    // Sentences in the checks (Shows / Does not show, reasons) and every key and value of its dictionaries.
    if (/market_checks\.ts$|i18n_market\.ts$/.test(p)) for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) if (/\s|[^\x00-\x7f]/.test(m[1])) out.push([p, JSON.parse(`"${m[1]}"`)]);
  }
  return out;
}
await check(`W2 /market uses the site's words, EN, JA and zh-HK (${MARKET.length ? `${MARKET.length} files` : "not in this tree"})`, () => {
  if (!MARKET.length) return;
  for (const f of ["app/market/Market.tsx", "app/market/i18n_market.ts", "app/market/market_checks.ts"]) assert.ok(MARKET.some(([q]) => q === f), `${f} is not scanned`);
  const bad = wordingProblems(marketShown(MARKET));
  assert.deepEqual(bad, []);
});
await check("W2 control: \"customer\" and 配送会社 put back into /market are caught", () => {
  const planted = [
    ["app/market/Market.tsx", 't("This customer\'s pseudonym here:")'],
    ["app/market/i18n_market.ts", '"the permit is not signed by the courier service": "許可が配送会社の署名ではありません",'],
  ];
  assert.equal(wordingProblems(marketShown(planted)).length, 2, wordingProblems(marketShown(planted)).join(" | "));
});

// ── J. Japanese ─────────────────────────────────────────────────────────────────────────────────
const jaProblems = (list, dict) => [...new Set(list.map(([, s]) => s))].filter((s) => /[A-Za-z]{3,}/.test(s) && !(s in dict));
await check("J1 every string the site shows has Japanese", () => {
  assert.deepEqual(jaProblems(SHOWN, JA), []);
});
await check("J control: a string without Japanese is caught", () => {
  assert.deepEqual(jaProblems([["x", "A sentence nobody translated."]], JA), ["A sentence nobody translated."]);
});

console.log(failed ? `\nsite_guard: ${failed} FAILED` : "\nsite_guard: all green");
process.exit(failed ? 1 : 0);
