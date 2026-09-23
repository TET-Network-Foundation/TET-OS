/**
 * Tmail Step 6 — headless LIVE two-node scheduled-release test (AT-3, spec §A.2).
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
function envelopePreimage({ chainId, genesisHash, msgId, sender, receiver, releaseAtMs, feeMicro, payloadSha256, mldsaPk, burn, scheduled }) {
  const flags = `basic=1,time_lock=${scheduled ? 1 : 0},burn_after_read=${burn ? 1 : 0},anonymous=0`;
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

async function buildEnvelope(sender, receiverWalletId, rxPub, rmkPub, text, binding, burn = false, releaseAtMs = 0) {
  const bundle = await encryptForReceiver(enc(text), rxPub, rmkPub);
  const payloadSha256 = hex(sha256(bundle.ct));
  const msgId = globalThis.crypto.randomUUID();
  const feeMicro = 100;
  const scheduled = releaseAtMs > 0;
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
    scheduled,
  });
  return {
    msgId,
    payloadSha256,
    env: {
      v: 1,
      kind: "tmail_envelope_v1",
      msg_id: msgId,
      flags: { basic: true, time_lock: scheduled, burn_after_read: burn, anonymous: false },
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



// --- inbox helpers ---
async function inboxRow(baseUrl, walletId, msgId) {
  const r = await getInbox(baseUrl, walletId);
  if (r.status !== 200) return { ok: false, status: r.status, row: null, lockedCount: null };
  const j = JSON.parse(r.body);
  return {
    ok: true,
    status: r.status,
    row: (j.messages || []).find((m) => m.msg_id === msgId) ?? null,
    lockedCount: j.locked_count ?? null,
  };
}

/** Poll both nodes until `pred(row)` holds on each, or the deadline passes. */
async function waitRow(urls, walletId, msgId, pred, timeoutMs = 60000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const seen = [];
    for (const u of urls) seen.push(await inboxRow(u, walletId, msgId));
    last = seen;
    if (seen.every((s) => s.ok && s.row && pred(s.row))) {
      return { ok: true, elapsedMs: Date.now() - started, seen };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, elapsedMs: Date.now() - started, seen: last };
}

function log(...a) {
  console.log(...a);
}

const N1 = process.env.N1_URL || "http://127.0.0.1:5010";
const N2 = process.env.N2_URL || "http://127.0.0.1:5020";
// Short enough to keep the run quick, long enough that propagation cannot outrun it.
const SCHEDULE_MS = Number(process.env.SCHEDULE_MS || 25000);

