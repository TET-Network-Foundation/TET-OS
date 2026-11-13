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
const { NUMBERS } = await import("../app/site/numbers.ts");
const { CHANGES } = await import("../app/site/changelog.ts");
const { AGENT_VERIFY } = await import("../app/site/data/agent_verify.ts");
const SNAPSHOT = JSON.parse(readFileSync(join(UI, "app/site/data/merged_prs.json"), "utf8"));
const TEXT = ["home", "tags", "machines", "keys", "services", "research", "about", "changelog", "numbers"];
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
    for (const m of s.matchAll(/<(FeatureCard|FeatureMini)\b([^>]*)>/g)) {
      const id = /\bid="([^"]+)"/.exec(m[2])?.[1];
      if (!id) out.push(`${p}: <${m[1]}> without a literal id="…"`);
      else if (!IDS.has(id)) out.push(`${p}: <${m[1]} id="${id}"> is not a registered feature`);
    }
    for (const m of s.matchAll(/\bsrc=(?:\{`|")([^"`]+)/g)) if (!m[1].startsWith("/site/")) out.push(`${p}: image ${m[1]} is not under /site/`);
    if (/<img\b[^>]*src=\{(?!`\/site\/)/.test(s) && !p.endsWith("app/site/kit.tsx")) out.push(`${p}: an <img> with a computed src`);
    if (/https?:\/\/[^\s"'`]+\.(?:jpe?g|png|webp|gif)\b/i.test(s)) out.push(`${p}: a remote image`);
  }
  return out;
}
await check(`P1 features only through <FeatureCard id> / <FeatureMini id>, images only from /site/ (${PAGES.length} files)`, () => {
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
  assert.match(pageProblems({ "x.tsx": '<FeatureMini id="no-such-feature" />' }).join(), /FeatureMini id="no-such-feature"> is not a registered feature/);
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
  [/\bfirst\b|世界初|業界初|初の/i, "\"first\""],
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
  for (const c of CHANGES) out.push([`/changelog #${c.pr}`, c.summary]);
  for (const [id, n] of Object.entries(NUMBERS)) out.push([`numbers ${id}`, n.value], [`numbers ${id}`, n.what], [`numbers ${id}`, n.source.label]);
  for (const s of SECTIONS) {
    out.push([s.section.href, s.section.title], [s.section.href, s.section.sentence]);
    for (const f of s.features) for (const x of [f.title, f.summary, ...f.shows, ...f.doesNot, f.link?.label].filter(Boolean)) out.push([`${s.section.href} ${f.id}`, x]);
  }
  return out;
}
const SHOWN = shown();
/** The one sentence that may say "company" (owner, 2026-11-13), exactly, in EN and JA. */
const PINNED = ["Open source. No token. No company.", "オープンソース。トークンなし。会社なし。"];
const unpinned = (s) => PINNED.reduce((x, p) => x.split(p).join(""), s);
const wordingProblems = (list) =>
  list.flatMap(([where, s0]) => {
    const s = unpinned(s0);
    return BANNED.filter(([re]) => re.test(s)).map(([, why]) => `${where}: ${why}: ${s0.slice(0, 90)}`);
  });
await check(`W1 no company/team/customers/pricing, money, testimonial or promised-date wording, EN and JA (${SHOWN.length} strings)`, () => {
  const all = [...SHOWN, ...SHOWN.filter(([, s]) => JA[s]).map(([w, s]) => [`${w} (ja)`, JA[s]])];
  const bad = wordingProblems(all);
  assert.deepEqual(bad, []);
});
await check("W control: each kind of banned wording is caught, in English and Japanese", () => {
  for (const s of ["The first chain for machines.", "世界初の仕組み", "Built by a small team.", "Our customers love it.", "See pricing.", "Earn TET by posting.", "Pay with TET.", "“It changed my life,” — Maria", "Coming soon.", "Ships in 2027.", "会社について", "お金", "まもなく公開"]) {
    assert.ok(wordingProblems([["x", s]]).length > 0, s);
  }
  assert.deepEqual(wordingProblems([["x", "Keys for machines and agents: what each key may do, and how many times."]]), []);
  // The pinned sentence passes; any other "company" still fails, including a near copy.
  assert.deepEqual(wordingProblems([["x", "Open source. No token. No company."], ["x", "オープンソース。トークンなし。会社なし。"]]), []);
  assert.ok(wordingProblems([["x", "Open source. No token. No company at all."]]).length > 0, "a near copy of the pinned sentence");
  assert.ok(wordingProblems([["x", "No company. Open source."]]).length > 0, "the words in another order");
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

// ── L. Layout (owner, 2026-11-13): checked on the class names of every site file ──────────────────
const ALLOWED_SIZES = new Set(["sm", "base", "xl", "2xl", "4xl"]);
const ALLOWED_WIDTHS = new Set(["3xl", "prose", "xl"]);
const SPACING = /(?<![\w-])-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y)-(\d+(?:\.\d+)?)(?![\w.])/g;
const OTHER_HUES = /(?<![\w-])(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|shadow|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|zinc|neutral|stone)-\d/g;
/** Every class-name string in a file: className="…", cx("…", "…") arguments, and the kit's tone tables. */
const classStrings = (src) => [...stripComments(src).matchAll(/className=\{?["'`]([^"'`]+)["'`]|\b(?:cx|tone|COLUMN|CARD|FOCUS)\b[^\n]*?["'`]([^"'`]*\b(?:text|p[xytblr]?|m[xytblr]?|gap|bg|font|max-w)-[^"'`]*)["'`]/g)].map((m) => m[1] ?? m[2]);
function layoutProblems(src) {
  const out = [];
  for (const [p, s] of Object.entries(src)) {
    const classes = classStrings(s).join(" ");
    const tokens = classes.split(/\s+/).map((c) => c.replace(/^(?:[a-z0-9-]+:)+/, ""));
    for (const c of tokens) {
      const size = /^text-(xs|sm|base|lg|xl|[2-9]xl)$/.exec(c)?.[1];
      if (size && !ALLOWED_SIZES.has(size)) out.push(`${p}: type size text-${size} (allowed: ${[...ALLOWED_SIZES].join(", ")})`);
      if (/^font-(?:thin|extralight|light|medium|bold|extrabold|black)$/.test(c)) out.push(`${p}: weight ${c} (allowed: font-normal, font-semibold)`);
      const w = /^max-w-([\w[\]().-]+)$/.exec(c)?.[1];
      if (w && !ALLOWED_WIDTHS.has(w)) out.push(`${p}: width max-w-${w} (allowed: ${[...ALLOWED_WIDTHS].join(", ")})`);
      if (/^text-(?:center|right|justify)$/.test(c)) out.push(`${p}: ${c} (body text is left-aligned)`);
    }
    for (const m of classes.matchAll(SPACING)) {
      const n = Number(m[1]);
      if (!Number.isInteger(n) || n % 2) out.push(`${p}: spacing ${m[0].trim()} is off the 8 px grid`);
    }
    for (const m of classes.matchAll(OTHER_HUES)) out.push(`${p}: colour ${m[0]}… (one accent: teal, with slate)`);
    const primaries = (stripComments(s).match(/<PrimaryLink\b/g) ?? []).length;
    if (primaries > 1) out.push(`${p}: ${primaries} primary buttons (at most one a page)`);
    if (!p.endsWith("app/site/kit.tsx") && /\bbg-teal-[67]00\b/.test(classes)) out.push(`${p}: a hand-made primary button (use <PrimaryLink>)`);
  }
  return out;
}
await check(`L1 layout: five type sizes, two weights, the 8 px grid, one column, one accent, left-aligned, one primary button (${PAGES.length} files)`, () => {
  assert.deepEqual(layoutProblems(SRC), []);
});
await check("L control: each layout rule is caught", () => {
  const cases = {
    'className="text-5xl"': /type size text-5xl/,
    'className="text-lg"': /type size text-lg/,
    'className="font-bold"': /weight font-bold/,
    'className="mt-3"': /mt-3 is off the 8 px grid/,
    'className="gap-1.5"': /gap-1\.5 is off the 8 px grid/,
    'className="max-w-5xl"': /width max-w-5xl/,
    'className="bg-amber-100"': /colour bg-amber-1/,
    'className="text-center"': /text-center/,
    '<PrimaryLink href="#a" label="A" /><PrimaryLink href="#b" label="B" />': /2 primary buttons/,
    'className="bg-teal-700 px-4"': /hand-made primary button/,
  };
  for (const [src, re] of Object.entries(cases)) assert.match(layoutProblems({ "app/(site)/x/page.tsx": src }).join(" | "), re, src);
  assert.deepEqual(layoutProblems({ "app/(site)/x/page.tsx": 'className="mt-4 gap-2 px-6 text-xl font-semibold max-w-prose text-teal-800 dark:text-slate-300 sm:text-4xl"' }), []);
});

// ── O. No off-site requests: nothing the site loads comes from another origin ────────────────────
const SITE_FILES = { ...SRC, "app/(site)/layout.tsx": read("app/(site)/layout.tsx") };
function offsiteProblems(src) {
  const out = [];
  const rules = [
    [/\bsrc=\{?["'`]https?:/, "a remote src"],
    [/\bfetch\(\s*["'`]https?:/, "a fetch to another origin"],
    [/\bnew (?:WebSocket|EventSource)\(/, "a socket or event stream"],
    [/navigator\.sendBeacon|XMLHttpRequest/, "a beacon or XHR"],
    [/next\/font\/google/, "a font from Google (fonts are self-hosted)"],
    [/@import\s+url\(\s*["']?https?:/, "a remote stylesheet import"],
    [/<link\b[^>]*\bhref=["']https?:/, "a remote <link>"],
    [/<script\b[^>]*\bsrc=/, "a <script src>"],
  ];
  for (const [p, s0] of Object.entries(src)) {
    const s = stripComments(s0);
    for (const [re, why] of rules) if (re.test(s)) out.push(`${p}: ${why}`);
  }
  return out;
}
await check(`O1 no off-site requests: no remote script, image, font, stylesheet, fetch, socket or beacon (${Object.keys(SITE_FILES).length} files)`, () => {
  assert.deepEqual(offsiteProblems(SITE_FILES), []);
  assert.match(SITE_FILES["app/(site)/layout.tsx"], /next\/font\/local/, "the fonts are not self-hosted through next/font/local");
});
await check("O control: each kind of off-site request is caught", () => {
  for (const [src, re] of [
    ['<img src="https://example.org/a.png" />', /remote src/],
    ['fetch("https://api.example.org/x")', /fetch to another origin/],
    ["new WebSocket(u)", /socket/],
    ["navigator.sendBeacon(u, b)", /beacon/],
    ['import { Inter } from "next/font/google";', /Google/],
    ['<link rel="stylesheet" href="https://cdn.example.org/x.css" />', /remote <link>/],
  ]) assert.match(offsiteProblems({ "x.tsx": src }).join(), re, src);
  assert.deepEqual(offsiteProblems({ "x.tsx": '<a href="https://github.com/x">GitHub</a>' }), [], "a link is not a request");
});

// ── N. Every number on a page has a source note (app/site/numbers.ts) ─────────────────────────────
/** Names and references that contain digits but are not quantities. */
const NAMES = /Ed25519|ed25519|X25519|ML-DSA-\d+|ML-KEM-\d+|FN-DSA|FIPS\s?20\d|SHA-\d+|NTAG\s?\d+(?:\s?DNA)?|P-256|BIP-?39|ePrint\s?\d{4}\/\d+|arXiv\s?\d{4}\.\d{4,5}(?:v\d+)?|\b\d{4}\/\d{3,5}\b|\b\d{4}\.\d{5}(?:v\d+)?\b|\(EU\)\s?\d{4}\/\d+|#\d+|\b\d{4}-\d{2}-\d{2}\b|\bS8-1\b|\b(?:AGKZ|SZ|HV|CS|HSVZ)\d{2}\b|\b0x[0-9a-f]+|\b[0-9a-f]{16,}\b|\bv\d+(?:\.\d+)*\b|\{\w+\}/g;
/**
 * What counts as a measurement: a number with a unit (size, time, a share, a count of tests or words),
 * or any number of three or more digits that is not a year. Counting words in a sentence ("one key",
 * "step 3", 1回だけ) are part of the wording, not measurements, and are left to the wording guards.
 */
const MEASURE = /\d[\d.,]*\s?(?:%|ms\b|s\b|秒|分|min(?:utes?)?\b|seconds?\b|hours?\b|時間|bytes?\b|バイト|[KMGT]i?B\b|tests?\b|テスト|words?\b|語)|(?<![-\d.:])(?!(?:19|20)\d{2}(?!\d))\d{3,}/g;
const quantities = (s) => (s.replace(NAMES, " ").match(MEASURE) ?? []);
/** Which files make up each page: its route folder, its feature and text file, and (home) app/site/home. */
function pageGroups() {
  const groups = { "/": ["app/site/Home.tsx", ...walk("app/site/home"), "app/site/text/home.ts"] };
  for (const d of walk("app/(site)").map((p) => /^app\/\(site\)\/([a-z-]+)\//.exec(p)?.[1]).filter(Boolean)) {
    groups[`/${d}`] = [...new Set([...(groups[`/${d}`] ?? []), ...walk(`app/(site)/${d}`), ...[`app/site/features/${d}.ts`, `app/site/text/${d}.ts`].filter((f) => existsSync(join(UI, f)))])];
  }
  return groups;
}
function numberProblems(groups, readFile = read) {
  const out = [];
  for (const [route, files] of Object.entries(groups)) {
    const texts = files.map((f) => [f, readFile(f)]);
    const all = texts.map(([, s]) => s).join("\n");
    for (const [f, s] of texts) {
      const strings = [...stripComments(s).replace(/className=(?:"[^"]*"|\{cx\([^)]*\)\})/g, "").matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2]).filter((x) => /[\sぁ-んァ-ン一-龯]/.test(x));
      for (const str of strings) {
        if (!quantities(str).length) continue;
        const ids = Object.entries(NUMBERS).filter(([, n]) => n.matches.test(str)).map(([id]) => id);
        if (!ids.length) { out.push(`${route} ${f}: a number with no source: ${str.slice(0, 80)}`); continue; }
        for (const id of ids) if (!new RegExp(`<(?:SourceNote|Measured)\\b[^>]*\\bid="${id}"`).test(all)) out.push(`${route} ${f}: "${id}" is used but its source is not on the page`);
      }
    }
  }
  return out;
}
await check("N1 every number on a page has a source note on that page", () => {
  assert.deepEqual(numberProblems(pageGroups()), []);
});
await check("N control: an unsourced number, and a sourced number whose note is missing, are caught", () => {
  const files = { "a.tsx": 't("One run takes 37 s.")', "b.tsx": 't("All 424 tests passed.")', "c.tsx": 't("All 424 tests passed.") <SourceNote id="ci-tests" />', "d.tsx": 't("Signed with Ed25519 and ML-DSA-44, see #172.")' };
  const r = (f) => numberProblems({ "/x": [f] }, (p) => files[p]);
  assert.match(r("a.tsx").join(), /a number with no source/);
  assert.match(r("b.tsx").join(), /"ci-tests" is used but its source is not on the page/);
  assert.deepEqual(r("c.tsx"), []);
  assert.deepEqual(r("d.tsx"), [], "names with digits are not quantities");
  files["e.tsx"] = 't("Proving took 9 s.")'; files["f.tsx"] = 't("証明に12秒かかりました。")'; files["g.tsx"] = 't("Each key may do one thing 1 time, in step 3, since 2025.")';
  assert.match(r("e.tsx").join(), /a number with no source/, "a time in seconds");
  assert.match(r("f.tsx").join(), /a number with no source/, "a time in Japanese");
  assert.deepEqual(r("g.tsx"), [], "counting words and a year are not measurements");
});

// ── C. The contact block on /about ──────────────────────────────────────────────────────────────
const WANT_CONTACT = { x: "https://x.com/stevenexusz", email: "tetsteve@proton.me", github: "https://github.com/TET-Network-Foundation" };
function contactProblems(kitSrc, aboutSrc) {
  const out = [];
  for (const [k, v] of Object.entries(WANT_CONTACT)) if (!new RegExp(`\\b${k}: "${v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`).test(kitSrc)) out.push(`the contact block has no ${k} ${v}`);
  if (!/<Contact\s*\/>/.test(stripComments(aboutSrc))) out.push("/about does not render <Contact />");
  return out;
}
const ABOUT = walk("app/(site)/about").map((p) => read(p)).join("\n");
await check("C1 /about shows the contact block: X, email and the GitHub organisation", () => {
  assert.deepEqual(contactProblems(read("app/site/kit.tsx"), ABOUT), []);
});
await check("C control: a missing contact or a page without the block is caught", () => {
  const kit = read("app/site/kit.tsx");
  assert.match(contactProblems(kit.replace("tetsteve@proton.me", "someone@example.org"), ABOUT).join(), /no email/);
  assert.match(contactProblems(kit, ABOUT.replace(/<Contact\s*\/>/g, "")).join(), /does not render <Contact/);
});

// ── A. Every link to the app goes through APP_URL (app/site/split.ts) ───────────────────────────
const APP_PATH = /\b(?:href|to)=\{?["'`]\/(?:try|agents|signin|future|market)(?=[?/#"'`])/;
function appLinkProblems(src) {
  const out = [];
  for (const [p, s] of Object.entries(src)) if (!p.endsWith("app/site/split.ts") && APP_PATH.test(stripComments(s))) out.push(`${p}: a raw link to the app (use appHref / the kit's links)`);
  const kit = src["app/site/kit.tsx"] ?? "";
  if ((kit.match(/appHref\(props\.href\)/g) ?? []).length < 2) out.push("app/site/kit.tsx: PrimaryLink and SecondaryLink must both go through appHref");
  return out;
}
await check("A1 project pages link to the app only through APP_URL", () => {
  assert.deepEqual(appLinkProblems(SRC), []);
});
await check("A control: a raw app link, and a kit link without appHref, are caught", () => {
  assert.match(appLinkProblems({ ...SRC, "app/(site)/x/page.tsx": '<a href="/try?tab=verify">Try</a>' }).join(), /raw link to the app/);
  assert.match(appLinkProblems({ ...SRC, "app/site/kit.tsx": SRC["app/site/kit.tsx"].replace(/appHref\(props\.href\)/g, "props.href") }).join(), /must both go through appHref/);
});

// ── T. The terminal shows captured output only; the changelog names real merged PRs ─────────────
await check("T1 a terminal block appears only through the kit, and its text is the capture", () => {
  const pre = Object.entries(SRC).filter(([p, s]) => !p.endsWith("app/site/kit.tsx") && /<pre\b/.test(stripComments(s))).map(([p]) => p);
  assert.deepEqual(pre, [], "a <pre> outside the kit's Terminal");
  assert.match(SRC["app/site/kit.tsx"], /<code translate="no">\{AGENT_VERIFY\.text\}<\/code>/);
  assert.match(AGENT_VERIFY.text, /^\$ tet-cli agent verify /m);
});
const changelogProblems = (changes, snap) =>
  changes.flatMap((c) => {
    const pr = snap.prs.find((p) => p.number === c.pr);
    return !pr ? [`#${c.pr} is not a merged PR in the snapshot`] : pr.merged !== c.merged ? [`#${c.pr} merged ${pr.merged}, not ${c.merged}`] : [];
  });
await check(`CHG1 every changelog entry is a real merged PR, with its merge date (${CHANGES.length} entries)`, () => {
  assert.ok(CHANGES.length >= 5);
  assert.deepEqual(changelogProblems(CHANGES, SNAPSHOT), []);
});
await check("CHG control: an unknown PR number and a wrong date are caught", () => {
  assert.match(changelogProblems([{ pr: 99999, merged: "2026-11-13", summary: "x" }], SNAPSHOT).join(), /not a merged PR/);
  assert.match(changelogProblems([{ pr: CHANGES[0].pr, merged: "2020-01-01", summary: "x" }], SNAPSHOT).join(), /merged \d{4}-\d{2}-\d{2}, not 2020-01-01/);
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
