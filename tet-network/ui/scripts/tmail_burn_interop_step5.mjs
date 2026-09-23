/**
 * Tmail Step 5 — headless LIVE two-node burn-after-read test (AT-4, spec §A.3.2).
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


// --- burn revoke (burn.rs §A.3.2) ---
function burnRevokePreimage({ chainId, genesisHash, msgId, reader, readAtMs, mldsaPk }) {
  return enc(
    `tet tmail burn revoke v1|chain_id=${chainId}|genesis_hash=${genesisHash}` +
      `|msg_id=${msgId.trim()}|reader=${reader.trim().toLowerCase()}` +
      `|read_at_ms=${readAtMs}|mldsa_pk=${mldsaPk.trim()}`,
  );
}

function buildBurnRevoke(wallet, msgId, binding) {
  const readAtMs = Date.now();
  const msg = burnRevokePreimage({
    chainId: binding.chainId,
    genesisHash: binding.genesisHash,
    msgId,
    reader: wallet.walletId,
    readAtMs,
    mldsaPk: wallet.mldsaPubB64,
  });
  return {
    v: 1,
    kind: "tmail_burn_revoke_v1",
    msg_id: msgId,
    reader_wallet_id: wallet.walletId,
    read_at_ms: readAtMs,
    hybrid_sig: {
      ed25519_pubkey_hex: wallet.walletId,
      ed25519_sig_b64: b64(wallet.signEd(msg)),
      mldsa_pubkey_b64: wallet.mldsaPubB64,
      mldsa_sig_b64: wallet.signMldsa(msg),
    },
  };
}

async function readReceipt(baseUrl, revoke) {
  const r = await fetch(`${baseUrl}/tmail/read-receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(revoke),
  });
  return { status: r.status, body: await r.text() };
}

async function inboxHas(baseUrl, walletId, msgId) {
  const r = await getInbox(baseUrl, walletId);
  if (r.status !== 200) return { ok: false, present: null, status: r.status };
  const j = JSON.parse(r.body);
  return { ok: true, present: (j.messages || []).some((m) => m.msg_id === msgId), status: r.status };
}

/** Poll both nodes until each reports `want` presence, or the deadline passes. */
async function waitPresence(urls, walletId, msgId, want, timeoutMs = 25000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const seen = [];
    for (const u of urls) seen.push(await inboxHas(u, walletId, msgId));
    last = seen;
    if (seen.every((s) => s.ok && s.present === want)) {
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

async function main() {
  await initPqc(readFileSync(resolve(__dirname, "../public/pqc/tet_pqc_wasm_bg.wasm")));

  const results = { steps: [] };
  const step = (name, ok, detail) => {
    results.steps.push({ name, ok, detail });
    log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  const mnA = generateMnemonic(wordlist, 128);
  const mnB = generateMnemonic(wordlist, 128);
  const A = makeWallet(mnA);
  const B = makeWallet(mnB);
  const kemA = await deriveKem(A.norm);
  const kemB = await deriveKem(B.norm);
  log(`Node 1 (sender side): ${N1}`);
  log(`Node 2 (reader side): ${N2}`);
  log(`Wallet A (sender):   ${A.walletId}`);
  log(`Wallet B (receiver): ${B.walletId}`);

  const binding = await chainBinding(N1);
  const binding2 = await chainBinding(N2);
  step(
    "both nodes agree on the chain binding",
    binding.genesisHash === binding2.genesisHash && binding.chainId === binding2.chainId,
    `chain_id=${binding.chainId} genesis=${binding.genesisHash.slice(0, 18)}…`,
  );

  // B publishes its KEM keys on node 1 so A can address it.
  const regB = await buildKeyRegistration(B, kemB, binding);
  const pb = await putKeys(N1, B.walletId, regB);
  step("N1 PUT /tmail/keys B", pb.status === 200, `HTTP ${pb.status}`);
  if (pb.status !== 200) return finish(results);

  // ---------------------------------------------------------------------
  // AT-4 proper: burn-after-read
  // ---------------------------------------------------------------------
  log("\n--- AT-4: burn-after-read ---");
  const text = `BURN ME. ts=${Date.now()}`;
  const built = await buildEnvelope(A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, text, binding, true);
  results.msg_id = built.msgId;
  log(`msg_id=${built.msgId}`);

  const sent = await sendTmail(N1, built.env);
  step("N1 POST /tmail/send (burn_after_read=1)", sent.status === 202, `HTTP ${sent.status} ${sent.body.slice(0, 120)}`);
  if (sent.status !== 202) return finish(results);

  // It must reach node 2 over real libp2p gossip.
  const arrived = await waitPresence([N1, N2], B.walletId, built.msgId, true);
  step(
    "envelope present on BOTH nodes (real gossip propagation)",
    arrived.ok,
    arrived.ok ? `converged in ${arrived.elapsedMs} ms` : `NOT on both: ${JSON.stringify(arrived.seen)}`,
  );
  if (!arrived.ok) return finish(results);

  // B decrypts on node 2 — it must actually be readable before we destroy it.
  const inbox2 = await getInbox(N2, B.walletId);
  let decOk = false;
  if (inbox2.status === 200) {
    const f = (JSON.parse(inbox2.body).messages || []).find((m) => m.msg_id === built.msgId);
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
      decOk = new TextDecoder().decode(pt) === text;
      results.decrypted_on_n2 = decOk;
      step("N2 burn flag survived the wire", f.flags?.burn_after_read === true, `flags=${JSON.stringify(f.flags)}`);
    }
  }
  step("N2 B decrypts the burn message before burning it", decOk, decOk ? "plaintext matches" : "decrypt FAILED");
  if (!decOk) return finish(results);

  // B reads it: read receipt on node 2.
  const revoke = buildBurnRevoke(B, built.msgId, binding2);
  const rr = await readReceipt(N2, revoke);
  step("N2 POST /tmail/read-receipt (receiver-signed)", rr.status === 202, `HTTP ${rr.status} ${rr.body.slice(0, 200)}`);
  if (rr.status !== 202) return finish(results);

  // AT-4 assertion: gone from BOTH.
  const gone = await waitPresence([N1, N2], B.walletId, built.msgId, false);
  step(
    "AT-4: ciphertext gone from BOTH node stores",
    gone.ok,
    gone.ok ? `both cleared in ${gone.elapsedMs} ms (revoke crossed the wire)` : `still present: ${JSON.stringify(gone.seen)}`,
  );

  // It must stay gone when the original envelope is re-submitted.
  const resend = await sendTmail(N1, built.env);
  const stillGone = await inboxHas(N1, B.walletId, built.msgId);
  step(
    "a re-submitted burned envelope is refused (tombstone holds)",
    resend.status === 409 && stillGone.ok && stillGone.present === false,
    `re-send HTTP ${resend.status}, present=${stillGone.present}`,
  );

  // ---------------------------------------------------------------------
  // Controls: the same run must NOT destroy things it has no right to.
  // ---------------------------------------------------------------------
  log("\n--- controls ---");

  // C-a: a plain (non-burn) message survives the identical read receipt.
  const plainText = `KEEP ME. ts=${Date.now()}`;
  const plain = await buildEnvelope(A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, plainText, binding, false);
  const ps = await sendTmail(N1, plain.env);
  step("N1 POST /tmail/send (plain, burn=0)", ps.status === 202, `HTTP ${ps.status}`);
  const plainArrived = await waitPresence([N1, N2], B.walletId, plain.msgId, true);
  step("plain message on BOTH nodes", plainArrived.ok, plainArrived.ok ? `${plainArrived.elapsedMs} ms` : "not propagated");
  const plainRevoke = buildBurnRevoke(B, plain.msgId, binding2);
  const prr = await readReceipt(N2, plainRevoke);
  step(
    "CONTROL: read receipt on a non-burn message is refused 403",
    prr.status === 403,
    `HTTP ${prr.status} ${prr.body.slice(0, 120)}`,
  );
  const plainStill = await inboxHas(N2, B.walletId, plain.msgId);
  step("CONTROL: the plain message survives", plainStill.present === true, `present=${plainStill.present}`);

  // C-b: a stranger cannot burn a burn-flagged message.
  const mnC = generateMnemonic(wordlist, 128);
  const C = makeWallet(mnC);
  const text2 = `STRANGER TEST. ts=${Date.now()}`;
  const built2 = await buildEnvelope(A, B.walletId, kemB.x25519_pub, kemB.mlkem_pub, text2, binding, true);
  const s2 = await sendTmail(N1, built2.env);
  step("N1 POST /tmail/send (burn, for stranger test)", s2.status === 202, `HTTP ${s2.status}`);
  const a2 = await waitPresence([N1, N2], B.walletId, built2.msgId, true);
  step("stranger-test message on BOTH nodes", a2.ok, a2.ok ? `${a2.elapsedMs} ms` : "not propagated");
  const strangerRevoke = buildBurnRevoke(C, built2.msgId, binding2);
  const srr = await readReceipt(N2, strangerRevoke);
  step(
    "CONTROL: a third party's read receipt is refused 403",
    srr.status === 403,
    `HTTP ${srr.status} ${srr.body.slice(0, 120)}`,
  );
  const survived = await inboxHas(N2, B.walletId, built2.msgId);
  step("CONTROL: the message survives a stranger's revoke", survived.present === true, `present=${survived.present}`);

  // C-c: sender may burn what they sent.
  const senderRevoke = buildBurnRevoke(A, built2.msgId, binding2);
  const arr = await readReceipt(N2, senderRevoke);
  step("the SENDER may burn what they sent", arr.status === 202, `HTTP ${arr.status}`);
  const goneToo = await waitPresence([N1, N2], B.walletId, built2.msgId, false);
  step("sender-initiated burn clears BOTH nodes", goneToo.ok, goneToo.ok ? `${goneToo.elapsedMs} ms` : JSON.stringify(goneToo.seen));

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
