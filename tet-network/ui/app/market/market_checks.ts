/**
 * /market (prototype, local only): the checks behind its three tabs, Delivery, Booking and Listing.
 *
 * Nothing new is signed or checked here. Every record is a canonical JSON object signed into the same
 * `.sig.json` envelope as Try TET's "Sign anything" (lib/sign_anything.ts, tet-cli agent sign):
 * Ed25519 + ML-DSA-44 over the agent-payload pre-image, with keys from 12 words as wallets make them
 * (lib/ed25519_tet.ts, lib/pqc.ts). Every signature is checked by lib/verify_anything.mjs
 * verifyEnvelope, the page's own verifier. A one-time permit is the machine notebook's idea
 * (tools/machine-notebook, "One-time permits"): a signed id that a check accepts once.
 *
 * Nothing moves money: no record carries an amount, and payment is always "outside TET".
 * Everything stays in the tab; nothing is sent anywhere. scripts/market_guard.mjs pins the checks.
 */
import { sha256 } from "@noble/hashes/sha2";
import { mnemonicToTetEd25519Keypair, signTetEd25519 } from "../lib/ed25519_tet";
import { generateMnemonic12 } from "../lib/bip39_12";
import { mldsa44KeypairFromMnemonic, mldsa44SignDeterministic, mldsa44Verify } from "../lib/pqc";
import { agentPayloadAuthMessageBytes, ED_PREFIX, mldsa44KeyId, PAE_DOMAIN, verifyEnvelope } from "../lib/verify_anything.mjs";

/** An example chain binding: part of every signature here, and plainly not a chain any node runs. */
export const CHAIN = { chainId: "tet-example-market", genesisHash: "0".repeat(63) + "1" };

export const PAYMENT = "outside TET (cash, bank, …)";

export const TYPE = {
  parcel: "application/vnd.tet.market.parcel+json",
  courierPermit: "application/vnd.tet.market.courier-permit+json",
  handover: "application/vnd.tet.market.handover+json",
  booking: "application/vnd.tet.market.booking+json",
  visit: "application/vnd.tet.market.visit+json",
  listing: "application/vnd.tet.market.listing+json",
  receipt: "application/vnd.tet.market.receipt+json",
  review: "application/vnd.tet.market.review+json",
} as const;
const KIND: Record<keyof typeof TYPE, string> = {
  parcel: "tet_market_parcel_v1",
  courierPermit: "tet_market_courier_permit_v1",
  handover: "tet_market_handover_v1",
  booking: "tet_market_booking_v1",
  visit: "tet_market_visit_v1",
  listing: "tet_market_listing_v1",
  receipt: "tet_market_receipt_v1",
  review: "tet_market_review_v1",
};

export type Envelope = {
  payloadType: string;
  payload: string;
  signatures: { keyid: string; sig: string }[];
  tet: { v: 1; pae: string; agent_ed25519_pubkey_hex: string; agent_mldsa44_pubkey_b64: string };
};
export type Key = { id: string; edSecret: Uint8Array; mlKeypair: string; mlPub: string };
type Rec = Record<string, unknown>;

// ── canonical JSON, envelopes ───────────────────────────────────────────────────────────────────

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as Rec).sort().map((k) => [k, sortDeep((v as Rec)[k])]));
  }
  return v;
}
const enc = new TextEncoder();
export const canonical = (o: Rec): Uint8Array => enc.encode(JSON.stringify(sortDeep(o)));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** A record's id: SHA-256 of its canonical bytes, hex. */
export const recordId = (o: Rec): string => hex(sha256(canonical(o)));
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const randomId = (): string => hex(crypto.getRandomValues(new Uint8Array(16)));

/** A key from 12 words, as a wallet derives it (Ed25519 from the BIP39 seed, ML-DSA-44 from the words). */
export async function keyFromWords(words: string): Promise<Key> {
  const ed = mnemonicToTetEd25519Keypair(words);
  const ml = await mldsa44KeypairFromMnemonic(words);
  return { id: ed.walletIdHex, edSecret: ed.secretKey, mlKeypair: ml.keypair_b64, mlPub: ml.pubkey_b64 };
}

/** A new key that exists only in this tab (a per-shop pseudonym, a courier's key for one parcel). */
export async function freshKey(): Promise<Key> {
  return keyFromWords((await generateMnemonic12()).mnemonic12);
}

