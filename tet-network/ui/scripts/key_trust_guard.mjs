// Guard: the page checks keys and senders itself (app/lib/key_trust.ts; SECURITY.md 2026-10-10).
//
//   node --experimental-strip-types scripts/key_trust_guard.mjs
//
// The real key_trust.ts runs against a fake node (fetch is replaced), with real signatures:
// 1. SECURITY: a node that swaps a recipient's key is refused (nothing to encrypt to).
// 2. SECURITY: a key registration signed by another wallet is refused.
// 3. SECURITY: an unsigned or older (not v2) registration is refused, with the re-register message.
// 4. SECURITY: a forged sender (an envelope or file signed by someone else) is refused.
// 5. An honest registration and an honest sender pass; the safety number is the same on both sides
//    and changes when either person's key changes.
// 6. SECURITY: no page encrypts to keys fetched with the raw getTmailKeys (only trustedKeysFor).
// Negative controls (run by hand, recorded in the commit): verifyKeyRegistration skipping the
// signature checks → 1 and 2 FAILED; verifyEnvelopeSender returning "verified" for any signer →
// 4 FAILED.

import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const kt = await import("../app/lib/key_trust.ts");
const { buildTmailKeyRegistrationV1, deriveTmailKeysFromMnemonic } = await import("../app/lib/tmail_keys.ts");
const { buildTmailEnvelopeV1 } = await import("../app/lib/tmail.ts");
const { buildFileEnvelopeV1 } = await import("../app/lib/files.ts");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { getHybridSignerSession } = await import("../app/lib/hybrid_signer_session.ts");
const { bytesToB64 } = await import("../app/lib/encoding.ts");

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

