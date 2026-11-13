// Guard for /market (app/market/): the prototype's checks, its wording and its promises.
//
//   node --experimental-strip-types scripts/market_guard.mjs
//
// Every record here is signed for real (market_checks.ts: Ed25519 + ML-DSA-44, the Sign anything
// envelope) and checked by the page's own verifier (verify_anything.mjs). No mock.
//
// D. Delivery. The honest handover is accepted. Each refusal is built so it passes every earlier check
//    (every record validly signed by the key that signs it), and asserts its own code:
//    D1 the same permit a second time -> permit_used (and the same handover with a fresh list is
//       accepted, so only the used list refuses it); D2 a tag on the parcel that differs -> tag_mismatch;
//    D3 a courier the permit does not name signs -> courier_not_permitted; D4 a permit signed by a key
//    that is not the courier service -> permit_not_service; D5 another key signs as the receiver ->
//    receiver_not_parcel; D6 one signature half replaced by a valid half from another record, once per
//    half -> parcel_signature; D7 the rendered record says "a verified courier" and never the courier's key.
// B. Booking. B1 a shop counts its own no-shows for its pseudonym; B2 the two pseudonyms differ; B3 a
//    shop given every record of both shops counts only its own, for its own pseudonym, and nothing for
//    the other shop's pseudonym; B4 a no-show signed by any key but the shop's is not counted; B5 a
//    booking signed by any key but the pseudonym is not counted. In-guard control: a naive count
//    (every "no-show" in the records) fails B3 and B4.
// L. Listing. L1 a review by the receipt's key is accepted; L2 a second review on that receipt ->
//    receipt_used; L3 no receipt -> no_receipt; L4 a receipt signed by another shop -> receipt_not_shop;
//    L5 a copy of the receipt used by another key -> not_receipt_holder; L6 a receipt for another
//    listing -> receipt_other; L7 an edited listing -> listing_signature.
// S. Shows / Does not show: every result card, ACCEPTED and REFUSED, of every tab, renders both
//    lists, every item, after the verdict, in English and Japanese.
// T. The status banner "prototype, local only" is the first thing on the page (English, Japanese).
// N. Nothing is sent: no fetch / XMLHttpRequest / sendBeacon / WebSocket / EventSource / form / node
//    API in app/market, and every flow above ran with those stubbed to record calls: none.
// P. Nothing here moves value: every record that has a payment field says "outside TET (cash, bank, …)",
//    no record has an amount, and the rendered payment line says the same.
// W. Every string the page shows has Japanese and Hong Kong Chinese, with the same {placeholders};
//    no "prove"/"proof"/"untraceable"/"guarantee" and no "pay with TET" wording in any language.