/** The `.sig.json` Sign anything makes, by `key` instead of the tab's wallet. */
export async function signRecord(key: Key, type: string, rec: Rec): Promise<Envelope> {
  const content = canonical(rec);
  const msg = agentPayloadAuthMessageBytes(CHAIN, type, content);
  const edSig = await signTetEd25519(key.edSecret, msg);
  const mlSig = await mldsa44SignDeterministic(key.mlKeypair, msg);
  return {
    payloadType: type,
    payload: b64(content),
    signatures: [
      { keyid: `${ED_PREFIX}${key.id}`, sig: b64(edSig) },
      { keyid: mldsa44KeyId(key.mlPub), sig: mlSig },
    ],
    tet: { v: 1, pae: PAE_DOMAIN, agent_ed25519_pubkey_hex: key.id, agent_mldsa44_pubkey_b64: key.mlPub },
  };
}

export type Refusal = { ok: false; code: string; why: string; vars?: { thing: string } };
const refuse = (code: string, why: string, vars?: { thing: string }): Refusal => (vars ? { ok: false, code, why, vars } : { ok: false, code, why });

/** What each record is called in a refusal ("the {thing}'s signature does not check out"). */
export const THING: Record<keyof typeof TYPE, string> = {
  parcel: "parcel record",
  courierPermit: "courier's permit",
  handover: "handover",
  booking: "booking",
  visit: "visit record",
  listing: "listing",
  receipt: "receipt",
  review: "review",
};

/** The sample's own words, translated on the page like every other string. */
export const SAMPLE = {
  contents: "Two books",
  listingTitle: "Handmade mug (sample)",
  listingText: "Blue glaze, 300 ml. Pick up at the shop.",
  review: "Good mug, as described.",
  shops: ["Hair salon (sample)", "Bike repair (sample)"],
} as const;

/** Both signatures checked by verifyEnvelope; then the type, the kind and canonical form. */
async function open(env: Envelope | null | undefined, what: keyof typeof TYPE): Promise<{ ok: true; signer: string; rec: Rec } | Refusal> {
  const thing = { thing: THING[what] };
  if (!env) return refuse(`${what}_missing`, "the {thing} is missing", thing);
  let content: Uint8Array;
  try {
    content = unb64(env.payload);
  } catch {
    return refuse(`${what}_signature`, "the {thing} is not readable", thing);
  }
  const v = await verifyEnvelope({ envelope: env, content, chain: CHAIN, mldsa44Verify });
  if (!v.ok) return refuse(`${what}_signature`, "the {thing}'s signature does not check out", thing);
  if (v.payloadType !== TYPE[what]) return refuse(`${what}_type`, "this is not a {thing}", thing);
  let rec: Rec;
  try {
    rec = JSON.parse(new TextDecoder().decode(content));
  } catch {
    return refuse(`${what}_type`, "this is not a {thing}", thing);
  }
  if (!rec || typeof rec !== "object" || rec.kind !== KIND[what] || hex(canonical(rec)) !== hex(content)) {
    return refuse(`${what}_type`, "this is not a {thing}", thing);
  }
  return { ok: true, signer: v.edHex, rec };
}

// ── 1. Delivery ─────────────────────────────────────────────────────────────────────────────────
//
// The sender signs the parcel record (its tag and the receiver's key). The courier service signs a
// one-time permit: "this key may hand over this one parcel". The courier uses a key for this parcel
// only, so the page can say "a verified courier" and never a name. The handover is one record signed
// by both the courier and the receiver.

export const parcelRecord = (tag: string, receiver: string, contents: string): Rec => ({ v: 1, kind: KIND.parcel, tag, receiver, contents, payment: PAYMENT });
export const courierPermit = (parcelTag: string, courier: string): Rec => ({ v: 1, kind: KIND.courierPermit, permit_id: randomId(), parcel_tag: parcelTag, courier, action: "hand over one parcel" });
export const handoverRecord = (parcelTag: string, permitId: string, courier: string, receiver: string): Rec => ({ v: 1, kind: KIND.handover, parcel_tag: parcelTag, permit_id: permitId, courier, receiver });

export type DeliveryCheck = { ok: true; tag: string; contents: string; sender: string; receiver: string; permitId: string } | Refusal;