// The fake node: whatever registration `served` holds for a wallet. Chain binding comes from env.
const served = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = String(input);
  const m = /\/tmail\/keys\/([0-9a-f]{64})/.exec(u);
  if (m) {
    const reg = served.get(m[1]);
    return new Response(JSON.stringify(reg ? { ok: true, registration: reg } : { ok: false }), { status: reg ? 200 : 404, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};
const BASE = "http://fake-node";

const WORDS_A = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const WORDS_B = "legal winner thank year wave sausage worth useful legal winner thank yellow";

async function registrationOf(words) {
  const id = await activateTryWallet(words);
  const k = await deriveTmailKeysFromMnemonic(words);
  return { id, keys: k, reg: await buildTmailKeyRegistrationV1({ x25519_pub: k.x25519_pub, mlkem_pub: k.mlkem_pub, baseUrl: BASE }) };
}
const A = await registrationOf(WORDS_A);
const B = await registrationOf(WORDS_B);
const clone = (x) => JSON.parse(JSON.stringify(x));

await check("an honest v2 registration by the wallet is trusted", async () => {
  served.set(A.id, A.reg);
  const k = await kt.trustedKeysFor(BASE, A.id);
  assert.equal(k.ok, true, JSON.stringify(k));
});

await check("SECURITY: a node that swaps the recipient's key is refused", async () => {
  const swapped = clone(A.reg);
  swapped.x25519_pub_b64 = B.reg.x25519_pub_b64; // the node's own key, A's signature kept
  served.set(A.id, swapped);
  const k = await kt.trustedKeysFor(BASE, A.id);
  assert.equal(k.ok, false);
  assert.equal(k.reason, "not_theirs");
  const kyber = clone(A.reg);
  kyber.mlkem_pub_b64 = B.reg.mlkem_pub_b64;
  served.set(A.id, kyber);
  assert.equal((await kt.trustedKeysFor(BASE, A.id)).ok, false, "a swapped Kyber key was trusted");
});

await check("SECURITY: a key signed by another wallet is refused", async () => {
  // B's whole, valid registration served as A's.
  served.set(A.id, B.reg);
  assert.equal((await kt.trustedKeysFor(BASE, A.id)).ok, false, "B's registration was trusted for A");
  // Claims to be A's (wallet id and signer say A), but B signed it.
  const claimed = clone(B.reg);
  claimed.wallet_id = A.id;
  claimed.hybrid_sig.ed25519_pubkey_hex = A.id;
  served.set(A.id, claimed);
  const k = await kt.trustedKeysFor(BASE, A.id);
  assert.equal(k.ok, false, "a registration signed by B, claiming A, was trusted");
  assert.equal(k.reason, "not_theirs");
});

await check("SECURITY: an unsigned or older registration is refused, with the re-register message", async () => {
  const legacy = clone(A.reg);
  delete legacy.v;
  served.set(A.id, legacy);
  let k = await kt.trustedKeysFor(BASE, A.id);
  assert.equal(k.ok, false);
  assert.equal(k.reason, "legacy");
  assert.match(k.message, /open TET once to re-register/);
  const unsigned = { wallet_id: A.id, x25519_pub_b64: A.reg.x25519_pub_b64, mlkem_pub_b64: A.reg.mlkem_pub_b64, registered_at_ms: 1 };
  served.set(A.id, unsigned);
  k = await kt.trustedKeysFor(BASE, A.id);
  assert.equal(k.ok, false, "an unsigned registration was trusted");
  const unsignedV2 = { ...unsigned, v: 2 };
  served.set(A.id, unsignedV2);
  assert.equal((await kt.trustedKeysFor(BASE, A.id)).ok, false, "an unsigned 'v2' registration was trusted");
});

await check("SECURITY: a forged sender is refused (message and file)", async () => {
  served.set(A.id, A.reg);
  await activateTryWallet(WORDS_B);
  const env = await buildTmailEnvelopeV1({ senderWalletId: B.id, receiverWalletId: A.id, plaintextUtf8: "hi", receiverX25519Pub: A.keys.x25519_pub, receiverMlkemPub: A.keys.mlkem_pub, baseUrl: BASE });
  assert.equal(await kt.verifyEnvelopeSender(env, BASE), "verified", "an honest sender didn't verify");
  const forged = clone(env);
  forged.sender_wallet_id = A.id; // B signed it; it claims to be from A
  forged.hybrid_sig.ed25519_pubkey_hex = A.id;
  assert.equal(await kt.verifyEnvelopeSender(forged, BASE), "forged");
  const changed = clone(env);
  changed.e2ee.ciphertext_b64 = bytesToB64(new Uint8Array(32)); // content swapped in transit
  assert.equal(await kt.verifyEnvelopeSender(changed, BASE), "forged", "a changed message kept its sender");
  const file = await buildFileEnvelopeV1({ senderWalletId: B.id, receiverWalletId: A.id, fileBytes: new Uint8Array([1, 2, 3]), filename: "a.txt", mimeType: "text/plain", receiverX25519Pub: A.keys.x25519_pub, receiverMlkemPub: A.keys.mlkem_pub, baseUrl: BASE });
  assert.equal(await kt.verifyFileSender(file.envelope, BASE), "verified");
  const ff = clone(file.envelope);
  ff.sender_wallet_id = A.id;
  ff.hybrid_sig.ed25519_pubkey_hex = A.id;
  assert.equal(await kt.verifyFileSender(ff, BASE), "forged");
});

await check("the safety number matches on both sides and changes with either key", async () => {
  const pa = { walletId: A.id, x25519PubB64: A.reg.x25519_pub_b64, mlkemPubB64: A.reg.mlkem_pub_b64 };
  const pb = { walletId: B.id, x25519PubB64: B.reg.x25519_pub_b64, mlkemPubB64: B.reg.mlkem_pub_b64 };
  const n = kt.safetyNumber(pa, pb);
  assert.match(n, /^\d{5} \d{5} \d{5} \d{5}$/);
  assert.equal(kt.safetyNumber(pb, pa), n, "differs by who computes it");
  assert.notEqual(kt.safetyNumber({ ...pa, x25519PubB64: B.reg.x25519_pub_b64 }, pb), n, "a swapped key kept the number");
  assert.notEqual(kt.safetyNumber(pa, { ...pb, mlkemPubB64: A.reg.mlkem_pub_b64 }), n);
});

await check("SECURITY: no page encrypts to keys from the raw getTmailKeys", async () => {
  // Raw lookups are fine only to ask "is MY inbox on?" (own wallet) or to compare a board's keys
  // with its invite (the invite is the key). Everything else goes through trustedKeysFor.
  const ALLOWED = new Set([
    "app/lib/key_trust.ts",
    "app/lib/try_board.ts", // openBoard: compared with the invite's own keys
    "app/try/wallet.tsx", // own inbox status
    "app/try/SignPanel.tsx", // own inbox status; encrypts to the tab's own keys
    "app/os/OsClient.tsx", // own registration
  ]);
  const bad = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs)$/.test(f)) {
        const rel = p.replace(/^.*?\/ui\//, "");
        const text = readFileSync(p, "utf8");
        if (/\bgetTmailKeys\(/.test(text) && !/export async function getTmailKeys/.test(text) && !ALLOWED.has(rel)) {
          // OS panels may look up their own wallet's registration (status) only.
          const calls = [...text.matchAll(/getTmailKeys\(\s*[\w.]+\s*,\s*([\w.]+)\s*\)/g)].map((m) => m[1]);
          if (calls.some((c) => !/^(myWalletId|me|wid|id)$/.test(c))) bad.push(`${rel}: getTmailKeys(…, ${calls.join(", ")})`);
        }
      }
    }
  };
  walk(new URL("../app", import.meta.url).pathname);
  assert.deepEqual(bad, []);
});

void getHybridSignerSession;
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
