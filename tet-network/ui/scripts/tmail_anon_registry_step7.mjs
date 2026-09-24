/**
 * Tmail Step 7 — LIVE registry propagation measurement (S8, spec §A.4.3).
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
function envelopePreimage({ chainId, genesisHash, msgId, sender, receiver, releaseAtMs, feeMicro, payloadSha256, mldsaPk, burn }) {
  const flags = `basic=1,time_lock=0,burn_after_read=${burn ? 1 : 0},anonymous=0`;
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

async function buildEnvelope(sender, receiverWalletId, rxPub, rmkPub, text, binding, burn = false) {
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
    burn,
  });
  return {
    msgId,
    payloadSha256,
    env: {
      v: 1,
      kind: "tmail_envelope_v1",
      msg_id: msgId,
      flags: { basic: true, time_lock: false, burn_after_read: burn, anonymous: false },
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



// --- anonymity registry (anon.rs §A.4.3) ---
import { sha256 as sha256h } from "@noble/hashes/sha2";

function anonCommitment(secret) {
  const d = new Uint8Array(11 + 32);
  d.set(enc("tet-anon-v1"), 0);
  d.set(secret, 11);
  return sha256h(d);
}

function anonRegistrationPreimage({ chainId, genesisHash, walletId, commitmentHex, registeredAtMs, mldsaPk }) {
  return enc(
    `tet tmail anon registration v1|chain_id=${chainId}|genesis_hash=${genesisHash}` +
      `|wallet_id=${walletId.toLowerCase()}|commitment=${commitmentHex.toLowerCase()}` +
      `|registered_at_ms=${registeredAtMs}|mldsa_pk=${mldsaPk.trim()}`,
  );
}

function buildAnonRegistration(wallet, secret, binding) {
  const registeredAtMs = Date.now();
  const commitmentHex = hex(anonCommitment(secret));
  const msg = anonRegistrationPreimage({
    chainId: binding.chainId,
    genesisHash: binding.genesisHash,
    walletId: wallet.walletId,
    commitmentHex,
    registeredAtMs,
    mldsaPk: wallet.mldsaPubB64,
  });
  return {
    v: 1,
    kind: "tmail_anon_registration_v1",
    wallet_id: wallet.walletId,
    commitment_hex: commitmentHex,
    registered_at_ms: registeredAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: wallet.walletId,
      ed25519_sig_b64: b64(wallet.signEd(msg)),
      mldsa_pubkey_b64: wallet.mldsaPubB64,
      mldsa_sig_b64: wallet.signMldsa(msg),
    },
  };
}

async function postAnonRegister(baseUrl, reg) {
  const r = await fetch(`${baseUrl}/tmail/anon/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(reg),
  });
  return { status: r.status, body: await r.text() };
}

async function getAnonRoot(baseUrl) {
  const r = await fetch(`${baseUrl}/tmail/anon/root`, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  return JSON.parse(await r.text());
}

async function getAnonPath(baseUrl, walletId) {
  const r = await fetch(`${baseUrl}/tmail/anon/path/${walletId}`, {
    headers: { Accept: "application/json" },
  });
  return { status: r.status, body: await r.text() };
}

/** Poll until `pred(state)` on `url`, returning elapsed ms. */
async function waitFor(url, pred, timeoutMs, stepMs = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await pred(url);
    if (s) return { ok: true, elapsedMs: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return { ok: false, elapsedMs: Date.now() - t0 };
}

function log(...a) {
  console.log(...a);
}

const N1 = process.env.N1_URL || "http://127.0.0.1:5310";
const N2 = process.env.N2_URL || "http://127.0.0.1:5320";
const LABEL = process.env.RUN_LABEL || "two local nodes";

async function main() {
  await initPqc(readFileSync(resolve(__dirname, "../public/pqc/tet_pqc_wasm_bg.wasm")));
  const results = { steps: [], measurements: {} };
  const step = (name, ok, detail) => {
    results.steps.push({ name, ok, detail });
    log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  log(`Run: ${LABEL}`);
  log(`Node 1 (registers): ${N1}`);
  log(`Node 2 (verifies) : ${N2}`);

  const A = makeWallet(generateMnemonic(wordlist, 128));
  const binding = await chainBinding(N1);
  const binding2 = await chainBinding(N2);
  step("both nodes agree on the chain binding", binding.genesisHash === binding2.genesisHash,
    `genesis=${binding.genesisHash.slice(0, 18)}…`);

  const before1 = await getAnonRoot(N1);
  const before2 = await getAnonRoot(N2);
  step("both nodes expose /tmail/anon/root", !!before1 && !!before2,
    `n1 members=${before1?.members} n2 members=${before2?.members} window=${before1?.root_window_ms} ms epoch_n1=${before1?.epoch}`);
  if (!before1 || !before2) return finish(results);

  // --- register on node 1 -------------------------------------------------
  const secret = new Uint8Array(32);
  globalThis.crypto.getRandomValues(secret);
  const reg = buildAnonRegistration(A, secret, binding);
  log(`\nwallet=${A.walletId}`);

  const t0 = Date.now();
  const posted = await postAnonRegister(N1, reg);
  step("N1 POST /tmail/anon/register", posted.status === 202, `HTTP ${posted.status} ${posted.body.slice(0, 160)}`);
  if (posted.status !== 202) return finish(results);

  // --- A. propagation: when does node 2 hold the registration at all? ------
  const startMembers2 = before2.members ?? 0;
  const prop = await waitFor(N2, async (u) => {
    const r = await getAnonRoot(u);
    return r && (r.members ?? 0) > startMembers2;
  }, 60_000);
  results.measurements.propagation_ms = prop.ok ? prop.elapsedMs : null;
  step("registration reaches node 2 (gossip + direct)", prop.ok,
    prop.ok ? `${prop.elapsedMs} ms` : "did not arrive within 60 s");
  if (!prop.ok) return finish(results);

  // --- B. epoch boundary: when does it enter node 2's TREE? ----------------
  const tree = await waitFor(N2, async (u) => (await getAnonPath(u, A.walletId)).status === 200, 180_000);
  results.measurements.propagation_plus_epoch_ms = tree.ok ? Date.now() - t0 : null;
  results.measurements.epoch_boundary_ms =
    tree.ok ? (Date.now() - t0) - prop.elapsedMs : null;
  step("registration enters node 2's tree (next epoch boundary)", tree.ok,
    tree.ok
      ? `${Date.now() - t0} ms total, of which ~${(Date.now() - t0) - prop.elapsedMs} ms waiting for the boundary`
      : "not in tree within 180 s");
  if (!tree.ok) return finish(results);

  // --- C. both nodes agree on the root --------------------------------------
  const r1 = await getAnonRoot(N1);
  const r2 = await getAnonRoot(N2);
  step("both nodes compute the SAME root once converged", r1.merkle_root === r2.merkle_root,
    `n1=${r1.merkle_root.slice(0, 16)}… n2=${r2.merkle_root.slice(0, 16)}…`);

  // --- D. node 1's path verifies against node 2's root ----------------------
  const p1 = await getAnonPath(N1, A.walletId);
  step("N1 serves an authentication path", p1.status === 200, `HTTP ${p1.status}`);
  if (p1.status === 200) {
    const path = JSON.parse(p1.body);
    step("path is full depth", path.siblings.length === path.depth, `${path.siblings.length}/${path.depth}`);
    step("N1's path root equals N2's current root", path.merkle_root === r2.merkle_root,
      path.merkle_root === r2.merkle_root ? "identical" : `n1_path=${path.merkle_root.slice(0,16)}… n2=${r2.merkle_root.slice(0,16)}…`);
    results.measurements.merkle_root = path.merkle_root;
    results.measurements.members = r2.members;
  }

  // --- margin ---------------------------------------------------------------
  const windowMs = r1.root_window_ms ?? 0;
  const proofMs = 33_000;
  const used = (results.measurements.propagation_plus_epoch_ms ?? 0) + proofMs;
  results.measurements.window_ms = windowMs;
  results.measurements.budget_used_ms = used;
  results.measurements.margin_ms = windowMs - used;
  log(`\n=== margin against the root window ===`);
  log(`propagation                 : ${results.measurements.propagation_ms} ms`);
  log(`epoch-boundary wait (<=60 s): ${results.measurements.epoch_boundary_ms} ms`);
  log(`proof (measured earlier)    : ${proofMs} ms`);
  log(`total budget used           : ${used} ms`);
  log(`root window (effective)     : ${windowMs} ms`);
  log(`margin                      : ${windowMs - used} ms (${((windowMs - used) / windowMs * 100).toFixed(1)}% spare)`);
  step("budget fits inside the root window with room to spare", windowMs - used > windowMs * 0.5,
    `${((windowMs - used) / windowMs * 100).toFixed(1)}% spare`);

  finish(results);
}

function finish(results) {
  log("\n=== SUMMARY ===");
  const pass = results.steps.every((s) => s.ok);
  log(JSON.stringify({ all_pass: pass, label: LABEL, ...results.measurements, steps: results.steps }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(2); });
