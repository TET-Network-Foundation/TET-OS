/**
 * `AgentManifestV1` signing in the browser: an owner wallet's statement that an agent key is
 * theirs (docs/AGENT_IDENTITY.md). Byte-identical to tet-core `sign_agent_manifest`, which
 * `ui_signed_agent_manifest_is_byte_identical_in_rust` checks against the fixture
 * `tet-core/src/testdata/agent_manifest_v1.json` this module produces.
 */

import { agentManifestAuthMessageBytes, AGENT_MANIFEST_KIND } from "./verify_anything.mjs";
import { mnemonicToTetEd25519Keypair, signTetEd25519 } from "./ed25519_tet";
import { mldsa44KeypairFromMnemonic, mldsa44SignDeterministic } from "./pqc";
import { u8ToStdBase64 } from "./ai_infer_hybrid";

export type AgentManifestV1 = {
  v: 1;
  kind: string;
  agent_id: string;
  agent_ed25519_pubkey_hex: string;
  agent_mldsa44_pubkey_b64: string;
  owner_wallet_id: string;
  created_at_ms: number;
  expires_at_ms: number;
  declared_automated: boolean;
  capabilities: string[];
  hybrid_sig: {
    ed25519_pubkey_hex: string;
    ed25519_sig_b64: string;
    mldsa_pubkey_b64: string;
    mldsa_sig_b64: string;
  };
};

/** Sign a manifest for an agent key with the owner's 12 words. */
export async function signAgentManifest(opts: {
  ownerWords: string;
  chain: { chainId: string; genesisHash: string };
  agentId: string;
  agentEd25519PubkeyHex: string;
  agentMldsa44PubkeyB64: string;
  createdAtMs: number;
  expiresAtMs: number;
  declaredAutomated: boolean;
  capabilities: string[];
}): Promise<AgentManifestV1> {
  const ed = mnemonicToTetEd25519Keypair(opts.ownerWords);
  const owner = ed.walletIdHex.toLowerCase();
  const pqc = await mldsa44KeypairFromMnemonic(opts.ownerWords);
  const unsigned = {
    v: 1 as const,
    kind: AGENT_MANIFEST_KIND,
    agent_id: opts.agentId,
    agent_ed25519_pubkey_hex: opts.agentEd25519PubkeyHex.trim().toLowerCase(),
    agent_mldsa44_pubkey_b64: opts.agentMldsa44PubkeyB64.trim(),
    owner_wallet_id: owner,
    created_at_ms: opts.createdAtMs,
    expires_at_ms: opts.expiresAtMs,
    declared_automated: opts.declaredAutomated,
    capabilities: opts.capabilities,
  };
  const msg = agentManifestAuthMessageBytes(opts.chain, unsigned, pqc.pubkey_b64);
  return {
    ...unsigned,
    hybrid_sig: {
      ed25519_pubkey_hex: owner,
      ed25519_sig_b64: u8ToStdBase64(await signTetEd25519(ed.secretKey, msg)),
      mldsa_pubkey_b64: pqc.pubkey_b64,
      mldsa_sig_b64: await mldsa44SignDeterministic(pqc.keypair_b64, msg),
    },
  };
}
