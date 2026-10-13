/**
 * Signed sites on the page (tet-core sites.rs): make a site, sign and append edits, and fetch and
 * **verify** a site's chain in the reader's own tab. The node is only a store: a reader checks every
 * edit's two signatures, that the site's own key made them, and that each one names the previous
 * edit's hash, so a node that drops, reorders or alters an edit is caught.
 *
 * The site's 12 words are its key. They're shown once when the site is made and never stored by
 * the page (the same rule as a board's words); editing later asks for them again.
 */
import { sha256 } from "@noble/hashes/sha2";
import { generateDisposableWords } from "./disposable_wallet.mjs";
import { expectedChainBinding } from "./chain_binding";
import { mnemonicToTetEd25519Keypair, signTetEd25519, verifyTetEd25519 } from "./ed25519_tet";
import { mldsa44KeypairFromMnemonic, mldsa44SignDeterministic, pqcInit } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { tetCoreUrl } from "./tet_core_http";

export const SITE_EDIT_KIND = "tet_site_edit_v1";
export const ZERO_HASH = "0".repeat(64);
/** ML-DSA-44 sizes, pinned before verifying (the verifier would also accept a consistent ML-DSA-65 pair). */
const MLDSA44_PK = 1312;
const MLDSA44_SIG = 2420;

export type SiteEdit = {
  v: 1;
  kind: typeof SITE_EDIT_KIND;
  site_wallet_id: string;
  seq: number;
  prev_hash: string;
  body: string;
  created_at_ms: number;
  hybrid_sig: { ed25519_pubkey_hex: string; ed25519_sig_b64: string; mldsa_pubkey_b64: string; mldsa_sig_b64: string };
};
export type Chain = { chainId: string; genesisHash: string };

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
function b64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** tet-core's pre-image, field for field. */
export function editPreimage(e: SiteEdit, chain: Chain, mldsaPubB64: string): Uint8Array {
  return enc.encode(
    `tet site edit v1|chain_id=${chain.chainId}|genesis_hash=${chain.genesisHash}|site=${e.site_wallet_id.toLowerCase()}|seq=${e.seq}|prev=${e.prev_hash.toLowerCase()}|body_sha256=${hex(sha256(enc.encode(e.body)))}|created_at_ms=${e.created_at_ms}|mldsa_pk=${mldsaPubB64.trim()}`,
  );
}

/** An edit's hash, which the next edit names as prev (tet-core `site_edit_hash`). */
export function editHash(e: Pick<SiteEdit, "site_wallet_id" | "seq" | "prev_hash" | "body">): string {
  return hex(sha256(enc.encode(`tet site edit hash v1|site=${e.site_wallet_id.toLowerCase()}|seq=${e.seq}|prev=${e.prev_hash.toLowerCase()}|body_sha256=${hex(sha256(enc.encode(e.body)))}`)));
}

/** A new site: its wallet id and its 12 words (shown once; the page doesn't keep them). */
export function newSite(): { siteId: string; words: string } {
  const words = generateDisposableWords();
  return { siteId: mnemonicToTetEd25519Keypair(words).walletIdHex.toLowerCase(), words };
}

/** The site id those 12 words make. */
export function siteIdOf(words: string): string {
  return mnemonicToTetEd25519Keypair(words.trim()).walletIdHex.toLowerCase();
}

/** Sign one edit with the site's words. */
export async function signEdit(words: string, seq: number, prev: string, body: string, chain: Chain, nowMs: number): Promise<SiteEdit> {
  await pqcInit();
  const ed = mnemonicToTetEd25519Keypair(words.trim());
  const pqc = await mldsa44KeypairFromMnemonic(words.trim());
  const e: SiteEdit = {
    v: 1,
    kind: SITE_EDIT_KIND,
    site_wallet_id: ed.walletIdHex.toLowerCase(),
    seq,
    prev_hash: prev,
    body,
    created_at_ms: nowMs,
    hybrid_sig: { ed25519_pubkey_hex: ed.walletIdHex.toLowerCase(), ed25519_sig_b64: "", mldsa_pubkey_b64: pqc.pubkey_b64, mldsa_sig_b64: "" },
  };
  const msg = editPreimage(e, chain, pqc.pubkey_b64);
  e.hybrid_sig.ed25519_sig_b64 = u8ToStdBase64(await signTetEd25519(ed.secretKey, msg));
  e.hybrid_sig.mldsa_sig_b64 = await mldsa44SignDeterministic(pqc.keypair_b64, msg);
  return e;
}

export type FetchedSite = { edits: SiteEdit[]; head: { len: number; head_hash: string } | null };

