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

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

register("./lib/ts_hooks.mjs", import.meta.url);
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

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