import { register, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const UI = new URL("../", import.meta.url);
const require = createRequire(new URL("package.json", UI));
register("./lib/ts_hooks.mjs", import.meta.url);
register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { readFileSync } from "node:fs";
      import { fileURLToPath } from "node:url";
      import { createRequire } from "node:module";
      const ts = createRequire(${JSON.stringify(new URL("package.json", UI).pathname)})("typescript");
      export async function load(url, context, next) {
        if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context);
        const out = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          fileName: fileURLToPath(url),
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        });
        return { format: "module", source: out.outputText, shortCircuit: true };
      }`),
);

// N: every way out is stubbed before the page's modules load, and every call is recorded.
const calls = [];
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) {
  globalThis[name] = function () {
    calls.push(name);
    throw new Error(`${name} called`);
  };
}
Object.defineProperty(globalThis.navigator, "sendBeacon", { configurable: true, value: () => (calls.push("sendBeacon"), false) });

const m = await import("../app/market/market_checks.ts");
const page = await import("../app/market/Market.tsx");
const { MARKET_DICTS } = await import("../app/market/i18n_market.ts");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const h = React.createElement;

const read = (rel) => readFileSync(new URL(rel, UI), "utf8");
const SRC = { page: read("app/market/Market.tsx"), checks: read("app/market/market_checks.ts"), route: read("app/market/page.tsx"), i18n: read("app/market/i18n_market.ts") };

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
const code = (r) => (r.ok ? "accepted" : r.code);
// React's escaping in renderToStaticMarkup, so a translated string can be found in the HTML.
const esc = (x) => x.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const T = { en: page.marketT("en"), ja: page.marketT("ja"), "zh-HK": page.marketT("zh-HK") };
const records = []; // every record payload made below, for P

const sign = async (key, type, rec) => {
  records.push(rec);
  return m.signRecord(key, type, rec);
};

// ── D. Delivery ─────────────────────────────────────────────────────────────────────────────────

const [S, R, SVC, C, C2, R2, OTHER] = await Promise.all(Array.from({ length: 7 }, () => m.freshKey()));
const TAG = "TET-PARCEL-0000A1B2";
const parcel = await sign(S, m.TYPE.parcel, m.parcelRecord(TAG, R.id, m.SAMPLE.contents));
const pr = m.courierPermit(TAG, C.id);
const permit = await sign(SVC, m.TYPE.courierPermit, pr);
const hand = m.handoverRecord(TAG, pr.permit_id, C.id, R.id);
const byC = await sign(C, m.TYPE.handover, hand);
const byR = await sign(R, m.TYPE.handover, hand);
const delivery = (over = {}) => m.checkDelivery({ parcel, tagOnParcel: TAG, permit, courierService: SVC.id, handoverByCourier: byC, handoverByReceiver: byR, used: new Set(), ...over });

await check("D0 the honest handover is accepted", async () => {
  const r = await delivery();
  assert.equal(code(r), "accepted");
  assert.equal(r.receiver, R.id);
  assert.equal(r.sender, S.id);
});

await check("D1 the same permit a second time is refused: permit_used (and only by the used list)", async () => {
  const used = new Set();
  assert.equal(code(await delivery({ used })), "accepted");
  assert.equal(code(await delivery({ used })), "permit_used");
  // The same handover against a list that has not seen it is accepted: nothing else refuses it.
  assert.equal(code(await delivery({ used: new Set() })), "accepted");
});

await check("D2 a tag on the parcel that differs from the signed one is refused: tag_mismatch", async () => {
  assert.equal(code(await delivery({ tagOnParcel: "TET-PARCEL-0000A1B3" })), "tag_mismatch");
});

await check("D3 a courier the permit does not name is refused: courier_not_permitted", async () => {
  // C2 holds no permit of its own. It signs, with its own key, the handover naming itself, and the
  // receiver signs the very same bytes; the parcel, the tag, the permit and its id are all genuine.
  const h2 = m.handoverRecord(TAG, pr.permit_id, C2.id, R.id);
  const r = await delivery({ handoverByCourier: await sign(C2, m.TYPE.handover, h2), handoverByReceiver: await sign(R, m.TYPE.handover, h2) });
  assert.equal(code(r), "courier_not_permitted");
});

await check("D4 a permit signed by a key that is not the courier service is refused: permit_not_service", async () => {
  const forged = await sign(OTHER, m.TYPE.courierPermit, pr); // the same permit, validly signed by OTHER
  assert.equal(code(await delivery({ permit: forged })), "permit_not_service");
});

await check("D5 another key signing as the receiver is refused: receiver_not_parcel", async () => {
  // The handover names R; R2 signs exactly those bytes.
  assert.equal(code(await delivery({ handoverByReceiver: await sign(R2, m.TYPE.handover, hand) })), "receiver_not_parcel");
});

await check("D6 one signature half swapped for a valid half from another record is refused, per half", async () => {
  const other = await m.signRecord(S, m.TYPE.parcel, m.parcelRecord("TET-PARCEL-FFFF0000", R.id, "x"));
  for (const half of [0, 1]) {
    const sigs = parcel.signatures.map((s, i) => (i === half ? { ...s, sig: other.signatures[half].sig } : s));
    const r = await delivery({ parcel: { ...parcel, signatures: sigs } });
    assert.equal(code(r), "parcel_signature", `half ${half === 0 ? "Ed25519" : "ML-DSA-44"}`);
  }
});

await check("D7 the record shows \"a verified courier\" and never the courier's key", async () => {
  for (const lang of ["en", "ja"]) {
    // Everything the page holds for a delivery goes in, the courier's signed handover and key included,
    // so the only reason the key can be absent is that the record does not show it.
    const html = renderToStaticMarkup(h(page.DeliveryRecord, { t: T[lang], s: { sender: S, receiver: R, tag: TAG, contents: m.SAMPLE.contents, courier: C, byCourier: byC, permit } }));
    assert.ok(html.includes(esc(T[lang]("a verified courier"))), lang);
    assert.ok(!html.includes(C.id.slice(0, 8)), `${lang}: the courier's key is on the page`);
  }
});