/**
 * Checks, in this order: the parcel record; the tag on the parcel is the one the sender signed; the
 * permit is the courier service's and names this parcel; the handover is about this parcel and permit;
 * the courier who signed it is the permit's; the receiver who signed it is the parcel's; the permit has
 * not been used before. Accepting marks the permit used (`used`, the record keeper's own list).
 */
export async function checkDelivery(o: {
  parcel: Envelope;
  tagOnParcel: string;
  permit: Envelope;
  courierService: string;
  handoverByCourier: Envelope;
  handoverByReceiver: Envelope;
  used: Set<string>;
}): Promise<DeliveryCheck> {
  const p = await open(o.parcel, "parcel");
  if (!p.ok) return p;
  if (o.tagOnParcel.trim() !== p.rec.tag) return refuse("tag_mismatch", "the tag on the parcel is not the one the sender signed");
  const pm = await open(o.permit, "courierPermit");
  if (!pm.ok) return pm;
  if (pm.signer !== o.courierService) return refuse("permit_not_service", "the permit is not signed by the courier service");
  if (pm.rec.parcel_tag !== p.rec.tag) return refuse("permit_other_parcel", "the permit is for another parcel");
  const hc = await open(o.handoverByCourier, "handover");
  if (!hc.ok) return hc;
  const hr = await open(o.handoverByReceiver, "handover");
  if (!hr.ok) return hr;
  if (o.handoverByCourier.payload !== o.handoverByReceiver.payload) return refuse("handover_differs", "the courier and the receiver signed different handovers");
  if (hc.rec.parcel_tag !== p.rec.tag || hc.rec.permit_id !== pm.rec.permit_id) return refuse("handover_other", "the handover is for another parcel or permit");
  if (hc.signer !== pm.rec.courier || hc.rec.courier !== pm.rec.courier) return refuse("courier_not_permitted", "the courier who signed is not the one the permit names");
  if (hr.signer !== p.rec.receiver || hc.rec.receiver !== p.rec.receiver) return refuse("receiver_not_parcel", "the receiver who signed is not the one the parcel names");
  const pid = String(pm.rec.permit_id);
  if (o.used.has(pid)) return refuse("permit_used", "this permit was already used for a handover");
  o.used.add(pid);
  return { ok: true, tag: String(p.rec.tag), contents: String(p.rec.contents), sender: p.signer, receiver: hr.signer, permitId: pid };
}

// ── 2. Booking ──────────────────────────────────────────────────────────────────────────────────
//
// The customer keeps one key per shop, made in this tab: the shop-specific pseudonym. A booking is
// signed by that pseudonym and names the shop; the shop signs what happened ("came" / "no-show").
// A shop counts only its own records, for that pseudonym, at that shop.

export const bookingRecord = (shop: string, pseudonym: string, slot: string): Rec => ({ v: 1, kind: KIND.booking, booking_id: randomId(), shop, pseudonym, slot });
export const visitRecord = (bookingId: string, outcome: "came" | "no-show"): Rec => ({ v: 1, kind: KIND.visit, booking_id: bookingId, outcome });

export type Booking = { booking: Envelope; visit: Envelope | null };

/**
 * How many no-shows `pseudonym` has at `shop`: visits signed by `shop` with outcome "no-show", for
 * bookings signed by `pseudonym` that name `shop`. Anything else in `records` (another shop's, another
 * pseudonym's, a visit signed by any other key) is not counted.
 */
export async function noShows(shop: string, pseudonym: string, records: Booking[]): Promise<{ bookings: number; noShows: number }> {
  let bookings = 0;
  let missed = 0;
  for (const r of records) {
    const b = await open(r.booking, "booking");
    if (!b.ok || b.signer !== pseudonym || b.rec.pseudonym !== pseudonym || b.rec.shop !== shop) continue;
    bookings++;
    if (!r.visit) continue;
    const v = await open(r.visit, "visit");
    if (v.ok && v.signer === shop && v.rec.booking_id === b.rec.booking_id && v.rec.outcome === "no-show") missed++;
  }
  return { bookings, noShows: missed };
}

// ── 3. Listing ──────────────────────────────────────────────────────────────────────────────────
//
// The shop signs its listing. A receipt, signed by the shop, names the listing and the customer's key
// for that shop; a review must cite a receipt, be signed by the key the receipt names, and each receipt
// carries one review.

