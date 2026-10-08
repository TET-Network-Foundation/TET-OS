/**
 * Try TET "Sign anything" (and its stamp): sign a file with the tab's wallet into the same `.sig.json`
 * Verify checks (`verify_anything.mjs`, tet-agent-sdk `signPayloadEnvelope`), and optionally anchor it
 * on chain through the file-fee path.
 *
 * A **stamp** stores the `.sig.json` (encrypted to the signer) on the demo node with a chosen file id:
 * the first 16 bytes of the `.sig.json`'s SHA-256, as a UUID. The demo's sponsor pays its `FileFee`,
 * whose `file_id` is on chain. So the chain carries 128 bits of that hash at a block height; anyone
 * holding the `.sig.json` and the fee transaction's hash can check it (`checkStamp`). It does not show
 * who made the document (the sponsor pays), and it anchors a 128-bit prefix, not the whole hash.
 */
import { sha256 } from "@noble/hashes/sha2";
import { agentPayloadAuthMessageBytes, ED_PREFIX, mldsa44KeyId, PAE_DOMAIN } from "./verify_anything.mjs";
import { getHybridSignerSession } from "./hybrid_signer_session";
import { mldsa44SignDeterministic, pqcInit } from "./pqc";

export const STAMP_RECEIPT_KIND = "tet_stamp_v1";

export type Chain = { chainId: string; genesisHash: string };
export type SigEnvelope = {
  payloadType: string;
  payload: string;
  signatures: { keyid: string; sig: string }[];
  tet: { v: 1; pae: string; agent_ed25519_pubkey_hex: string; agent_mldsa44_pubkey_b64: string };
};
export type StampReceipt = {
  kind: typeof STAMP_RECEIPT_KIND;
  tx_hash: string;
  file_id: string;
  block_height: number;
  chain_id: string;
  genesis_hash: string;
};

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Sign `content` with the tab's wallet (Ed25519 + ML-DSA-44) over the agent-payload pre-image. */
export async function signContent(content: Uint8Array, payloadType: string, chain: Chain): Promise<SigEnvelope> {
  const sess = getHybridSignerSession();
  if (!sess) throw new Error("No wallet in this tab.");
  await pqcInit();
  const type = payloadType.trim() || "application/octet-stream";
  const msg = agentPayloadAuthMessageBytes(chain, type, content);
  const edSig = await sess.signEd25519(msg);
  const mlSig = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);
  const edHex = sess.walletIdHex64.toLowerCase();
  return {
    payloadType: type,
    payload: b64(content),
    signatures: [
      { keyid: `${ED_PREFIX}${edHex}`, sig: b64(edSig) },
      { keyid: mldsa44KeyId(sess.mldsa44_pubkey_b64), sig: mlSig },
    ],
    tet: { v: 1, pae: PAE_DOMAIN, agent_ed25519_pubkey_hex: edHex, agent_mldsa44_pubkey_b64: sess.mldsa44_pubkey_b64.trim() },
  };
}

/** The exact bytes of the downloaded `.sig.json` (a stamp commits to these). */
export function sigJsonBytes(env: SigEnvelope): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(env, null, 2)}\n`);
}

/** The stamp's file id: the first 16 bytes of SHA-256(sig.json bytes), formatted as a UUID. */
export function stampFileId(sigBytes: Uint8Array): string {
  const h = Array.from(sha256(sigBytes).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export type StampCheck =
  | { state: "anchored"; height: number; txHash: string }
  | { state: "not_anchored"; reason: string };

/**
 * Check a stamp: the fee transaction exists on this node's chain, in a canonical block, is a
 * `FileFee`, and its `file_id` is the stamp of exactly these `.sig.json` bytes. `fetchTx` is injected
 * (the page passes the node's `/explorer/tx/:hash`).
 */
export async function checkStamp(o: {
  sigBytes: Uint8Array;
  receipt: { tx_hash?: unknown };
  fetchTx: (hash: string) => Promise<{ found?: boolean; block_height?: number; canonical?: boolean; tx?: { tx?: unknown } } | null>;
}): Promise<StampCheck> {
  const hash = typeof o.receipt?.tx_hash === "string" ? o.receipt.tx_hash.trim().toLowerCase().replace(/^0x/, "") : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return { state: "not_anchored", reason: "the receipt has no transaction hash" };
  const row = await o.fetchTx(hash);
  if (!row || row.found !== true) return { state: "not_anchored", reason: "this node's chain has no such transaction (not mined yet, or another chain)" };
  if (row.canonical === false) return { state: "not_anchored", reason: "the transaction is in a block that is no longer on the chain" };
  // TxV1 is serialised `{"kind":"file_fee", "file_id": …, …}` (serde tag = "kind").
  const tx = row.tx?.tx as { kind?: unknown; file_id?: unknown } | undefined;
  const fileId = tx && typeof tx === "object" && tx.kind === "file_fee" ? String(tx.file_id ?? "") : null;
  if (fileId === null) return { state: "not_anchored", reason: "the transaction is not a file fee" };
  const want = stampFileId(o.sigBytes);
  if (fileId.toLowerCase() !== want) return { state: "not_anchored", reason: "the transaction stamps a different file" };
  const height = Number(row.block_height ?? 0);
  if (!(height > 0)) return { state: "not_anchored", reason: "the transaction has no block height yet" };
  return { state: "anchored", height, txHash: hash };
}
