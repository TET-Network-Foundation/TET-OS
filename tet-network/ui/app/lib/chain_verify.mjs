// "Verify without TET", Level 2: is a stamp in a block, and is that block in a chain copy that holds
// together? Pure and offline: the crypto comes in as functions (sha256, ed25519Verify,
// mldsa44Verify), so the same code runs in the offline verifier, the CLI and the guard.
//
// The input is a chain export (scripts/chain_export.mjs): blocks from the stamp's height up, as
// GET /explorer/block/:height gives them — the header fields a block id is computed from, and each
// transaction's canonical JSON as a string (the exact bytes its hash and signatures cover).
//
// What it proves, and what it doesn't: that the export is consistent with itself (each block id
// recomputes, each block names the one before it, the stamp's transaction is signed by its sender
// and listed in its block). Not that this is THE chain: until blocks carry producer signatures
// (Phase 1), anyone can make a consistent copy. Compare the tip's block id with what other nodes
// report.

export const EXPORT_KIND = "tet-chain-export";
const ZERO_PARENT = "0x" + "0".repeat(64);
const cvEnc = new TextEncoder();
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const le64 = (n) => {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
};
const cvConcat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** tet-core `consensus::block_id_for_block`. */
export async function blockIdOf(b, sha256) {
  const parent = b.parent_block_id && b.parent_block_id.trim() ? b.parent_block_id : ZERO_PARENT;
  const bytes = cvConcat(
    cvEnc.encode("TET_BLOCK_ID_V2|"),
    le64(b.height),
    cvEnc.encode(`|parent=${parent}|state=${b.state_root}|txs=${b.tx_hashes.join(",")}|producer=${b.producer_id}`),
  );
  return "0x" + hexOf(await sha256(bytes));
}

/** The bytes a (generic) transaction's hash and signatures cover: tet-core `tx_v1_auth_message_bytes`. */
export function txPreimage(chain, t) {
  return cvEnc.encode(`tet tx v1|chain_id=${chain.chainId}|genesis_hash=${chain.genesisHash}|mldsa=${String(t.mldsa_pubkey_b64).trim()}|tx=${t.tx_json}`);
}

/**
 * Check a chain export, and (optionally) that a stamp is in it.
 * @param {{ exported: any, chain: { chainId: string, genesisHash: string }, stamp?: { txHash: string, fileId: string },
 *           sha256: (b: Uint8Array) => Promise<Uint8Array>, ed25519Verify: Function, mldsa44Verify: Function }} o
 * @returns {Promise<{ ok: true, from: number, tip: number, tipBlockId: string, stamp: null | { height: number, confirmations: number } }
 *                 | { ok: false, reason: string }>}
 */
export async function verifyChainExport(o) {
  const e = o.exported;
  if (!e || e.v !== 1 || e.kind !== EXPORT_KIND || !Array.isArray(e.blocks) || !e.blocks.length) return { ok: false, reason: "not a TET chain export" };
  if (e.chain?.chainId !== o.chain.chainId || String(e.chain?.genesisHash).toLowerCase() !== String(o.chain.genesisHash).toLowerCase()) {
    return { ok: false, reason: "the export is from another chain" };
  }
  let prev = null;
  let found = null;
  for (const b of e.blocks) {
    if ((await blockIdOf(b, o.sha256)) !== b.block_id) return { ok: false, reason: `block ${b.height}: its id doesn't match its contents` };
    if (prev && (b.height !== prev.height + 1 || b.parent_block_id !== prev.block_id)) return { ok: false, reason: `block ${b.height} doesn't follow block ${prev.height}` };
    if (o.stamp && !found) {
      const want = o.stamp.txHash.toLowerCase().replace(/^0x/, "");
      const i = b.tx_hashes.findIndex((h) => h.toLowerCase().replace(/^0x/, "") === want);
      if (i >= 0) {
        const t = b.txs[i];
        const pre = txPreimage(o.chain, t);
        if ("0x" + hexOf(await o.sha256(pre)) !== b.tx_hashes[i]) return { ok: false, reason: "the stamp's transaction doesn't match its hash" };
        let tx;
        try {
          tx = JSON.parse(t.tx_json);
        } catch {
          return { ok: false, reason: "the stamp's transaction isn't readable" };
        }
        if (tx.kind !== "file_fee") return { ok: false, reason: "the transaction is not a file fee" };
        if (String(tx.file_id).toLowerCase() !== o.stamp.fileId.toLowerCase()) return { ok: false, reason: "the transaction stamps a different file" };
        if (String(tx.from_wallet).toLowerCase() !== String(t.ed25519_pubkey_hex).toLowerCase()) return { ok: false, reason: "the transaction isn't signed by its sender" };
        const ed = await o.ed25519Verify(String(t.ed25519_pubkey_hex).toLowerCase(), t.ed25519_sig_b64, pre);
        const pq = await o.mldsa44Verify(t.mldsa_pubkey_b64, t.mldsa_sig_b64, pre);
        if (!ed || !pq) return { ok: false, reason: "the transaction's signatures don't verify" };
        found = b.height;
      }
    }
    prev = b;
  }
  if (o.stamp && found === null) return { ok: false, reason: "the stamp's transaction isn't in this export" };
  const tip = e.blocks[e.blocks.length - 1];
  return { ok: true, from: e.blocks[0].height, tip: tip.height, tipBlockId: tip.block_id, stamp: found === null ? null : { height: found, confirmations: tip.height - found } };
}

/** A stamp's file id (tet-network/ui sign_anything.ts `stampFileId`): the .sig.json's SHA-256, first 16 bytes, as a UUID. */
export async function stampFileIdOf(sigBytes, sha256) {
  const h = hexOf((await sha256(sigBytes)).slice(0, 16));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