async function main() {
  await initPqc(readFileSync(resolve(__dirname, "../public/pqc/tet_pqc_wasm_bg.wasm")));

  const results = { steps: [] };
  const step = (name, ok, detail) => {
    results.steps.push({ name, ok, detail });
    log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  const A = makeWallet(generateMnemonic(wordlist, 128));
  const B = makeWallet(generateMnemonic(wordlist, 128));
  const kemB = await deriveKem(B.norm);
  log(`Node 1 (sender side): ${N1}`);
  log(`Node 2 (reader side): ${N2}`);
  log(`Wallet A (sender):   ${A.walletId}`);
  log(`Wallet B (receiver): ${B.walletId}`);

  const binding = await chainBinding(N1);
  const binding2 = await chainBinding(N2);
  step(
    "both nodes agree on the chain binding",
    binding.genesisHash === binding2.genesisHash,
    `genesis=${binding.genesisHash.slice(0, 18)}…`,
  );

  const pb = await putKeys(N1, B.walletId, await buildKeyRegistration(B, kemB, binding));
  step("N1 PUT /tmail/keys B", pb.status === 200, `HTTP ${pb.status}`);
  if (pb.status !== 200) return finish(results);

  // ---------------------------------------------------------------------
  // AT-3: scheduled release
  // ---------------------------------------------------------------------
  log(`\n--- AT-3: scheduled release (+${SCHEDULE_MS} ms) ---`);
  const text = `OPEN ME LATER. ts=${Date.now()}`;
  const releaseAt = Date.now() + SCHEDULE_MS;
  const built = await buildEnvelope(
    A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, text, binding, false, releaseAt,
  );
  results.msg_id = built.msgId;
  log(`msg_id=${built.msgId} release_at_ms=${releaseAt}`);

  const sent = await sendTmail(N1, built.env);
  step("N1 POST /tmail/send (time_lock=1)", sent.status === 202, `HTTP ${sent.status} ${sent.body.slice(0, 120)}`);
  if (sent.status !== 202) return finish(results);

  // Present on both, and WITHHELD on both.
  const withheld = await waitRow([N1, N2], B.walletId, built.msgId, (r) => r.locked === true);
  step(
    "listed as locked on BOTH nodes (real gossip propagation)",
    withheld.ok,
    withheld.ok ? `converged in ${withheld.elapsedMs} ms` : `not locked on both: ${JSON.stringify(withheld.seen)}`,
  );
  if (!withheld.ok) return finish(results);

  // The ciphertext must be absent on both, and the release time visible.
  const noPayload = withheld.seen.every((s) => s.row.e2ee === undefined);
  step("no e2ee block served on either node", noPayload, noPayload ? "withheld" : "CIPHERTEXT LEAKED");
  const showsRelease = withheld.seen.every((s) => s.row.release_at_ms === releaseAt);
  step("release_at_ms visible to the receiver", showsRelease, `release_at_ms=${releaseAt}`);
  const hasNote = withheld.seen.every(
    (s) => typeof s.row.locked_note === "string" && s.row.locked_note.includes("not an enforced lock"),
  );
  step("R6 disclosure served with the locked row", hasNote, hasNote ? "present on both" : "MISSING");
  const counted = withheld.seen.every((s) => s.lockedCount >= 1);
  step("locked_count reported", counted, `n1=${withheld.seen[0].lockedCount} n2=${withheld.seen[1].lockedCount}`);

  // Raw-body check: the ciphertext must not appear anywhere in either response.
  let leaked = false;
  for (const u of [N1, N2]) {
    const raw = (await getInbox(u, B.walletId)).body;
    if (raw.includes(built.env.e2ee.ciphertext_b64)) leaked = true;
  }
  step("ciphertext absent from the raw response bodies", !leaked, leaked ? "LEAKED" : "clean");

  // ---------------------------------------------------------------------
  // Wait out the schedule, then confirm release.
  // ---------------------------------------------------------------------
  const waitMs = Math.max(0, releaseAt - Date.now()) + 1500;
  log(`\n--- waiting ${waitMs} ms for the release ---`);
  await new Promise((r) => setTimeout(r, waitMs));

  const released = await waitRow([N1, N2], B.walletId, built.msgId, (r) => r.locked === false);
  step(
    "released on BOTH nodes after release_at_ms",
    released.ok,
    released.ok ? `both unlocked in ${released.elapsedMs} ms` : JSON.stringify(released.seen),
  );
  if (!released.ok) return finish(results);

  const hasPayload = released.seen.every((s) => s.row.e2ee && s.row.e2ee.ciphertext_b64);
  step("e2ee block now served on both", hasPayload, hasPayload ? "present" : "STILL MISSING");

  // And it decrypts to the original plaintext on the reader node.
  let decOk = false;
  const f = released.seen[1].row;
  if (f && f.e2ee) {
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
    decOk = new TextDecoder().decode(pt) === text;
  }
  step("N2 B decrypts the released message", decOk, decOk ? "plaintext matches" : "decrypt FAILED");

  // ---------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------
  log("\n--- controls ---");

  // C-a: an unscheduled message is never withheld.
  const plainText = `NO SCHEDULE. ts=${Date.now()}`;
  const plain = await buildEnvelope(A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, plainText, binding);
  const ps = await sendTmail(N1, plain.env);
  step("N1 POST /tmail/send (no schedule)", ps.status === 202, `HTTP ${ps.status}`);
  const open = await waitRow([N1, N2], B.walletId, plain.msgId, (r) => r.locked === false);
  step(
    "CONTROL: an unscheduled message is never withheld",
    open.ok && open.seen.every((s) => s.row.e2ee),
    open.ok ? "served in full on both" : "unexpectedly withheld",
  );

  // C-b: a schedule in the past is refused at send, not released immediately under a
  // "scheduled" label.
  const past = await buildEnvelope(
    A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, "PAST", binding, false, Date.now() - 60000,
  );
  const pastSent = await sendTmail(N1, past.env);
  step(
    "CONTROL: a past release_at_ms is refused",
    pastSent.status === 400,
    `HTTP ${pastSent.status} ${pastSent.body.slice(0, 120)}`,
  );

  // C-c: an unsigned time_lock block cannot move the release.
  const moved = await buildEnvelope(
    A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, "MOVED", binding, false, Date.now() + SCHEDULE_MS,
  );
  moved.env.time_lock = { release_at_ms: Date.now() + 999999999, vdf_proof_b64: null };
  const movedSent = await sendTmail(N1, moved.env);
  step(
    "CONTROL: an unsigned time_lock block cannot move the release",
    movedSent.status === 400,
    `HTTP ${movedSent.status} ${movedSent.body.slice(0, 120)}`,
  );

  finish(results);
}

function finish(results) {
  log("\n=== SUMMARY ===");
  const pass = results.steps.every((s) => s.ok);
  log(JSON.stringify({ all_pass: pass, msg_id: results.msg_id, steps: results.steps }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
