/**
 * Every refusal in `verifySigEnvelope` / `tetVerify` that no other test reaches on its own.
 *
 * Each case starts from a valid envelope in the shared fixture (`agent_payload_envelopes.json`) and
 * changes one thing, so that every check before the one under test passes; each asserts the exact
 * reason. Negative controls (by hand, recorded in the commit): each check below removed in turn makes
 * its case fail.
 *
 * Not here, on purpose: the size pins in `tetVerify` (ML-DSA key, ML-DSA signature, Ed25519
 * signature). They refuse before any verification, but the verification behind them refuses the same
 * inputs, and `tetVerify` returns a bare boolean, so no input can tell the pin from the check behind
 * it. Removing a pin leaves this package's behaviour unchanged; the pins are fail-fast, not a defence
 * of their own.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Loads Ed25519's SHA-512 the way the package entry does, so a refusal below is never a missing hash.
import "../src/wallet_from_mnemonic.js";
import {
  tetVerify,
  verifySigEnvelope,
  type TetAgentSigEnvelopeV1,
  type TetChainBinding,
} from "../src/agent.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = JSON.parse(
  readFileSync(join(repoRoot, "tet-core", "src", "testdata", "agent_payload_envelopes.json"), "utf8"),
) as {
  chain: { chain_id: string; genesis_hash: string };
  cases: {
    payload_type: string;
    payload_b64: string;
    agent_wallet_id: string;
    ed25519_sig_b64: string;
    mldsa_sig_b64: string;
    envelope: TetAgentSigEnvelopeV1;
  }[];
};
const chain: TetChainBinding = { chainId: fixture.chain.chain_id, genesisHash: fixture.chain.genesis_hash };
const c0 = () => fixture.cases[0]!;
const env0 = (): TetAgentSigEnvelopeV1 => structuredClone(c0().envelope);
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

describe("verifySigEnvelope: each refusal for its own reason", () => {
  test("baseline: the fixture envelope verifies", async () => {
    await expect(verifySigEnvelope(env0(), chain)).resolves.toEqual({ ok: true });
  });

  test("another envelope version", async () => {
    const e = env0();
    (e.tet as { v: number }).v = 2;
    await expect(verifySigEnvelope(e, chain)).resolves.toEqual({ ok: false, reason: "unsupported envelope version" });
  });

  test("a blank payloadType", async () => {
    const e = env0();
    e.payloadType = "   ";
    await expect(verifySigEnvelope(e, chain)).resolves.toEqual({ ok: false, reason: "empty payloadType" });
  });

  // A third entry that is a copy of the ML-DSA one: with the count check gone, the set check would
  // still refuse, but for a different reason, which is what this asserts against.
  test("three signatures", async () => {
    const e = env0();
    e.signatures.push({ ...e.signatures[1]! });
    await expect(verifySigEnvelope(e, chain)).resolves.toEqual({
      ok: false,
      reason: "expected exactly 2 signatures, got 3",
    });
  });
});

describe("tetVerify: an Ed25519 half that cannot be checked is a refusal", () => {
  test("baseline: the fixture signature verifies", async () => {
    const c = c0();
    const sig = {
      ed25519_pubkey_hex: c.agent_wallet_id,
      ed25519_sig_b64: c.ed25519_sig_b64,
      mldsa_pubkey_b64: c.envelope.tet.agent_mldsa44_pubkey_b64,
      mldsa_sig_b64: c.mldsa_sig_b64,
    };
    await expect(tetVerify(sig, c.payload_type, bytes(c.payload_b64), chain)).resolves.toBe(true);
  });

  // The ML-DSA half is valid, so only the Ed25519 half can refuse; its key is not hex, so checking it
  // throws rather than returning false. A throw must count as "does not verify".
  test("an Ed25519 key that is not hex, with a valid ML-DSA half", async () => {
    const c = c0();
    const sig = {
      ed25519_pubkey_hex: "zz".repeat(32),
      ed25519_sig_b64: c.ed25519_sig_b64,
      mldsa_pubkey_b64: c.envelope.tet.agent_mldsa44_pubkey_b64,
      mldsa_sig_b64: c.mldsa_sig_b64,
    };
    await expect(tetVerify(sig, c.payload_type, bytes(c.payload_b64), chain)).resolves.toBe(false);
  });
});
