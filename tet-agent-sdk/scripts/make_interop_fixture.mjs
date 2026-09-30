/**
 * Regenerate `tet-core/src/testdata/agent_sdk_hybrid_sigs.json`.
 *
 * Signatures are produced by the agent SDK's OWN code path: BIP39 Ed25519 from
 * `src/wallet_from_mnemonic.ts` and ML-DSA-44 from `vendor/tet_pqc_wasm_bg.wasm` — the third
 * committed copy of the signer, which until now had neither a reproducibility diff nor a
 * behaviour fixture. The node verifies the result in `tet-core/src/tests.rs`.
 *
 * Both halves are deterministic (Ed25519 by RFC 8032; ML-DSA-44 because TET derives the signing
 * randomness as SHA256("tet:mldsa44-signing-rnd:v1" ‖ msg)), so regenerating this file must
 * produce byte-identical output. A diff here means the signer changed.
 *
 *   npm run fixture
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadHybridWalletFromMnemonic } from "../dist/wallet_from_mnemonic.js";
import { mldsa44SignDeterministic } from "../dist/pqc_wasm.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const OUT = join(repoRoot, "tet-core", "src", "testdata", "agent_sdk_hybrid_sigs.json");

/** Standard BIP39 test vectors, in the same order as `browser_wallet_hybrid_sigs.json`. */
const MNEMONICS = [
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
  "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
];

const b64 = (u8) => Buffer.from(u8).toString("base64");

const cases = [];
for (const mnemonic of MNEMONICS) {
  const w = await loadHybridWalletFromMnemonic(mnemonic);
  const message_utf8 = `tet agent-sdk interop v1|${w.walletIdHex64}`;
  const msg = new TextEncoder().encode(message_utf8);
  cases.push({
    mnemonic,
    wallet_id: w.walletIdHex64,
    mldsa_pubkey_b64: w.mldsa44PubkeyB64,
    message_utf8,
    ed25519_sig_b64: b64(w.signEd25519(msg)),
    mldsa_sig_b64: await mldsa44SignDeterministic(w.mldsa44KeypairB64, msg),
  });
}

// The point of the fixture is cross-implementation agreement, so check it here too rather than
// only in Rust: the browser wallet must have derived the same wallet ids from the same vectors.
const browser = JSON.parse(
  readFileSync(join(repoRoot, "tet-core", "src", "testdata", "browser_wallet_hybrid_sigs.json"), "utf8"),
);
browser.cases.forEach((c, i) => {
  if (c.wallet_id !== cases[i].wallet_id) {
    throw new Error(
      `case ${i}: agent SDK derived ${cases[i].wallet_id}, browser wallet derived ${c.wallet_id}`,
    );
  }
  if (c.mldsa_pubkey_b64 !== cases[i].mldsa_pubkey_b64) {
    throw new Error(`case ${i}: ML-DSA-44 public keys disagree with the browser wallet`);
  }
});

const doc = {
  _what:
    "Hybrid signatures produced by tet-agent-sdk — BIP39 Ed25519 plus the SDK's own vendored " +
    "tet-pqc-wasm copy — verified here by the node's own verifiers.",
  _produced_by: "tet-agent-sdk/scripts/make_interop_fixture.mjs (npm run fixture)",
  _produced_on: "2026-09-30",
  _why:
    "tet-agent-sdk/vendor/ is a THIRD committed copy of the ML-DSA-44 signer. CI rebuilt the " +
    "wasm but never compared bytes, and the only interop fixture came from the UI's copy, so " +
    "nothing tested this one. It also caught a real defect: the SDK derived Ed25519 with " +
    "@polkadot/keyring (substrate mini-secret) instead of BIP39, so the same mnemonic produced " +
    "wallet id 9125f505... here and c5785e18... everywhere else in TET.",
  _mnemonics: "Standard BIP39 test vectors, public by design. No real funds.",
  _level: "ML-DSA-44: 1312-byte public key, 2420-byte signature. Pinned, not inferred.",
  cases,
};
writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${OUT} (${cases.length} cases)`);
for (const c of cases) console.log(`  ${c.wallet_id}`);
