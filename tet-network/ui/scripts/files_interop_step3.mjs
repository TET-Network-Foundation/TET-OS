/**
 * File Sharing Step 3 — headless Rust↔TS interop test.
 *
 * Replicates the EXACT byte formats / crypto of the UI File Sharing libs (files_e2ee.ts, files.ts)
 * and reuses the Tmail KEM key derivation (Files reuse Tmail messaging keys), using the same npm
 * packages + the same ML-DSA WASM the browser uses, then drives two test wallets (A, B) end-to-end
 * against the running TET node(s):
 *
 *   register A,B KEM keys → PUT /tmail/keys           (node verifies hybrid sig; 401 == interop break)
 *   A encrypts a file → B → POST /files/upload        (multipart; node verifies env + sha256(body))
 *   B lists inbox        → GET  /files/inbox/:wallet  (envelope w/ encrypted filename/mime)
 *   B fetches body       → GET  /files/fetch/:file_id → decrypt (TS↔TS E2EE), verify bytes/name/mime
 *   cross-region         → VPS inbox shows same file_id (announce gossip), envelope byte-identical
 *   negative test        → tampered envelope rejected (POST /files/announce → 4xx)
 *   cleanup              → DELETE /files/item/:file_id (A-signed) → fetch 404
 *
 * Usage: node scripts/files_interop_step3.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { x25519 } from "@noble/curves/ed25519";
import * as ed from "@noble/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256, sha512 } from "@noble/hashes/sha2";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { Kyber768 } from "crystals-kyber-js";

import initPqc, {
  mldsa44_keypair_from_mnemonic_b64,
  mldsa44_sign_deterministic_b64,
} from "../public/pqc/tet_pqc_wasm.js";

ed.hashes.sha512 = (m) => new Uint8Array(sha512(m));

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAC_URL = process.env.MAC_URL || "http://127.0.0.1:5011";
const VPS_URL = process.env.VPS_URL || "http://95.217.158.153:5010";
const TREASURY = process.env.TREASURY || "0000000000000000000000000000000000000000000000000000000000000099";
const CHAIN_ID = process.env.CHAIN_ID || "tet-local-dev";

const enc = (s) => new TextEncoder().encode(s);
const dec = (u8) => new TextDecoder().decode(u8);
const b64 = (u8) => Buffer.from(u8).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const hex = (u8) => Buffer.from(u8).toString("hex");

// --- chain_binding.ts replica (buildGenesisPayloadV2 / deterministicGenesisHashHex) ---
const STEVEMON = 1_000_000n;
const MAX_SUPPLY_MICRO = 10_000_000_000n * STEVEMON;
const FOUNDER_MICRO = 2_500_000_000n * STEVEMON;
const WORKER_POOL_MICRO = 5_000_000_000n * STEVEMON;
const TREASURY_MICRO = 2_500_000_000n * STEVEMON;
const RESERVE_MICRO = 0n;
const WALLET_WORKER_POOL = "0000000000000000000000000000000000000000000000000000000000000001";
const WALLET_PROTOCOL_RESERVE = "0000000000000000000000000000000000000000000000000000000000000003";

// v2 (Phase 1): genesis time, founder cliff and the validator-set digest are in the hash. Set them
// to what the node runs with; the defaults match a dev node that sets none of them.
const GENESIS_TIME_MS = process.env.TET_GENESIS_TIME_MS || "0";
const FOUNDER_CLIFF_MS = process.env.TET_FOUNDER_CLIFF_MS || String(365 * 86_400_000);
// tet-core `genesis::validators_digest_hex([])` = SHA-256("tet-validators-v1"): no validators.
const GENESIS_VALIDATORS_DIGEST =
  process.env.TET_GENESIS_VALIDATORS_DIGEST ||
  "48026ca38ababf8c4f25aa286b5fafa47914cabd5026b7ea9c4fba9ee3b9dd38";
// Item 6: the leader mode is a genesis parameter (tet-core `genesis::leader_mode_from_env`).
const LEADER_MODE = ((process.env.TET_CONSENSUS_LEADER_MODE || "").trim().toLowerCase() || "hash");
if (LEADER_MODE !== "hash" && LEADER_MODE !== "caac") {
  throw new Error(`TET_CONSENSUS_LEADER_MODE must be hash or caac, got ${LEADER_MODE}`);
}

function buildGenesisPayloadV2(chainId, founder, treasury) {
  return (
    `tet-genesis-v2|chain_id=${chainId}` +
    `|founder=${founder.toLowerCase()}` +
    `|founder_micro=${FOUNDER_MICRO}` +
    `|worker_pool=${WALLET_WORKER_POOL}` +
    `|worker_pool_micro=${WORKER_POOL_MICRO}` +
    `|treasury=${treasury.toLowerCase()}` +
    `|treasury_micro=${TREASURY_MICRO}` +
    `|reserve=${WALLET_PROTOCOL_RESERVE}` +
    `|reserve_micro=${RESERVE_MICRO}` +
    `|max_supply_micro=${MAX_SUPPLY_MICRO}` +
    `|genesis_time_ms=${GENESIS_TIME_MS}` +
    `|founder_cliff_ms=${FOUNDER_CLIFF_MS}` +
    `|validators=${GENESIS_VALIDATORS_DIGEST}` +
    `|leader_mode=${LEADER_MODE}`
  );
}

async function chainBinding(baseUrl) {
  let founder = "";
  try {
    const r = await fetch(`${baseUrl}/status`, { headers: { Accept: "application/json" } });
    const d = r.ok ? await r.json() : {};
    if (typeof d.founder_wallet_id === "string") founder = d.founder_wallet_id;
  } catch {}
  if (!founder) throw new Error(`could not read founder_wallet_id from ${baseUrl}/status`);
  const payload = buildGenesisPayloadV2(CHAIN_ID, founder, TREASURY);
  const genesisHash = "0x" + hex(sha256(enc(payload)));
  return { chainId: CHAIN_ID, genesisHash, founder };
}

// --- wallet identity (ed25519_tet.ts + pqc.ts) ---
function normMnemonic(m) {
  return m.trim().toLowerCase().replace(/\s+/g, " ");
}

function makeWallet(mnemonic) {
  const norm = normMnemonic(mnemonic);
  if (!validateMnemonic(norm, wordlist)) throw new Error("invalid mnemonic");
  const seed = mnemonicToSeedSync(norm, "");
  const edSk = seed.subarray(0, 32);
  const edPub = ed.getPublicKey(edSk);
  const walletId = hex(edPub);
  const pqc = mldsa44_keypair_from_mnemonic_b64(norm);
  return {
    norm,
    walletId,
    edSk,
    edPub,
    mldsaPubB64: pqc.pubkey_b64,
    mldsaKeypairB64: pqc.keypair_b64,
    signEd: (msg) => ed.sign(msg, edSk),
    signMldsa: (msg) => mldsa44_sign_deterministic_b64(pqc.keypair_b64, msg),
  };
}

// --- KEM key derivation (tmail_keys.deriveTmailKeysFromMnemonic — Files reuse Tmail KEM) ---
async function deriveKem(norm) {
  const seed = mnemonicToSeedSync(norm, "");
  const x25519_sk = hkdf(sha256, seed, undefined, enc("tet-tmail-x25519-v1"), 32);
  const x25519_pub = x25519.getPublicKey(x25519_sk);
  const mlkemSeed = hkdf(sha256, seed, undefined, enc("tet-tmail-mlkem-v1"), 64);
  const [mlkem_pub, mlkem_sk] = await new Kyber768().deriveKeyPair(mlkemSeed);
  return { x25519_sk, x25519_pub, mlkem_sk, mlkem_pub };
}

// --- File E2EE (files_e2ee.ts — info "tet-file-v1", one KEM key, three nonces) ---
const FILE_HKDF_INFO = enc("tet-file-v1");
const HKDF_SALT = new Uint8Array(32);
function deriveKeyHybridFile(xShared, mlkemShared) {
  const ikm = new Uint8Array(xShared.length + mlkemShared.length);
  ikm.set(xShared, 0);
  ikm.set(mlkemShared, xShared.length);
  return hkdf(sha256, ikm, HKDF_SALT, FILE_HKDF_INFO, 32);
}
function randomBytes(n) {
  const o = new Uint8Array(n);
  // crypto.getRandomValues caps each call at 65536 bytes — fill in chunks for larger buffers.
  for (let off = 0; off < n; off += 65536) {
    globalThis.crypto.getRandomValues(o.subarray(off, Math.min(off + 65536, n)));
  }
  return o;
}
async function encryptFile(fileBytes, filename, mime, rxPub, rmkPub) {
  const ephSk = randomBytes(32);
  const ephPub = x25519.getPublicKey(ephSk);
  const xShared = x25519.getSharedSecret(ephSk, rxPub);
  const [mlkemCt, mlkemSs] = await new Kyber768().encap(rmkPub);
  const key = deriveKeyHybridFile(xShared, mlkemSs);
  const fnNonce = randomBytes(12);
  const mimeNonce = randomBytes(12);
  const bodyNonce = randomBytes(12);
  const fnCt = chacha20poly1305(key, fnNonce).encrypt(enc(filename));
  const mimeCt = chacha20poly1305(key, mimeNonce).encrypt(enc(mime));
  const bodyCt = chacha20poly1305(key, bodyNonce).encrypt(fileBytes);
  return { ephPub, mlkemCt, fnNonce, mimeNonce, bodyNonce, fnCt, mimeCt, bodyCt };
}
async function decryptFile(b, rxSk, rmkSk) {
  const xShared = x25519.getSharedSecret(rxSk, b.client_ephemeral_pub);
  const mlkemSs = await new Kyber768().decap(b.mlkem_ciphertext, rmkSk);
  const key = deriveKeyHybridFile(xShared, mlkemSs);
  const filename = dec(chacha20poly1305(key, b.filename_nonce).decrypt(b.filename_ciphertext));
  const mimeType = dec(chacha20poly1305(key, b.mime_nonce).decrypt(b.mime_ciphertext));
  const fileBytes = chacha20poly1305(key, b.body_nonce).decrypt(b.body_ciphertext);
  return { fileBytes, filename, mimeType };
}

// --- preimages (keys.rs / files/mod.rs) ---
function keyRegPreimage({ chainId, genesisHash, walletId, xPubB64, mlkemPubB64, registeredAtMs, mldsaPk }) {
  return enc(
    `tet tmail key v1|chain_id=${chainId}|genesis_hash=${genesisHash}` +
      `|wallet_id=${walletId.toLowerCase()}|x25519_pub=${xPubB64.trim()}|mlkem_pub=${mlkemPubB64.trim()}` +
      `|registered_at_ms=${registeredAtMs}|mldsa_pk=${mldsaPk.trim()}`,
  );
}
function fileEnvelopePreimage(o) {
  return enc(
    `tet file envelope v1|chain_id=${o.chainId}|genesis_hash=${o.genesisHash}` +
      `|file_id=${o.fileId}|sender=${o.sender.toLowerCase()}|receiver=${o.receiver.toLowerCase()}` +
      `|size=${o.size}|sha256=${o.sha256.trim().toLowerCase()}` +
      `|filename=${o.filenameB64.trim()}|mime=${o.mimeB64.trim()}` +
      `|storage_node=${o.storageNode.trim()}|fee_micro=${o.feeMicro}|created_at_ms=${o.createdAtMs}` +
      `|mldsa_pk=${o.mldsaPk.trim()}`,
  );
}
function fileDeletePreimage(o) {
  return enc(
    `tet file delete v1|chain_id=${o.chainId}|genesis_hash=${o.genesisHash}` +
      `|file_id=${o.fileId}|sender=${o.sender.toLowerCase()}|created_at_ms=${o.createdAtMs}|mldsa_pk=${o.mldsaPk.trim()}`,
  );
}

async function buildKeyRegistration(wallet, kem, binding) {
  const registeredAtMs = Date.now();
  const xPubB64 = b64(kem.x25519_pub);
  const mlkemPubB64 = b64(kem.mlkem_pub);
  const msg = keyRegPreimage({
    chainId: binding.chainId,
    genesisHash: binding.genesisHash,
    walletId: wallet.walletId,
    xPubB64,
    mlkemPubB64,
    registeredAtMs,
    mldsaPk: wallet.mldsaPubB64,
  });
  return {
    wallet_id: wallet.walletId,
    x25519_pub_b64: xPubB64,
    mlkem_pub_b64: mlkemPubB64,
    registered_at_ms: registeredAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: wallet.walletId,
      ed25519_sig_b64: b64(wallet.signEd(msg)),
      mldsa_pubkey_b64: wallet.mldsaPubB64,
      mldsa_sig_b64: wallet.signMldsa(msg),
    },
  };
}

async function buildFileEnvelope(sender, receiverWalletId, rxPub, rmkPub, fileBytes, filename, mime, binding) {
  const bundle = await encryptFile(fileBytes, filename, mime, rxPub, rmkPub);
  const bodyCt = bundle.bodyCt;
  const sha = hex(sha256(bodyCt));
  const fileId = globalThis.crypto.randomUUID();
  const storageNode = "local";
  const feeMicro = 1000;
  const createdAtMs = Date.now();
  const ttlMs = 30 * 24 * 60 * 60 * 1000;
  const filenameB64 = b64(bundle.fnCt);
  const mimeB64 = b64(bundle.mimeCt);
  const msg = fileEnvelopePreimage({
    chainId: binding.chainId,
    genesisHash: binding.genesisHash,
    fileId,
    sender: sender.walletId,
    receiver: receiverWalletId,
    size: bodyCt.length,
    sha256: sha,
    filenameB64,
    mimeB64,
    storageNode,
    feeMicro,
    createdAtMs,
    mldsaPk: sender.mldsaPubB64,
  });
  const env = {
    v: 1,
    kind: "file_envelope_v1",
    file_id: fileId,
    sender_wallet_id: sender.walletId,
    receiver_wallet_id: receiverWalletId,
    file_size: bodyCt.length,
    file_sha256: sha,
    filename_encrypted_b64: filenameB64,
    mime_type_encrypted_b64: mimeB64,
    storage_node: storageNode,
    fee_micro: feeMicro,
    created_at_ms: createdAtMs,
    ttl_ms: ttlMs,
    e2ee: {
      v: 1,
      scheme: "tet-file-hybrid-v1",
      client_ephemeral_pub_b64: b64(bundle.ephPub),
      receiver_x25519_pub_b64: b64(rxPub),
      receiver_mlkem_pub_b64: b64(rmkPub),
      mlkem_ciphertext_b64: b64(bundle.mlkemCt),
      filename_nonce_b64: b64(bundle.fnNonce),
      mime_nonce_b64: b64(bundle.mimeNonce),
      body_nonce_b64: b64(bundle.bodyNonce),
    },
    hybrid_sig: {
      ed25519_pubkey_hex: sender.walletId,
      ed25519_sig_b64: b64(sender.signEd(msg)),
      mldsa_pubkey_b64: sender.mldsaPubB64,
      mldsa_sig_b64: sender.signMldsa(msg),
    },
  };
  return { fileId, sha256: sha, bodyCt, env };
}

function buildDeleteRequest(sender, fileId, binding) {
  const createdAtMs = Date.now();
  const msg = fileDeletePreimage({
    chainId: binding.chainId,
    genesisHash: binding.genesisHash,
    fileId,
    sender: sender.walletId,
    createdAtMs,
    mldsaPk: sender.mldsaPubB64,
  });
  return {
    file_id: fileId,
    sender_wallet_id: sender.walletId,
    created_at_ms: createdAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: sender.walletId,
      ed25519_sig_b64: b64(sender.signEd(msg)),
      mldsa_pubkey_b64: sender.mldsaPubB64,
      mldsa_sig_b64: sender.signMldsa(msg),
    },
  };
}

// --- REST helpers ---
async function putKeys(baseUrl, walletId, reg) {
  const r = await fetch(`${baseUrl}/tmail/keys/${walletId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(reg),
  });
  return { status: r.status, body: await r.text() };
}
async function getKeys(baseUrl, walletId) {
  const r = await fetch(`${baseUrl}/tmail/keys/${walletId}`, { headers: { Accept: "application/json" } });
  return { status: r.status, body: await r.text() };
}
async function uploadFile(baseUrl, env, bodyCt) {
  // Manually assemble the multipart/form-data body into a single Buffer so the request carries a
  // fixed Content-Length (undici's streamed Blob upload triggered EPIPE against the node).
  const boundary = "----tetfiles" + hex(randomBytes(12));
  const CRLF = "\r\n";
  const part = (s) => Buffer.from(s, "utf8");
  const head =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="envelope"${CRLF}` +
    `Content-Type: application/json${CRLF}${CRLF}` +
    `${JSON.stringify(env)}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="body"; filename="${env.file_id}.bin"${CRLF}` +
    `Content-Type: application/octet-stream${CRLF}${CRLF}`;
  const tail = `${CRLF}--${boundary}--${CRLF}`;
  const payload = Buffer.concat([part(head), Buffer.from(bodyCt), part(tail)]);
  try {
    const r = await fetch(`${baseUrl}/files/upload`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(payload.length),
      },
      body: payload,
    });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: String(e?.cause?.code || e?.message || e) };
  }
}
async function announceFile(baseUrl, env) {
  try {
    const r = await fetch(`${baseUrl}/files/announce`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(env),
    });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: String(e?.cause?.code || e?.message || e) };
  }
}
async function getFilesInbox(baseUrl, walletId, limit = 50) {
  try {
    const r = await fetch(`${baseUrl}/files/inbox/${walletId}?limit=${limit}`, { headers: { Accept: "application/json" } });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: String(e?.cause?.code || e?.message || e) };
  }
}
async function fetchFile(baseUrl, fileId) {
  try {
    const r = await fetch(`${baseUrl}/files/fetch/${fileId}`, { headers: { Accept: "application/octet-stream" } });
    if (!r.ok) return { status: r.status, bytes: null };
    const buf = await r.arrayBuffer();
    return { status: r.status, bytes: new Uint8Array(buf) };
  } catch (e) {
    return { status: 0, bytes: null, err: String(e?.cause?.code || e?.message || e) };
  }
}
async function deleteFile(baseUrl, fileId, req) {
  try {
    const r = await fetch(`${baseUrl}/files/item/${fileId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(req),
    });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: String(e?.cause?.code || e?.message || e) };
  }
}

function eqBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function log(...a) {
  console.log(...a);
}

async function main() {
  await initPqc(readFileSync(resolve(__dirname, "../public/pqc/tet_pqc_wasm_bg.wasm")));

  const results = { steps: [] };
  // `optional` steps (cross-region / VPS) do not count toward the Mac-only pass verdict — the VPS
  // is redeployed separately, so an unreachable or stale VPS must not fail the local-loop result.
  const step = (name, ok, detail, optional = false) => {
    results.steps.push({ name, ok, detail, optional });
    log(`${ok ? "✓" : optional ? "○" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  // ---- Setup ----
  const mac = await chainBinding(MAC_URL);
  log(`chain_id=${mac.chainId} genesis_hash=${mac.genesisHash} founder=${mac.founder}`);

  const A = makeWallet(generateMnemonic(wordlist, 128));
  const B = makeWallet(generateMnemonic(wordlist, 128));
  log(`Wallet A (sender):   ${A.walletId}`);
  log(`Wallet B (receiver): ${B.walletId}`);
  const kemA = await deriveKem(A.norm);
  const kemB = await deriveKem(B.norm);

  const pa = await putKeys(MAC_URL, A.walletId, await buildKeyRegistration(A, kemA, mac));
  step("Setup: PUT /tmail/keys A (Mac)", pa.status === 200, `HTTP ${pa.status}`);
  const regB = await buildKeyRegistration(B, kemB, mac);
  const pb = await putKeys(MAC_URL, B.walletId, regB);
  step("Setup: PUT /tmail/keys B (Mac)", pb.status === 200, `HTTP ${pb.status}`);
  const gk = await getKeys(MAC_URL, B.walletId);
  step("Setup: GET /tmail/keys B (lookup)", gk.status === 200 && gk.body.includes(regB.x25519_pub_b64), `HTTP ${gk.status}`);
  if (pa.status !== 200 || pb.status !== 200) return finish(results);

  // ---- Send (Mac) ----
  const original = randomBytes(100 * 1024); // ~100 KB synthetic file
  const filename = "tet-interop-step3.dat";
  const mime = "application/octet-stream";
  const built = await buildFileEnvelope(A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, original, filename, mime, mac);
  results.file_id = built.fileId;
  results.file_sha256 = built.sha256;
  log(`file_id=${built.fileId}`);
  log(`file_sha256(encrypted body)=${built.sha256}  encrypted_size=${built.bodyCt.length}`);

  const t0 = Date.now();
  const up = await uploadFile(MAC_URL, built.env, built.bodyCt);
  let upJson = {};
  try {
    upJson = JSON.parse(up.body);
  } catch {}
  const upOk = up.status === 202 && upJson.file_id === built.fileId;
  step("Send: POST /files/upload (A→B, Mac)", upOk, `HTTP ${up.status} file_id=${upJson.file_id ?? "?"} storage_node=${upJson.storage_node ?? "?"}`);
  if (!upOk) return finish(results);

  // ---- Receive (Mac) ----
  await new Promise((r) => setTimeout(r, 2000));
  const macInbox = await getFilesInbox(MAC_URL, B.walletId);
  let macEnv = null;
  if (macInbox.status === 200) {
    const j = JSON.parse(macInbox.body);
    macEnv = (j.files || []).find((f) => f.file_id === built.fileId);
  }
  step("Receive: GET /files/inbox B has file_id (Mac)", !!macEnv, macEnv ? "present" : `not found (HTTP ${macInbox.status})`);

  const macBlob = await fetchFile(MAC_URL, built.fileId);
  const macBlobOk = macBlob.status === 200 && eqBytes(macBlob.bytes, built.bodyCt);
  step("Receive: GET /files/fetch body byte-identical to upload (Mac)", macBlobOk,
    macBlob.status === 200 ? `len=${macBlob.bytes?.length}` : `HTTP ${macBlob.status}`);

  const macShaOk = macBlob.status === 200 && hex(sha256(macBlob.bytes)) === built.sha256;
  step("Receive: fetched body sha256 == envelope file_sha256 (Mac)", macShaOk,
    macBlob.status === 200 ? hex(sha256(macBlob.bytes)).slice(0, 16) + "…" : `HTTP ${macBlob.status}`);

  let macDecOk = false;
  let macNameOk = false;
  if (macBlob.status === 200 && macEnv) {
    const out = await decryptFile(
      {
        client_ephemeral_pub: unb64(macEnv.e2ee.client_ephemeral_pub_b64),
        mlkem_ciphertext: unb64(macEnv.e2ee.mlkem_ciphertext_b64),
        filename_nonce: unb64(macEnv.e2ee.filename_nonce_b64),
        mime_nonce: unb64(macEnv.e2ee.mime_nonce_b64),
        body_nonce: unb64(macEnv.e2ee.body_nonce_b64),
        filename_ciphertext: unb64(macEnv.filename_encrypted_b64),
        mime_ciphertext: unb64(macEnv.mime_type_encrypted_b64),
        body_ciphertext: macBlob.bytes,
      },
      kemB.x25519_sk,
      kemB.mlkem_sk,
    );
    macDecOk = eqBytes(out.fileBytes, original);
    macNameOk = out.filename === filename && out.mimeType === mime;
    results.mac_decrypted_filename = out.filename;
    results.mac_decrypted_mime = out.mimeType;
  }
  step("Receive: decrypt body == original 100 KB (Mac)", macDecOk, macDecOk ? "match" : "MISMATCH");
  step("Receive: decrypt filename + mime match (Mac)", macNameOk,
    macNameOk ? `name="${results.mac_decrypted_filename}" mime="${results.mac_decrypted_mime}"` : "MISMATCH");

  // ---- Cross-region (VPS) — optional: VPS is redeployed in a separate task. All steps here are
  // marked optional so an unreachable / stale VPS never fails the Mac-only verdict. ----
  const OPT = true;
  let crossMs = null;
  let vpsEnv = null;
  const vpsProbe = await getFilesInbox(VPS_URL, B.walletId);
  const vpsReachable = vpsProbe.status !== 0;
  const vpsHasFilesRoutes = vpsProbe.status === 200; // 404 ⇒ stale VPS binary (no /files/* yet)
  if (!vpsReachable) {
    step("Cross-region: VPS reachable", false, `unreachable (${vpsProbe.body}) — out of scope this task`, OPT);
  } else if (!vpsHasFilesRoutes) {
    step("Cross-region: VPS has /files/* routes", false,
      `HTTP ${vpsProbe.status} — VPS still on stale binary (redeploy is the next task)`, OPT);
  } else {
    // Poll VPS inbox for the gossiped envelope (announce plane), up to ~6s.
    for (let i = 0; i < 6; i++) {
      const vin = await getFilesInbox(VPS_URL, B.walletId);
      if (vin.status === 200) {
        const j = JSON.parse(vin.body);
        vpsEnv = (j.files || []).find((f) => f.file_id === built.fileId);
        if (vpsEnv) {
          crossMs = Date.now() - t0;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    step("Cross-region: VPS inbox shows same file_id (announce gossip)", !!vpsEnv,
      vpsEnv ? `~${crossMs}ms` : "not propagated (Mac↔VPS peer link down)", OPT);
    results.cross_region_ms = crossMs;

    if (vpsEnv) {
      const envIdentical =
        vpsEnv.file_sha256 === built.env.file_sha256 &&
        vpsEnv.filename_encrypted_b64 === built.env.filename_encrypted_b64 &&
        vpsEnv.mime_type_encrypted_b64 === built.env.mime_type_encrypted_b64 &&
        vpsEnv.e2ee.client_ephemeral_pub_b64 === built.env.e2ee.client_ephemeral_pub_b64 &&
        vpsEnv.e2ee.mlkem_ciphertext_b64 === built.env.e2ee.mlkem_ciphertext_b64 &&
        vpsEnv.e2ee.body_nonce_b64 === built.env.e2ee.body_nonce_b64;
      step("Cross-region: VPS signed envelope byte-identical to Mac", envIdentical, envIdentical ? "identical" : "MISMATCH", OPT);
    }

    // Body plane: Phase 0 only stores the blob on the uploader's node (announce = meta only). The VPS
    // fetch is expected to 404 until Step 4 (libp2p req/resp). We then independently verify the VPS
    // body pipeline by uploading the SAME signed envelope+body to VPS and fetching it back.
    const vpsFetchPre = await fetchFile(VPS_URL, built.fileId);
    step("Cross-region: VPS /files/fetch before independent upload (Phase-0: 404 expected)",
      vpsFetchPre.status === 404 || vpsFetchPre.status === 200,
      `HTTP ${vpsFetchPre.status}${vpsFetchPre.status === 404 ? " (expected — blob not gossiped in Phase 0)" : ""}`, OPT);

    const vUp = await uploadFile(VPS_URL, built.env, built.bodyCt);
    step("Cross-region: VPS accepts same signed envelope (POST /files/upload)", vUp.status === 202, `HTTP ${vUp.status}`, OPT);
    if (vUp.status === 202) {
      const vBlob = await fetchFile(VPS_URL, built.fileId);
      const vByteOk = vBlob.status === 200 && eqBytes(vBlob.bytes, built.bodyCt) && eqBytes(vBlob.bytes, macBlob.bytes);
      step("Cross-region: VPS fetched body byte-identical to Mac body", vByteOk,
        vBlob.status === 200 ? `len=${vBlob.bytes?.length}` : `HTTP ${vBlob.status}`, OPT);
      if (vBlob.status === 200) {
        const out = await decryptFile(
          {
            client_ephemeral_pub: unb64(built.env.e2ee.client_ephemeral_pub_b64),
            mlkem_ciphertext: unb64(built.env.e2ee.mlkem_ciphertext_b64),
            filename_nonce: unb64(built.env.e2ee.filename_nonce_b64),
            mime_nonce: unb64(built.env.e2ee.mime_nonce_b64),
            body_nonce: unb64(built.env.e2ee.body_nonce_b64),
            filename_ciphertext: unb64(built.env.filename_encrypted_b64),
            mime_ciphertext: unb64(built.env.mime_type_encrypted_b64),
            body_ciphertext: vBlob.bytes,
          },
          kemB.x25519_sk,
          kemB.mlkem_sk,
        );
        step("Cross-region: VPS decrypt body == original (B reads via VPS)", eqBytes(out.fileBytes, original),
          eqBytes(out.fileBytes, original) ? "match" : "MISMATCH", OPT);
      }
    }
  }

  // ---- Hybrid signature verification (positive already implied by upload 202) ----
  step("Hybrid sig: backend accepted envelope (no 401 on upload)", upOk, "Ed25519 + ML-DSA-44 verified");

  // Negative test: tamper file_sha256 (keeps 64-hex structure → signature must fail → 4xx).
  const tampered = JSON.parse(JSON.stringify(built.env));
  const last = tampered.file_sha256.slice(-1);
  tampered.file_sha256 = tampered.file_sha256.slice(0, -1) + (last === "0" ? "1" : "0");
  tampered.file_id = globalThis.crypto.randomUUID(); // avoid dedup collision with the valid one
  const tamperRes = await announceFile(MAC_URL, tampered);
  step("Hybrid sig: tampered envelope rejected (POST /files/announce)", tamperRes.status >= 400 && tamperRes.status < 500,
    `HTTP ${tamperRes.status} ${tamperRes.body.slice(0, 80)}`);

  // ---- Cleanup ----
  const del = await deleteFile(MAC_URL, built.fileId, buildDeleteRequest(A, built.fileId, mac));
  step("Cleanup: DELETE /files/item (A-signed, Mac)", del.status === 200, `HTTP ${del.status} ${del.body.slice(0, 80)}`);
  const afterDel = await fetchFile(MAC_URL, built.fileId);
  step("Cleanup: GET /files/fetch after delete → 404 (Mac)", afterDel.status === 404, `HTTP ${afterDel.status}`);
  // Tidy any independent VPS copy too (best-effort, not asserted hard; skips if VPS unreachable).
  try {
    const bindingV = await chainBinding(VPS_URL);
    const delV = await deleteFile(VPS_URL, built.fileId, buildDeleteRequest(A, built.fileId, bindingV));
    if (delV.status !== 0) log(`(cleanup) VPS DELETE /files/item → HTTP ${delV.status}`);
  } catch {
    /* VPS unreachable — nothing to tidy */
  }

  finish(results);
}

function finish(results) {
  log("\n=== SUMMARY ===");
  const required = results.steps.filter((s) => !s.optional);
  const optional = results.steps.filter((s) => s.optional);
  const macPass = required.every((s) => s.ok);
  const crossPass = optional.length > 0 && optional.every((s) => s.ok);
  log(
    JSON.stringify(
      {
        mac_all_pass: macPass,
        cross_region_pass: crossPass,
        cross_region_skipped: optional.length === 0 || !crossPass,
        file_id: results.file_id,
        file_sha256: results.file_sha256,
        cross_region_ms: results.cross_region_ms,
        steps: results.steps,
      },
      null,
      2,
    ),
  );
  log(`\nMac-only File Sharing interop: ${macPass ? "PASS" : "FAIL"}`);
  log(`Cross-region (VPS): ${crossPass ? "PASS" : "SKIPPED/INCOMPLETE (VPS redeploy is the next task)"}`);
  // Exit reflects the Mac-only verdict (this task's scope); cross-region is informational.
  process.exit(macPass ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