export const listingRecord = (title: string, text: string): Rec => ({ v: 1, kind: KIND.listing, title, text, payment: PAYMENT });
export const receiptRecord = (listingId: string, customer: string): Rec => ({ v: 1, kind: KIND.receipt, receipt_id: randomId(), listing_id: listingId, customer, payment: PAYMENT });
export const reviewRecord = (listingId: string, receiptId: string, stars: number, text: string): Rec => ({ v: 1, kind: KIND.review, listing_id: listingId, receipt_id: receiptId, stars, text });

export type ListingCheck = { ok: true; shop: string; title: string; text: string; listingId: string } | Refusal;
export async function checkListing(env: Envelope): Promise<ListingCheck> {
  const l = await open(env, "listing");
  if (!l.ok) return l;
  return { ok: true, shop: l.signer, title: String(l.rec.title), text: String(l.rec.text), listingId: recordId(l.rec) };
}

export type ReviewCheck = { ok: true; stars: number; text: string; receiptId: string } | Refusal;

/**
 * Checks, in this order: the listing; the review; that it is about this listing; that it cites a
 * receipt; the receipt; that the listing's shop signed the receipt, for this listing; that the review
 * is signed by the key the receipt names; that the receipt has not carried a review before. Accepting
 * marks the receipt used (`used`).
 */
export async function checkReview(o: { listing: Envelope; review: Envelope; receipt: Envelope | null; used: Set<string> }): Promise<ReviewCheck> {
  const l = await checkListing(o.listing);
  if (!l.ok) return l;
  const r = await open(o.review, "review");
  if (!r.ok) return r;
  if (r.rec.listing_id !== l.listingId) return refuse("review_other_listing", "the review is about another listing");
  if (!o.receipt) return refuse("no_receipt", "the review cites no receipt");
  const rc = await open(o.receipt, "receipt");
  if (!rc.ok) return rc;
  if (rc.signer !== l.shop) return refuse("receipt_not_shop", "the receipt is not signed by this listing's shop");
  if (rc.rec.listing_id !== l.listingId || r.rec.receipt_id !== rc.rec.receipt_id) return refuse("receipt_other", "the receipt is for another listing or review");
  if (r.signer !== rc.rec.customer) return refuse("not_receipt_holder", "the review is not signed by the key the receipt names");
  const rid = String(rc.rec.receipt_id);
  if (o.used.has(rid)) return refuse("receipt_used", "this receipt already carries a review");
  const stars = Number(r.rec.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return refuse("review_stars", "the review's stars are not 1 to 5");
  o.used.add(rid);
  return { ok: true, stars, text: String(r.rec.text), receiptId: rid };
}

// ── Shows / Does not show, per result ───────────────────────────────────────────────────────────

export const SHOWS = {
  delivery: [
    "The sender's key signed this parcel record, with this tag and this receiver.",
    "The tag on the parcel is the one the sender signed.",
    "A courier the courier service gave a one-time permit to, and the receiver's key, both signed this handover.",
    "This permit was used once, here.",
  ],
  booking: [
    "How many times this pseudonym booked at this shop and did not come, by this shop's own signed records.",
  ],
  listing: [
    "The shop's key signed this listing, and it has not changed since.",
    "Each review shown cites a receipt this shop's key signed, and is signed by the key that receipt names.",
    "Each receipt carries one review at most.",
  ],
} as const;

export const DOES_NOT_SHOW = {
  delivery: [
    "Who the courier is: the page says only \"a verified courier\". The courier service knows which courier it gave the permit to.",
    "What is inside the parcel: the contents line is what the sender wrote.",
    "Who holds each key.",
    "That nobody with a copy of the courier's key used the permit somewhere else: only this record keeper's list is checked.",
    "Anything about payment, which happens outside TET.",
  ],
  booking: [
    "Who the customer is.",
    "The customer's record at any other shop: there they use another pseudonym.",
    "That a customer did not start over with a new pseudonym: a new pseudonym looks like a new customer.",
    "That the shop marked \"did not come\" fairly: these are the shop's own records.",
  ],
  listing: [
    "That the customer paid: payment happens outside TET, and the receipt says only that the shop issued it.",
    "That the shop did not give receipts to friends.",
    "That a review is true, or who wrote it.",
  ],
} as const;