// ── B. Booking ──────────────────────────────────────────────────────────────────────────────────

const [SHOP_A, SHOP_B, PA, PB] = await Promise.all(Array.from({ length: 4 }, () => m.freshKey()));
async function book(shop, pseudonym, outcome, visitSigner = shop, bookingSigner = pseudonym) {
  const b = m.bookingRecord(shop.id, pseudonym.id, "slot");
  return { booking: await sign(bookingSigner, m.TYPE.booking, b), visit: await sign(visitSigner, m.TYPE.visit, m.visitRecord(b.booking_id, outcome)) };
}
const atA = [await book(SHOP_A, PA, "no-show"), await book(SHOP_A, PA, "came"), await book(SHOP_A, PA, "no-show")];
const atB = [await book(SHOP_B, PB, "came")];
const all = [...atA, ...atB];
const naive = async (_shop, _pseudonym, recs) => ({ bookings: recs.length, noShows: recs.filter((r) => JSON.parse(atob(r.visit.payload)).outcome === "no-show").length });

async function b3(count) {
  assert.deepEqual(await count(SHOP_B.id, PB.id, all), { bookings: 1, noShows: 0 });
  assert.deepEqual(await count(SHOP_B.id, PA.id, all), { bookings: 0, noShows: 0 });
}
async function b4(count) {
  const forged = [...atA, await book(SHOP_A, PA, "no-show", OTHER)];
  assert.deepEqual(await count(SHOP_A.id, PA.id, forged), { bookings: 4, noShows: 2 });
}

await check("B1 a shop counts its own no-shows for its pseudonym", async () => {
  assert.deepEqual(await m.noShows(SHOP_A.id, PA.id, atA), { bookings: 3, noShows: 2 });
});
await check("B2 the buyer's pseudonyms at the two shops are different keys", async () => {
  assert.notEqual(PA.id, PB.id);
});
await check("B3 given every record of both shops, a shop counts only its own, for its own pseudonym", async () => {
  await b3(m.noShows);
});
await check("B4 a no-show signed by any key but the shop's is not counted", async () => {
  await b4(m.noShows);
});
await check("B5 a booking signed by any key but the pseudonym is not counted", async () => {
  const forged = [...atA, await book(SHOP_A, PA, "no-show", SHOP_A, OTHER)];
  assert.deepEqual(await m.noShows(SHOP_A.id, PA.id, forged), { bookings: 3, noShows: 2 });
});
await check("B control: a naive count (every no-show in the records) fails B3 and B4", async () => {
  await assert.rejects(() => b3(naive));
  await assert.rejects(() => b4(naive));
});

// ── L. Listing ──────────────────────────────────────────────────────────────────────────────────

const [SHOP, BUYER, SHOP2, STRANGER] = await Promise.all(Array.from({ length: 4 }, () => m.freshKey()));
const listing = await sign(SHOP, m.TYPE.listing, m.listingRecord(m.SAMPLE.listingTitle, m.SAMPLE.listingText));
const L = await m.checkListing(listing);
const rcRec = m.receiptRecord(L.listingId, BUYER.id);
const receipt = await sign(SHOP, m.TYPE.receipt, rcRec);
const review = (key, rid = rcRec.receipt_id, text = m.SAMPLE.review) => sign(key, m.TYPE.review, m.reviewRecord(L.listingId, rid, 5, text));
const reviewCheck = async (over) => m.checkReview({ listing, receipt, used: new Set(), ...over });

