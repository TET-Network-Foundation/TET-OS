// Writes tet-core/src/testdata/agent_manifest_v1.json: a manifest signed by the UI's own code
// (`app/lib/agent_manifest.ts`), which tet-core must reproduce byte for byte and accept
// (`ui_signed_agent_manifest_is_byte_identical_in_rust`), and which the verify page's guard must
// accept too. One file, three implementations agreeing on it.
//
//   node --experimental-strip-types scripts/make_agent_manifest_fixture.mjs
//
// Deterministic: fixed mnemonics (BIP39 test vectors), fixed times, and ML-DSA signing randomness
// derived from the message, so re-running it must reproduce the committed file exactly.

import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

register("./lib/ts_hooks.mjs", import.meta.url);

const { signAgentManifest } = await import("../app/lib/agent_manifest.ts");
const { mnemonicToTetEd25519Keypair } = await import("../app/lib/ed25519_tet.ts");
const { mldsa44KeypairFromMnemonic } = await import("../app/lib/pqc.ts");

const envelopes = JSON.parse(readFileSync(new URL("../../../tet-core/src/testdata/agent_payload_envelopes.json", import.meta.url), "utf8"));
const chain = { chainId: envelopes.chain.chain_id, genesisHash: envelopes.chain.genesis_hash };

const AGENT = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const OWNER = "legal winner thank year wave sausage worth useful legal winner thank yellow";

const agentEd = mnemonicToTetEd25519Keypair(AGENT).walletIdHex;
const agentPq = await mldsa44KeypairFromMnemonic(AGENT);
const manifest = await signAgentManifest({
  ownerWords: OWNER,
  chain,
  agentId: "fixture-agent ✓",
  agentEd25519PubkeyHex: agentEd,
  agentMldsa44PubkeyB64: agentPq.pubkey_b64,
  createdAtMs: 1_790_000_000_000,
  expiresAtMs: 4_102_444_800_000,
  declaredAutomated: true,
  capabilities: ["sign:devlog", "ask:questions"],
});

const doc = {
  _what: "An AgentManifestV1 signed by the UI (tet-network/ui/app/lib/agent_manifest.ts).",
  _produced_by: "tet-network/ui/scripts/make_agent_manifest_fixture.mjs",
  _why:
    "The verify page checks manifests in the browser and tet-core checks them in Rust. tet-core re-signs this manifest and compares the signatures byte for byte, then verifies it; the UI guard verifies it too.",
  _mnemonics: "Standard BIP39 test vectors, public by design. No real funds.",
  chain: envelopes.chain,
  owner_mnemonic: OWNER,
  agent_mnemonic: AGENT,
  verify_at_ms: 1_800_000_000_000,
  manifest,
};
const out = new URL("../../../tet-core/src/testdata/agent_manifest_v1.json", import.meta.url);
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote ${out.pathname}`);
