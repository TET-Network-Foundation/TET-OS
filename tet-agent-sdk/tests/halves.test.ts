/**
 * A record cut down to one signature half is refused by `verifySigEnvelope`.
 *
 * The signer always makes both halves, so a verifier that only requires "every half that is present
 * verifies" would accept a record with one half cut away. `agent_halves_v1.json` is one record signed
 * by `tet-cli agent sign` and that record with exactly ONE half removed, emptied or relabelled
 * (tet-cli/scripts/make_halves_fixture.py). tet-core, tet-cli and the offline verifier read the same
 * file.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Through the package entry, as a user imports it: `src/agent.js` alone does not set up Ed25519's
// SHA-512 (src/wallet_from_mnemonic.ts does), and then refuses every record, valid ones included.
import { verifySigEnvelope, type TetAgentSigEnvelopeV1, type TetChainBinding } from "../src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const doc = JSON.parse(
  readFileSync(join(repoRoot, "tet-core", "src", "testdata", "agent_halves_v1.json"), "utf8"),
) as {
  chain: { chain_id: string; genesis_hash: string };
  base: TetAgentSigEnvelopeV1;
  cases: { name: string; envelope: TetAgentSigEnvelopeV1 }[];
};
const chain: TetChainBinding = { chainId: doc.chain.chain_id, genesisHash: doc.chain.genesis_hash };

// The reason each case must be refused for. The two emptied cases share the SDK's one wording for a
// failed signature; that each is refused on its own half is what the per-case runs show.
const reasons: Record<string, string> = {
  ed25519_only: "expected exactly 2 signatures, got 1",
  mldsa44_only: "expected exactly 2 signatures, got 1",
  ed25519_sig_empty: "signature verification failed",
  mldsa44_sig_empty: "signature verification failed",
  ed25519_label_changed: "missing or duplicated ed25519 signature",
  mldsa44_label_changed: "missing or duplicated ml-dsa-44 signature",
};

describe("a record cut to one signature half", () => {
  test("the uncut record verifies, so the refusals below are about the cut", async () => {
    expect(await verifySigEnvelope(doc.base, chain)).toEqual({ ok: true });
  });

  test("the fixture holds exactly the pinned cases", () => {
    expect(doc.cases.map((c) => c.name)).toEqual(Object.keys(reasons));
  });

  test.each(Object.keys(reasons))("%s is refused for its own reason", async (name) => {
    const c = doc.cases.find((x) => x.name === name)!;
    expect(await verifySigEnvelope(c.envelope, chain)).toEqual({ ok: false, reason: reasons[name] });
  });
});