await check("L1 a review signed by the key the receipt names is accepted", async () => {
  assert.equal(L.ok, true);
  assert.equal(code(await reviewCheck({ review: await review(BUYER) })), "accepted");
});
await check("L2 a second review on the same receipt is refused: receipt_used (and only by the used list)", async () => {
  const used = new Set();
  assert.equal(code(await reviewCheck({ review: await review(BUYER), used })), "accepted");
  const second = await review(BUYER, rcRec.receipt_id, "Again.");
  assert.equal(code(await reviewCheck({ review: second, used })), "receipt_used");
  assert.equal(code(await reviewCheck({ review: second, used: new Set() })), "accepted");
});
await check("L3 a review with no receipt is refused: no_receipt", async () => {
  assert.equal(code(await reviewCheck({ review: await review(STRANGER, ""), receipt: null })), "no_receipt");
});
await check("L4 a receipt signed by another shop is refused: receipt_not_shop", async () => {
  const fake = await sign(SHOP2, m.TYPE.receipt, rcRec); // same receipt, validly signed by SHOP2
  assert.equal(code(await reviewCheck({ review: await review(BUYER), receipt: fake })), "receipt_not_shop");
});
await check("L5 a copy of the receipt used by another key is refused: not_receipt_holder", async () => {
  assert.equal(code(await reviewCheck({ review: await review(STRANGER) })), "not_receipt_holder");
});
await check("L6 a receipt for another listing is refused: receipt_other", async () => {
  const elsewhere = m.receiptRecord("0".repeat(64), BUYER.id);
  const r = await reviewCheck({ review: await review(BUYER, elsewhere.receipt_id), receipt: await sign(SHOP, m.TYPE.receipt, elsewhere) });
  assert.equal(code(r), "receipt_other");
});
await check("L7 a listing edited after signing is refused: listing_signature", async () => {
  const body = JSON.parse(atob(listing.payload));
  const edited = { ...listing, payload: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ ...body, text: body.text.replace("300", "500") })))) };
  assert.equal(code(await m.checkListing(edited)), "listing_signature");
});

// ── S. Shows / Does not show under every result ─────────────────────────────────────────────────

function assertLists(html, t, kind, label) {
  const verdictAt = Math.min(...[t("ACCEPTED"), t("REFUSED")].map((v) => html.indexOf(v)).filter((i) => i >= 0));
  assert.ok(Number.isFinite(verdictAt), `${label}: no verdict`);
  for (const head of [t("Shows"), t("Does not show")]) assert.ok(html.indexOf(head) > verdictAt, `${label}: no "${head}" after the verdict`);
  for (const s of [...m.SHOWS[kind], ...m.DOES_NOT_SHOW[kind]]) {
    assert.ok(html.includes(esc(t(s))), `${label}: missing "${s}"`);
  }
}
await check("S every result card, accepted and refused, of every tab, carries both lists (en, ja)", async () => {
  for (const lang of ["en", "ja"]) {
    for (const kind of ["delivery", "booking", "listing"]) {
      for (const ok of [true, false]) {
        const html = renderToStaticMarkup(h(page.ResultCard, { t: T[lang], kind, title: "x", ok, why: ok ? undefined : "the {thing}'s signature does not check out", vars: ok ? undefined : { thing: "receipt" } }));
        assertLists(html, T[lang], kind, `${lang} ${kind} ${ok ? "ACCEPTED" : "REFUSED"}`);
      }
    }
  }
});

// ── T. Status banner ────────────────────────────────────────────────────────────────────────────

await check("T the status banner \"prototype, local only\" is first on the page (en, ja)", async () => {
  const html = renderToStaticMarkup(h(page.default));
  const banner = html.indexOf("prototype, local only");
  assert.ok(banner >= 0, "no banner on the page");
  assert.ok(banner < html.indexOf("<h1"), "the banner is not above the title");
  assert.ok(renderToStaticMarkup(h(page.StatusBanner, { t: T.ja })).includes(MARKET_DICTS.ja["prototype, local only"]), "no Japanese banner");
});

// ── N. Nothing is sent ──────────────────────────────────────────────────────────────────────────