/** A site's chain as this node holds it (null: no such site here). Not yet verified. */
export async function fetchSite(baseUrl: string, siteId: string): Promise<FetchedSite | null> {
  const r = await fetch(tetCoreUrl(baseUrl, `/sites/${siteId.toLowerCase()}`));
  if (r.status === 404) return null;
  if (r.status === 410) throw new Error("This site isn't served on this node (the operator hid it).");
  if (!r.ok) throw new Error(`The node didn't return the site (HTTP ${r.status}).`);
  const j = (await r.json()) as { edits?: SiteEdit[]; head?: { len: number; head_hash: string } };
  return { edits: j.edits ?? [], head: j.head ?? null };
}

/** Sign and append one edit (an op body) at the end of the site's chain. Returns the new version. */
export async function appendEdit(baseUrl: string, words: string, op: unknown): Promise<string> {
  const siteId = siteIdOf(words);
  const chain = await expectedChainBinding(baseUrl);
  const body = JSON.stringify(op);
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await fetchSite(baseUrl, siteId);
    const seq = cur?.head?.len ?? 0;
    const prev = cur?.head?.head_hash ?? ZERO_HASH;
    const e = await signEdit(words, seq, prev, body, chain, Date.now());
    const r = await fetch(tetCoreUrl(baseUrl, "/sites/edit"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e) });
    if (r.status === 202) return editHash(e);
    if (r.status === 409 && attempt === 0) continue; // someone else's edit landed first: re-read the head
    const text = await r.text();
    let why = text.trim() || `HTTP ${r.status}`;
    try {
      why = String((JSON.parse(text) as { error?: string }).error ?? why);
    } catch {
      /* not JSON: the gate's plain-text reason */
    }
    throw new Error(r.status === 429 && /daily upload limit/.test(text) ? "Today's upload limit for this address is used." : r.status === 429 ? `The node is busy (${why}). Try again in a minute.` : why);
  }
  throw new Error("The site changed while saving. Try again.");
}

/**
 * `lastSignedAtMs` is the newest edit's signed time. A node can serve a valid *prefix* of a chain
 * (an older version) by leaving out newer edits, and signatures can't prove recency: the reader
 * page shows this time and the version, and says so, so a reader can compare with the owner.
 */
export type ChainVerdict = { ok: true; version: string; count: number; lastSignedAtMs: number } | { ok: false; at: number; reason: string };

/**
 * Check a chain in this tab: every edit is the site's own (signer = site), signed with both
 * signatures over tet-core's pre-image, numbered 0, 1, 2… and naming the previous edit's hash.
 */
export async function verifyChain(
  siteId: string,
  edits: SiteEdit[],
  chain: Chain,
  mldsa44Verify: (pk: string, sig: string, msg: Uint8Array) => Promise<boolean>,
): Promise<ChainVerdict> {
  const site = siteId.toLowerCase();
  let prev = ZERO_HASH;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const fail = (reason: string): ChainVerdict => ({ ok: false, at: i, reason });
    if (e.kind !== SITE_EDIT_KIND || e.v !== 1) return fail("not a site edit");
    if (e.site_wallet_id.toLowerCase() !== site) return fail("an edit for another site");
    if (e.hybrid_sig.ed25519_pubkey_hex.toLowerCase() !== site) return fail("not signed by the site's own key");
    if (e.seq !== i) return fail(`edit ${i} is numbered ${e.seq}`);
    if (e.prev_hash.toLowerCase() !== prev) return fail("doesn't name the previous edit (an edit was dropped, reordered or changed)");
    const pk = b64ToBytes(e.hybrid_sig.mldsa_pubkey_b64);
    const ms = b64ToBytes(e.hybrid_sig.mldsa_sig_b64);
    const es = b64ToBytes(e.hybrid_sig.ed25519_sig_b64);
    if (!pk || pk.length !== MLDSA44_PK || !ms || ms.length !== MLDSA44_SIG || !es || es.length !== 64) return fail("malformed signature");
    const msg = editPreimage(e, chain, e.hybrid_sig.mldsa_pubkey_b64);
    if (!(await verifyTetEd25519(fromHex(site), msg, es))) return fail("ed25519 signature doesn't verify");
    if (!(await mldsa44Verify(e.hybrid_sig.mldsa_pubkey_b64, e.hybrid_sig.mldsa_sig_b64, msg))) return fail("ML-DSA-44 signature doesn't verify");
    prev = editHash(e);
  }
  return { ok: true, version: prev, count: edits.length, lastSignedAtMs: edits.length ? edits[edits.length - 1].created_at_ms : 0 };
}
