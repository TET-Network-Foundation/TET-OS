/**
 * Tmail Step 8 — LIVE anonymous send end to end (AT-5(a), spec §A.4).
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

const N1 = process.env.N1_URL || "http://127.0.0.1:5330";
const N2 = process.env.N2_URL || "http://127.0.0.1:15010";
const LABEL = process.env.RUN_LABEL || "follower -> seed";
const PROVER = process.env.PROVER_URL || N1;

async function postJson(baseUrl, path, body) {
  const r = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.text() };
}
async function putJson(baseUrl, path, body) {
  const r = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.text() };
}

async function inboxRowOf(baseUrl, walletId, msgId) {
  const r = await getInbox(baseUrl, walletId);
  if (r.status !== 200) return null;
  return (JSON.parse(r.body).messages || []).find((m) => m.msg_id === msgId) ?? null;
}

async function waitVerdict(baseUrl, walletId, msgId, want, timeoutMs = 90000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const row = await inboxRowOf(baseUrl, walletId, msgId);
    last = row?.anon_verdict?.state ?? null;
    if (last === want) return { ok: true, elapsedMs: Date.now() - t0, state: last };
    if (last === "failed") return { ok: false, elapsedMs: Date.now() - t0, state: last, row };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, elapsedMs: Date.now() - t0, state: last };
}

async function main() {
  await initPqc(readFileSync(resolve(__dirname, "../public/pqc/tet_pqc_wasm_bg.wasm")));
  const results = { steps: [] };
  const step = (name, ok, detail) => {
    results.steps.push({ name, ok, detail });
    log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  log(`Run: ${LABEL}`);
  log(`N1 (sender / follower): ${N1}`);
  log(`N2 (verifier / seed)  : ${N2}`);

  // Identities come from the environment so the run can be done in two passes: pass 1 registers
  // and dumps what needs proving, the Rust prover runs, pass 2 sends. Random identities would not
  // survive between passes.
  const A = makeWallet(process.env.MEMBER_MNEMONIC || generateMnemonic(wordlist, 128));
  const B = makeWallet(process.env.RECEIVER_MNEMONIC || generateMnemonic(wordlist, 128));
  const kemB = await deriveKem(B.norm);
  const binding = await chainBinding(N1);

  // Receiver publishes KEM keys so A can encrypt to them.
  const pb = await putKeys(N1, B.walletId, await buildKeyRegistration(B, kemB, binding));
  step("N1 PUT /tmail/keys B", pb.status === 200, `HTTP ${pb.status}`);
  if (pb.status !== 200) return finish(results);

  // --- 1. register A in the anonymity set on the FOLLOWER -----------------
  // The member secret must be STABLE across the two passes: a fresh secret is a different
  // commitment, which the node correctly treats as an update and refuses under the 24 h cooldown.
  const secret = process.env.MEMBER_SECRET_HEX
    ? unb64(Buffer.from(process.env.MEMBER_SECRET_HEX, "hex").toString("base64"))
    : (() => {
        const v = new Uint8Array(32);
        globalThis.crypto.getRandomValues(v);
        return v;
      })();
  const reg = buildAnonRegistration(A, secret, binding);
  const posted = await postAnonRegister(N1, reg);
  const alreadyIn = posted.status === 202 || posted.body.includes("duplicate");
  step("N1 POST /tmail/anon/register", alreadyIn,
    `HTTP ${posted.status} ${posted.body.slice(0, 80)}`);
  if (!alreadyIn) return finish(results);

  // --- 2. wait for the epoch boundary AND for the seed to hold it ---------
  const t0 = Date.now();
  const inTree = await waitFor(N1, async (u) => (await getAnonPath(u, A.walletId)).status === 200, 180_000);
  step("member enters the follower's tree", inTree.ok, `${Date.now() - t0} ms (epoch boundary)`);
  if (!inTree.ok) return finish(results);
  const seedHas = await waitFor(N2, async (u) => (await getAnonPath(u, A.walletId)).status === 200, 180_000);
  step("member enters the SEED's tree (propagated)", seedHas.ok, `${Date.now() - t0} ms total`);
  if (!seedHas.ok) return finish(results);

  const rootN1 = await getAnonRoot(N1);
  const rootN2 = await getAnonRoot(N2);
  step("both nodes agree on the registry root", rootN1.merkle_root === rootN2.merkle_root,
    `${rootN1.merkle_root.slice(0, 16)}… members=${rootN2.members}`);

  // --- 3. sender eligibility, without naming the sender -------------------
  // POST /tmail/anon/send {wallet_id} was removed: it told the node which wallet was about to post.
  // A poster downloads the whole registry and looks for its own commitment (anon_poster.mjs).
  const leavesResp = await fetch(`${N1}/tmail/anon/leaves`);
  const leavesJson = await leavesResp.json();
  step("A's commitment is in N1's registry download", leavesResp.status === 200 &&
    leavesJson.leaves.includes(hex(anonCommitment(secret))), `total=${leavesJson.total}`);

  // --- 4. build the proof (this is the ~33 s job) -------------------------
  log("\n--- proving (this is the job the API returns 202 for) ---");
  const pathResp = await getAnonPath(N1, A.walletId);
  const pathJson = JSON.parse(pathResp.body);
  const ephForParams = makeWallet(process.env.EPHEMERAL_MNEMONIC || generateMnemonic(wordlist, 128));
  const sentAtForProof = Number(process.env.PROOF_SENT_AT_MS || Date.now());
  const bucketForProof = Math.floor(sentAtForProof / 86400000);

  if (!process.env.PROOF_RECEIPT_B64) {
    // Pass 1: dump exactly what the Rust prover needs, then stop. Nothing secret leaves this
    // machine -- the member secret is generated here and stays in the params file.
    const params = {
      secret_hex: hex(secret),
      index: pathJson.index,
      siblings_hex: pathJson.siblings.join(","),
      ephemeral_hex: ephForParams.walletId,
      receiver_hex: B.walletId,
      bucket: bucketForProof,
      sent_at_ms: sentAtForProof,
      member_mnemonic: A.norm,
      receiver_mnemonic: B.norm,
      ephemeral_mnemonic: ephForParams.norm,
    };
    const out = process.env.PARAMS_OUT || "/tmp/anon_params.json";
    readFileSync; // keep the import used
    (await import("node:fs")).writeFileSync(out, JSON.stringify(params, null, 2));
    step("pass 1 complete: params written for the prover", true, out);
    log(`\nPARAMS_FILE ${out}`);
    return finish(results);
  }
  const receiptB64 = process.env.PROOF_RECEIPT_B64;
  const journalB64 = process.env.PROOF_JOURNAL_B64;
  const ephWallet = makeWallet(process.env.EPHEMERAL_MNEMONIC);
  const imageIdHex = process.env.PROOF_IMAGE_ID_HEX;
  log(`proof supplied: receipt ${receiptB64.length} b64 chars (proved by the Rust helper)`);

  // --- 5. deposit the receipt on the sender's node ------------------------
  const receiptBytes = unb64(receiptB64);
  const receiptHash = hex(sha256(receiptBytes));
  const put = await putJson(N1, "/tmail/anon/receipt", {
    receipt_sha256_hex: receiptHash,
    receipt_b64: receiptB64,
  });
  step("N1 PUT /tmail/anon/receipt", put.status === 200, `HTTP ${put.status} ${put.body.slice(0, 100)}`);
  if (put.status !== 200) return finish(results);

  // --- 6. send the anonymous envelope ------------------------------------
  const text = `ANON HELLO. ts=${Date.now()}`;
  const bundle = await encryptForReceiver(enc(text), kemB.x25519_pub, kemB.mlkem_pub);
  const payloadSha256 = hex(sha256(bundle.ct));
  const msgId = globalThis.crypto.randomUUID();
  const sentAtMs = Number(process.env.PROOF_SENT_AT_MS || Date.now());
  const flags = { basic: true, time_lock: false, burn_after_read: false, anonymous: true };
  const flagsStr = "basic=1,time_lock=0,burn_after_read=0,anonymous=1";
  const preimage = enc(
    `tet tmail envelope v1|chain_id=${binding.chainId}|genesis_hash=${binding.genesisHash}` +
      `|msg_id=${msgId}|flags=${flagsStr}|sender=anonymous|receiver=${B.walletId.toLowerCase()}` +
      `|release_at_ms=0|fee_micro=100|payload_sha256=${payloadSha256}|mldsa_pk=${ephWallet.mldsaPubB64}`,
  );
  const envelope = {
    v: 1,
    kind: "tmail_envelope_v1",
    msg_id: msgId,
    flags,
    sender_wallet_id: "anonymous",
    receiver_wallet_id: B.walletId,
    sent_at_ms: sentAtMs,
    release_at_ms: 0,
    ttl_ms: 7 * 24 * 60 * 60 * 1000,
    fee_paid_micro: 100,
    pin_stake_micro: 0,
    e2ee: {
      v: 1,
      scheme: "tet-e2ee-hybrid-v1",
      client_ephemeral_pub_b64: b64(bundle.ephPub),
      client_mlkem_pub_b64: "",
      receiver_x25519_pub_b64: b64(kemB.x25519_pub),
      receiver_mlkem_pub_b64: b64(kemB.mlkem_pub),
      mlkem_ciphertext_b64: b64(bundle.mlkemCt),
      nonce_b64: b64(bundle.nonce),
      ciphertext_b64: b64(bundle.ct),
    },
    anonymous: {
      ephemeral_wallet_id: ephWallet.walletId,
      anchor_proof: {
        image_id_hex: imageIdHex,
        journal_b64: journalB64,
        receipt_sha256_hex: receiptHash,
      },
    },
    hybrid_sig: {
      ed25519_pubkey_hex: ephWallet.walletId,
      ed25519_sig_b64: b64(ephWallet.signEd(preimage)),
      mldsa_pubkey_b64: ephWallet.mldsaPubB64,
      mldsa_sig_b64: ephWallet.signMldsa(preimage),
    },
  };

  const wireBytes = Buffer.byteLength(JSON.stringify(envelope));
  const sent = await sendTmail(N1, envelope);
  step("N1 POST /tmail/send (anonymous)", sent.status === 202,
    `HTTP ${sent.status} envelope ${wireBytes} bytes ${sent.body.slice(0, 80)}`);
  step("envelope fits the 128 KiB gossip ceiling", wireBytes < 131072, `${wireBytes} bytes`);
  if (sent.status !== 202) return finish(results);

  // --- 7. the anchor must be absent from the wire ------------------------
  const wireStr = JSON.stringify(envelope);
  step("sender_wallet_id is the sentinel, not a wallet", envelope.sender_wallet_id === "anonymous");
  step("the registering wallet does NOT appear in the envelope",
    !wireStr.includes(A.walletId), A.walletId.slice(0, 12) + "… absent");

  // --- 8. the SEED pulls the receipt and verifies -------------------------
  log("\n--- seed pulls the receipt and verifies (announce-then-pull) ---");
  const verdict = await waitVerdict(N2, B.walletId, msgId, "verified");
  step("SEED verdict reaches 'verified'", verdict.ok,
    verdict.ok ? `${verdict.elapsedMs} ms after arrival` : `stuck at ${verdict.state}`);

  // --- 9. and the receiver reads it as verified ---------------------------
  const row = await inboxRowOf(N2, B.walletId, msgId);
  step("receiver sees the message with a VERIFIED anonymity verdict",
    row?.anon_verdict?.state === "verified", `verdict=${row?.anon_verdict?.state}`);
  step("receiver can decrypt it", !!row?.e2ee, row?.e2ee ? "e2ee present" : "no payload");
  if (row?.e2ee) {
    const pt = await decryptForReceiver(
      {
        client_ephemeral_pub: unb64(row.e2ee.client_ephemeral_pub_b64),
        mlkem_ciphertext: unb64(row.e2ee.mlkem_ciphertext_b64),
        nonce: unb64(row.e2ee.nonce_b64),
        ciphertext: unb64(row.e2ee.ciphertext_b64),
      },
      kemB.x25519_sk,
      kemB.mlkem_sk,
    );
    step("plaintext matches", new TextDecoder().decode(pt) === text);
  }

  finish(results);
}

function finish(results) {
  log("\n=== SUMMARY ===");
  const pass = results.steps.every((s) => s.ok);
  log(JSON.stringify({ all_pass: pass, label: LABEL, steps: results.steps }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(2); });