await check("N nothing in app/market can send, and no flow above called anything", async () => {
  for (const [name, src] of Object.entries(SRC)) {
    const hit = src.match(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|<form\b|tet-node-api|tetApi|navigator\s*\.\s*\w+\s*\(/);
    assert.equal(hit, null, `${name}: ${hit?.[0]}`);
  }
  assert.deepEqual(calls, []);
});

// ── P. Nothing here moves value ──────────────────────────────────────────────────────────────────────

await check("P payment is always outside TET, and no record carries an amount", async () => {
  assert.equal(m.PAYMENT, "outside TET (cash, bank, …)");
  assert.ok(records.length > 20);
  for (const rec of records) {
    if ("payment" in rec) assert.equal(rec.payment, m.PAYMENT, rec.kind);
    for (const k of Object.keys(rec)) assert.ok(!/amount|price|fee|value|balance|tet$/i.test(k), `${rec.kind} has "${k}"`);
  }
  for (const kind of ["parcel", "listing", "receipt"]) assert.ok(records.some((r) => r.kind === `tet_market_${kind}_v1` && r.payment === m.PAYMENT), kind);
  for (const lang of ["en", "ja", "zh-HK"]) {
    const html = renderToStaticMarkup(h(page.ListingView, { t: T[lang], title: m.SAMPLE.listingTitle, text: m.SAMPLE.listingText, shop: SHOP.id }));
    assert.ok(html.includes(T[lang]("Settled:")) && html.includes(esc(T[lang](m.PAYMENT))), lang);
  }
});

// ── W. Every string translated; wording ─────────────────────────────────────────────────────────

const lit = (src, re) => [...src.matchAll(re)].map((x) => JSON.parse(`"${x[1]}"`));
const STRINGS = new Set([
  ...lit(SRC.page, /\bt\("((?:[^"\\]|\\.)*)"/g),
  ...lit(SRC.page, /label: "((?:[^"\\]|\\.)*)"/g),
  ...lit(SRC.checks, /refuse\("[a-z_]+", "((?:[^"\\]|\\.)*)"/g),
  ...lit(SRC.checks, /refuse\(`\$\{what\}_[a-z]+`, "((?:[^"\\]|\\.)*)"/g),
  ...Object.values(m.THING),
  ...Object.values(m.SAMPLE).flat(),
  ...Object.values(m.SHOWS).flat(),
  ...Object.values(m.DOES_NOT_SHOW).flat(),
  m.PAYMENT,
]);
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");

await check("W1 every string the page shows has ja and zh-HK, with the same placeholders", async () => {
  assert.ok(STRINGS.size > 90, `only ${STRINGS.size} strings found: the scan is broken`);
  for (const lang of ["ja", "zh-HK"]) {
    const missing = [...STRINGS].filter((s) => !(s in MARKET_DICTS[lang]));
    assert.deepEqual(missing, [], `${lang} missing`);
    for (const s of STRINGS) assert.equal(placeholders(MARKET_DICTS[lang][s]), placeholders(s), `${lang}: ${s}`);
  }
});
const BAD_WORDING = /\bprove|\bproof|untraceable|guarantee|pay (?:with|in) TET|send TET|TET payment|証明|保証|追跡不能|證明|保證|用 ?TET ?(?:付|支付)|TETで(?:支払|払)/i;
await check("W2 no prove/proof/untraceable/guarantee and no pay-with-TET wording, in any language", async () => {
  const bad = BAD_WORDING;
  for (const s of STRINGS) {
    for (const text of [s, MARKET_DICTS.ja[s] ?? "", MARKET_DICTS["zh-HK"][s] ?? ""]) assert.ok(!bad.test(text), text);
  }
});

// W2 reads the strings the page passes to t() and the sample data. Text written straight into the
// page (a JSX text node, or a literal outside t()) would not be among them, so every literal and text
// fragment of /market's own source is checked against the same wording too.
const sourceText = (src) => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g)].map((x) => x[1] ?? x[2] ?? x[3] ?? x[4]);
};
await check("W2b no such wording written straight into /market's source (JSX text and literals outside t())", async () => {
  const bad = [SRC.page, SRC.route, SRC.checks].flatMap(sourceText).filter((x) => BAD_WORDING.test(x));
  assert.deepEqual(bad, []);
});
await check("W2b control: a sentence written as JSX text is caught", async () => {
  const planted = SRC.page.replace("<h3 ", "<p>This proves the parcel arrived.</p>\n<h3 ");
  assert.notEqual(planted, SRC.page, "the control's anchor is gone");
  assert.ok(sourceText(planted).some((x) => BAD_WORDING.test(x)), "JSX text is not scanned");
});

console.log(failed ? `\nmarket_guard: ${failed} FAILED` : "\nmarket_guard: all green");
process.exit(failed ? 1 : 0);
