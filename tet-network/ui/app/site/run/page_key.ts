/**
 * "Run it": a fresh test key, made in the visitor's tab, and the signing it does. No new cryptography:
 * the 12 words come from lib/bip39_12 (standard BIP-39), Ed25519 from lib/ed25519_tet (tet-core's
 * derivation, held to it by scripts/browser_signing_parity_guard.mjs), ML-DSA-44 from the committed
 * WASM signer through lib/pqc. The envelope is the one lib/sign_anything signs, with this key instead
 * of the tab's wallet, over the same agent-payload pre-image (lib/verify_anything).
 *
 * The 12 words never leave makeTestKey: only the derived keys are kept, in memory, for one run. The
 * chain is an example no node runs, so nothing signed here is valid anywhere else.
 */
import { sha256 } from "@noble/hashes/sha2";
import { generateMnemonic12 } from "../../lib/bip39_12";
import { bytesToHex, mnemonicToTetEd25519Keypair, signTetEd25519 } from "../../lib/ed25519_tet";
import { mldsa44KeypairFromMnemonic, mldsa44SignDeterministic, mldsa44Verify } from "../../lib/pqc";
import { agentPayloadAuthMessageBytes, ED_PREFIX, mldsa44KeyId, PAE_DOMAIN, verifyEnvelope } from "../../lib/verify_anything.mjs";
import { checkMachineLog } from "../../lib/machine_log.mjs";

export type Chain = { chainId: string; genesisHash: string };
export type Envelope = {
  payloadType: string;
  payload: string;
  signatures: { keyid: string; sig: string }[];
  tet: { v: 1; pae: string; agent_ed25519_pubkey_hex: string; agent_mldsa44_pubkey_b64: string };
};

/** The binding every run signs for: plainly an example, no node runs it. */
export const RUN_CHAIN: Chain = {
  chainId: "tet-example-site-run",
  genesisHash: bytesToHex(sha256(new TextEncoder().encode("tet site run it"))),
};

export type TestKey = {
  /** tet-ed25519:<hex>, as notebook.py's device.keyid. */
  keyid: string;
  edHex: string;
  mlPubB64: string;
  sign: (msg: Uint8Array) => (Promise<{ ed: Uint8Array; ml: string }>);
};

/** A new key from fresh 12 words. The words are dropped before this returns. */
export async function makeTestKey(): Promise<TestKey> {
  const { mnemonic12 } = await generateMnemonic12();
  const ed = mnemonicToTetEd25519Keypair(mnemonic12);
  const ml = await mldsa44KeypairFromMnemonic(mnemonic12);
  const secret = ed.secretKey;
  return {
    keyid: `${ED_PREFIX}${ed.walletIdHex}`,
    edHex: ed.walletIdHex,
    mlPubB64: ml.pubkey_b64,
    sign: async (msg) => ({ ed: await signTetEd25519(secret, msg), ml: await mldsa44SignDeterministic(ml.keypair_b64, msg) }),
  };
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** `tet-cli agent sign`'s envelope over `content`, signed by `key` for `chain`. */
export async function signEnvelope(key: TestKey, chain: Chain, payloadType: string, content: Uint8Array): Promise<Envelope> {
  const msg = agentPayloadAuthMessageBytes(chain, payloadType, content);
  const s = await key.sign(msg);
  return {
    payloadType,
    payload: b64(content),
    signatures: [
      { keyid: key.keyid, sig: b64(s.ed) },
      { keyid: mldsa44KeyId(key.mlPubB64), sig: s.ml },
    ],
    tet: { v: 1, pae: PAE_DOMAIN, agent_ed25519_pubkey_hex: key.edHex, agent_mldsa44_pubkey_b64: key.mlPubB64 },
  };
}

/**
 * The checkers a run calls. Every run takes them as a parameter so a guard can swap one for a fake and
 * see the run's output change (scripts/site_run_guard.mjs): a run that printed the same with a fake
 * checker would not be running the real one.
 */
export type Checkers = {
  checkMachineLog: typeof checkMachineLog;
  verifyEnvelope: typeof verifyEnvelope;
  mldsa44Verify: (pub: string, sig: string, msg: Uint8Array) => (Promise<boolean>);
};

export const REAL_CHECKERS: Checkers = { checkMachineLog, verifyEnvelope, mldsa44Verify };

/** A short form of a key id for a console line: the prefix and the first 12 hex digits. */
export const shortKey = (keyid: string) => (keyid.length > 30 ? `${keyid.slice(0, 24)}…` : keyid);
