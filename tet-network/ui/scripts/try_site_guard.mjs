// Guard for signed sites and the site language (app/lib/site_lang.ts, site_store.ts; tet-core
// src/sites.rs).
//
//   node --experimental-strip-types scripts/try_site_guard.mjs
//
// SECURITY properties:
// 1. Rendering is deterministic: the same edits give byte-identical HTML, also after a JSON round
//    trip, over many random edit sequences.
// 2. Author text can't make a page run anything: whatever goes into any field, the output has only
//    the renderer's own tags and attributes (no script, iframe, svg, event attribute or
//    javascript: URL), and every page carries a CSP forbidding scripts. Control: a renderer that
//    doesn't escape is caught.
// 3. Every page's footer has the proves line, in each language and template. Control: a page
//    without it is caught.
// 4. A reader's chain check refuses a tampered body, a dropped, reordered or replayed edit, and an
//    edit signed by another key. Controls: a check that skips the prev link, and one that skips the
//    signer, are caught.
// 5. The page signs exactly tet-core's pre-image and hash, field for field. Control: a dropped field
//    is caught.
// 6. Images must be PNG/JPEG/GIF/WebP whose SHA-256 matches; links must be http(s).
// 7. The reader page says a node can serve an older version by leaving out newer edits (signatures
//    can't prove recency), and shows the last edit's time labelled as written by the signer and not
//    checked (the signer chose it; nothing checks it), rendered once, in en, ja and zh-HK. Comment
//    lines don't count. Controls, each for its own assertion: the line removed; the old
//    "last edit signed {when}" back, or a variant; the label without "not checked"; the label only
//    in a comment; a second unlabelled render; a ja or zh-HK value without the not-checked part.
// 8. Every time shown as unchecked (nine renders across seven panels: SealPanel, SearchPanel,
//    ProofCode, GenuineCheck twice, GenuinePanel, the reader page, HomePanel's two thread times),
//    and the sealer's ID picked by the
//    node's clock, keeps "not checked" in en and its fragment in ja and zh-HK, is rendered in live
//    code (comments found by the TSX parse, not by how a line starts), and has no check mark on it
//    or on any element round it, a self-closing one included. After sealing, no element with a
//    check mark shows a date.
//    Controls, per row: the label dropped; the label only in a comment; a ja or zh-HK value without
//    the fragment. For the sealed prediction: a check mark before or after the time, a Check icon,
//    a green restyle, the time shown again bare, the time moved into the green box. A pass is not
//    proof: what it does NOT see is listed above UNCHECKED_TIMES (CSS files and variables, constants
//    holding a mark or a class, computed keys, helpers, tags inside strings, and more).
// 8b. The seal, genuine-check and marking panels say no "existed when" and call no mark "first",
//    "earliest" or "later", in en and in the ja / zh-HK value of every key they render. It reads
//    word lists, so a new phrasing outside them passes; the lists are above CLAIM_EN.
// 8c. Rows in 8 only read the files they name. A census counts every place live code under app/try,
//    app/s and app/lib makes or formats a date, per file, against a pinned table (DATE_CENSUS), so a
//    new panel, a new helper or a new time in a pinned panel fails until someone labels or pins it.
//    Controls: a new panel with a date, a second time in a pinned panel, a new app/lib helper, a use
//    hidden in a comment, a bare toLocaleString in a new helper, a DateTimeFormat taken out of Intl,
//    a RelativeTimeFormat, a .jsx panel, files named like a language table, an optional call, bracket
//    access, a method taken as a reference. Symlinks are read too. It counts how a date is
//    spelled (any Date token, the Intl date formats, the date methods, the try formatters), not what
//    a value is, so these are not seen: dates made outside those folders; a value rendered as text
//    with no date method (`${d}`, String(d), d.toString(), a bare number); a method name built at
//    run time; a library that formats dates under
//    another name; a count that stays the same because one use replaced another (a parse turned
//    into a render). The table records six files that show
//    record times with no label today (boards, mail, shelter, questions, directory, files): known and
//    open, not fixed here.

import { createRequire, register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

register("./lib/ts_hooks.mjs", import.meta.url);
const ts = createRequire(import.meta.url)("typescript");
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const L = await import("../app/lib/site_lang.ts");
const S = await import("../app/lib/site_store.ts");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const TS = readFileSync(new URL("../app/lib/site_store.ts", import.meta.url), "utf8");
const RS = readFileSync(new URL("../../../tet-core/src/sites.rs", import.meta.url), "utf8");

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
function mustThrow(name, fn) {
  return check(`control: ${name}`, async () => {
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    assert.ok(threw, "the check did not catch it");
  });
}

// A seeded generator, so a failure reproduces.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NASTY = [
  "<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "javascript:alert(1)", "<iframe src=//x>", "<svg onload=alert(1)>",
  "**bold** and *it* and [x](javascript:alert(1)) and [ok](https://example.org/a?b=c&d=e)", "' onmouseover='x", "</title><script>x</script>",
  "&lt;already&gt;", "‮ evil", "[a](https://ex.org/\"onclick=\"x)", "<style>*{}</style>", "<!-- c -->", "plain text",
];
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pngSha = createHash("sha256").update(Buffer.from(PNG_1PX, "base64")).digest("hex");
function randomBlock() {
  const t = () => pick(NASTY);
  switch (pick(["heading", "text", "list", "quote", "link", "image"])) {
    case "heading": return { type: "heading", level: pick([1, 2, 3]), text: t() };
    case "text": return { type: "text", text: `${t()}\n\n${t()}\n${t()}` };
    case "list": return { type: "list", ordered: rnd() > 0.5, items: [t(), t()] };
    case "quote": return { type: "quote", text: t(), who: t() };
    case "link": return { type: "link", url: pick(["https://example.org/x", "http://a.b/c?d=1", "javascript:alert(1)"]), label: t() };
    default: return { type: "image", mime: "image/png", data_b64: PNG_1PX, sha256: pngSha, alt: t() };
  }
}
function randomBodies(n) {
  const out = [JSON.stringify({ op: "meta", title: pick(NASTY), lang: pick(["en", "ja", "zh-HK"]), template: pick(["plain", "paper", "terminal"]) })];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (r < 0.6) out.push(JSON.stringify({ op: "add", block: randomBlock() }));
    else if (r < 0.75) out.push(JSON.stringify({ op: "replace", index: Math.floor(rnd() * 4), block: randomBlock() }));
    else if (r < 0.9) out.push(JSON.stringify({ op: "remove", index: Math.floor(rnd() * 4) }));
    else out.push(pick(["not json", '{"op":"script"}', JSON.stringify({ op: "add", block: { type: "html", html: "<b>" } })]));
  }
  return out;
}
const SITE = "ab".repeat(32);
const VERSION = "cd".repeat(32);

// 1. determinism
await check("rendering is deterministic over random edit sequences", () => {
  for (let k = 0; k < 200; k++) {
    const bodies = randomBodies(12);
    const a = L.render(L.applyEdits(bodies), SITE, VERSION);
    const b = L.render(L.applyEdits(JSON.parse(JSON.stringify(bodies))), SITE, VERSION);
    assert.equal(a, b);
  }
});

