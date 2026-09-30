/**
 * The client half of agent identity, against the same fixture `tet-core` verifies.
 *
 * Byte equality, not "both verify": every case asserts the exact signature bytes from
 * `agent_payload_envelopes.json`, so a divergence in the pre-image encoding between TypeScript and
 * Rust is a red test here rather than a signature a node rejects in production. That comparison is
 * only possible because ML-DSA signing randomness is SHA256(label ‖ msg) — see
 * docs/AGENT_IDENTITY.md on why that must not be randomised.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadHybridWalletFromMnemonic } from "../src/wallet_from_mnemonic.js";
import {
  TET_AGENT_KEYID_ED25519_PREFIX,
  TET_AGENT_KEYID_MLDSA44_PREFIX,
  TET_AGENT_PAYLOAD_DOMAIN_V1,
  agentPayloadAuthMessageBytes,
  buildSigEnvelope,
  chainBindingFromEnv,
  mldsa44KeyId,
  signPayloadEnvelope,
  tetSign,
  tetVerify,
  verifySigEnvelope,
  type TetAgentSigEnvelopeV1,
  type TetChainBinding,
} from "../src/agent.js";
import { buildAgentPayloadHeaders } from "../src/hybrid_infer.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = JSON.parse(
  readFileSync(
    join(repoRoot, "tet-core", "src", "testdata", "agent_payload_envelopes.json"),
    "utf8",
  ),
) as {
  chain: { chain_id: string; genesis_hash: string };
  cases: {
    mnemonic: string;
    payload_type: string;
    payload_b64: string;
    agent_wallet_id: string;
    ed25519_sig_b64: string;
    mldsa_sig_b64: string;
    envelope: TetAgentSigEnvelopeV1;
  }[];
};

const chain: TetChainBinding = {
  chainId: fixture.chain.chain_id,
  genesisHash: fixture.chain.genesis_hash,
};
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

describe("agent payload signing", () => {
  test("the fixture is not empty", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  test.each(fixture.cases.map((c, i) => [i, c] as const))(
    "case %i reproduces the fixture signature bytes",
    async (_i, c) => {
      const wallet = await loadHybridWalletFromMnemonic(c.mnemonic);
      const sig = await tetSign(wallet, c.payload_type, bytes(c.payload_b64), chain);
      expect(sig.ed25519_pubkey_hex).toBe(c.agent_wallet_id);
      expect(sig.ed25519_sig_b64).toBe(c.ed25519_sig_b64);
      expect(sig.mldsa_sig_b64).toBe(c.mldsa_sig_b64);
      expect(Buffer.from(sig.mldsa_pubkey_b64, "base64").length).toBe(1312);
      expect(Buffer.from(sig.mldsa_sig_b64, "base64").length).toBe(2420);
      await expect(tetVerify(sig, c.payload_type, bytes(c.payload_b64), chain)).resolves.toBe(true);
    },
  );

  test.each(fixture.cases.map((c, i) => [i, c] as const))(
    "case %i rebuilds the fixture envelope exactly",
    async (_i, c) => {
      const wallet = await loadHybridWalletFromMnemonic(c.mnemonic);
      const envelope = await signPayloadEnvelope(wallet, c.payload_type, bytes(c.payload_b64), chain);
      expect(envelope).toEqual(c.envelope);
      await expect(verifySigEnvelope(c.envelope, chain)).resolves.toEqual({ ok: true });
    },
  );
});

describe("what must be refused", () => {
  const c0 = () => fixture.cases[0]!;

  test("a tampered payload", async () => {
    const c = c0();
    const sig = {
      ed25519_pubkey_hex: c.agent_wallet_id,
      ed25519_sig_b64: c.ed25519_sig_b64,
      mldsa_pubkey_b64: c.envelope.tet.agent_mldsa44_pubkey_b64,
      mldsa_sig_b64: c.mldsa_sig_b64,
    };
    await expect(tetVerify(sig, c.payload_type, new TextEncoder().encode("tampered"), chain))
      .resolves.toBe(false);
  });

  test("a different payload_type over identical bytes", async () => {
    const c = c0();
    const sig = {
      ed25519_pubkey_hex: c.agent_wallet_id,
      ed25519_sig_b64: c.ed25519_sig_b64,
      mldsa_pubkey_b64: c.envelope.tet.agent_mldsa44_pubkey_b64,
      mldsa_sig_b64: c.mldsa_sig_b64,
    };
    await expect(tetVerify(sig, "application/json", bytes(c.payload_b64), chain)).resolves.toBe(false);
  });

  // Both chain fields, separately. They are redundant on the node (the genesis hash is derived from
  // the chain id) so a single combined assertion could not say which one was load-bearing — the
  // mistake that made `envelope_signed_against_a_different_genesis_hash_is_rejected` vacuous until
  // 2026-09-28.
  test("a different chain_id", async () => {
    const c = c0();
    await expect(
      verifySigEnvelope(c.envelope, { ...chain, chainId: "tet-other-chain" }),
    ).resolves.toEqual({ ok: false, reason: "signature verification failed" });
  });

  test("a different genesis_hash", async () => {
    const c = c0();
    await expect(
      verifySigEnvelope(c.envelope, { ...chain, genesisHash: "00".repeat(32) }),
    ).resolves.toEqual({ ok: false, reason: "signature verification failed" });
  });

  // BOTH halves are checked, each proven separately. A verifier that looked only at Ed25519 would
  // pass every test above, because a tampered payload breaks both signatures at once. These swap in
  // a *valid* signature from another case, so exactly one half is wrong and only a verifier that
  // checks that half can refuse it.
  test("a valid ML-DSA signature from another payload", async () => {
    const c = c0();
    const other = fixture.cases[1]!;
    expect(other.mldsa_sig_b64).not.toBe(c.mldsa_sig_b64);
    const sig = {
      ed25519_pubkey_hex: c.agent_wallet_id,
      ed25519_sig_b64: c.ed25519_sig_b64,
      mldsa_pubkey_b64: c.envelope.tet.agent_mldsa44_pubkey_b64,
      mldsa_sig_b64: other.mldsa_sig_b64,
    };
    await expect(tetVerify(sig, c.payload_type, bytes(c.payload_b64), chain)).resolves.toBe(false);
  });

  test("a valid Ed25519 signature from another payload", async () => {
    const c = c0();
    const other = fixture.cases[1]!;
    expect(other.ed25519_sig_b64).not.toBe(c.ed25519_sig_b64);
    const sig = {
      ed25519_pubkey_hex: c.agent_wallet_id,
      ed25519_sig_b64: other.ed25519_sig_b64,
      mldsa_pubkey_b64: c.envelope.tet.agent_mldsa44_pubkey_b64,
      mldsa_sig_b64: c.mldsa_sig_b64,
    };
    await expect(tetVerify(sig, c.payload_type, bytes(c.payload_b64), chain)).resolves.toBe(false);
  });

  // The strong level case — a VALID ML-DSA-65 pair — lives in Rust
  // (`agent_manifest_signed_with_a_valid_65_owner_key_is_refused`), because this package's only
  // signer is the 44-only wasm and cannot produce one.
  //
  // And to be accurate about what this one proves: the size pin here is fail-fast, not the only
  // defence. Measured 2026-09-30 — `mldsa44_verify_b64` returns false for a 1952-byte key rather
  // than throwing, so removing the pin does not make a 65 key acceptable. The pin's value is that
  // the refusal happens before any verification and for a stated reason.
  test("an ML-DSA key of the wrong size, before any verification", async () => {
    const c = c0();
    const sig = {
      ed25519_pubkey_hex: c.agent_wallet_id,
      ed25519_sig_b64: c.ed25519_sig_b64,
      mldsa_pubkey_b64: Buffer.alloc(1952).toString("base64"), // ML-DSA-65 sized
      mldsa_sig_b64: c.mldsa_sig_b64,
    };
    await expect(tetVerify(sig, c.payload_type, bytes(c.payload_b64), chain)).resolves.toBe(false);

    const shortSig = { ...sig, mldsa_pubkey_b64: c.envelope.tet.agent_mldsa44_pubkey_b64, mldsa_sig_b64: Buffer.alloc(3309).toString("base64") };
    await expect(tetVerify(shortSig, c.payload_type, bytes(c.payload_b64), chain)).resolves.toBe(false);
  });

  test("a keyid that names a key the envelope does not carry", async () => {
    const c = c0();
    const ed: TetAgentSigEnvelopeV1 = structuredClone(c.envelope);
    ed.signatures[0]!.keyid = `${TET_AGENT_KEYID_ED25519_PREFIX}${"ab".repeat(32)}`;
    await expect(verifySigEnvelope(ed, chain)).resolves.toEqual({
      ok: false,
      reason: "ed25519 keyid does not match the key it names",
    });

    const ml: TetAgentSigEnvelopeV1 = structuredClone(c.envelope);
    ml.signatures[1]!.keyid = `${TET_AGENT_KEYID_MLDSA44_PREFIX}${"cd".repeat(32)}`;
    await expect(verifySigEnvelope(ml, chain)).resolves.toEqual({
      ok: false,
      reason: "ml-dsa-44 keyid does not match the key it names",
    });
  });

  test("an envelope naming another pre-image encoding", async () => {
    const e: TetAgentSigEnvelopeV1 = structuredClone(c0().envelope);
    e.tet.pae = "DSSEv1";
    const r = await verifySigEnvelope(e, chain);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("unknown pre-image encoding");
  });

  // Two entries of one kind and none of the other: the COUNT is right and the SET is wrong. The
  // duplicate is caught on whichever lookup runs first, so the assertion names the error that
  // actually fires rather than the one that reads better.
  test("a duplicated signature set", async () => {
    const dupEd: TetAgentSigEnvelopeV1 = structuredClone(c0().envelope);
    dupEd.signatures[1] = { ...dupEd.signatures[0]! };
    const r1 = await verifySigEnvelope(dupEd, chain);
    expect(r1).toEqual({ ok: false, reason: "missing or duplicated ed25519 signature" });

    const dupMl: TetAgentSigEnvelopeV1 = structuredClone(c0().envelope);
    dupMl.signatures[0] = { ...dupMl.signatures[1]! };
    const r2 = await verifySigEnvelope(dupMl, chain);
    expect(r2).toEqual({ ok: false, reason: "missing or duplicated ed25519 signature" });
  });
});

describe("the encoding itself", () => {
  test("starts with the domain tag", () => {
    const out = agentPayloadAuthMessageBytes(chain, "text/plain", new Uint8Array([1, 2, 3]));
    expect(Buffer.from(out).subarray(0, TET_AGENT_PAYLOAD_DOMAIN_V1.length).toString()).toBe(
      TET_AGENT_PAYLOAD_DOMAIN_V1,
    );
  });

  // Inputs that CONTAIN the separator. Inputs that do not would pass with the length prefixes
  // removed, because the space between fields lands in a different place — measuring the separator
  // instead of the defence. See CLAUDE.md.
  test("is unambiguous across a field boundary that contains the separator", () => {
    const enc = (t: string, p: string) =>
      Buffer.from(agentPayloadAuthMessageBytes(chain, t, new TextEncoder().encode(p))).toString("hex");
    expect(enc("a", "b c")).not.toBe(enc("a b", "c"));
    expect(enc("one two", "three")).not.toBe(enc("one", "two three"));
    expect(enc("1 t", "abc")).not.toBe(enc("1", "t abc"));
    expect(enc("t", "3 abc ")).not.toBe(enc("t", "4 abc "));
  });

  test("matches the Rust encoding for every fixture case", async () => {
    // Implied by the signature equality above, but asserted directly so a failure says "the
    // encoding differs" rather than "a signature differs".
    for (const c of fixture.cases) {
      const wallet = await loadHybridWalletFromMnemonic(c.mnemonic);
      const sig = await tetSign(wallet, c.payload_type, bytes(c.payload_b64), chain);
      expect(buildSigEnvelope(sig, c.payload_type, bytes(c.payload_b64))).toEqual(c.envelope);
    }
  });
});

describe("configuration and transport", () => {
  test("the chain binding is never guessed", () => {
    expect(() => chainBindingFromEnv({} as NodeJS.ProcessEnv)).toThrow(/TET_CHAIN_ID/);
    expect(() => chainBindingFromEnv({ TET_CHAIN_ID: "x" } as NodeJS.ProcessEnv)).toThrow(
      /TET_GENESIS_HASH/,
    );
    expect(
      chainBindingFromEnv({ TET_CHAIN_ID: " x ", TET_GENESIS_HASH: " AB " } as NodeJS.ProcessEnv),
    ).toEqual({ chainId: "x", genesisHash: "ab" });
  });

  test("inline headers carry what a receiver needs to rebuild the pre-image", async () => {
    const c = fixture.cases[0]!;
    const wallet = await loadHybridWalletFromMnemonic(c.mnemonic);
    const h = await buildAgentPayloadHeaders(wallet, c.payload_type, bytes(c.payload_b64), chain);
    expect(h["x-tet-agent-payload-type"]).toBe(c.payload_type);
    expect(h["x-tet-ed25519-pubkey-hex"]).toBe(c.agent_wallet_id);
    expect(h["x-tet-ed25519-sig-b64"]).toBe(c.ed25519_sig_b64);
    expect(h["x-tet-mldsa-sig-b64"]).toBe(c.mldsa_sig_b64);
    expect(h["x-tet-mldsa-pubkey-b64"]).toBe(c.envelope.tet.agent_mldsa44_pubkey_b64);
  });

  test("the keyid is a hash of the key, not the key", () => {
    const pk = fixture.cases[0]!.envelope.tet.agent_mldsa44_pubkey_b64;
    const id = mldsa44KeyId(pk);
    expect(id.startsWith(TET_AGENT_KEYID_MLDSA44_PREFIX)).toBe(true);
    expect(id.length).toBe(TET_AGENT_KEYID_MLDSA44_PREFIX.length + 64);
    expect(id).not.toContain(pk.slice(0, 24));
  });
});
