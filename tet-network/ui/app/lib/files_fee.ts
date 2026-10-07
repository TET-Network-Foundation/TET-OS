/**
 * Settling a sent file's fee, in one of two ways. The file is already delivered when this runs, so
 * the outcome is a line of text, never a failure of the send.
 *
 * - `"self"` (the desktop): the sender's own wallet signs a `TxV1::FileFee` to `/files/fee`.
 * - `"demo-sponsor"` (the try page, docs/DEMO_NODE.md): the sender signs a request, and the demo
 *   node's sponsor wallet pays, under caps. **The visitor's wallet never signs a fee** and
 *   `/files/fee` (off the demo node's allow-list) is never called. A refusal is final: one request,
 *   no retry, and the page says the file was delivered and why the fee wasn't sponsored.
 */

import { expectedChainBinding } from "./chain_binding";
import { buildFileFeeEnvelopeV1, FILE_FEE_MICRO } from "./files";
import { requireHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";
import { fetchJson, postFilesFee, tetCoreUrl } from "./tet_core_http";

export type FeeMode = "self" | "demo-sponsor";

/** tet-core `demo_sponsor::SponsorFeeRequestV1`. */
export type SponsorFeeRequestV1 = {
  file_id: string;
  sender_wallet_id: string;
  requested_at_ms: number;
  hybrid_sig: {
    ed25519_pubkey_hex: string;
    ed25519_sig_b64: string;
    mldsa_pubkey_b64: string;
    mldsa_sig_b64: string;
  };
};

/** Byte-exact with tet-core `demo_sponsor::sponsor_request_auth_message_bytes`. */
export function sponsorRequestAuthMessageBytes(o: {
  chainId: string;
  genesisHash: string;
  fileId: string;
  senderWalletId: string;
  requestedAtMs: number;
  mldsaPubkeyB64: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `tet demo sponsor fee v1|chain_id=${o.chainId}|genesis_hash=${o.genesisHash}` +
      `|file_id=${o.fileId.trim()}|sender=${o.senderWalletId.trim().toLowerCase()}` +
      `|requested_at_ms=${o.requestedAtMs}|mldsa_pk=${o.mldsaPubkeyB64.trim()}`,
  );
}

/** The sender's signed request that the demo node sponsor this file's fee. */
export async function buildSponsorFeeRequestV1(o: {
  fileId: string;
  baseUrl?: string;
  requestedAtMs?: number;
}): Promise<SponsorFeeRequestV1> {
  const sess = requireHybridSignerSession();
  const sender = sess.walletIdHex64.trim().toLowerCase();
  const requestedAtMs = o.requestedAtMs ?? Date.now();
  const { chainId, genesisHash } = await expectedChainBinding(o.baseUrl);
  const msg = sponsorRequestAuthMessageBytes({
    chainId,
    genesisHash,
    fileId: o.fileId,
    senderWalletId: sender,
    requestedAtMs,
    mldsaPubkeyB64: sess.mldsa44_pubkey_b64,
  });
  return {
    file_id: o.fileId.trim(),
    sender_wallet_id: sender,
    requested_at_ms: requestedAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: sender,
      ed25519_sig_b64: u8ToStdBase64(await Promise.resolve(sess.signEd25519(msg))),
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg),
    },
  };
}

/** What the page says for each refusal reason (docs/DEMO_NODE.md). */
const REASON_TEXT: Record<string, string> = {
  daily_cap_ip: "the demo's daily limit for your connection is used up",
  daily_cap_wallet: "the demo's daily limit for this wallet is used up",
  daily_cap_global: "the demo's daily limit for everyone is used up",
  sponsor_low: "the demo's sponsor wallet is low",
  not_sponsorable: "this file can't be sponsored here",
  no_sponsor: "this node has no sponsor",
  stale_request: "your clock is too far from the node's",
  bad_signature: "the request's signature didn't check",
  rate_limited: "too many requests from your connection just now; wait a minute before the next file",
};

export type FeeOutcome =
  | { state: "paid"; text: string }
  | { state: "sponsored"; text: string }
  | { state: "unpaid"; reason: string; text: string };

/** Settle the fee for a file that was just delivered. Never throws. */
export async function settleFileFee(o: {
  mode: FeeMode;
  baseUrl: string;
  fileId: string;
  senderWalletId: string;
  storageWallet: string;
}): Promise<FeeOutcome> {
  if (o.mode === "demo-sponsor") {
    let reason = "";
    try {
      const req = await buildSponsorFeeRequestV1({ fileId: o.fileId, baseUrl: o.baseUrl });
      const r = await fetchJson<{ ok?: boolean; sponsored?: boolean; reason?: string }>(
        tetCoreUrl(o.baseUrl, "/demo/files/sponsor-fee"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(req),
        },
      );
      if (r.ok && r.data?.sponsored === true) {
        return { state: "sponsored", text: `Fee ${FILE_FEE_MICRO} µTET: sponsored by the demo.` };
      }
      // A refusal comes back as a non-2xx JSON body `{ ok: false, reason }`.
      let refused: string | undefined = r.data?.reason;
      if (!refused && r.text) {
        try {
          refused = (JSON.parse(r.text) as { reason?: string }).reason;
        } catch {
          /* not JSON: fall through to the status */
        }
      }
      // A 429 without a reason is the node's per-connection rate limit, not one of the sponsor's caps.
      reason = refused ?? (r.status === 429 ? "rate_limited" : r.status ? `HTTP ${r.status}` : "no answer");
    } catch (e: unknown) {
      reason = e instanceof Error ? e.message : String(e);
    }
    const why = REASON_TEXT[reason] ?? reason;
    return {
      state: "unpaid",
      reason,
      text: `Your file was delivered. Its fee wasn't sponsored (${why}); that doesn't affect the file.`,
    };
  }
  try {
    const env = await buildFileFeeEnvelopeV1({
      senderWalletId: o.senderWalletId,
      storageWallet: o.storageWallet,
      fileId: o.fileId,
      baseUrl: o.baseUrl,
    });
    const r = await postFilesFee(o.baseUrl, env);
    return r.ok
      ? { state: "paid", text: `Fee ${FILE_FEE_MICRO} µTET queued for settlement.` }
      : { state: "unpaid", reason: "settlement_failed", text: `Fee settlement failed: ${r.text ?? `HTTP ${r.status}`}.` };
  } catch (e: unknown) {
    return { state: "unpaid", reason: "settlement_failed", text: `Fee settlement failed: ${e instanceof Error ? e.message : String(e)}.` };
  }
}
