// Guard for "verify anything" (Try TET part 4, docs/DEMO_NODE.md). Runs the page's verifier
// (`app/lib/verify_anything.mjs`) on fixtures that tet-core itself asserts:
//
// - tet-core/src/testdata/agent_payload_envelopes.json: SDK-signed envelopes tet-core verifies;
// - tet-core/src/testdata/agent_manifest_v1.json: a UI-signed manifest tet-core re-signs byte for
//   byte and verifies (`ui_signed_agent_manifest_is_byte_identical_in_rust`).
//
//   node --experimental-strip-types scripts/try_verify_guard.mjs
//
// SECURITY properties (each says only what it proves, and refuses otherwise):
// 1. Step 1 passes only for the exact bytes, on the verifier's chain, with both signatures, at
//    ML-DSA-44, from a well-formed envelope.
// 2. Step 2 passes only for a manifest that verifies like tet-core's and vouches for the key that
//    signed; a correctly signed manifest naming another owner, another key, or expired, fails.
// 3. Step 3 passes only when the pin names this key.
// 4. Without a manifest or a pin, the verdict stops at step 1.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

const v = await import("../app/lib/verify_anything.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const { signAgentManifest } = await import("../app/lib/agent_manifest.ts");
const { mnemonicToTetEd25519Keypair, signTetEd25519 } = await import("../app/lib/ed25519_tet.ts");
const { mldsa44KeypairFromMnemonic, mldsa44SignDeterministic } = await import("../app/lib/pqc.ts");

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const envDoc = read("../../../tet-core/src/testdata/agent_payload_envelopes.json");
const manDoc = read("../../../tet-core/src/testdata/agent_manifest_v1.json");
const chain = { chainId: envDoc.chain.chain_id, genesisHash: envDoc.chain.genesis_hash };
const NOW = manDoc.verify_at_ms;
const b64 = (u8) => Buffer.from(u8).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const clone = (x) => JSON.parse(JSON.stringify(x));

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

const base = { chain, nowMs: NOW, mldsa44Verify };
const verdict = (o) => v.gradedVerdict({ ...base, ...o });
const c0 = envDoc.cases[0];
const content0 = unb64(c0.payload_b64);

await check("every tet-core-asserted envelope passes step 1, and stops there without a manifest or pin", async () => {
  assert.ok(envDoc.cases.length >= 5);
  for (const [i, c] of envDoc.cases.entries()) {
    const r = await verdict({ content: unb64(c.payload_b64), envelope: c.envelope });
    assert.equal(r.steps[0].status, "ok", `case ${i}: ${r.steps[0].text}`);
    assert.equal(r.level, 1, `case ${i}`);
    assert.deepEqual(r.steps.slice(1).map((s) => s.status), ["skipped", "skipped"]);
  }
});

await check("SECURITY: step 1 fails for other bytes, another chain, a bad signature or a malformed envelope", async () => {
  const flipped = content0.slice();
  flipped[0] ^= 1;
  const cases = [
    ["one changed byte", { content: flipped, envelope: c0.envelope }, /content differs/],
    ["one extra byte", { content: new Uint8Array([...content0, 0]), envelope: c0.envelope }, /content differs/],
    ["another genesis hash", { content: content0, envelope: c0.envelope, chain: { ...chain, genesisHash: chain.genesisHash.replace(/.$/, "0") } }, /does not verify/],
    ["another chain id", { content: content0, envelope: c0.envelope, chain: { ...chain, chainId: "tet-other" } }, /does not verify/],
  ];
  const e1 = clone(c0.envelope);
  e1.signatures.find((s) => s.keyid.startsWith(v.ED_PREFIX)).sig = b64(new Uint8Array(64));
  cases.push(["a zeroed ed25519 signature", { content: content0, envelope: e1 }, /ed25519 signature does not verify/]);
  const e2 = clone(c0.envelope);
  const ml = e2.signatures.find((s) => s.keyid.startsWith(v.ML_PREFIX));
  const sigBytes = unb64(ml.sig);
  sigBytes[100] ^= 1;
  ml.sig = b64(sigBytes);
  cases.push(["a flipped ml-dsa signature bit", { content: content0, envelope: e2 }, /ml-dsa-44 signature does not verify/]);
  const e3 = clone(c0.envelope);
  e3.chain = chain;
  cases.push(["a chain named in the sidecar", { content: content0, envelope: e3 }, /unexpected field "chain"/]);
  const e4 = clone(c0.envelope);
  e4.signatures = e4.signatures.slice(0, 1);
  cases.push(["one signature only", { content: content0, envelope: e4 }, /exactly 2 signatures/]);
  const e5 = clone(c0.envelope);
  const shortPub = unb64(e5.tet.agent_mldsa44_pubkey_b64).slice(0, 1311);
  e5.tet.agent_mldsa44_pubkey_b64 = b64(shortPub);
  e5.signatures.find((s) => s.keyid.startsWith(v.ML_PREFIX)).keyid = v.mldsa44KeyId(b64(shortPub));
  cases.push(["an ml-dsa key that isn't level 44", { content: content0, envelope: e5 }, /not ML-DSA-44/]);
  const e6 = clone(c0.envelope);
  e6.tet.agent_ed25519_pubkey_hex = "ab".repeat(32);
  cases.push(["a keyid naming another key", { content: content0, envelope: e6 }, /keyid does not match/]);
  for (const [what, o, re] of cases) {
    const r = await verdict(o);
    assert.equal(r.level, 0, `${what}: level ${r.level}`);
    assert.equal(r.steps[0].status, "failed", what);
    assert.match(r.steps[0].text, re, `${what}: ${r.steps[0].text}`);
  }
});

await check("the UI-signed manifest (re-signed byte for byte by tet-core) verifies and grades step 2", async () => {
  assert.equal(manDoc.manifest.agent_ed25519_pubkey_hex, c0.agent_wallet_id, "fixture agent must be case 0's signer");
  const r = await verdict({ content: content0, envelope: c0.envelope, manifest: manDoc.manifest });
  assert.equal(r.steps[1].status, "ok", r.steps[1].text);
  assert.equal(r.level, 2);
  assert.match(r.steps[1].text, new RegExp(manDoc.manifest.owner_wallet_id));
  assert.match(r.steps[1].text, /a declaration, not a proof/);
});

// A manifest signed by OWNER_B that claims OWNER_A owns the agent: correctly signed, wrong owner.
const OWNER_B = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
// Every SDK fixture case is signed by one agent key; a second key, from another BIP39 test vector.
const OTHER_WORDS = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
const OTHER_AGENT = {
  ed: mnemonicToTetEd25519Keypair(OTHER_WORDS).walletIdHex,
  ml: (await mldsa44KeypairFromMnemonic(OTHER_WORDS)).pubkey_b64,
};
async function signedByBNamingA() {
  const m = clone(manDoc.manifest);
  const ed = mnemonicToTetEd25519Keypair(OWNER_B);
  const pq = await mldsa44KeypairFromMnemonic(OWNER_B);
  const msg = v.agentManifestAuthMessageBytes(chain, m, pq.pubkey_b64);
  m.hybrid_sig = {
    ed25519_pubkey_hex: ed.walletIdHex,
    ed25519_sig_b64: b64(await signTetEd25519(ed.secretKey, msg)),
    mldsa_pubkey_b64: pq.pubkey_b64,
    mldsa_sig_b64: await mldsa44SignDeterministic(pq.keypair_b64, msg),
  };
  return m;
}

await check("SECURITY: step 2 fails for a forged owner, another key, an altered field, or expiry", async () => {
  const forOther = await signAgentManifest({
    ownerWords: manDoc.owner_mnemonic,
    chain,
    agentId: "another agent",
    agentEd25519PubkeyHex: OTHER_AGENT.ed,
    agentMldsa44PubkeyB64: OTHER_AGENT.ml,
    createdAtMs: 1_790_000_000_000,
    expiresAtMs: 4_102_444_800_000,
    declaredAutomated: false,
    capabilities: [],
  });
  const altered = clone(manDoc.manifest);
  altered.capabilities = [...altered.capabilities, "spend"];
  const automatedFlip = clone(manDoc.manifest);
  automatedFlip.declared_automated = false;
  const cases = [
    ["a manifest signed by B naming A as owner", await signedByBNamingA(), NOW, /not signed by the owner it names/],
    ["a valid manifest for another agent key", forOther, NOW, /different key/],
    ["a capability added after signing", altered, NOW, /does not verify/],
    ["declared_automated flipped after signing", automatedFlip, NOW, /does not verify/],
    ["an expired manifest", manDoc.manifest, manDoc.manifest.expires_at_ms + 1, /expired/],
  ];
  for (const [what, manifest, nowMs, re] of cases) {
    const r = await verdict({ content: content0, envelope: c0.envelope, manifest, nowMs });
    assert.equal(r.steps[0].status, "ok", `${what}: step 1 should still hold`);
    assert.equal(r.steps[1].status, "failed", `${what}: ${r.steps[1].text}`);
    assert.match(r.steps[1].text, re, `${what}: ${r.steps[1].text}`);
    assert.equal(r.level, 1, `${what}: level ${r.level}`);
  }
});

await check("SECURITY: step 3 passes only when the pin names this key", async () => {
  const ed = c0.agent_wallet_id;
  const ml = v.mldsa44KeyId(c0.envelope.tet.agent_mldsa44_pubkey_b64);
  for (const pin of [ed, `${ed} ${ml}`, ml, JSON.stringify({ agent_ed25519_pubkey_hex: ed, agent_mldsa44_keyid: ml })]) {
    const r = await verdict({ content: content0, envelope: c0.envelope, pin });
    assert.equal(r.steps[2].status, "ok", `pin ${pin.slice(0, 20)}: ${r.steps[2].text}`);
    assert.equal(r.level, 3);
  }
  const otherEd = OTHER_AGENT.ed;
  for (const pin of [otherEd, `${ed} tet-mldsa44:${"0".repeat(64)}`]) {
    const r = await verdict({ content: content0, envelope: c0.envelope, pin });
    assert.equal(r.steps[2].status, "failed", `pin ${pin.slice(0, 20)} matched`);
    assert.match(r.steps[2].text, /NOT the key you pinned/);
    assert.equal(r.level, 1);
  }
  const bad = await verdict({ content: content0, envelope: c0.envelope, pin: "not-a-key" });
  assert.equal(bad.steps[2].status, "failed");
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
