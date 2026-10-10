/**
 * TetSearch v1 (docs/plans/TETSEARCH.md; tet-core `search.rs`). Only vouched people can publish:
 * a Shelter member lists a site with a record signed by their member wallet **and** the site's own
 * key. Members read the listings (Shelter's signed reads), and the search runs here, in the
 * browser: each listed site's signed edit chain is fetched (public), checked, rebuilt with the
 * site language and searched locally. The node never sees what a member searches for.
 *
 * Wording (guarded): "Only vouched people can publish. Built to keep out mass AI generation." and
 * "Keys without a human vouch can't publish." Never "AI cannot access" or "humans only, guaranteed".
 */
import { expectedChainBinding } from "./chain_binding";
import { getHybridSignerSession } from "./hybrid_signer_session";
import { mnemonicToTetEd25519Keypair, signTetEd25519 } from "./ed25519_tet";
import { mldsa44KeypairFromMnemonic, mldsa44SignDeterministic, pqcInit } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { readAuth } from "./shelter";
import { fetchSite, verifyChain } from "./site_store";
import { applyEdits, type Block } from "./site_lang";

export const LISTING_KIND = "tet search list";
export const LISTING_PAE_DOMAIN = "tet search list v1";

type HybridSig = { ed25519_pubkey_hex: string; ed25519_sig_b64: string; mldsa_pubkey_b64: string; mldsa_sig_b64: string };
export type SearchListing = {
  v: 1;
  kind: typeof LISTING_KIND;
  site_wallet_id: string;
  member_wallet_id: string;
  listed_at_ms: number;
  member_sig: HybridSig;
  site_sig: HybridSig;
};

/** `domain SP (len SP field SP)*` (tet-core `agent::pae`). */
function pae(domain: string, fields: string[]): Uint8Array {
  const enc = new TextEncoder();
  let s = `${domain} `;
  for (const f of fields) s += `${enc.encode(f).length} ${f} `;
  return enc.encode(s);
}

/** tet-core `search::listing_auth_message_bytes`: the same bytes for both signers but their ML-DSA key. */
export function listingAuthMessageBytes(chain: { chainId: string; genesisHash: string }, l: Pick<SearchListing, "site_wallet_id" | "member_wallet_id" | "listed_at_ms">, mldsaPubkeyB64: string): Uint8Array {
  return pae(LISTING_PAE_DOMAIN, [chain.chainId, chain.genesisHash, l.site_wallet_id.toLowerCase(), l.member_wallet_id.toLowerCase(), String(l.listed_at_ms), mldsaPubkeyB64.trim()]);
}

/** List a site in TetSearch: signed by this tab's member wallet and by the site's own key (its words). */
export async function listSite(baseUrl: string, siteWords: string, nowMs = Date.now()): Promise<{ ok: true } | { ok: false; error: string }> {
  await pqcInit();
  const s = getHybridSignerSession();
  if (!s) return { ok: false, error: "No ID in this tab yet." };
  const chain = await expectedChainBinding(baseUrl);
  const ed = mnemonicToTetEd25519Keypair(siteWords.trim());
  const pq = await mldsa44KeypairFromMnemonic(siteWords.trim());
  const base = { site_wallet_id: ed.walletIdHex.toLowerCase(), member_wallet_id: s.walletIdHex64.toLowerCase(), listed_at_ms: nowMs };
  const memberMsg = listingAuthMessageBytes(chain, base, s.mldsa44_pubkey_b64);
  const siteMsg = listingAuthMessageBytes(chain, base, pq.pubkey_b64);
  const l: SearchListing = {
    v: 1,
    kind: LISTING_KIND,
    ...base,
    member_sig: {
      ed25519_pubkey_hex: s.walletIdHex64.toLowerCase(),
      ed25519_sig_b64: u8ToStdBase64(await Promise.resolve(s.signEd25519(memberMsg))),
      mldsa_pubkey_b64: s.mldsa44_pubkey_b64.trim(),
      mldsa_sig_b64: await mldsa44SignDeterministic(s.mldsa44_keypair_b64, memberMsg),
    },
    site_sig: {
      ed25519_pubkey_hex: ed.walletIdHex.toLowerCase(),
      ed25519_sig_b64: u8ToStdBase64(await signTetEd25519(ed.secretKey, siteMsg)),
      mldsa_pubkey_b64: pq.pubkey_b64,
      mldsa_sig_b64: await mldsa44SignDeterministic(pq.keypair_b64, siteMsg),
    },
  };
  const r = await fetch(`${baseUrl}/search/list`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(l) });
  if (r.ok) return { ok: true };
  const j = await r.json().catch(() => null);
  return { ok: false, error: String(j?.error ?? `HTTP ${r.status}`) };
}

