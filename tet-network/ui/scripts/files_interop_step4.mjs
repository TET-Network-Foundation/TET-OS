/**
 * File Sharing Step 4 — libp2p body transfer + on-chain fee settlement interop test.
 *
 * Builds on Step 3 (REST flow, see files_interop_step3.mjs) and verifies the two Step 4 features
 * against the live Mac + VPS nodes:
 *
 *   1. libp2p body transfer (`/tet/v1/files/fetch`, custom 8 MiB codec):
 *      A uploads a ~5 MB encrypted file to the MAC node only. The VPS node receives the gossip
 *      announce (metadata, no blob). `GET VPS /files/fetch/:id` must transparently pull the blob
 *      from the Mac over libp2p, verify sha256, cache it, and return byte-identical content.
 *
 *   2. Fee settlement (`TxV1::FileFee`, 25/50/25 treasury/storage/burn):
 *      A claims the welcome airdrop (funding), then submits a hybrid-signed file fee
 *      (1000 µTET) to `POST /files/fetch`→`/files/fee`. The VPS producer mines it; both nodes
 *      must show sender −1000, treasury +250, burn +250 (storage +500 goes to the node wallet,
 *      which also accrues block rewards, so it is reported but not asserted).
 *
 *   negative: fee from an unfunded wallet → 400; wrong fee amount → 4xx.
 *
 * Usage: node scripts/files_interop_step4.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const MAC_URL = process.env.MAC_URL || "http://127.0.0.1:5011";
const VPS_URL = process.env.VPS_URL || "http://95.217.158.153:5010";
const TREASURY = process.env.TREASURY || "0000000000000000000000000000000000000000000000000000000000000099";
const BURN_WALLET = process.env.BURN_WALLET || "tet-api-pool";
const CHAIN_ID = process.env.CHAIN_ID || "tet-local-dev";
const FILE_FEE_MICRO = 1000;

const enc = (s) => new TextEncoder().encode(s);
const dec = (u8) => new TextDecoder().decode(u8);
const b64 = (u8) => Buffer.from(u8).toString("base64");
const hex = (u8) => Buffer.from(u8).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- chain binding (chain_binding.ts replica) ---
const STEVEMON = 1_000_000n;
const MAX_SUPPLY_MICRO = 10_000_000_000n * STEVEMON;
const FOUNDER_MICRO = 2_500_000_000n * STEVEMON;
const WORKER_POOL_MICRO = 5_000_000_000n * STEVEMON;
const TREASURY_MICRO = 2_500_000_000n * STEVEMON;
const RESERVE_MICRO = 0n;
const WALLET_WORKER_POOL = "0000000000000000000000000000000000000000000000000000000000000001";
const WALLET_PROTOCOL_RESERVE = "0000000000000000000000000000000000000000000000000000000000000003";

function buildGenesisPayloadV1(chainId, founder, treasury) {
  return (
    `tet-genesis-v1|chain_id=${chainId}` +
    `|founder=${founder.toLowerCase()}` +
    `|founder_micro=${FOUNDER_MICRO}` +
    `|worker_pool=${WALLET_WORKER_POOL}` +
    `|worker_pool_micro=${WORKER_POOL_MICRO}` +
    `|treasury=${treasury.toLowerCase()}` +
    `|treasury_micro=${TREASURY_MICRO}` +
    `|reserve=${WALLET_PROTOCOL_RESERVE}` +
    `|reserve_micro=${RESERVE_MICRO}` +
    `|max_supply_micro=${MAX_SUPPLY_MICRO}`
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
  const payload = buildGenesisPayloadV1(CHAIN_ID, founder, TREASURY);
  const genesisHash = "0x" + hex(sha256(enc(payload)));
  return { chainId: CHAIN_ID, genesisHash, founder };
}

// --- wallet identity ---
function makeWallet(mnemonic) {
  const norm = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(norm, wordlist)) throw new Error("invalid mnemonic");
  const seed = mnemonicToSeedSync(norm, "");
  const edSk = seed.subarray(0, 32);
  const edPub = ed.getPublicKey(edSk);
  const walletId = hex(edPub);
  const pqc = mldsa44_keypair_from_mnemonic_b64(norm);
  return {
    norm,
    walletId,
    signEd: (msg) => ed.sign(msg, edSk),
    signMldsa: (msg) => mldsa44_sign_deterministic_b64(pqc.keypair_b64, msg),
    mldsaPubB64: pqc.pubkey_b64,
  };
}

async function deriveKem(norm) {
  const seed = mnemonicToSeedSync(norm, "");
  const x25519_sk = hkdf(sha256, seed, undefined, enc("tet-tmail-x25519-v1"), 32);
  const x25519_pub = x25519.getPublicKey(x25519_sk);
  const mlkemSeed = hkdf(sha256, seed, undefined, enc("tet-tmail-mlkem-v1"), 64);
  const [mlkem_pub, mlkem_sk] = await new Kyber768().deriveKeyPair(mlkemSeed);
  return { x25519_sk, x25519_pub, mlkem_sk, mlkem_pub };
}

// --- File E2EE (info "tet-file-v1") ---
const HKDF_SALT = new Uint8Array(32);
function deriveKeyHybridFile(xShared, mlkemShared) {
  const ikm = new Uint8Array(xShared.length + mlkemShared.length);
  ikm.set(xShared, 0);
  ikm.set(mlkemShared, xShared.length);
  return hkdf(sha256, ikm, HKDF_SALT, enc("tet-file-v1"), 32);
}
function randomBytes(n) {
  const o = new Uint8Array(n);
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
  return {
    ephPub,
    mlkemCt,
    fnNonce,
    mimeNonce,
    bodyNonce,
    fnCt: chacha20poly1305(key, fnNonce).encrypt(enc(filename)),
    mimeCt: chacha20poly1305(key, mimeNonce).encrypt(enc(mime)),
    bodyCt: chacha20poly1305(key, bodyNonce).encrypt(fileBytes),
  };
}
async function decryptFile(b, rxSk, rmkSk) {
  const xShared = x25519.getSharedSecret(rxSk, b.client_ephemeral_pub);
  const mlkemSs = await new Kyber768().decap(b.mlkem_ciphertext, rmkSk);
  const key = deriveKeyHybridFile(xShared, mlkemSs);
  return {
    filename: dec(chacha20poly1305(key, b.filename_nonce).decrypt(b.filename_ciphertext)),
    mimeType: dec(chacha20poly1305(key, b.mime_nonce).decrypt(b.mime_ciphertext)),
    fileBytes: chacha20poly1305(key, b.body_nonce).decrypt(b.body_ciphertext),
  };
}

// --- preimages ---
function keyRegPreimage(o) {
  return enc(
    `tet tmail key v1|chain_id=${o.chainId}|genesis_hash=${o.genesisHash}` +
      `|wallet_id=${o.walletId.toLowerCase()}|x25519_pub=${o.xPubB64.trim()}|mlkem_pub=${o.mlkemPubB64.trim()}` +
      `|registered_at_ms=${o.registeredAtMs}|mldsa_pk=${o.mldsaPk.trim()}`,
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
/** Canonical TxV1 envelope preimage — mirrors tet-core `wallet::tx_v1_auth_message_bytes`. */
function txV1Preimage(binding, mldsaPubB64, txCanonicalJson) {
  return enc(
    `tet tx v1|chain_id=${binding.chainId}|genesis_hash=${binding.genesisHash}` +
      `|mldsa=${mldsaPubB64.trim()}|tx=${txCanonicalJson}`,
  );
}