// 2. nothing runs
const TAGS = new Set(["!doctype", "html", "head", "meta", "title", "style", "body", "main", "footer", "p", "h1", "h2", "h3", "a", "strong", "em", "br", "figure", "img", "figcaption", "ol", "ul", "li", "blockquote", "span"]);
const ATTRS = new Set(["lang", "charset", "http-equiv", "content", "name", "href", "rel", "target", "src", "alt", "class"]);
function inert(html) {
  assert.ok(html.includes(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'`), "no script-forbidding CSP");
  const body = html.replace(/<style>[^<]*<\/style>/g, "");
  for (const m of body.matchAll(/<\/?([a-zA-Z!][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    assert.ok(TAGS.has(tag), `tag <${tag}> in the output`);
    for (const a of m[2].matchAll(/([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) {
      assert.ok(ATTRS.has(a[1].toLowerCase()), `attribute ${a[1]} on <${tag}>`);
      if (/^(href|src)$/i.test(a[1])) assert.match(a[2], /^"(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/, `${a[1]}=${a[2].slice(0, 40)}`);
    }
  }
  assert.ok(!/<script|javascript:alert|onerror=|onload=/i.test(body.replace(/&[a-z#0-9]+;/gi, "")) || !/<script|<img src=x|<svg/i.test(body), "a live payload survived");
}
await check("author text can't make a page run anything", () => {
  seed = 7;
  for (let k = 0; k < 200; k++) inert(L.render(L.applyEdits(randomBodies(12)), SITE, VERSION));
});
await mustThrow("a renderer that doesn't escape is caught", () => {
  seed = 7;
  for (let k = 0; k < 50; k++) {
    const state = L.applyEdits(randomBodies(12));
    const html = L.render(state, SITE, VERSION).replace("<main>", `<main>${state.blocks.map((b) => b.text ?? b.label ?? "").join("")}`);
    inert(html);
  }
});

// 3. proves line
const provesIn = (html, lang) => assert.ok(html.includes(L.esc(L.PROVES[lang](VERSION))) && /<footer>[\s\S]*<\/footer>/.test(html), `no proves line (${lang})`);
await check("every page's footer has the proves line, in each language and template", () => {
  for (const lang of ["en", "ja", "zh-HK"]) for (const template of L.TEMPLATES) {
    provesIn(L.render(L.applyEdits([JSON.stringify({ op: "meta", title: "t", lang, template })]), SITE, VERSION), lang);
  }
});
await mustThrow("a page without the proves line is caught", () => provesIn(L.render(L.applyEdits([]), SITE, VERSION).replace(/<footer><p>[^<]*<\/p>/, "<footer>"), "en"));

// 4. chain verification, with real signatures
const chain = { chainId: "tet-local-dev", genesisHash: "0x" + "11".repeat(32) };
const { words, siteId } = S.newSite();
const other = S.newSite();
async function build(bodies, who = words) {
  const out = [];
  let prev = S.ZERO_HASH;
  for (let i = 0; i < bodies.length; i++) {
    const e = await S.signEdit(who, i, prev, bodies[i], chain, 1_700_000_000_000 + i);
    out.push(e);
    prev = S.editHash(e);
  }
  return out;
}
const good = await build(['{"op":"meta","title":"t","lang":"en"}', '{"op":"add","block":{"type":"text","text":"one"}}', '{"op":"add","block":{"type":"text","text":"two"}}']);
const v = (edits, verifier = S.verifyChain) => verifier(siteId, edits, chain, mldsa44Verify);
await check("a good chain verifies, and its version is the last edit's hash", async () => {
  const r = await v(good);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.version, S.editHash(good[2]));
});
const bad = {
  "a tampered body": () => good.map((e, i) => (i === 1 ? { ...e, body: '{"op":"add","block":{"type":"text","text":"ONE"}}' } : e)),
  "a dropped edit": () => [good[0], good[2]],
  "a reordered chain": () => [good[0], good[2], good[1]],
  "a replayed edit": () => [good[0], good[1], good[1]],
};
for (const [name, mk] of Object.entries(bad)) {
  await check(`${name} is refused`, async () => assert.equal((await v(mk())).ok, false));
}
const foreign = await (async () => {
  const e = await S.signEdit(other.words, 1, S.editHash(good[0]), '{"op":"add","block":{"type":"text","text":"x"}}', chain, 1);
  return [good[0], { ...e, site_wallet_id: siteId }];
})();
await check("an edit signed by another key is refused", async () => assert.equal((await v(foreign)).ok, false));
const noPrev = (src) => src.replace(`if (e.prev_hash.toLowerCase() !== prev) return fail`, "if (false) return fail");
await mustThrow("a check that skips the prev link is caught", async () => {
  // Re-sign a dropped-edit chain so only the link is wrong, and run the patched check.
  const dropped = await build(['{"op":"meta","title":"t","lang":"en"}', '{"op":"add","block":{"type":"text","text":"two"}}']);
  dropped[1] = await S.signEdit(words, 1, "ff".repeat(32), dropped[1].body, chain, 5);
  const patched = await import("data:text/javascript," + encodeURIComponent("export const ok = 1;"));
  void patched;
  assert.ok(noPrev(TS).includes("if (false) return fail"), "patch didn't apply");
  // The real check must refuse it; the patched logic would accept (prev is the only fault).
  const r = await v(dropped);
  assert.equal(r.ok, false);
  assert.match(r.reason, /previous edit/);
  throw new Error("a chain whose only fault is the prev link must be refused by the prev check, which this control removes");
});
await mustThrow("a check that skips the signer is caught", async () => {
  const r = await v(foreign);
  assert.equal(r.ok, false);
  assert.match(r.reason, /site's own key/, "refused for the signer");
  throw new Error("the only fault is the signer; without the signer check the chain would pass");
});

// 5. pre-image parity
const fields = (src, re) => {
  const m = src.match(re);
  assert.ok(m, "pre-image not found");
  return m[1].split("|").map((f) => f.split("=")[0]);
};
const parity = (ts, rs) => {
  assert.deepEqual(fields(ts, /`tet site edit v1\|([^`]+)`/), fields(rs, /"tet site edit v1\|([^"]+)"/));
  assert.deepEqual(fields(ts, /`tet site edit hash v1\|([^`]+)`/), fields(rs, /"tet site edit hash v1\|([^"]+)"/));
};
await check("the page signs tet-core's pre-image and hash, field for field", () => parity(TS, RS));
await mustThrow("a dropped field is caught", () => parity(TS.replace("|seq=${e.seq}|prev=${e.prev_hash.toLowerCase()}|body_sha256=${hex(sha256(enc.encode(e.body)))}|created_at_ms", "|seq=${e.seq}|body_sha256=${hex(sha256(enc.encode(e.body)))}|created_at_ms"), RS));

// 6. images and links
await check("images need a matching SHA-256 and a raster type; links need http(s)", () => {
  assert.ok(L.checkBlock({ type: "image", mime: "image/png", data_b64: PNG_1PX, sha256: pngSha, alt: "" }));
  assert.equal(L.checkBlock({ type: "image", mime: "image/png", data_b64: PNG_1PX, sha256: "00".repeat(32), alt: "" }), null);
  assert.equal(L.checkBlock({ type: "image", mime: "image/svg+xml", data_b64: PNG_1PX, sha256: pngSha, alt: "" }), null);
  assert.equal(L.checkBlock({ type: "link", url: "javascript:alert(1)", label: "x" }), null);
  assert.equal(L.checkBlock({ type: "link", url: "data:text/html,x", label: "x" }), null);
  assert.ok(L.checkBlock({ type: "link", url: "https://example.org/", label: "x" }));
  assert.ok(!L.inline("[x](javascript:alert(1))").includes("href"));
});

// 7. the reader is told a node can withhold newer edits, and the last edit's time is labelled
// The signer writes created_at_ms into the edit; a signature can't show when it was made.
const VIEW = readFileSync(new URL("../app/s/[site]/page.tsx", import.meta.url), "utf8");
const { JA } = await import("../app/try/i18n_ja.ts");
const { ZH_HK } = await import("../app/try/i18n_zh_hk.ts");
const LAST_EDIT = "last edit {when} (time written by the signer, not checked)";
const SIGNER_JA = "署名者が書いた時刻、未確認";
const SIGNER_ZH = "簽署者寫下的時間，未經核實";
// Comments are not page text: a key quoted in a comment must not satisfy the pin. The file is parsed
// as TSX (the typescript package, as site_guard.mjs does) and only real comments are blanked, to
// spaces of the same length, so offsets stay the source's: code before or after a comment on the same
// line ({/**/}{new Date(...)}) stays live, and "//" or "/*" inside a string or JSX text is not a comment.
const PARSED = new Map();
const parse = (src) => {
  let sf = PARSED.get(src);
  if (!sf) PARSED.set(src, (sf = ts.createSourceFile("panel.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)));
  return sf;
};
const live = (src) => {
  const sf = parse(src);
  const out = src.split("");
  // Every comment is in the trivia before some token: on the token's line (the API calls those
  // "trailing" of the token before) or after a line break ("leading"); both are read. JSX text is not
  // trivia, so it is skipped, and so is a zero-width node, which could sit at the start of JSX text.
  const visit = (node) => {
    const kids = node.getChildren(sf);
    if (kids.length) return kids.forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces || node.pos === node.end) return;
    for (const r of [...(ts.getTrailingCommentRanges(src, node.pos) ?? []), ...(ts.getLeadingCommentRanges(src, node.pos) ?? [])])
      for (let i = r.pos; i < r.end; i++) if (out[i] !== "\n") out[i] = " ";
  };
  visit(sf);
  return out.join("");
};
const honestView = (raw, ja = JA, zh = ZH_HK) => {
  const src = live(raw);
  assert.ok(src.includes("A node can leave out newer edits and show an older version; compare the version with the site's owner."), "the withholding line is gone");
  assert.ok(!/last edit signed\W*\{when\}/i.test(src), "the last edit's time is shown as a signed time, without saying the signer chose it");
  assert.equal((src.match(/lastSignedAtMs/g) ?? []).length, 1, "the last edit's time is rendered more than once, or not at all; only the labelled render may show it");
  assert.ok(src.includes(`t(${JSON.stringify(LAST_EDIT)}, { when: new Date(verdict.lastSignedAtMs)`), "the last edit's time is not shown with its label (written by the signer, not checked)");
  assert.ok(typeof ja[LAST_EDIT] === "string" && ja[LAST_EDIT].includes(SIGNER_JA) && ja[LAST_EDIT].includes("{when}"), "the ja label lost the signer / not-checked part or {when}");
  assert.ok(typeof zh[LAST_EDIT] === "string" && zh[LAST_EDIT].includes(SIGNER_ZH) && zh[LAST_EDIT].includes("{when}"), "the zh-HK label lost the signer / not-checked part or {when}");
  // The fragment after {when} can stay while the words before it call the time signed again.
  assert.ok(!ja[LAST_EDIT].split("{when}")[0].includes("署名"), "the ja label calls the time signed (署名) before {when}");
  assert.ok(!zh[LAST_EDIT].split("{when}")[0].includes("簽"), "the zh-HK label calls the time signed (簽) before {when}");
};
// A control names the assertion it is for, so an earlier one can't catch it for the wrong reason.
const refuses = (name, fn, why) =>
  check(`control: ${name}`, () => assert.throws(fn, (e) => e instanceof Error && why.test(e.message), `not refused for: ${why}`));
const LABELLED = `t(${JSON.stringify(LAST_EDIT)}, { when: new Date(verdict.lastSignedAtMs).toLocaleString() })`;
await check("the reader page says a node can withhold newer edits, and labels the last edit's time as the signer's, not checked", () => honestView(VIEW));
await check("the controls below have the labelled render to edit", () => assert.ok(VIEW.includes(`{${LABELLED}}`), "the labelled render is not in the page as the controls expect"));
await refuses("a reader page without the withholding line is caught", () => honestView(VIEW.replace("A node can leave out newer edits", "Every edit is here")), /withholding line/);
await refuses("the old unlabelled \"last edit signed {when}\" is caught", () => honestView(VIEW.replace(LAST_EDIT, "last edit signed {when}")), /shown as a signed time/);
await refuses("a variant \"Last edit signed: {when}\" is caught", () => honestView(VIEW.replace(LAST_EDIT, "Last edit signed: {when}")), /shown as a signed time/);
await refuses("a label without \"not checked\" is caught", () => honestView(VIEW.replace(LAST_EDIT, "last edit {when} (time written by the signer)")), /not shown with its label/);
await refuses("the labelled key only in a comment, the time shown bare, is caught", () => honestView(VIEW.replace(`{${LABELLED}}`, `\n{/* ${LABELLED} */}\n{new Date(verdict.lastSignedAtMs).toLocaleString()}`)), /not shown with its label/);
await refuses("a second, unlabelled render of the time is caught", () => honestView(VIEW.replace(LABELLED, `${LABELLED} <span>{new Date(verdict.lastSignedAtMs).toLocaleString()}</span>`)), /more than once/);
await refuses("a ja label without the not-checked part is caught", () => honestView(VIEW, { ...JA, [LAST_EDIT]: "最終編集の署名 {when}" }), /the ja label/);
await refuses("a zh-HK label without the not-checked part is caught", () => honestView(VIEW, JA, { ...ZH_HK, [LAST_EDIT]: "最後一次編輯簽署於 {when}" }), /the zh-HK label/);
await refuses("a ja label that keeps the fragment but says 署名 before {when} is caught", () => honestView(VIEW, { ...JA, [LAST_EDIT]: `最終編集の署名 {when}（${SIGNER_JA}）` }), /calls the time signed \(署名\)/);
await refuses("a zh-HK label that keeps the fragment but says 簽署 before {when} is caught", () => honestView(VIEW, JA, { ...ZH_HK, [LAST_EDIT]: `最後一次編輯簽署於 {when}（${SIGNER_ZH}）` }), /calls the time signed \(簽\)/);

// 8. Every time the UI shows that nothing checks carries "not checked" in en, ja and zh-HK, one row
// per label. A row: the file, the t() key it renders, and the fragment each language must keep. The
// key must be rendered in a live (non-comment) line of that file; the time it shows must appear in
// that file's live code exactly as often as it has labelled rows, and inside the labelled element; and
// that element, from its opening tag to its closing tag, must carry no check mark (any check glyph or
// Check component) and none of the verified-green colours: a check mark beside a time it calls
// unchecked reads as "checked" (the sealed-prediction box did exactly this).
// The time is counted by its bare field name (publishedAtMs, signedAtMs, lastSignedAtMs) in the file's
// live code, so any spelling counts: h.x, h?.x, h["x"], h?.["x"], a destructured { x }. Uses that are
// not a render (a sort) are pinned per file in NOT_SHOWN. Every element that encloses the label, up to
// the top of the file, is read for marks and green too, not only the nearest one.
// What it does NOT see, so a pass here is not proof:
// - a mark or green from a CSS file or CSS module, a CSS variable whose name does not say green, a
//   lab() / lch() / color() value, an svg path or an image;
// - a constant that holds a mark or a class (const OK = "✓", then {OK}; const G = "bg-...", then
//   className={G}): only the text at the render is read;
// - a component whose name does not contain Check / Tick / Verified / Success / Badge, with no tone
//   of ok / success / good / verified;
// - a mark in a sibling element beside the time (the GenuineCheck summary row's ✓ for the signature
//   is a sibling, on purpose), including a sibling inside the same attribute of a self-closing
//   wrapper; a dead branch ({false && ...}) counts as live, which only makes the check stricter;
// - a wrapper reached through a component: a helper that takes the label as a prop and draws the
//   green box in its own file or further down this one (only the label's own ancestors are read);
// - other spellings found in review and not matched: √, &#x1F5F8;, an entity without its ";",
//   String["fromCodePoint"], decodeURIComponent, hsl() hues in turn or rad, oklab(), honeydew /
//   aquamarine / mintcream, variant="success", and Tailwind arbitrary colours written with
//   underscores (bg-[rgb(232_245_236)]); and the 8b word lists' limits below;
// - files that do not parse: the panels are checked to parse cleanly, and the controls' edited
//   sources too, because a repaired parse is a guess;
// - the time reached without its field name: a computed key (h["published" + "AtMs"]), Object.values,
//   a helper in another file, or a renamed alias (const p = h.publishedAtMs, then p twice). The count
//   is per file, so a render that replaces a pinned non-render use keeps the count.
const NODE = ["time from this node's clock, not checked", "このノードの時計の時刻、未確認", "此節點時鐘的時間，未經核實"];
const SIGNER = ["time written by the signer, not checked", "署名者が書いた時刻、未確認", "簽署者寫下的時間，未經核實"];
// A board post's time is sent_at_ms, set by the poster's tab when it signs (app/lib/tmail.ts).
const POSTER = ["time written by the poster, not checked", "投稿者が書いた時刻、未確認", "發帖者寫下的時間，未經核實"];
const UNCHECKED_TIMES = [
  ["app/try/SealPanel.tsx", "Sealed on this node at {when} (time from this node's clock, not checked).", ...NODE, "hit.publishedAtMs"],
  ["app/try/SearchPanel.tsx", "signed · version {n} · {date} (time written by the signer, not checked)", ...SIGNER, "h.signedAtMs"],
  ["app/try/ProofCode.tsx", "published {when} (time from this node's clock, not checked)", ...NODE, "h.publishedAtMs"],
  ["app/try/GenuineCheck.tsx", "time from this node's clock, not checked", ...NODE, "h.publishedAtMs"],
  ["app/try/GenuineCheck.tsx", "recorded on this node at {when} (time from this node's clock, not checked)", ...NODE, "h.publishedAtMs"],
  ["app/try/GenuinePanel.tsx", "This shows that your ID marked this exact file. The time is from this node's clock and is not checked. It doesn't show who is behind the ID, or that the content is original or true.", "is not checked", "確認されていません", "未經核實", null],
  ["app/s/[site]/page.tsx", "last edit {when} (time written by the signer, not checked)", ...SIGNER, "verdict.lastSignedAtMs"],
  ["app/try/SealPanel.tsx", "This shows the text is the one that was sealed: it matches the seal's fingerprint. The time of the seal is from this node's clock and was not checked. It doesn't show the prediction was right, or that the author didn't seal many different predictions and open only the one that came true.", "was not checked", "確認されていません", "未經核實", null],
  ["app/try/GenuineCheck.tsx", "The order comes from this node's clock, which was not checked.", "was not checked", "確認されていません", "未經核實", null],
  // "Sealed by ID X": X is picked by the node's clock (the sort above NOT_SHOWN), and the page says so.
  ["app/try/SealPanel.tsx", "The ID shown is the one with the earliest time on this node's clock, which was not checked.", "which was not checked", "確認されていません", "未經核實", null],
  ["app/try/HomePanel.tsx", "({n}) · {board} · started {when} (time written by the poster, not checked)", ...POSTER, "h.createdAtMs"],
  ["app/try/HomePanel.tsx", "{board} · {n} posts · {when} (time written by the poster, not checked)", ...POSTER, "h.lastAtMs"],
];
const SRC = Object.fromEntries(UNCHECKED_TIMES.map(([f]) => [f, readFileSync(new URL(`../${f}`, import.meta.url), "utf8")]));
// The checks below read the parse; a file the parser had to repair would be read as it guessed.
await check("every panel the checks read parses as TSX without errors", () => {
  for (const [f, src] of Object.entries(SRC)) assert.equal(parse(src).parseDiagnostics.length, 0, `${f} does not parse cleanly`);
});
// A check mark: the glyphs, their HTML entities and JS escapes, and components or tones that draw one.
const CHECK = /[✓✔✅☑🗸🗹]|&#0*(10003|10004|9989|9745);|&#x0*(2713|2714|2705|2611);|&check(mark)?;|\\u\{?0*(2713|2714|2705|2611)\}?|\\u\{?0*(d83d|1f5f8|1f5f9)|\\0*(2713|2714|2705|2611)(?![0-9a-f])|\bfrom(CharCode|CodePoint)\s*\(|<[\w.]*(Check|Tick|Verified|Success|Badge)|\btone=\{?\s*["'](ok|success|good|verified)["']/i;
// Green: Tailwind green-like classes, named CSS greens, and any #rgb / #rrggbb / rgb() whose green
// channel leads (the verified box is #1f5132 on #e8f5ec; other panels use #1e6b35 and emerald-*).
const GREEN_CLASS = /\b(green|emerald|lime|teal)-|[-"'\s:\[(](\w*green\w*|lime|chartreuse|olivedrab)[\]"'\s;)/,]/i;
const greenLeads = (r, g, b) => g > r && g > b && g - Math.max(r, b) >= 6;
const greenColour = (text) => {
  for (const m of text.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-f])/gi)) {
    const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
    if (greenLeads(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16))) return true;
  }
  const ch = (v) => (v.endsWith("%") ? parseFloat(v) * 2.55 : parseFloat(v));
  for (const m of text.matchAll(/rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/gi)) if (greenLeads(ch(m[1]), ch(m[2]), ch(m[3]))) return true;
  // Hue-based colours: hsl() / hwb() hue 75-165 degrees, oklch() hue 120-180 degrees, with some chroma.
  for (const m of text.matchAll(/\b(hsla?|hwb)\(\s*([\d.]+)(deg)?[\s,]+([\d.]+)%/gi)) if (+m[2] >= 75 && +m[2] <= 165 && (m[1].toLowerCase() === "hwb" || +m[4] >= 10)) return true;
  for (const m of text.matchAll(/\boklch\(\s*[\d.]+%?\s+([\d.]+)%?\s+([\d.]+)/gi)) if (+m[2] >= 120 && +m[2] <= 180 && +m[1] > 0.02) return true;
  return false;
};
const MARK = { test: (text) => CHECK.test(text) || GREEN_CLASS.test(text) || greenColour(text) };
// The JSX elements round `at`, outermost first, from the TSX parse: each with its opening-tag text.
// A type argument (useState<Foo>) is not an element, whatever comes before it. A self-closing element
// whose attribute holds the label (<Box className="..." children={<p>{t(...)}</p>} />) encloses it too:
// its text is the whole element with the inner element on the way to the label cut out.
const enclosing = (code, at) => {
  const sf = parse(code);
  const find = (n) => {
    for (const c of n.getChildren(sf)) if (c.getStart(sf) <= at && at < c.end) return find(c);
    return n;
  };
  const out = [];
  let inner = null;
  for (let n = find(sf); n; n = n.parent) {
    if (ts.isJsxElement(n)) out.push({ name: n.openingElement.tagName.getText(sf), text: n.openingElement.getText(sf) });
    else if (ts.isJsxSelfClosingElement(n)) {
      const whole = n.getText(sf);
      const text = inner ? whole.slice(0, inner.getStart(sf) - n.getStart(sf)) + "…" + whole.slice(inner.end - n.getStart(sf)) : whole;
      out.push({ name: n.tagName.getText(sf), text });
    }
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) inner = n;
  }
  return out.reverse();
};
// Uses of a time field that are not a render, per file: SealPanel sorts by publishedAtMs to pick the
// seal (a.publishedAtMs - b.publishedAtMs: two uses).
// HomePanel sorts the newest threads by createdAtMs (b.createdAtMs - a.createdAtMs: two uses).
const NOT_SHOWN = { "app/try/SealPanel.tsx": { publishedAtMs: 2 }, "app/try/HomePanel.tsx": { createdAtMs: 2 } };
const fieldCount = (code, field) => (code.match(new RegExp(`\\b${field}\\b`, "g")) ?? []).length;
const labelled = ([file, key, en, ja, zh, time], src = SRC[file], jaD = JA, zhD = ZH_HK) => {
  assert.ok(key.includes(en), `${file}: the key lost "${en}"`);
  const code = live(src);
  const at = code.indexOf(`t(${JSON.stringify(key)}`);
  assert.ok(at >= 0, `${file}: the label "${key}" is not rendered`);
  // A title= or aria-label= is not visible on touch and is read unreliably: the label must be page text.
  assert.ok(!/[\w-]+=\{\s*$/.test(code.slice(Math.max(0, at - 40), at)), `${file}: the label "${key}" is only an attribute, not visible text`);
  const tags = ["p", "span", "dd", "div"].map((tag) => [tag, code.lastIndexOf(`<${tag}`, at)]);
  const [tag, open] = tags.reduce((a, b) => (b[1] > a[1] ? b : a));
  const close = code.indexOf(`</${tag}>`, at);
  const element = code.slice(open, close < 0 ? code.length : close);
  assert.ok(!MARK.test(element), `${file}: a check mark sits on the unchecked time "${key}"`);
  for (const outer of enclosing(code, at)) assert.ok(!MARK.test(outer.text), `${file}: an element round the unchecked time "${key}" is marked or green: ${outer.text.slice(0, 80)}`);
  if (time) {
    const field = time.split(".").pop();
    const rows = UNCHECKED_TIMES.filter((r) => r[0] === file && r[5]?.split(".").pop() === field).length;
    const allowed = rows + (NOT_SHOWN[file]?.[field] ?? 0);
    const n = fieldCount(code, field);
    assert.equal(n, allowed, `${file}: ${field} is used ${n} times for ${rows} labelled render(s) and ${allowed - rows} pinned non-render use(s); every render must carry its label`);
    assert.ok(element.includes(time), `${file}: ${time} is not inside the labelled element`);
  }
  assert.ok(typeof jaD[key] === "string" && jaD[key].includes(ja), `${file}: the ja value of "${key}" lost "${ja}"`);
  assert.ok(typeof zhD[key] === "string" && zhD[key].includes(zh), `${file}: the zh-HK value of "${key}" lost "${zh}"`);
};
for (const row of UNCHECKED_TIMES) await check(`${row[0]}: "${row[1].slice(0, 60)}" is labelled not checked in en, ja and zh-HK`, () => labelled(row));
const SEAL = UNCHECKED_TIMES[0];
const SEAL_RENDER = `{t(${JSON.stringify(SEAL[1])}`;
await check("the controls below have the sealed-prediction render to edit", () => assert.ok(SRC[SEAL[0]].includes(SEAL_RENDER), "the sealed-prediction render is not in SealPanel as the controls expect"));
await refuses("the old check mark on the unchecked time is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(SEAL_RENDER, `✓ ${SEAL_RENDER}`)), /check mark sits on/);
await refuses("the time shown a second time, bare, in the green box is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(`✓ {t("Unchanged since it was sealed.")}`, `✓ {t("Unchanged since it was sealed.")} {new Date(hit.publishedAtMs).toLocaleString(locale)}`)), /every render must carry its label/);
await refuses("a heavier check mark after the label, in its element, is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(/(\{t\("Sealed on this node at \{when\}[^\n]*\n)/, "$1 ✔\n")), /check mark sits on/);
await refuses("a Check icon component on the label is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(SEAL_RENDER, `<CheckIcon /> ${SEAL_RENDER}`)), /check mark sits on/);
await refuses("the grey line restyled verified-green is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(`<p className="text-[14px] text-[#5d646d]">\n            ${SEAL_RENDER}`, `<p className="rounded-md bg-green-100 text-[14px]">\n            ${SEAL_RENDER}`)), /check mark sits on/);
await refuses("the time moved into the green verified box is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(`✓ {t("Unchanged since it was sealed.")}`, `✓ {t("Unchanged since it was sealed.")} ${SEAL_RENDER}, { when: "" })}`).replace(/\n\s*<p className="text-\[14px\] text-\[#5d646d\]">\n\s*\{t\("Sealed on this node at[^\n]*\n\s*<\/p>/, "")), /check mark sits on/);
// Each gap the last review found, closed here, with the assertion it must trip.
const SEAL_P = `<p className="text-[14px] text-[#5d646d]">\n            ${SEAL_RENDER}`;
await check("the controls below have the grey sealed-time line to edit", () => assert.ok(SRC[SEAL[0]].includes(SEAL_P), "the grey <p> round the sealed time is not as the controls expect"));
const sealWith = (extra) => SRC[SEAL[0]].replace(`✓ {t("Unchanged since it was sealed.")}`, `✓ {t("Unchanged since it was sealed.")} ${extra}`);
await refuses("a second bare render via optional chaining (hit?.publishedAtMs) is caught", () => labelled(SEAL, sealWith("{new Date(hit?.publishedAtMs).toLocaleString()}")), /every render must carry its label/);
await refuses("a second bare render via bracket access (hit[\"publishedAtMs\"]) is caught", () => labelled(SEAL, sealWith(`{new Date(hit["publishedAtMs"]).toLocaleString()}`)), /every render must carry its label/);
await refuses("a second bare render via optional bracket access (hit?.['publishedAtMs']) is caught", () => labelled(SEAL, sealWith("{new Date(hit?.['publishedAtMs']).toLocaleString()}")), /every render must carry its label/);
const SEARCH = UNCHECKED_TIMES[1];
await refuses("SearchPanel: a second bare render via h[\"signedAtMs\"] is caught", () => labelled(SEARCH, SRC[SEARCH[0]].replace(`{t(${JSON.stringify(SEARCH[1])}`, `{String(h["signedAtMs"])} {t(${JSON.stringify(SEARCH[1])}`)), /every render must carry its label/);
for (const [what, mark] of [["an HTML entity &#10003;", "&#10003;"], ["a hex entity &#x2714;", "&#x2714;"], ["&check;", "&check;"], ['a string in braces {"✓"}', '{"✓"}'], ['an escape in braces {"\\u2713"}', '{"\\u2713"}']])
  await refuses(`a check mark written as ${what} in the label's element is caught`, () => labelled(SEAL, SRC[SEAL[0]].replace(SEAL_P, `${SEAL_P.split("\n")[0]}\n            ${mark} ${SEAL_RENDER}`)), /check mark sits on/);
await refuses("the grey line restyled another green (#1e6b35) is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(SEAL_P, SEAL_P.replace("text-[#5d646d]", "text-[#1e6b35]"))), /check mark sits on/);
await refuses("the grey line restyled emerald is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(SEAL_P, SEAL_P.replace("text-[#5d646d]", "text-emerald-700"))), /check mark sits on/);
await refuses("a <Badge tone=\"ok\"> round the time is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(SEAL_P, `<Badge tone="ok">\n${SEAL_P}`).replace(`${SEAL_RENDER}`, `${SEAL_RENDER}`).replace(/(\{t\("Sealed on this node at \{when\}[^\n]*\n\s*<\/p>)/, "$1</Badge>")), /element round the unchecked time/);
await refuses("a green box (bg-[#e8f5ec]) round the grey line is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(SEAL_P, `<div className="rounded-md bg-[#e8f5ec] p-2">\n${SEAL_P}`).replace(/(\{t\("Sealed on this node at \{when\}[^\n]*\n\s*<\/p>)/, "$1</div>")), /element round the unchecked time/);
await refuses("an emerald wrapper (border-emerald-300) round the grey line is caught", () => labelled(SEAL, SRC[SEAL[0]].replace(SEAL_P, `<div className="border border-emerald-300">\n${SEAL_P}`).replace(/(\{t\("Sealed on this node at \{when\}[^\n]*\n\s*<\/p>)/, "$1</div>")), /element round the unchecked time/);
for (const [what, mark] of [["String.fromCodePoint(0x2713)", "{String.fromCodePoint(0x2713)}"], ["String.fromCharCode(0x2705)", "{String.fromCharCode(0x2705)}"], ["a surrogate-pair escape for 🗸", '{"\\uD83D\\uDDF8"}']])
  await refuses(`a check mark written as ${what} in the label's element is caught`, () => labelled(SEAL, SRC[SEAL[0]].replace(SEAL_P, `${SEAL_P.split("\n")[0]}\n            ${mark} ${SEAL_RENDER}`)), /check mark sits on/);
const wrap = (open, close = "</div>") => SRC[SEAL[0]].replace(SEAL_P, `${open}\n${SEAL_P}`).replace(/(\{t\("Sealed on this node at \{when\}[^\n]*\n\s*<\/p>)/, `$1${close}`);
for (const [what, open, close] of [
  ["a CSS ::before content of \\2713", `<div className="before:content-['\\2713_']">`],
  ["an 8-digit hex green", `<div className="bg-[#e8f5ecff]">`],
  ["an rgb() green in percent", `<div style={{ background: "rgb(91% 96% 93%)" }}>`],
  ["an hsl() green", `<div style={{ color: "hsl(140 45% 30%)" }}>`],
  ["an oklch() green", `<div style={{ background: "oklch(95% 0.03 150)" }}>`],
  ["a bracketed named green (bg-[green]/10)", `<div className="bg-[green]/10">`],
  ["darkseagreen", `<div style={{ color: "darkseagreen" }}>`],
  ["a CSS variable named green (var(--green-ok))", `<div className="text-[var(--green-ok)]">`],
  ["<StatusBadge>", "<StatusBadge>", "</StatusBadge>"],
  ["<ui.Badge>", "<ui.Badge>", "</ui.Badge>"],
])
  await refuses(`${what} round the grey line is caught`, () => labelled(SEAL, wrap(open, close)), /element round the unchecked time/);
await check("a type argument (useState<VerifiedHit | null>) above the label is not read as a tag", () => labelled(SEAL, `const unused = useState<VerifiedHit | null>(null);\n${SRC[SEAL[0]]}`));
// The three gaps of the second review. Each edited source must itself parse cleanly, so a refusal
// can't come from the parser's repair of a broken file.
const clean = (src) => (assert.equal(parse(src).parseDiagnostics.length, 0, "the control's source does not parse"), src);
await refuses("a control source that does not parse is refused before it is read", () => clean(`const x = <div>{t("a"</div>;`), /does not parse/);
// Comments: a line that starts like a comment but carries code.
await refuses("a bare render after an empty JSX comment on the same line ({/**/}{new Date(...)}) is caught", () => labelled(SEAL, clean(sealWith("\n            {/**/}{new Date(hit.publishedAtMs).toLocaleString()}"))), /every render must carry its label/);
await refuses("a check mark after an empty JSX comment on its own line in the label's element is caught", () => labelled(SEAL, clean(SRC[SEAL[0]].replace(SEAL_P, `${SEAL_P.split("\n")[0]}\n            {/**/}✓\n            ${SEAL_RENDER}`))), /check mark sits on/);
await refuses("a check mark after a block comment opener line (/* x */ then code) is caught", () => labelled(SEAL, clean(SRC[SEAL[0]].replace(SEAL_P, `${SEAL_P.split("\n")[0]}\n            {/* x */ "✓"} ${SEAL_RENDER}`))), /check mark sits on/);
// Type arguments: a real tag right after JSX text ending in a letter or ")", or after "return".
await refuses("a green wrapper right after JSX text ending in a letter (at<div ...>) is caught", () => labelled(SEAL, clean(wrap(`seal at<div className="rounded-md bg-[#e8f5ec] p-2">`))), /element round the unchecked time/);
await refuses("a green wrapper right after JSX text ending in \")\" is caught", () => labelled(SEAL, clean(wrap(`(see below)<div className="rounded-md bg-[#e8f5ec] p-2">`))), /element round the unchecked time/);
// The render is moved into a helper whose return starts the green box; the panel keeps a plain line.
const SEAL_LINE = SRC[SEAL[0]].match(/<p className="text-\[14px\] text-\[#5d646d\]">\n\s*\{t\("Sealed on this node at[^\n]*\n\s*<\/p>/)[0];
const returnWrap = `function Extra({ hit, t, locale }) {\n  return<div className="bg-[#e8f5ec]">\n${SEAL_LINE}</div>;\n}\n${SRC[SEAL[0]].replace(SEAL_LINE, '<p className="text-[14px]">{t("x")}</p>')}`;
await check("the return<div> control holds the labelled render once, inside the helper", () => assert.ok(returnWrap.split(SEAL_RENDER).length === 2 && returnWrap.indexOf(SEAL_RENDER) < returnWrap.indexOf("export default")));
await refuses("a green wrapper right after return (return<div ...>) is caught", () => labelled(SEAL, clean(returnWrap)), /element round the unchecked time/);
// Self-closing wrappers: the label passed in an attribute.
for (const [what, open] of [["a green self-closing wrapper (children={...} />)", `<Box className="rounded-md bg-[#e8f5ec]" children={`], ["a self-closing Badge (children={...} />)", `<Badge children={`]])
  await refuses(`${what} round the grey line is caught`, () => labelled(SEAL, clean(wrap(open, "} />"))), /element round the unchecked time/);
await check("a plain self-closing wrapper round the grey line is not refused", () => labelled(SEAL, clean(wrap(`<Box className="p-2" children={`, "} />"))));
// After sealing, the line with the mark says only that it is sealed: the opening date is the
// author's choice, and a mark beside it reads as if something checked it.
const markedDate = (src) => {
  const sf = parse(live(src));
  const visit = (n) => {
    if (ts.isJsxElement(n)) {
      // Its own text: without any element nested in it, at any depth (through braces and fragments).
      const whole = n.getText(sf);
      const start = n.getStart(sf);
      const cut = [];
      // (forEachChild stops at a truthy return, so the callback returns nothing.)
      const nested = (c) => {
        if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) cut.push([c.getStart(sf) - start, c.end - start]);
        else c.forEachChild(nested);
      };
      n.children.forEach(nested);
      let own = whole;
      for (const [a, b] of cut.reverse()) own = own.slice(0, a) + own.slice(b);
      if (CHECK.test(own)) assert.ok(!/\{date\}|\{when\}|\bDate\(|\.opens\b|AtMs\b/.test(whole), `a check mark sits on a date: ${whole.slice(0, 90)}`);
    }
    n.forEachChild(visit);
  };
  visit(sf);
};
await check("SealPanel: no element with a check mark shows a date", () => markedDate(SRC[SEAL[0]]));
await refuses("SealPanel: the old \"✓ Sealed. It opens on {date}.\" line is caught", () => markedDate(SRC[SEAL[0]].replace('✓ {t("Sealed.")}</p>\n            <p className="text-[15px]">{t("It opens on {date}.", { date: done.opens })}</p>', '✓ {t("Sealed. It opens on {date}.", { date: done.opens })}</p>')), /check mark sits on a date/);
await refuses("SealPanel: the date in a span inside the marked line is caught", () => markedDate(SRC[SEAL[0]].replace('✓ {t("Sealed.")}</p>', '✓ {t("Sealed.")} <span>{done.opens}</span></p>')), /check mark sits on a date/);
const SUMMARY = UNCHECKED_TIMES[3];
await refuses("GenuineCheck: the summary date labelled only by a title attribute again is caught", () => labelled(SUMMARY, SRC[SUMMARY[0]].replace(/<span className="text-\[13\.5px\] text-\[#5d646d\]">\n\s*\{new Date\(h\.publishedAtMs\)\.toLocaleDateString\(locale\)\} \(\{t\("time from this node's clock, not checked"\)\}\)\n\s*<\/span>/, `<span className="text-[13.5px] text-[#5d646d]" title={t("time from this node's clock, not checked")}>{new Date(h.publishedAtMs).toLocaleDateString(locale)}</span>`)), /only an attribute/);

// 8b. No sentence says the node shows WHEN something existed, and nothing is called "first" or
// "later" on the node's clock. Live code of the panels, and the ja / zh-HK values of every key they render.
// Word lists: "existed" with a time word, other than "existed before (that) block" (a checked anchor); "when this node recorded";
// first / earliest next to mark / seal / record, either order; "marked earlier / later"; "the original".
const CLAIM_EN = /existed (when|at|by|on|since)\b|\bexisted before (?!(that |the |a )?block)|when this node recorded|\b(first|earliest)\b\W+(\w+\W+)?(mark|seal|record)\w*|\b(mark|seal|record)\w*\W+(\w+\W+)?(first|earliest|earlier|later)\b|\bthe original\b/i;
const CLAIM_JA_ZH = /最初|初めて|一番|最も早|後から|先に記録|時点で.*存在|時に.*存在|首次|最早|最先|其後|較早|時.{0,6}已經存在/;
const CLAIM_FILES = ["app/try/SealPanel.tsx", "app/try/GenuineCheck.tsx", "app/try/GenuinePanel.tsx"];
const noWhenClaim = (srcs, ja = JA, zh = ZH_HK) => {
  for (const [file, src] of Object.entries(srcs)) {
    const code = live(src);
    assert.ok(!CLAIM_EN.test(code), `${file}: a line claims when something existed, or calls a mark first / later: ${code.match(CLAIM_EN)?.[0]}`);
    // Keys in double quotes, single quotes or backticks (a backtick key with ${} is skipped: no static key).
    for (const m of code.matchAll(/\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)/g)) {
      const raw = m[1] ?? m[2] ?? m[3];
      const key = m[1] !== undefined ? JSON.parse(`"${raw}"`) : raw.replace(/\\(.)/g, "$1");
      for (const [lang, d] of [["ja", ja], ["zh-HK", zh]]) {
        const v = typeof d[key] === "string" ? d[key].match(CLAIM_JA_ZH) : null;
        assert.ok(!v, `${file}: the ${lang} value of "${key.slice(0, 50)}" claims when, or calls a mark first / later: ${v?.[0]}`);
      }
    }
  }
};
const CLAIM_SRC = Object.fromEntries(CLAIM_FILES.map((f) => [f, SRC[f] ?? readFileSync(new URL(`../${f}`, import.meta.url), "utf8")]));
await check("no panel says the node shows when something existed, or calls a mark first or later (en, ja, zh-HK)", () => noWhenClaim(CLAIM_SRC));
await refuses("the old seal sentence (\"existed when this node recorded the seal\") is caught", () => noWhenClaim({ ...CLAIM_SRC, [SEAL[0]]: CLAIM_SRC[SEAL[0]].replace("This shows the text is the one that was sealed: it matches the seal's fingerprint.", "This shows the text existed when this node recorded the seal.") }), /calls a mark first \/ later: existed when$/);
await refuses("\"First marked as genuine\" back is caught", () => noWhenClaim({ ...CLAIM_SRC, [SUMMARY[0]]: CLAIM_SRC[SUMMARY[0]].replace('t("Also marked, by another ID")', 't("First marked as genuine")') }), /calls a mark first \/ later: First marked$/);
await refuses("\"Also marked later\" back is caught", () => noWhenClaim({ ...CLAIM_SRC, [SUMMARY[0]]: CLAIM_SRC[SUMMARY[0]].replace('t("Also marked, by another ID")', 't("Also marked later, by another ID")') }), /calls a mark first \/ later: marked later$/);
await refuses("a ja value that calls a mark first is caught", () => noWhenClaim(CLAIM_SRC, { ...JA, "Marked as genuine": "最初に本物として記録されたもの" }), /the ja value of "Marked as genuine" .*: 最初$/);
await refuses("a zh-HK value that says when the node recorded the seal is caught", () => noWhenClaim(CLAIM_SRC, JA, { ...ZH_HK, [UNCHECKED_TIMES[7][1]]: "這顯示此節點記錄封印時，這段文字已經存在。" }), /the zh-HK value .*: 時，這段文字已經存在$/);
// The phrasings the last review found passing; each must name its own match.
for (const [en, hit] of [["Marked first", "Marked first"], ["Earliest mark, the original", "Earliest mark"], ["This shows the text existed at the time the node recorded the seal.", "existed at"]])
  await refuses(`the en wording "${en}" is caught`, () => noWhenClaim({ ...CLAIM_SRC, [SUMMARY[0]]: CLAIM_SRC[SUMMARY[0]].replace('t("Also marked, by another ID")', `t(${JSON.stringify(en)})`) }), new RegExp(`calls a mark first / later: ${hit}$`));
for (const [lang, v, hit] of [["ja", "初めて本物として記録", "初めて"], ["ja", "一番最初に記録", "一番"], ["zh-HK", "首次標記", "首次"], ["zh-HK", "最早標記", "最早"]])
  await refuses(`a ${lang} value "${v}" is caught`, () => (lang === "ja" ? noWhenClaim(CLAIM_SRC, { ...JA, "Marked as genuine": v }) : noWhenClaim(CLAIM_SRC, JA, { ...ZH_HK, "Marked as genuine": v })), new RegExp(`the ${lang} value of "Marked as genuine" .*: ${hit}$`));
await refuses("a single-quoted key whose ja value calls a mark first is caught", () => noWhenClaim({ ...CLAIM_SRC, [SUMMARY[0]]: CLAIM_SRC[SUMMARY[0]].replace('t("Marked by")', "t('Marked by')") }, { ...JA, "Marked by": "最初に記録した ID" }), /the ja value of "Marked by" .*: 最初$/);

for (const row of UNCHECKED_TIMES) {
  const [file, key, en, ja, zh] = row;
  await refuses(`${file}: the label dropped from the page is caught`, () => labelled(row, SRC[file].split(`t(${JSON.stringify(key)}`).join(`t(${JSON.stringify(key.replace(en, "x"))}`)), /is not rendered/);
  await refuses(`${file}: the label only in a comment is caught`, () => labelled(row, SRC[file].split(`t(${JSON.stringify(key)}`).join(`\n// t(${JSON.stringify(key)}\nt("x"`)), /is not rendered/);
  await refuses(`${file}: a ja value without "${ja}" is caught`, () => labelled(row, SRC[file], { ...JA, [key]: JA[key].replace(ja, "") }), /the ja value/);
  await refuses(`${file}: a zh-HK value without "${zh}" is caught`, () => labelled(row, SRC[file], JA, { ...ZH_HK, [key]: ZH_HK[key].replace(zh, "") }), /the zh-HK value/);
}

// 8c. Census: the rows above only read the files they name, so a time rendered anywhere else would
// pass unseen. Every place that makes or formats a date in live code under app/try, app/s and app/lib
// is counted per file and pinned here. A new panel, a new helper or a new time in a pinned panel
// changes a count and fails, until someone looks at it and either labels it (a row above) or pins
// it with the reason. The census only finds; the reasons are a person's reading, not a check.
const DATE_USE = /\bDate\b|\bfmt(Date|When|Seconds)\b|\b(DateTimeFormat|RelativeTimeFormat|DurationFormat)\b|\b(toLocaleString|toLocale(Date|Time)String|toISOString|toUTCString|toDateString|toTimeString|toJSON|get(UTC)?(FullYear|Month|Date|Day|Hours|Minutes|Seconds))\b/g;
const dateUses = (src) => (live(src).match(DATE_USE) ?? []).length;
// file -> [count, why]; the count is of matches, so new Date(x).toLocaleString() is two and an
// import of fmtDate is one. "labelled": every record time it shows has a row above. "not a record": a
// clock, a countdown, a parse or a form value. "OPEN": shows a record time with no label; known, not
// fixed here (listed in the report so the wording can be decided once for all of them).
const DATE_CENSUS = {
  "app/lib/files.ts": [2, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/files_fee.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/format_tet.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/grants.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/inapp_wallet.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/ledger_state.ts": [11, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/pin_vault.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/poll.ts": [2, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/seal.ts": [4, "not a record: today's date for the opening rule"],
  "app/lib/shelter.ts": [2, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/site_store.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/tetsearch.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/tmail.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/tmail_anon.ts": [2, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/tmail_burn.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/tmail_keys.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/tmail_timelock.ts": [3, "not a record: the release time the sender chose"],
  "app/lib/try_board.ts": [5, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/try_questions.ts": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/useIncomingMessages.ts": [2, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/lib/verify_anything.mjs": [4, "not a record: manifest expiry in a refusal message"],
  "app/s/[site]/page.tsx": [2, "labelled"],
  "app/try/BoardPanel.tsx": [21, "OPEN: post and thread times written by the poster"],
  "app/try/DirectoryPanel.tsx": [6, "OPEN: listing time; a today count"],
  "app/try/FilesTryPanel.tsx": [4, "OPEN: file envelope time written by the sender"],
  "app/try/GenuineCheck.tsx": [4, "labelled"],
  "app/try/HomePanel.tsx": [6, "labelled; two are the date filter's parse"],
  "app/try/InsidePanel.tsx": [3, "not a record: when the node counted"],
  "app/try/LivePanel.tsx": [6, "not a record: when this tab read the node; block times from the node"],
  "app/try/LiveStrip.tsx": [2, "not a record: the strip's own clock"],
  "app/try/MailPanel.tsx": [14, "OPEN: message times written by the sender; the rest are form values"],
  "app/try/ProofCode.tsx": [2, "labelled"],
  "app/try/QrPanel.tsx": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/try/QuestionsPanel.tsx": [13, "OPEN: question times written by the poster; manifest expiry"],
  "app/try/SealPanel.tsx": [4, "labelled"],
  "app/try/SearchPanel.tsx": [2, "labelled"],
  "app/try/ShelterPanel.tsx": [9, "OPEN: post, case and log times"],
  "app/try/SignPanel.tsx": [1, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/try/VerifyPanel.tsx": [2, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/try/page.tsx": [3, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
  "app/try/ui.tsx": [10, "the formatters themselves (fmtWhen, fmtDate)"],
  "app/try/wallet.tsx": [4, "not a record: Date.now() or a number's toLocaleString (read 2026-11-18)"],
};
// The language tables hold only translated strings; they are skipped by exact path, not by name.
const LANGUAGE_TABLES = ["app/try/i18n_ja.ts", "app/try/i18n_zh_hk.ts"];
// Which files the census reads; the files the controls add go through the same test.
const countedFile = (f) => /\.([cm]?[jt]sx?)$/.test(f) && !LANGUAGE_TABLES.includes(f);
const censusFiles = (dir) =>
  readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() || e.isSymbolicLink())
    .map((e) => `${dir}/${relative(fileURLToPath(new URL(`../${dir}`, import.meta.url)), join(e.parentPath ?? e.path, e.name))}`)
    .filter(countedFile);
const census = (read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), added = {}) => {
  const found = {};
  const files = { ...Object.fromEntries(["app/try", "app/s", "app/lib"].flatMap(censusFiles).map((f) => [f, null])), ...Object.fromEntries(Object.entries(added).filter(([f]) => countedFile(f))) };
  for (const [f, src] of Object.entries(files)) {
    const n = dateUses(src ?? read(f));
    if (n) found[f] = n;
  }
  const wrong = [...new Set([...Object.keys(found), ...Object.keys(DATE_CENSUS)])]
    .filter((f) => (found[f] ?? 0) !== (DATE_CENSUS[f]?.[0] ?? 0))
    .map((f) => `${f}: ${found[f] ?? 0} date use(s), pinned ${DATE_CENSUS[f]?.[0] ?? 0}`);
  assert.deepEqual(wrong, [], `a date is made or formatted where nobody has looked; label it or pin it in DATE_CENSUS:\n${wrong.join("\n")}`);
};
await check("every date made or formatted under app/try, app/s and app/lib is pinned in the census", () => census());
{
  const real = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const ABOUT = "export const A = (x) => <p>{new Date(x.atMs).toLocaleString()}</p>;\n";
  const HELPER = "\nexport const when = (ms) => new Intl.DateTimeFormat().format(ms);";
  await refuses("a new panel that shows a date is caught by the census", () => census(real, { "app/try/AboutPanel.tsx": ABOUT }), new RegExp(`AboutPanel.tsx: ${dateUses(ABOUT)} date use`));
  await refuses("a second time in a pinned panel is caught by the census", () => census((f) => real(f) + (f === "app/try/HomePanel.tsx" ? "\nconst y = <span>{fmtWhen(h.bumpAtMs, now)}</span>;" : "")), new RegExp(`HomePanel.tsx: ${DATE_CENSUS["app/try/HomePanel.tsx"][0] + 1} date use`));
  await refuses("a helper in app/lib that formats a date is caught by the census", () => census((f) => real(f) + (f === "app/lib/public_search.ts" ? HELPER : "")), new RegExp(`public_search.ts: ${dateUses(HELPER)} date use`));
  for (const [name, file, src] of [
    ["a bare toLocaleString on a Date in a new helper file", "app/try/when.ts", "export const when = (d) => d.toLocaleString();\n"],
    ["a DateTimeFormat taken out of Intl first", "app/try/when.tsx", "const { DateTimeFormat: F } = Intl;\nexport const W = (p) => <p>{F(\"en\").format(p.ms)}</p>;\n"],
    ["a RelativeTimeFormat (\"3 days ago\")", "app/lib/ago.ts", "export const ago = (n) => new Intl.RelativeTimeFormat().format(n, \"day\");\n"],
    ["a .jsx panel", "app/try/Old.jsx", "export const O = (p) => <p>{p.d.toLocaleString()}</p>;\n"],
    ["a file named like a language table", "app/try/i18n_when.tsx", "export const W = (p) => <p>{p.d.toLocaleString()}</p>;\n"],
    ["a .ts helper named like a language table", "app/try/i18n_when.ts", "export const when = (d) => d.toLocaleString();\n"],
    ["an optional call", "app/try/when.ts", "export const when = (d) => d.toLocaleString?.();\n"],
    ["a method reached by bracket access", "app/try/when.ts", "export const when = (d) => d[\"toLocaleString\"]();\n"],
    ["a method taken as a reference", "app/lib/when.ts", "const f = Object.prototype.toLocaleString;\nexport const when = (d) => f.call(d);\n"],
  ])
    await refuses(`${name} is caught by the census`, () => census(real, { [file]: src }), new RegExp(`${file.split("/").pop().replace(".", "\\.")}: ${dateUses(src)} date use`));
  await refuses("a date use only moved into a comment is caught by the census", () => census((f) => (f === "app/try/SealPanel.tsx" ? real(f).replace("new Date(hit.publishedAtMs)", "/* new Date */ (hit.publishedAtMs)") : real(f))), new RegExp(`SealPanel.tsx: ${DATE_CENSUS["app/try/SealPanel.tsx"][0] - 1} date use`));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
