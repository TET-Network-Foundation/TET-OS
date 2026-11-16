// Guard: the browser derives the same Ed25519 key from 12 words as tet-core does, and its Ed25519 is
// RFC 8032 Ed25519.
//
//   node --experimental-strip-types scripts/browser_signing_parity_guard.mjs
//
// It runs the module the browser runs (`app/lib/ed25519_tet.ts`, which wires @noble/ed25519 to
// SHA-512), not a copy of its logic. The other side is tet-core's own derivation, through the
// fixture tet-core asserts: `tet-core/src/testdata/agent_sdk_hybrid_sigs.json` carries 12-word
// BIP-39 test phrases with their wallet ids, and the rust test
// `agent_sdk_derives_the_same_hybrid_identity_as_the_node` checks every one of those ids against
// `wallet::ed25519_signing_key_from_mnemonic`. So: browser == fixture == tet-core.
//
// 1. Each 12-word phrase gives the fixture's wallet id in the browser module.
// 2. The browser signs each fixture message to the exact fixture signature bytes (Ed25519 is
//    deterministic; tet-core verifies those bytes in agent_sdk_hybrid_signatures_verify_on_the_node).
// 3. RFC 8032 section 7.1 test vectors 1, 2, 3 and SHA(abc): public key and signature byte for
//    byte, the signature verifies, and a one-bit change to the signature or the message is refused.
//
// The old scripts/verify-ed25519-tet-parity.mjs compared a copy of the UI logic with
// tet-core/scripts/wallet_client_entry.mjs, which is JavaScript on the same library, not tet-core's
// rust derivation. It stays as a manual tool.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

const { mnemonicToTetEd25519Keypair, signTetEd25519, verifyTetEd25519, bytesToHex } = await import(
  "../app/lib/ed25519_tet.ts"
);
// The same @noble/ed25519 instance the module above configured; used only for getPublicKey on the
// RFC secret keys, which the browser module does not export for a raw key.
const ed = await import("@noble/ed25519");

const fixture = JSON.parse(
  readFileSync(new URL("../../../tet-core/src/testdata/agent_sdk_hybrid_sigs.json", import.meta.url), "utf8"),
);
const hex = (s) => new Uint8Array(Buffer.from(s, "hex"));
const b64 = (u8) => Buffer.from(u8).toString("base64");

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

await check("12 words give tet-core's wallet id in the browser module", async () => {
  // An empty or shrunken fixture would pass vacuously.
  assert.equal(fixture.cases.length, 4, "fixture must keep its four BIP-39 test phrases");
  for (const [i, c] of fixture.cases.entries()) {
    assert.equal(c.mnemonic.split(" ").length, 12, `case ${i}: not 12 words`);
    const kp = mnemonicToTetEd25519Keypair(c.mnemonic);
    assert.equal(kp.walletIdHex, c.wallet_id, `case ${i}: browser wallet id differs from tet-core's`);
  }
});

await check("the browser signs tet-core-verified messages to the same bytes", async () => {
  for (const [i, c] of fixture.cases.entries()) {
    const kp = mnemonicToTetEd25519Keypair(c.mnemonic);
    const sig = await signTetEd25519(kp.secretKey, new TextEncoder().encode(c.message_utf8));
    assert.equal(b64(sig), c.ed25519_sig_b64, `case ${i}: browser Ed25519 signature differs`);
  }
});

// RFC 8032 section 7.1, Ed25519.
const RFC8032 = [
  {
    name: "TEST 1",
    sk: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    pk: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    msg: "",
    sig: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  },
  {
    name: "TEST 2",
    sk: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    pk: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    msg: "72",
    sig: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
  },
  {
    name: "TEST 3",
    sk: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
    pk: "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
    msg: "af82",
    sig: "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
  },
  {
    name: "TEST SHA(abc)",
    sk: "833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42",
    pk: "ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf",
    msg: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    sig: "dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b58909351fc9ac90b3ecfdfbc7c66431e0303dca179c138ac17ad9bef1177331a704",
  },
];

for (const v of RFC8032) {
  await check(`RFC 8032 ${v.name}: same key and signature, and a one-bit change is refused`, async () => {
    const sk = hex(v.sk);
    const msg = hex(v.msg);
    const pk = ed.getPublicKey(sk);
    assert.equal(bytesToHex(pk), v.pk, "public key");
    const sig = await signTetEd25519(sk, msg);
    assert.equal(bytesToHex(sig), v.sig, "signature");
    assert.equal(await verifyTetEd25519(pk, msg, sig), true, "the RFC signature must verify");

    const badSig = sig.slice();
    badSig[0] ^= 1;
    assert.equal(await verifyTetEd25519(pk, msg, badSig), false, "a signature with one bit changed must be refused");
    const badMsg = new Uint8Array([...msg, 0]);
    badMsg[0] ^= msg.length ? 1 : 0;
    assert.equal(await verifyTetEd25519(pk, badMsg, sig), false, "a changed message must be refused");
  });
}

if (failed) {
  console.log(`\nbrowser_signing_parity_guard: ${failed} failed`);
  process.exit(1);
}
console.log("\nbrowser_signing_parity_guard: all checks passed");