function signedTxEnvelope(wallet, binding, txCanonicalJson, txObj) {
  const msg = txV1Preimage(binding, wallet.mldsaPubB64, txCanonicalJson);
  return {
    v: 1,
    tx: txObj,
    sig: {
      ed25519_pubkey_hex: wallet.walletId,
      ed25519_sig_b64: b64(wallet.signEd(msg)),
      mldsa_pubkey_b64: wallet.mldsaPubB64,
      mldsa_sig_b64: wallet.signMldsa(msg),
    },
    attestation: { platform: "", report_b64: "" },
  };
}

// --- REST helpers ---
async function jsonReq(url, method, body) {
  try {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: String(e?.cause?.code || e?.message || e) };
  }
}
async function balanceMicro(baseUrl, wallet) {
  const r = await fetch(`${baseUrl}/ledger/balance/${encodeURIComponent(wallet)}`, {
    headers: { Accept: "application/json" },
  });
  const d = await r.json();
  return Math.round((d.balance_tet ?? 0) * 1e6);
}
async function uploadFile(baseUrl, env, bodyCt) {
  const boundary = "----tetfiles" + hex(randomBytes(12));
  const CRLF = "\r\n";
  const head =
    `--${boundary}${CRLF}Content-Disposition: form-data; name="envelope"${CRLF}` +
    `Content-Type: application/json${CRLF}${CRLF}${JSON.stringify(env)}${CRLF}` +
    `--${boundary}${CRLF}Content-Disposition: form-data; name="body"; filename="${env.file_id}.bin"${CRLF}` +
    `Content-Type: application/octet-stream${CRLF}${CRLF}`;
  const payload = Buffer.concat([Buffer.from(head, "utf8"), Buffer.from(bodyCt), Buffer.from(`${CRLF}--${boundary}--${CRLF}`, "utf8")]);
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
}
async function fetchFile(baseUrl, fileId, timeoutMs = 60_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseUrl}/files/fetch/${fileId}`, {
      headers: { Accept: "application/octet-stream" },
      signal: ctl.signal,
    });
    if (!r.ok) return { status: r.status, bytes: null };
    return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
  } catch (e) {
    return { status: 0, bytes: null, err: String(e?.cause?.code || e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// --- main ---
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  await initPqc(readFileSync(resolve(__dirname, "../public/pqc/tet_pqc_wasm_bg.wasm")));
  const binding = await chainBinding(MAC_URL);
  console.log(`chain binding: chain_id=${binding.chainId} genesis=${binding.genesisHash.slice(0, 18)}…`);

  // Wallets: A sender (funded), B receiver, C unfunded (negative test).
  const A = makeWallet(generateMnemonic(wordlist));
  const B = makeWallet(generateMnemonic(wordlist));
  const C = makeWallet(generateMnemonic(wordlist));
  const kemB = await deriveKem(B.norm);
  console.log(`A=${A.walletId.slice(0, 12)}… B=${B.walletId.slice(0, 12)}… C=${C.walletId.slice(0, 12)}…`);

  // Register B's KEM keys on Mac (required to address a file to B).
  {
    const registeredAtMs = Date.now();
    const reg = {
      wallet_id: B.walletId,
      x25519_pub_b64: b64(kemB.x25519_pub),
      mlkem_pub_b64: b64(kemB.mlkem_pub),
      registered_at_ms: registeredAtMs,
      hybrid_sig: {
        ed25519_pubkey_hex: B.walletId,
        ed25519_sig_b64: b64(
          B.signEd(
            keyRegPreimage({
              chainId: binding.chainId,
              genesisHash: binding.genesisHash,
              walletId: B.walletId,
              xPubB64: b64(kemB.x25519_pub),
              mlkemPubB64: b64(kemB.mlkem_pub),
              registeredAtMs,
              mldsaPk: B.mldsaPubB64,
            }),
          ),
        ),
        mldsa_pubkey_b64: B.mldsaPubB64,
        mldsa_sig_b64: B.signMldsa(
          keyRegPreimage({
            chainId: binding.chainId,
            genesisHash: binding.genesisHash,
            walletId: B.walletId,
            xPubB64: b64(kemB.x25519_pub),
            mlkemPubB64: b64(kemB.mlkem_pub),
            registeredAtMs,
            mldsaPk: B.mldsaPubB64,
          }),
        ),
      },
    };
    const r = await jsonReq(`${MAC_URL}/tmail/keys/${B.walletId}`, "PUT", reg);
    if (!check("Setup: register B KEM keys (Mac)", r.status === 200, `HTTP ${r.status}`)) return;
  }

  // Fund A via the consensus welcome airdrop (1000 TET).
  {
    const txCanonical = `{"kind":"initial_airdrop","wallet_id":"${A.walletId}"}`;
    const env = signedTxEnvelope(A, binding, txCanonical, {
      kind: "initial_airdrop",
      wallet_id: A.walletId,
    });
    const r = await jsonReq(`${MAC_URL}/ledger/initial_airdrop/claim`, "POST", env);
    check("Funding: airdrop claim accepted (Mac)", r.status === 202 || r.status === 200, `HTTP ${r.status}`);
    let bal = 0;
    for (let i = 0; i < 24; i++) {
      await sleep(2500);
      bal = await balanceMicro(MAC_URL, A.walletId);
      if (bal > 0) break;
    }
    if (!check("Funding: A balance credited after mining", bal >= FILE_FEE_MICRO, `${bal} µTET`)) return;
  }

  // Snapshot balances before the fee settlement.
  const before = {
    senderMac: await balanceMicro(MAC_URL, A.walletId),
    treasuryMac: await balanceMicro(MAC_URL, TREASURY),
    treasuryVps: await balanceMicro(VPS_URL, TREASURY),
    burnMac: await balanceMicro(MAC_URL, BURN_WALLET),
    burnVps: await balanceMicro(VPS_URL, BURN_WALLET),
  };

  // 1. Upload a ~5 MB file A→B on the MAC node only.
  const plaintext = randomBytes(5 * 1024 * 1024 - 64);
  const bundle = await encryptFile(plaintext, "step4-libp2p.bin", "application/octet-stream", kemB.x25519_pub, kemB.mlkem_pub);
  const fileId = globalThis.crypto.randomUUID();
  const sha = hex(sha256(bundle.bodyCt));
  const createdAtMs = Date.now();
  const filenameB64 = b64(bundle.fnCt);
  const mimeB64 = b64(bundle.mimeCt);
  const envMsg = fileEnvelopePreimage({
    chainId: binding.chainId,
    genesisHash: binding.genesisHash,
    fileId,
    sender: A.walletId,
    receiver: B.walletId,
    size: bundle.bodyCt.length,
    sha256: sha,
    filenameB64,
    mimeB64,
    storageNode: "local",
    feeMicro: FILE_FEE_MICRO,
    createdAtMs,
    mldsaPk: A.mldsaPubB64,
  });
  const fileEnv = {
    v: 1,
    kind: "file_envelope_v1",
    file_id: fileId,
    sender_wallet_id: A.walletId,
    receiver_wallet_id: B.walletId,
    file_size: bundle.bodyCt.length,
    file_sha256: sha,
    filename_encrypted_b64: filenameB64,
    mime_type_encrypted_b64: mimeB64,
    storage_node: "local",
    fee_micro: FILE_FEE_MICRO,
    created_at_ms: createdAtMs,
    ttl_ms: 30 * 24 * 60 * 60 * 1000,
    e2ee: {
      v: 1,
      scheme: "tet-file-hybrid-v1",
      client_ephemeral_pub_b64: b64(bundle.ephPub),
      receiver_x25519_pub_b64: b64(kemB.x25519_pub),
      receiver_mlkem_pub_b64: b64(kemB.mlkem_pub),
      mlkem_ciphertext_b64: b64(bundle.mlkemCt),
      filename_nonce_b64: b64(bundle.fnNonce),
      mime_nonce_b64: b64(bundle.mimeNonce),
      body_nonce_b64: b64(bundle.bodyNonce),
    },
    hybrid_sig: {
      ed25519_pubkey_hex: A.walletId,
      ed25519_sig_b64: b64(A.signEd(envMsg)),
      mldsa_pubkey_b64: A.mldsaPubB64,
      mldsa_sig_b64: A.signMldsa(envMsg),
    },
  };
  const up = await uploadFile(MAC_URL, fileEnv, bundle.bodyCt);
  let storageWallet = "";
  try {
    storageWallet = JSON.parse(up.body).storage_wallet ?? "";
  } catch {}
  if (!check("Upload: 5 MB encrypted body stored on Mac", up.status === 202, `HTTP ${up.status} storage_wallet=${storageWallet}`)) return;

  // 2. Wait for the announce to reach the VPS inbox (gossip).
  let announced = false;
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const r = await jsonReq(`${VPS_URL}/files/inbox/${B.walletId}?limit=50`, "GET");
    if (r.status === 200 && r.body.includes(fileId)) {
      announced = true;
      break;
    }
  }
  if (!check("Announce: file visible in VPS inbox (gossip)", announced)) return;

  // 3. The Step 4 core: fetch the body from the VPS, which must pull it from the Mac over libp2p.
  const t0 = Date.now();
  const fetched = await fetchFile(VPS_URL, fileId);
  const fetchMs = Date.now() - t0;
  const bytesOk = !!fetched.bytes && fetched.bytes.length === bundle.bodyCt.length && hex(sha256(fetched.bytes)) === sha;
  if (!check(
    "libp2p body transfer: VPS served blob pulled from Mac",
    fetched.status === 200 && bytesOk,
    `HTTP ${fetched.status} bytes=${fetched.bytes?.length ?? 0} took=${fetchMs}ms`,
  )) return;

  // Decrypt as B and compare to the original plaintext.
  const decrypted = await decryptFile(
    {
      client_ephemeral_pub: bundle.ephPub,
      mlkem_ciphertext: bundle.mlkemCt,
      filename_nonce: bundle.fnNonce,
      mime_nonce: bundle.mimeNonce,
      body_nonce: bundle.bodyNonce,
      filename_ciphertext: bundle.fnCt,
      mime_ciphertext: bundle.mimeCt,
      body_ciphertext: fetched.bytes,
    },
    kemB.x25519_sk,
    kemB.mlkem_sk,
  );
  check(
    "E2EE: decrypted body byte-identical to plaintext",
    decrypted.fileBytes.length === plaintext.length && Buffer.compare(Buffer.from(decrypted.fileBytes), Buffer.from(plaintext)) === 0,
    `${decrypted.filename} (${decrypted.fileBytes.length} bytes)`,
  );

  // Second fetch must be served from the VPS local cache (fast).
  const t1 = Date.now();
  const cached = await fetchFile(VPS_URL, fileId);
  check(
    "Cache: second VPS fetch served locally",
    cached.status === 200 && !!cached.bytes && hex(sha256(cached.bytes)) === sha,
    `took=${Date.now() - t1}ms (first=${fetchMs}ms)`,
  );

  // 4. Fee settlement: A pays 1000 µTET via TxV1::FileFee.
  {
    const sw = storageWallet || "local-wallet";
    const txCanonical = `{"kind":"file_fee","from_wallet":"${A.walletId}","storage_wallet":"${sw}","file_id":"${fileId}","fee_micro":${FILE_FEE_MICRO}}`;
    const env = signedTxEnvelope(A, binding, txCanonical, {
      kind: "file_fee",
      from_wallet: A.walletId,
      storage_wallet: sw,
      file_id: fileId,
      fee_micro: FILE_FEE_MICRO,
    });
    const r = await jsonReq(`${MAC_URL}/files/fee`, "POST", env);
    if (!check("Fee: POST /files/fee accepted (Mac)", r.status === 202, `HTTP ${r.status} ${r.body.slice(0, 120)}`)) return;

    let senderAfter = before.senderMac;
    for (let i = 0; i < 24; i++) {
      await sleep(2500);
      senderAfter = await balanceMicro(MAC_URL, A.walletId);
      if (senderAfter !== before.senderMac) break;
    }
    check(
      "Fee: sender debited exactly 1000 µTET (Mac)",
      senderAfter === before.senderMac - FILE_FEE_MICRO,
      `${before.senderMac} → ${senderAfter}`,
    );
    const senderVps = await balanceMicro(VPS_URL, A.walletId);
    check("Fee: sender balance identical on VPS", senderVps === senderAfter, `${senderVps}`);

    const after = {
      treasuryMac: await balanceMicro(MAC_URL, TREASURY),
      treasuryVps: await balanceMicro(VPS_URL, TREASURY),
      burnMac: await balanceMicro(MAC_URL, BURN_WALLET),
      burnVps: await balanceMicro(VPS_URL, BURN_WALLET),
    };
    // Treasury is a 2.5e15 µTET balance reported as f64 TET → ±1 µTET rounding tolerance.
    const near = (delta, want) => Math.abs(delta - want) <= 1;
    check(
      "Fee: treasury +250 µTET (Mac & VPS, 25%)",
      near(after.treasuryMac - before.treasuryMac, 250) && near(after.treasuryVps - before.treasuryVps, 250),
      `mac Δ=${after.treasuryMac - before.treasuryMac} vps Δ=${after.treasuryVps - before.treasuryVps}`,
    );
    check(
      "Fee: burn sink +250 µTET (Mac & VPS, 25%)",
      near(after.burnMac - before.burnMac, 250) && near(after.burnVps - before.burnVps, 250),
      `mac Δ=${after.burnMac - before.burnMac} vps Δ=${after.burnVps - before.burnVps}`,
    );
    console.log(`   (storage node share +500 µTET goes to "${sw}", which also accrues block rewards — not asserted)`);
  }

  // 5. Negative: unfunded wallet C rejected; wrong fee amount rejected.
  {
    const txCanonical = `{"kind":"file_fee","from_wallet":"${C.walletId}","storage_wallet":"local-wallet","file_id":"${globalThis.crypto.randomUUID()}","fee_micro":${FILE_FEE_MICRO}}`;
    const env = signedTxEnvelope(C, binding, txCanonical, {
      kind: "file_fee",
      from_wallet: C.walletId,
      storage_wallet: "local-wallet",
      file_id: JSON.parse(txCanonical).file_id,
      fee_micro: FILE_FEE_MICRO,
    });
    const r = await jsonReq(`${MAC_URL}/files/fee`, "POST", env);
    check("Negative: unfunded wallet fee rejected (400)", r.status === 400, `HTTP ${r.status} ${r.body.slice(0, 80)}`);

    const txBad = `{"kind":"file_fee","from_wallet":"${A.walletId}","storage_wallet":"local-wallet","file_id":"${globalThis.crypto.randomUUID()}","fee_micro":1}`;
    const envBad = signedTxEnvelope(A, binding, txBad, {
      kind: "file_fee",
      from_wallet: A.walletId,
      storage_wallet: "local-wallet",
      file_id: JSON.parse(txBad).file_id,
      fee_micro: 1,
    });
    const rb = await jsonReq(`${MAC_URL}/files/fee`, "POST", envBad);
    check("Negative: wrong fee amount rejected (4xx)", rb.status >= 400 && rb.status < 500, `HTTP ${rb.status} ${rb.body.slice(0, 80)}`);
  }

  const pass = results.every((r) => r.ok);
  console.log(`\nFile Sharing Step 4 interop: ${pass ? "PASS" : "FAIL"} (${results.filter((r) => r.ok).length}/${results.length})`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
