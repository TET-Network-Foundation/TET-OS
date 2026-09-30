/**
 * The agent SDK must derive the SAME hybrid identity as the node, the browser wallet and the UI.
 *
 * Until 2026-09-30 it did not: `@polkadot/keyring`'s `addFromMnemonic` derives Ed25519 from the
 * substrate mini-secret (PBKDF2 over the mnemonic ENTROPY, salt "mnemonic"), not from the BIP39
 * seed (PBKDF2 over the mnemonic PHRASE) that every other TET implementation uses. The same
 * mnemonic therefore produced two different wallets, and nothing rejected either one, because each
 * half was internally consistent.
 *
 * So this asserts byte equality against a fixture the node also verifies, not merely that signing
 * succeeds. Signing succeeding is exactly what the bug did.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadHybridWalletFromMnemonic } from "../src/wallet_from_mnemonic.js";
import { mldsa44SignDeterministic } from "../src/pqc_wasm.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const testdata = join(repoRoot, "tet-core", "src", "testdata");

type Case = {
  mnemonic: string;
  wallet_id: string;
  mldsa_pubkey_b64: string;
  message_utf8: string;
  ed25519_sig_b64: string;
  mldsa_sig_b64: string;
};

const fixture = JSON.parse(
  readFileSync(join(testdata, "agent_sdk_hybrid_sigs.json"), "utf8"),
) as { cases: Case[] };
const browser = JSON.parse(
  readFileSync(join(testdata, "browser_wallet_hybrid_sigs.json"), "utf8"),
) as { cases: { wallet_id: string; mldsa_pubkey_b64: string }[] };

/** What the removed `@polkadot/keyring` derivation produced for `cases[0].mnemonic`. */
const SUBSTRATE_MINI_SECRET_WALLET_ID =
  "9125f505bdef2cb5825b9931769316d3e2f22150786489a04f39b434ec9fb294";

const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");

describe("hybrid derivation matches the rest of TET", () => {
  test("fixtures are not empty", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(browser.cases.length).toBe(fixture.cases.length);
  });

  test.each(fixture.cases.map((c, i) => [i, c] as const))(
    "case %i derives the canonical wallet id and ML-DSA-44 key",
    async (i, c) => {
      const w = await loadHybridWalletFromMnemonic(c.mnemonic);

      expect(w.walletIdHex64).toBe(c.wallet_id);
      expect(w.mldsa44PubkeyB64).toBe(c.mldsa_pubkey_b64);

      // The browser wallet (wallet_client_bundled.js) derived these from the same vectors.
      expect(w.walletIdHex64).toBe(browser.cases[i]!.wallet_id);
      expect(w.mldsa44PubkeyB64).toBe(browser.cases[i]!.mldsa_pubkey_b64);

      // ML-DSA-44, pinned by size rather than trusted from the name.
      expect(Buffer.from(w.mldsa44PubkeyB64, "base64").length).toBe(1312);
    },
  );

  test.each(fixture.cases.map((c, i) => [i, c] as const))(
    "case %i reproduces both signature halves byte for byte",
    async (i, c) => {
      const w = await loadHybridWalletFromMnemonic(c.mnemonic);
      const msg = new TextEncoder().encode(c.message_utf8);

      expect(b64(w.signEd25519(msg))).toBe(c.ed25519_sig_b64);
      expect(await mldsa44SignDeterministic(w.mldsa44KeypairB64, msg)).toBe(c.mldsa_sig_b64);
      expect(Buffer.from(c.mldsa_sig_b64, "base64").length).toBe(2420);
    },
  );

  test("the substrate mini-secret wallet id can never come back", async () => {
    const w = await loadHybridWalletFromMnemonic(fixture.cases[0]!.mnemonic);
    expect(w.walletIdHex64).not.toBe(SUBSTRATE_MINI_SECRET_WALLET_ID);
  });
});
