/**
 * Testnet practice grants, the page's side (tet-core grants.rs; docs/plans/TESTNET_REWARDS.md).
 *
 * The welcome grant: 100 TET (practice unit, can't be exchanged for money) for the opening 1,000
 * people. The claim is a membership proof made out to the grant (its receiver id, day 0), so each
 * registered member has exactly one welcome nullifier; the claim names the wallet to pay and is
 * signed by the proof's one-time key, not by the member's wallet.
 *
 * Weak today, and the page says so: "one per person" is one per registration in the node's open
 * anonymity set, and registering is free.
 */
import { sha256 } from "@noble/hashes/sha2";
import { anonCommitment, anonRootAndPath, fromHex, tmailEphemeralSeed, toHex } from "./anon_tree.mjs";
import { fetchAnonLeaves, makeHelperProver } from "./anon_poster.mjs";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { expectedChainBinding } from "./chain_binding";
import { signTetEd25519 } from "./ed25519_tet";
import { mldsa44SignDeterministic } from "./pqc";
import { anonNodeAdapter } from "./tet_core_http";
import { ephemeralKeysFromSeed } from "./tmail";
import { getTmailKeySession } from "./tmail_session";

export const WELCOME_RECEIVER = toHex(sha256(new TextEncoder().encode("tet grant welcome v1")));

export type GrantsStatus = { granted: number; cap: number; amountMicro: number } | null;

export async function grantsStatus(baseUrl: string): Promise<GrantsStatus> {
  try {
    const r = await fetch(`${baseUrl}/grants/status`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return { granted: j.welcome.granted, cap: j.welcome.cap, amountMicro: j.welcome.amount_micro };
  } catch {
    return null;
  }
}

/** `PAE("tet grant claim v1", [...])`, byte-exact with tet-core `grants::claim_auth_message_bytes`. */
export function grantClaimAuthMessageBytes(o: { chainId: string; genesisHash: string; grant: string; payout: string; receiptSha256: string; claimedAtMs: number; mldsaPubB64: string }): Uint8Array {
  const enc = new TextEncoder();
  const fields = [o.chainId, o.genesisHash, o.grant, o.payout.trim().toLowerCase(), o.receiptSha256.trim().toLowerCase(), String(o.claimedAtMs), o.mldsaPubB64.trim()];
  let s = "tet grant claim v1 ";
  for (const f of fields) s += `${enc.encode(f).length} ${f} `;
  return enc.encode(s);
}

export type ClaimState = { state: "loading_set" | "proving" | "depositing" | "sending" } | { state: "granted"; txHash: string | null } | { state: "failed"; reason: string } | { state: "not_in_set" };

/** Claim the welcome grant for `payoutWallet`. About 30 s of proving on the visitor's own computer. */
export async function claimWelcome(baseUrl: string, proverUrl: string, payoutWallet: string, onState: (s: ClaimState) => void): Promise<ClaimState> {
  const done = (s: ClaimState) => (onState(s), s);
  const ks = getTmailKeySession();
  if (!ks) return done({ state: "failed", reason: "No ID in this tab yet." });
  const node = anonNodeAdapter(baseUrl);
  onState({ state: "loading_set" });
  const set = await fetchAnonLeaves(node);
  const mine = toHex(anonCommitment(ks.anonMemberSecret));
  const index = set.leaves.findIndex((l: Uint8Array) => toHex(l) === mine);
  const { root, siblings } = anonRootAndPath(set.leaves, index);
  if (toHex(root) !== String(set.rootHex).toLowerCase()) return done({ state: "failed", reason: "the downloaded registry does not reproduce this node's root" });
  if (index < 0 || !siblings) return done({ state: "not_in_set" });
  // Made out to the grant, on day 0: one nullifier per member, forever.
  const seed = tmailEphemeralSeed(ks.anonMemberSecret, fromHex(WELCOME_RECEIVER), 0);
  const eph = await ephemeralKeysFromSeed(seed);
  onState({ state: "proving" });
  let proof;
  try {
    proof = await makeHelperProver({ url: proverUrl })({
      secret_hex: toHex(ks.anonMemberSecret),
      index,
      siblings_hex: siblings.map(toHex),
      ephemeral_hex: eph.walletId,
      receiver_hex: WELCOME_RECEIVER,
      bucket: 0,
    });
  } catch (e) {
    return done({ state: "failed", reason: e instanceof Error ? e.message : String(e) });
  }
  onState({ state: "depositing" });
  const put = await node("/tmail/anon/receipt", { method: "PUT", body: JSON.stringify({ receipt_sha256_hex: proof.receipt_sha256_hex, receipt_b64: proof.receipt_b64 }) });
  if (put.status !== 200) return done({ state: "failed", reason: `receipt deposit failed (HTTP ${put.status})` });
  onState({ state: "sending" });
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const claimedAtMs = Date.now();
  const msg = grantClaimAuthMessageBytes({ chainId, genesisHash, grant: "welcome", payout: payoutWallet, receiptSha256: proof.receipt_sha256_hex, claimedAtMs, mldsaPubB64: eph.mldsaPubB64 });
  const claim = {
    v: 1,
    kind: "tet_grant_claim_v1",
    grant: "welcome",
    payout_wallet: payoutWallet.trim().toLowerCase(),
    receipt_sha256_hex: proof.receipt_sha256_hex,
    journal_b64: proof.journal_b64,
    image_id_hex: proof.image_id_hex,
    claimed_at_ms: claimedAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: eph.walletId,
      ed25519_sig_b64: u8ToStdBase64(await signTetEd25519(eph.secretKey, msg)),
      mldsa_pubkey_b64: eph.mldsaPubB64,
      mldsa_sig_b64: await mldsa44SignDeterministic(eph.mldsaKeypairB64, msg),
    },
  };
  const r = await node("/grants/welcome", { method: "POST", body: JSON.stringify(claim) });
  const j = (r.json ?? {}) as { tx_hash?: string; reason?: string };
  if (r.status === 202) return done({ state: "granted", txHash: j.tx_hash ?? null });
  return done({ state: "failed", reason: j.reason ?? r.text ?? `HTTP ${r.status}` });
}
