/**
 * The hash-only stamp: anchor a "Mark as genuine" record on chain, so its place in the chain doesn't
 * depend on one node's clock. It runs the Sign panel's stamp on the RECORD (a file's SHA-256 plus
 * signatures), never on the file: the record is stored encrypted to its signer (7 days), the demo's
 * sponsor covers its `FileFee` (whose `file_id` is the record's stamp id), and the node is told the
 * fee's hash, which it checks against its own chain (`/sigs/publish` with `anchor_tx`).
 *
 * Nothing of the file leaves the tab: `anchorRecord` refuses anything that isn't a hash-only record
 * (hash_stamp_guard checks the bytes that would be uploaded). It shows the record existed before
 * the fee's block; blocks carry no date yet.
 */
import { buildFileEnvelopeV1 } from "./files";
import { settleFileFee } from "./files_fee";
import { checkStamp, stampFileId, STAMP_RECEIPT_KIND, type Chain, type StampReceipt } from "./sign_anything";
import { postFilesUpload, tetCoreUrl } from "./tet_core_http";
import { publishAnchor } from "./proof_code";

export const HASH_RECORD_TYPE = "application/vnd.tet.sha256";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Is `bytes` a hash-only record (payload: exactly 32 bytes)? Anything else would carry content. */
export function isHashOnlyRecord(bytes: Uint8Array): boolean {
  try {
    const env = JSON.parse(new TextDecoder().decode(bytes)) as { payloadType?: unknown; payload?: unknown };
    return env.payloadType === HASH_RECORD_TYPE && typeof env.payload === "string" && atob(env.payload).length === 32;
  } catch {
    return false;
  }
}

export type AnchorDeps = {
  buildFileEnvelopeV1: typeof buildFileEnvelopeV1;
  postFilesUpload: typeof postFilesUpload;
  settleFileFee: typeof settleFileFee;
  checkStamp: typeof checkStamp;
  publishAnchor: typeof publishAnchor;
  fetchTx: (hash: string) => Promise<{ found?: boolean; block_height?: number; canonical?: boolean; tx?: { tx?: unknown } } | null>;
  sleep: (ms: number) => Promise<void>;
};

export type AnchorStep = "upload" | "fee" | "mined" | "link";

/** A mined transaction as the node's explorer has it (404: not on its chain). */
export async function explorerTx(baseUrl: string, hash: string) {
  const r = await fetch(tetCoreUrl(baseUrl, `/explorer/tx/${hash}`));
  if (r.status === 404) return { found: false };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function anchorRecord(o: {
  baseUrl: string;
  record: Uint8Array;
  me: string;
  keys: { x25519_pub: Uint8Array; mlkem_pub: Uint8Array };
  chain: Chain;
  onStep?: (s: AnchorStep) => void;
  deps?: Partial<AnchorDeps>;
}): Promise<StampReceipt> {
  const d: AnchorDeps = {
    buildFileEnvelopeV1,
    postFilesUpload,
    settleFileFee,
    checkStamp,
    publishAnchor,
    fetchTx: (hash) => explorerTx(o.baseUrl, hash),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    ...o.deps,
  };
  if (!isHashOnlyRecord(o.record)) throw new Error("only a hash-only record can be anchored this way");
  const fileId = stampFileId(o.record);
  o.onStep?.("upload");
  const built = await d.buildFileEnvelopeV1({
    senderWalletId: o.me,
    receiverWalletId: o.me,
    fileBytes: o.record,
    filename: "proof.json",
    mimeType: "application/json",
    receiverX25519Pub: o.keys.x25519_pub,
    receiverMlkemPub: o.keys.mlkem_pub,
    baseUrl: o.baseUrl,
    ttlMs: TTL_MS,
    fileId,
  });
  const up = await d.postFilesUpload(o.baseUrl, built.envelope, built.bodyCiphertext);
  if (!up.ok) throw new Error(up.text || `HTTP ${up.status}`);
  o.onStep?.("fee");
  const fee = await d.settleFileFee({ mode: "demo-sponsor", baseUrl: o.baseUrl, fileId, senderWalletId: o.me, storageWallet: up.storageWallet ?? "" });
  if (fee.state !== "sponsored" || !fee.txHash) throw new Error(fee.text);
  o.onStep?.("mined");
  for (let i = 0; i < 40; i++) {
    const c = await d.checkStamp({ sigBytes: o.record, receipt: { tx_hash: fee.txHash }, fetchTx: d.fetchTx });
    if (c.state === "anchored") {
      o.onStep?.("link");
      await d.publishAnchor(o.baseUrl, o.record, o.chain, c.txHash);
      return { kind: STAMP_RECEIPT_KIND, tx_hash: c.txHash, file_id: fileId, block_height: c.height, chain_id: o.chain.chainId, genesis_hash: o.chain.genesisHash };
    }
    await d.sleep(3_000);
  }
  throw new Error(`timeout:${fee.txHash}`);
}