export type ListingRow = { site_wallet_id: string; member_wallet_id: string; listed_at_ms: number; version: number; updated_at_ms: number };

/** The current listings (members only: a signed read). `status` 401/403 means not a member. */
export async function fetchListings(baseUrl: string): Promise<{ status: number; listings: ListingRow[]; error: string }> {
  const path = "/search/listings";
  const r = await fetch(`${baseUrl}${path}`, { headers: { "x-tet-shelter-auth": await readAuth(baseUrl, path) }, cache: "no-store" });
  const j = await r.json().catch(() => null);
  return { status: r.status, listings: r.ok ? ((j?.listings ?? []) as ListingRow[]) : [], error: r.ok ? "" : String(j?.error ?? `HTTP ${r.status}`) };
}

/** A searchable document: one listed site, rebuilt from its checked edit chain. */
export type Doc = { siteId: string; member: string; title: string; body: string; version: number; signedAtMs: number };

/** The plain text of a block, for searching and snippets. */
export function blockText(b: Block): string {
  switch (b.type) {
    case "heading":
    case "text":
      return b.text;
    case "list":
      return b.items.join(" · ");
    case "quote":
      return b.who ? `${b.text} — ${b.who}` : b.text;
    case "link":
      return b.label;
    case "image":
      return b.alt;
  }
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Rank documents for `query`: every word must appear (title or body); a title match counts more;
 * **one result per member** (a member's best page), so a thousand pages from one member are one
 * voice; then the more recent signed version first. No other signals.
 */
export function rank(docs: Doc[], query: string): (Doc & { score: number; snippet: string })[] {
  const q = words(query);
  if (!q.length) return [];
  const scored = docs
    .map((d) => {
      const t = d.title.toLowerCase();
      const b = d.body.toLowerCase();
      if (!q.every((w) => t.includes(w) || b.includes(w))) return null;
      const score = q.reduce((n, w) => n + (t.includes(w) ? 3 : 0) + (b.includes(w) ? 1 : 0), 0);
      const at = b.indexOf(q[0]);
      const start = Math.max(0, at - 60);
      const snippet = (start > 0 ? "…" : "") + d.body.slice(start, start + 180).trim() + (d.body.length > start + 180 ? "…" : "");
      return { ...d, score, snippet };
    })
    .filter((x): x is Doc & { score: number; snippet: string } => x !== null)
    .sort((a, b) => b.score - a.score || b.signedAtMs - a.signedAtMs);
  const seen = new Set<string>();
  return scored.filter((d) => (seen.has(d.member) ? false : (seen.add(d.member), true)));
}

/** Fetch and check each listed site; a site whose chain doesn't verify is left out. */
export async function loadDocs(
  baseUrl: string,
  listings: ListingRow[],
  mldsa44Verify: (pk: string, sig: string, msg: Uint8Array) => Promise<boolean>,
): Promise<Doc[]> {
  const chain = await expectedChainBinding(baseUrl);
  const out: Doc[] = [];
  for (const l of listings) {
    const site = await fetchSite(baseUrl, l.site_wallet_id).catch(() => null);
    if (!site || !site.edits.length) continue;
    const v = await verifyChain(l.site_wallet_id, site.edits, chain, mldsa44Verify);
    if (!v.ok) continue;
    const st = applyEdits(site.edits.map((e) => e.body));
    out.push({
      siteId: l.site_wallet_id,
      member: l.member_wallet_id,
      title: st.title || st.blocks.find((b) => b.type === "heading")?.text || l.site_wallet_id.slice(0, 8),
      body: st.blocks.map(blockText).join("\n"),
      version: v.count,
      signedAtMs: v.lastSignedAtMs,
    });
  }
  return out;
}
