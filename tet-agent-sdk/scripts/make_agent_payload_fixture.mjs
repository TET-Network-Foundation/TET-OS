/**
 * Regenerate `tet-core/src/testdata/agent_payload_envelopes.json`.
 *
 * Payloads signed by the SDK, verified in Rust by `tet-core` and by `tet-cli agent verify`. The
 * signatures must be BYTE-IDENTICAL across the two languages: Ed25519 is deterministic by RFC 8032
 * and ML-DSA-44 is deterministic here because TET derives the signing randomness as
 * SHA256("tet:mldsa44-signing-rnd:v1" || msg). That is the only reason a cross-language fixture can
 * compare signature bytes at all rather than merely "both verify", and it is what caught the
 * ML-DSA-65/44 divergence.
 *
 *   npm run fixture:agent
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadHybridWalletFromMnemonic } from "../dist/wallet_from_mnemonic.js";
import { signPayloadEnvelope, tetSign, verifySigEnvelope } from "../dist/agent.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(repoRoot, "tet-core", "src", "testdata", "agent_payload_envelopes.json");

/** Fixed binding, so the fixture is reproducible and the Rust side can set the same env. */
const CHAIN = {
  chain_id: "tet-agent-interop-1",
  // `0x`-prefixed, because that is what tet-core actually derives
  // (`format!("0x{}", hex::encode(...))`). The fixture used a bare 64-hex value until 2026-09-30,
  // which is a shape no real node serves — and that mismatch is exactly what let the SDK ship a
  // validation regex rejecting the live format.
  genesis_hash: "0x9f2c1b7a4d6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607182",
};
const chain = { chainId: CHAIN.chain_id, genesisHash: CHAIN.genesis_hash };

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const PAYLOADS = [
  { payload_type: "text/plain", bytes: Buffer.from("hello agent", "utf8"), note: "the simple case" },
  {
    payload_type: "application/vnd.tet.devlog+json",
    bytes: Buffer.from(
      JSON.stringify({ date: "2026-09-30", project: "tet", title: "Agent identity, day 2" }),
      "utf8",
    ),
    note: "the shape Day 3 signs",
  },
  {
    payload_type: "application/octet-stream",
    bytes: Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    note: "every byte value, so base64 handling is exercised rather than assumed",
  },
  {
    payload_type: "text/plain",
    bytes: Buffer.from("3 abc |tet xfer hybrid v1|ab|1234|7|deadbeef", "utf8"),
    note: "a payload imitating both the length prefix and another pre-image's delimiter",
  },
  { payload_type: "text/plain", bytes: Buffer.alloc(0), note: "empty payload" },
];

const wallet = await loadHybridWalletFromMnemonic(MNEMONIC);
const cases = [];
for (const p of PAYLOADS) {
  const payload = new Uint8Array(p.bytes);
  const sig = await tetSign(wallet, p.payload_type, payload, chain);
  const envelope = await signPayloadEnvelope(wallet, p.payload_type, payload, chain);

  // Self-check before writing: an envelope the SDK cannot verify must never reach the fixture.
  const v = await verifySigEnvelope(envelope, chain);
  if (!v.ok) throw new Error(`SDK cannot verify its own envelope: ${v.reason}`);
  if (envelope.signatures[0].sig !== sig.ed25519_sig_b64) throw new Error("envelope/sig mismatch (ed)");
  if (envelope.signatures[1].sig !== sig.mldsa_sig_b64) throw new Error("envelope/sig mismatch (ml)");

  cases.push({
    note: p.note,
    mnemonic: MNEMONIC,
    payload_type: p.payload_type,
    payload_b64: Buffer.from(payload).toString("base64"),
    agent_wallet_id: sig.ed25519_pubkey_hex,
    ed25519_sig_b64: sig.ed25519_sig_b64,
    mldsa_sig_b64: sig.mldsa_sig_b64,
    envelope,
  });
}

const doc = {
  _what:
    "Agent payload signatures and detached DSSE-shaped envelopes produced by tet-agent-sdk, " +
    "verified in Rust by tet-core and by `tet-cli agent verify`.",
  _produced_by: "tet-agent-sdk/scripts/make_agent_payload_fixture.mjs (npm run fixture:agent)",
  _produced_on: "2026-09-30",
  _why:
    "Three implementations sign the same pre-image; nothing forces them to agree on the encoding. " +
    "Signatures are compared BYTE FOR BYTE, not merely 'both verify', which is possible only " +
    "because ML-DSA signing randomness here is SHA256(label || msg) rather than random.",
  _chain:
    "The chain binding is part of the pre-image, so it is pinned here. The Rust side sets " +
    "TET_CHAIN_ID and TET_GENESIS_HASH to these values; a verifier on another chain must refuse.",
  chain: CHAIN,
  _mnemonics: "Standard BIP39 test vector, public by design. No real funds.",
  _level: "ML-DSA-44: 1312-byte public key, 2420-byte signature. Pinned, not inferred.",
  cases,
};
writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${OUT} (${cases.length} cases)`);
