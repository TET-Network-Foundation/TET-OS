// Anonymous membership — client-side derivations (spec §A.4.3), byte-identical to
// `nexus-protocol` and `tet-core/src/tmail/anon.rs`.
//
// Plain ESM rather than TypeScript so `scripts/anon_poster_guard.mjs` can import it under the
// Node version CI runs, with no build step. The cross-language golden vector is pinned on both
// sides: `anon_client_derivations_match_the_golden_vector` in `tet-core/src/tests.rs`, and
// `GOLDEN` in the guard script.
//
// Why the client builds the tree itself: a poster who asks the node for "my path" names its
// wallet to the node just before an anonymous message appears. Downloading every leaf of the
// epoch and computing the path locally tells the node nothing about which member is posting.

import { sha256 } from "@noble/hashes/sha2";
import { hkdf } from "@noble/hashes/hkdf";

/** Merkle depth. `nexus_protocol::TET_ANON_MERKLE_DEPTH`. */
export const ANON_MERKLE_DEPTH = 20;
/** `nexus_protocol::TMAIL_BUCKET_MS`. */
export const TMAIL_BUCKET_MS = 86_400_000;

const enc = new TextEncoder();

/** @param {...Uint8Array} parts */
function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** @param {Uint8Array} b */
export function toHex(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/** @param {string} h */
export function fromHex(h) {
  const s = h.trim().toLowerCase();
  if (s.length % 2 !== 0 || !/^[0-9a-f]*$/.test(s)) throw new Error("bad hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Registry leaf: `SHA256("tet-anon-v1" ‖ secret)`. @param {Uint8Array} secret32 */
export function anonCommitment(secret32) {
  if (secret32.length !== 32) throw new Error("member secret must be 32 bytes");
  return sha256(concat(enc.encode("tet-anon-v1"), secret32));
}

/** `SHA256("tet-node-v1" ‖ left ‖ right)`. @param {Uint8Array} l @param {Uint8Array} r */
export function anonParent(l, r) {
  return sha256(concat(enc.encode("tet-node-v1"), l, r));
}

/** Empty-subtree hashes `E[0..=DEPTH]`; `E[0] = SHA256("tet-anon-empty-v1")`. */
export function anonEmptyHashes() {
  const out = [sha256(enc.encode("tet-anon-empty-v1"))];
  for (let d = 1; d <= ANON_MERKLE_DEPTH; d++) out.push(anonParent(out[d - 1], out[d - 1]));
  return out;
}

/**
 * Root of the fixed-depth tree over `leaves` (in leaf order), and the authentication path for
 * `index` when `0 <= index < leaves.length`. Mirrors `AnonMerkleTree::build`/`root`/`path`.
 *
 * @param {Uint8Array[]} leaves
 * @param {number} index
 * @returns {{ root: Uint8Array, siblings: Uint8Array[] | null }}
 */
export function anonRootAndPath(leaves, index) {
  const empties = anonEmptyHashes();
  const wantPath = Number.isInteger(index) && index >= 0 && index < leaves.length;
  const siblings = [];
  let level = leaves.slice();
  let i = index;
  for (let d = 0; d < ANON_MERKLE_DEPTH; d++) {
    if (wantPath) siblings.push(level[i ^ 1] ?? empties[d]);
    const next = [];
    for (let k = 0; k < level.length; k += 2) {
      next.push(anonParent(level[k], k + 1 < level.length ? level[k + 1] : empties[d]));
    }
    level = next;
    i >>= 1;
  }
  return { root: level[0] ?? empties[ANON_MERKLE_DEPTH], siblings: wantPath ? siblings : null };
}

/** `floor(sent_at_ms / 86_400_000)`. @param {number} sentAtMs */
export function tmailBucketIndex(sentAtMs) {
  return Math.floor(sentAtMs / TMAIL_BUCKET_MS);
}

/** @param {number} n */
function u64le(n) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return out;
}

/**
 * `nexus_protocol::tmail_ephemeral_seed_v1`: `HKDF-SHA256(anchor, info = "tet-ephemeral-v1" ‖
 * receiver ‖ bucket_le)`. One ephemeral per (member, receiver, day), and the member can always
 * re-derive it from its own secret, so nothing about it is stored anywhere.
 *
 * @param {Uint8Array} anchor32 the member secret
 * @param {Uint8Array} receiver32
 * @param {number} bucket
 */
export function tmailEphemeralSeed(anchor32, receiver32, bucket) {
  const info = concat(enc.encode("tet-ephemeral-v1"), receiver32, u64le(bucket));
  return hkdf(sha256, anchor32, undefined, info, 32);
}

/**
 * The member secret, derived from the wallet's BIP39 seed so it is recoverable from the mnemonic
 * and never stored: `HKDF-SHA256(bip39_seed, info = "tet-anon-member-v1")`. A label of its own,
 * so it is unrelated to the wallet's signing key and to its messaging keys.
 *
 * @param {Uint8Array} bip39Seed64
 */
export function anonMemberSecretFromBip39Seed(bip39Seed64) {
  return hkdf(sha256, bip39Seed64, undefined, enc.encode("tet-anon-member-v1"), 32);
}

/**
 * Hybrid-signature pre-image of a registration — byte-exact with Rust
 * `tmail_anon_registration_auth_message_bytes`.
 *
 * @param {{ chainId: string, genesisHash: string, walletId: string, commitmentHex: string,
 *           registeredAtMs: number, mldsaPubkeyB64: string }} o
 */
export function anonRegistrationAuthMessageBytes(o) {
  return enc.encode(
    `tet tmail anon registration v1|chain_id=${o.chainId}|genesis_hash=${o.genesisHash}` +
      `|wallet_id=${o.walletId.trim().toLowerCase()}|commitment=${o.commitmentHex.trim().toLowerCase()}` +
      `|registered_at_ms=${o.registeredAtMs}|mldsa_pk=${o.mldsaPubkeyB64.trim()}`,
  );
}
