/**
 * Tmail Step 4 — headless Rust↔TS interop test.
 *
 * Replicates the EXACT byte formats / crypto of the UI Tmail libs (tmail_e2ee.ts, tmail_keys.ts,
 * tmail.ts, chain_binding.ts) using the same npm packages + the same ML-DSA WASM the browser uses,
 * then drives two test wallets (A, B) end-to-end against the running TET node(s):
 *
 *   register A,B KEM keys  → PUT /tmail/keys   (node verifies hybrid sig; 401 == interop break)
 *   A encrypts → B         → POST /tmail/send  (node verifies envelope + recomputes payload_sha256)
 *   B fetches inbox        → GET /tmail/inbox  → decryptForReceiver (TS↔TS E2EE)
 *
 * Usage: node scripts/tmail_interop_step4.mjs
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
const b64 = (u8) => Buffer.from(u8).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const hex = (u8) => Buffer.from(u8).toString("hex");

// --- chain_binding.ts replica (buildGenesisPayloadV1 / deterministicGenesisHashHex) ---
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
  // founder from node /status (mirrors chain_binding.runtimeFounderWalletId)
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
  const pqc = mldsa44_keypair_from_mnemonic_b64(norm); // { pubkey_b64, keypair_b64 }
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

// --- KEM key derivation (tmail_keys.deriveTmailKeysFromMnemonic) ---
async function deriveKem(norm) {
  const seed = mnemonicToSeedSync(norm, "");
  const x25519_sk = hkdf(sha256, seed, undefined, enc("tet-tmail-x25519-v1"), 32);
  const x25519_pub = x25519.getPublicKey(x25519_sk);
  const mlkemSeed = hkdf(sha256, seed, undefined, enc("tet-tmail-mlkem-v1"), 64);
  const [mlkem_pub, mlkem_sk] = await new Kyber768().deriveKeyPair(mlkemSeed);
  return { x25519_sk, x25519_pub, mlkem_sk, mlkem_pub };
}

// --- E2EE (tmail_e2ee.ts) ---
const HKDF_INFO = enc("tet-e2ee-hybrid-v1");
const HKDF_SALT = new Uint8Array(32);
function deriveKeyHybrid(xShared, mlkemShared) {
  const ikm = new Uint8Array(xShared.length + mlkemShared.length);
  ikm.set(xShared, 0);
  ikm.set(mlkemShared, xShared.length);
  return hkdf(sha256, ikm, HKDF_SALT, HKDF_INFO, 32);
}
function randomBytes(n) {
  const o = new Uint8Array(n);
  globalThis.crypto.getRandomValues(o);
  return o;
}
async function encryptForReceiver(plaintext, rxPub, rmkPub) {
  const ephSk = randomBytes(32);
  const ephPub = x25519.getPublicKey(ephSk);
  const xShared = x25519.getSharedSecret(ephSk, rxPub);
  const [mlkemCt, mlkemSs] = await new Kyber768().encap(rmkPub);
  const key = deriveKeyHybrid(xShared, mlkemSs);
  const nonce = randomBytes(12);
  const ct = chacha20poly1305(key, nonce).encrypt(plaintext);
  return { ephPub, mlkemCt, nonce, ct };
}
async function decryptForReceiver(bundle, rxSk, rmkSk) {
  const xShared = x25519.getSharedSecret(rxSk, bundle.client_ephemeral_pub);
  const mlkemSs = await new Kyber768().decap(bundle.mlkem_ciphertext, rmkSk);
  const key = deriveKeyHybrid(xShared, mlkemSs);
  return chacha20poly1305(key, bundle.nonce).decrypt(bundle.ciphertext);
}

// --- preimages (keys.rs / envelope.rs) ---
function keyRegPreimage({ chainId, genesisHash, walletId, xPubB64, mlkemPubB64, registeredAtMs, mldsaPk }) {
  return enc(
    `tet tmail key v1|chain_id=${chainId}|genesis_hash=${genesisHash}` +
      `|wallet_id=${walletId.toLowerCase()}|x25519_pub=${xPubB64.trim()}|mlkem_pub=${mlkemPubB64.trim()}` +
      `|registered_at_ms=${registeredAtMs}|mldsa_pk=${mldsaPk.trim()}`,
  );
}
function envelopePreimage({ chainId, genesisHash, msgId, sender, receiver, releaseAtMs, feeMicro, payloadSha256, mldsaPk }) {
  const flags = "basic=1,time_lock=0,burn_after_read=0,anonymous=0";
  return enc(
    `tet tmail envelope v1|chain_id=${chainId}|genesis_hash=${genesisHash}` +
      `|msg_id=${msgId.trim()}|flags=${flags}|sender=${sender.toLowerCase()}|receiver=${receiver.toLowerCase()}` +
      `|release_at_ms=${releaseAtMs}|fee_micro=${feeMicro}|payload_sha256=${payloadSha256}|mldsa_pk=${mldsaPk.trim()}`,
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

async function buildEnvelope(sender, receiverWalletId, rxPub, rmkPub, text, binding) {
  const bundle = await encryptForReceiver(enc(text), rxPub, rmkPub);
  const payloadSha256 = hex(sha256(bundle.ct));
  const msgId = globalThis.crypto.randomUUID();
  const feeMicro = 100;
  const releaseAtMs = 0;
  const msg = envelopePreimage({
    chainId: binding.chainId,
    genesisHash: binding.genesisHash,
    msgId,
    sender: sender.walletId,
    receiver: receiverWalletId,
    releaseAtMs,
    feeMicro,
    payloadSha256,
    mldsaPk: sender.mldsaPubB64,
  });
  return {
    msgId,
    payloadSha256,
    env: {
      v: 1,
      kind: "tmail_envelope_v1",
      msg_id: msgId,
      flags: { basic: true, time_lock: false, burn_after_read: false, anonymous: false },
      sender_wallet_id: sender.walletId,
      receiver_wallet_id: receiverWalletId,
      sent_at_ms: Date.now(),
      release_at_ms: releaseAtMs,
      ttl_ms: 7 * 24 * 60 * 60 * 1000,
      fee_paid_micro: feeMicro,
      pin_stake_micro: 0,
      e2ee: {
        v: 1,
        scheme: "tet-e2ee-hybrid-v1",
        client_ephemeral_pub_b64: b64(bundle.ephPub),
        client_mlkem_pub_b64: "",
        receiver_x25519_pub_b64: b64(rxPub),
        receiver_mlkem_pub_b64: b64(rmkPub),
        mlkem_ciphertext_b64: b64(bundle.mlkemCt),
        nonce_b64: b64(bundle.nonce),
        ciphertext_b64: b64(bundle.ct),
      },
      hybrid_sig: {
        ed25519_pubkey_hex: sender.walletId,
        ed25519_sig_b64: b64(sender.signEd(msg)),
        mldsa_pubkey_b64: sender.mldsaPubB64,
        mldsa_sig_b64: sender.signMldsa(msg),
      },
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
async function sendTmail(baseUrl, env) {
  const r = await fetch(`${baseUrl}/tmail/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(env),
  });
  return { status: r.status, body: await r.text() };
}
async function getInbox(baseUrl, walletId, limit = 50) {
  const r = await fetch(`${baseUrl}/tmail/inbox/${walletId}?limit=${limit}`, { headers: { Accept: "application/json" } });
  return { status: r.status, body: await r.text() };
}

function log(...a) {
  console.log(...a);
}

async function main() {
  await initPqc(readFileSync(resolve(__dirname, "../public/pqc/tet_pqc_wasm_bg.wasm")));

  const results = { steps: [] };
  const step = (name, ok, detail) => {
    results.steps.push({ name, ok, detail });
    log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  // Wallets
  const mnA = generateMnemonic(wordlist, 128);
  const mnB = generateMnemonic(wordlist, 128);
  const A = makeWallet(mnA);
  const B = makeWallet(mnB);
  log(`Wallet A: ${A.walletId}`);
  log(`Wallet B: ${B.walletId}`);
  const kemA = await deriveKem(A.norm);
  const kemB = await deriveKem(B.norm);
  log(`A x25519_pub=${b64(kemA.x25519_pub).slice(0, 16)}… mlkem_pub_len=${kemA.mlkem_pub.length}`);
  log(`B x25519_pub=${b64(kemB.x25519_pub).slice(0, 16)}… mlkem_pub_len=${kemB.mlkem_pub.length}`);

  const binding = await chainBinding(MAC_URL);
  log(`chain_id=${binding.chainId} genesis_hash=${binding.genesisHash} founder=${binding.founder}`);

  // 1. Register A + B keys on Mac
  const regA = await buildKeyRegistration(A, kemA, binding);
  const regB = await buildKeyRegistration(B, kemB, binding);
  const pa = await putKeys(MAC_URL, A.walletId, regA);
  step("Mac PUT /tmail/keys A", pa.status === 200, `HTTP ${pa.status} ${pa.body.slice(0, 120)}`);
  if (pa.status !== 200) return finish(results);
  const pb = await putKeys(MAC_URL, B.walletId, regB);
  step("Mac PUT /tmail/keys B", pb.status === 200, `HTTP ${pb.status} ${pb.body.slice(0, 120)}`);
  if (pb.status !== 200) return finish(results);

  // 2. Confirm key lookup
  const gk = await getKeys(MAC_URL, B.walletId);
  const gkOk = gk.status === 200 && gk.body.includes(regB.x25519_pub_b64);
  step("Mac GET /tmail/keys B (lookup)", gkOk, `HTTP ${gk.status}`);
  if (!gkOk) return finish(results);

  // 3. A → B send on Mac
  const text = `Hello B, this is A. Timestamp: ${Date.now()}`;
  const built = await buildEnvelope(A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, text, binding);
  const sent = await sendTmail(MAC_URL, built.env);
  const sentOk = sent.status === 202;
  step("Mac POST /tmail/send (A→B)", sentOk, `HTTP ${sent.status} ${sent.body.slice(0, 160)}`);
  results.msg_id = built.msgId;
  results.plaintext = text;
  results.payload_sha256 = built.payloadSha256;
  log(`msg_id=${built.msgId}`);
  if (!sentOk) return finish(results);

  // 4. B inbox on Mac + decrypt
  await new Promise((r) => setTimeout(r, 1200));
  const inbox = await getInbox(MAC_URL, B.walletId);
  let macDecryptOk = false;
  let macFound = null;
  if (inbox.status === 200) {
    const j = JSON.parse(inbox.body);
    macFound = (j.messages || []).find((m) => m.msg_id === built.msgId);
    if (macFound) {
      // verify payload_sha256 recompute
      const ctBytes = unb64(macFound.e2ee.ciphertext_b64);
      const recomputed = hex(sha256(ctBytes));
      const shaMatch = recomputed === macFound.e2ee.payload_sha256 || true; // node doesn't echo it; we recompute vs our own
      const pt = await decryptForReceiver(
        {
          client_ephemeral_pub: unb64(macFound.e2ee.client_ephemeral_pub_b64),
          mlkem_ciphertext: unb64(macFound.e2ee.mlkem_ciphertext_b64),
          nonce: unb64(macFound.e2ee.nonce_b64),
          ciphertext: ctBytes,
        },
        kemB.x25519_sk,
        kemB.mlkem_sk,
      );
      const decoded = new TextDecoder().decode(pt);
      macDecryptOk = decoded === text && recomputed === built.payloadSha256 && shaMatch;
      results.mac_decrypted = decoded;
      results.mac_recomputed_payload_sha256 = recomputed;
    }
  }
  step("Mac GET /tmail/inbox B + decrypt + payload_sha256", macDecryptOk,
    macFound ? `msg_id match, sha256 match=${results.mac_recomputed_payload_sha256 === built.payloadSha256}` : `msg_id ${built.msgId} not found (HTTP ${inbox.status})`);

  // 5. Cross-region: does the same envelope appear on VPS (gossip)?
  const vpsInbox = await getInbox(VPS_URL, B.walletId);
  let vpsFound = null;
  if (vpsInbox.status === 200) {
    const j = JSON.parse(vpsInbox.body);
    vpsFound = (j.messages || []).find((m) => m.msg_id === built.msgId);
  }
  step("VPS GET /tmail/inbox B (gossip propagation of Mac msg)", !!vpsFound,
    vpsFound ? "same msg_id present on VPS" : `not propagated (HTTP ${vpsInbox.status}) — expected if Mac has no peers`);
  if (vpsFound) {
    const ctMatch = vpsFound.e2ee.ciphertext_b64 === built.env.e2ee.ciphertext_b64;
    step("VPS ciphertext matches Mac (byte-identical)", ctMatch, ctMatch ? "identical" : "MISMATCH");
  }

  // 6. Independent VPS verification: register B on VPS + send A→B directly to VPS + decrypt.
  const bindingV = await chainBinding(VPS_URL);
  const regBv = await buildKeyRegistration(B, kemB, bindingV);
  const pbv = await putKeys(VPS_URL, B.walletId, regBv);
  step("VPS PUT /tmail/keys B", pbv.status === 200, `HTTP ${pbv.status} ${pbv.body.slice(0, 120)}`);
  if (pbv.status === 200) {
    const text2 = `Direct-to-VPS from A. ts=${Date.now()}`;
    const built2 = await buildEnvelope(A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, text2, bindingV);
    const sent2 = await sendTmail(VPS_URL, built2.env);
    step("VPS POST /tmail/send (A→B direct)", sent2.status === 202, `HTTP ${sent2.status} ${sent2.body.slice(0, 120)}`);
    if (sent2.status === 202) {
      await new Promise((r) => setTimeout(r, 1200));
      const vin = await getInbox(VPS_URL, B.walletId);
      let vdecOk = false;
      if (vin.status === 200) {
        const j = JSON.parse(vin.body);
        const f = (j.messages || []).find((m) => m.msg_id === built2.msgId);
        if (f) {
          const pt = await decryptForReceiver(
            {
              client_ephemeral_pub: unb64(f.e2ee.client_ephemeral_pub_b64),
              mlkem_ciphertext: unb64(f.e2ee.mlkem_ciphertext_b64),
              nonce: unb64(f.e2ee.nonce_b64),
              ciphertext: unb64(f.e2ee.ciphertext_b64),
            },
            kemB.x25519_sk,
            kemB.mlkem_sk,
          );
          vdecOk = new TextDecoder().decode(pt) === text2;
        }
      }
      step("VPS GET /tmail/inbox B + decrypt (B reads via VPS)", vdecOk, vdecOk ? "decrypted OK" : "failed");
    }
  }

  finish(results);
}

function finish(results) {
  log("\n=== SUMMARY ===");
  const pass = results.steps.every((s) => s.ok);
  log(JSON.stringify({ all_pass: pass, msg_id: results.msg_id, payload_sha256: results.payload_sha256, steps: results.steps }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
