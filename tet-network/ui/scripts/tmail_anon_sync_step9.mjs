/**
 * Tmail Step 9 — LIVE anti-entropy registry sync (S8, spec §A.4.4b).
 *
 * Reproduces the CH<->HEL gap of 2026-09-25 and shows sync closing it:
 *
 *   phase "register" : node 1 alone; register a wallet and wait until it is in node 1's TREE.
 *   (harness starts node 2 here — it has therefore MISSED the gossip entirely)
 *   phase "verify"   : node 2 must acquire the registration by PULL, then converge one epoch later.
 *
 * The negative control runs phase 2 against a node 2 built from the pre-sync commit: it stays at
 * members=0 forever, which is the mismatch observed live.
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
  // founder from node /status (mirrors chain_binding.runtimeFounderWalletId)
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
const MODE = process.env.SYNC_MODE || "register";
const STATE = process.env.SYNC_STATE || "/tmp/tet-anon-sync-state.json";
const LABEL = process.env.RUN_LABEL || "two local nodes";

import { writeFileSync, existsSync } from "node:fs";

async function main() {
  await initPqc(readFileSync(resolve(__dirname, "../public/pqc/tet_pqc_wasm_bg.wasm")));
  const results = { steps: [], measurements: {} };
  const step = (name, ok, detail) => {
    results.steps.push({ name, ok, detail });
    log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  if (MODE === "register") {
    // Phase 1: node 1 is up alone. Register, and wait until it is in node 1's TREE, so that when
    // node 2 starts it has genuinely missed the gossip — the CH<->HEL situation exactly.
    log(`Phase 1 — register on node 1 BEFORE node 2 exists (${N1})`);
    const A = makeWallet(generateMnemonic(wordlist, 128));
    const binding = await chainBinding(N1);
    const secret = new Uint8Array(32);
    globalThis.crypto.getRandomValues(secret);
    const reg = buildAnonRegistration(A, secret, binding);
    const posted = await postAnonRegister(N1, reg);
    step("N1 POST /tmail/anon/register", posted.status === 202, `HTTP ${posted.status}`);
    if (posted.status !== 202) return finish(results);
    const tree = await waitFor(N1, async (u) => (await getAnonPath(u, A.walletId)).status === 200, 180_000);
    step("registration is in node 1's tree before node 2 starts", tree.ok, `${tree.elapsedMs} ms`);
    const r1 = await getAnonRoot(N1);
    step("node 1 root recorded", !!r1, `members=${r1.members} root=${r1.merkle_root.slice(0, 16)}…`);
    writeFileSync(STATE, JSON.stringify({ walletId: A.walletId, n1Root: r1.merkle_root, n1Members: r1.members }));
    return finish(results);
  }

  // Phase 2: node 2 has just started, fresh, and dialled node 1.
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  log(`Phase 2 — node 2 joined late (${N2}); does it converge? [${LABEL}]`);
  log(`wallet registered on node 1 only: ${st.walletId}`);

  const t0 = Date.now();
  const before2 = await getAnonRoot(N2);
  step("node 2 is up and exposes /tmail/anon/root", !!before2,
    `members=${before2?.members} root=${before2?.merkle_root?.slice(0, 16)}…`);
  if (!before2) return finish(results);

  // THE GAP: without sync this never becomes true, because gossip has no history.
  const got = await waitFor(N2, async (u) => (await getAnonRoot(u)).members > 0, 90_000);
  results.measurements.sync_arrival_ms = got.ok ? got.elapsedMs : null;
  step("node 2 acquires the registration it was never gossiped", got.ok,
    got.ok ? `${got.elapsedMs} ms after start` : "NEVER — node 2 stayed at members=0 (this is the gap)");
  if (!got.ok) return finish(results);

  // Convergence is forward: the leaf enters at node 2's NEXT epoch.
  const tree = await waitFor(N2, async (u) => (await getAnonPath(u, st.walletId)).status === 200, 180_000);
  results.measurements.epoch_boundary_ms = tree.ok ? (Date.now() - t0) - got.elapsedMs : null;
  step("it enters node 2's tree at the next epoch (forward, not retroactive)", tree.ok,
    tree.ok ? `+${(Date.now() - t0) - got.elapsedMs} ms waiting for the boundary` : "not in tree within 180 s");
  if (!tree.ok) return finish(results);

  const r1 = await getAnonRoot(N1);
  const r2 = await getAnonRoot(N2);
  step("both nodes now report the same member count", r1.members === r2.members,
    `n1=${r1.members} n2=${r2.members}`);
  step("both nodes compute the SAME root after sync + one epoch", r1.merkle_root === r2.merkle_root,
    `n1=${r1.merkle_root.slice(0, 16)}… n2=${r2.merkle_root.slice(0, 16)}…`);
  results.measurements.merkle_root = r2.merkle_root;
  results.measurements.members = r2.members;

  // The late joiner can serve a path that verifies against the node it synced from.
  const p2 = await getAnonPath(N2, st.walletId);
  step("node 2 serves an authentication path for a wallet it never saw registered", p2.status === 200,
    `HTTP ${p2.status}`);
  if (p2.status === 200) {
    const path = JSON.parse(p2.body);
    step("path is full depth", path.siblings.length === path.depth, `${path.siblings.length}/${path.depth}`);
    step("node 2's path root equals node 1's current root", path.merkle_root === r1.merkle_root,
      path.merkle_root === r1.merkle_root ? "identical" : `n2_path=${path.merkle_root.slice(0,16)}… n1=${r1.merkle_root.slice(0,16)}…`);
  }

  log(`\n=== convergence ===`);
  log(`sync arrival (anti-entropy) : ${results.measurements.sync_arrival_ms} ms`);
  log(`epoch boundary wait         : ${results.measurements.epoch_boundary_ms} ms`);
  log(`converged root              : ${results.measurements.merkle_root}`);
  log(`members                     : ${results.measurements.members}`);
  finish(results);
}

function finish(results) {
  log("\n=== SUMMARY ===");
  const pass = results.steps.every((s) => s.ok);
  log(JSON.stringify({ all_pass: pass, label: LABEL, mode: MODE, ...results.measurements, steps: results.steps }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(2); });
