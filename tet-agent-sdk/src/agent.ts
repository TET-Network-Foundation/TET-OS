/**
 * Agent identity, client half. Mirrors `tet-core/src/agent.rs` byte for byte.
 *
 * `tetSign` is a GENERIC signer: it signs whatever bytes it is given. That is the dangerous thing in
 * this feature, and the encoding is what makes it safe — a generic signer with no domain separation
 * is a signing oracle, and a payload that happened to equal a transfer pre-image would turn an agent
 * key into a spending key. So the bytes are length-prefixed under a fixed domain tag, with the chain
 * bound in:
 *
 *   tet agent payload v1 <len> <chain_id> <len> <genesis_hash> <len> <payload_type> <len> <payload>
 *
 * each field written `<decimal length> SP <bytes> SP`. See `docs/AGENT_IDENTITY.md`.
 *
 * The chain binding is NOT guessed here. `tet-core` can derive a genesis hash from its treasury
 * configuration; this package cannot, and a wrong guess would produce signatures that verify
 * nowhere while looking fine. So both values are required, from options or from the environment.
 */
import { sha256 } from "@noble/hashes/sha2";
import * as ed from "@noble/ed25519";

import { mldsa44SignDeterministic, ensurePqcWasmLoaded } from "./pqc_wasm.js";
import type { HybridKeyMaterial } from "./types.js";
import { u8ToStdBase64 } from "./encoding.js";

/** Domain tag every agent-signed pre-image starts with. */
export const TET_AGENT_PAYLOAD_DOMAIN_V1 = "tet agent payload v1";
export const TET_AGENT_KEYID_ED25519_PREFIX = "tet-ed25519:";
export const TET_AGENT_KEYID_MLDSA44_PREFIX = "tet-mldsa44:";
export const TET_MLDSA44_PUBKEY_BYTES = 1312;
export const TET_MLDSA44_SIG_BYTES = 2420;
export const TET_ED25519_SIG_BYTES = 64;

export type TetChainBinding = {
  chainId: string;
  genesisHash: string;
};

export type TetAgentSignature = {
  ed25519_pubkey_hex: string;
  ed25519_sig_b64: string;
  mldsa_pubkey_b64: string;
  mldsa_sig_b64: string;
};

export type DsseSignature = { keyid: string; sig: string };

export type TetAgentSigEnvelopeV1 = {
  payloadType: string;
  /** Standard base64 of the raw payload bytes, per DSSE. */
  payload: string;
  signatures: DsseSignature[];
  tet: {
    v: 1;
    pae: string;
    agent_ed25519_pubkey_hex: string;
    agent_mldsa44_pubkey_b64: string;
  };
};

/**
 * Read the chain binding from `TET_CHAIN_ID` and `TET_GENESIS_HASH`.
 *
 * Throws when either is missing rather than defaulting. `tet-core`'s dev fallback derives the genesis
 * hash from its own configuration; reimplementing that here would be a second source of truth for a
 * value that silently decides whether a signature is valid anywhere.
 */
export function chainBindingFromEnv(env: NodeJS.ProcessEnv = process.env): TetChainBinding {
  const chainId = String(env.TET_CHAIN_ID ?? "").trim();
  const genesisHash = String(env.TET_GENESIS_HASH ?? "").trim().toLowerCase();
  if (!chainId || !genesisHash) {
    throw new Error(
      "TET_CHAIN_ID and TET_GENESIS_HASH are both required to sign as an agent. " +
        "They are not guessed: a wrong genesis hash produces signatures that verify nowhere. " +
        "Read them from the node you sign against.",
    );
  }
  return { chainId, genesisHash };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const SP = new Uint8Array([0x20]);

/** `<len> SP <field> SP` for each field. The length prefix is what makes the encoding unambiguous. */
function paeFields(fields: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of fields) {
    parts.push(utf8(String(f.length)), SP, f, SP);
  }
  return concat(parts);
}

/** The exact bytes an agent key signs. Mirrors `agent::agent_payload_auth_message_bytes`. */
export function agentPayloadAuthMessageBytes(
  chain: TetChainBinding,
  payloadType: string,
  payload: Uint8Array,
): Uint8Array {
  return concat([
    utf8(TET_AGENT_PAYLOAD_DOMAIN_V1),
    SP,
    paeFields([utf8(chain.chainId), utf8(chain.genesisHash), utf8(payloadType.trim()), payload]),
  ]);
}

/** Hybrid-sign arbitrary bytes. Byte-identical to `agent::sign_agent_payload` for the same input. */
export async function tetSign(
  wallet: HybridKeyMaterial,
  payloadType: string,
  payload: Uint8Array,
  chain: TetChainBinding,
): Promise<TetAgentSignature> {
  const msg = agentPayloadAuthMessageBytes(chain, payloadType, payload);
  return {
    ed25519_pubkey_hex: wallet.walletIdHex64.trim().toLowerCase(),
    ed25519_sig_b64: u8ToStdBase64(wallet.signEd25519(msg)),
    mldsa_pubkey_b64: wallet.mldsa44PubkeyB64,
    mldsa_sig_b64: await mldsa44SignDeterministic(wallet.mldsa44KeypairB64, msg),
  };
}

function b64Len(s: string): number {
  return Buffer.from(s, "base64").length;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("expected 64 lowercase hex chars");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Verify a hybrid agent signature. **Both halves must verify, at ML-DSA-44 specifically.**
 *
 * The level is pinned by size before anything is verified, exactly as `verify_mldsa44_b64` does in
 * Rust. The wasm verifier would happily check a consistent ML-DSA-65 pair, which no wallet on the
 * network can produce or use.
 */
export async function tetVerify(
  sig: TetAgentSignature,
  payloadType: string,
  payload: Uint8Array,
  chain: TetChainBinding,
): Promise<boolean> {
  if (b64Len(sig.mldsa_pubkey_b64) !== TET_MLDSA44_PUBKEY_BYTES) return false;
  if (b64Len(sig.mldsa_sig_b64) !== TET_MLDSA44_SIG_BYTES) return false;
  if (b64Len(sig.ed25519_sig_b64) !== TET_ED25519_SIG_BYTES) return false;

  const msg = agentPayloadAuthMessageBytes(chain, payloadType, payload);
  let edOk: boolean;
  try {
    edOk = ed.verify(
      new Uint8Array(Buffer.from(sig.ed25519_sig_b64, "base64")),
      msg,
      hexToBytes(sig.ed25519_pubkey_hex),
    );
  } catch {
    return false;
  }
  if (!edOk) return false;

  const glue = await ensurePqcWasmLoaded();
  return glue.mldsa44_verify_b64(sig.mldsa_pubkey_b64, sig.mldsa_sig_b64, msg) === true;
}

/** `tet-mldsa44:<sha256 hex of the raw public key>` — a 1312-byte key does not belong in an id. */
export function mldsa44KeyId(pubkeyB64: string): string {
  const raw = new Uint8Array(Buffer.from(pubkeyB64.trim(), "base64"));
  return `${TET_AGENT_KEYID_MLDSA44_PREFIX}${Buffer.from(sha256(raw)).toString("hex")}`;
}

/**
 * Wrap a signature in a detached envelope, written next to the artefact as `<name>.sig.json`.
 *
 * DSSE's shape, so the structure is familiar. The signed bytes are TET's PAE, not DSSE's, which is
 * why `tet.pae` names the encoding: a standard DSSE verifier computes a different pre-image and
 * rejects, and that is the right outcome rather than a surprise.
 *
 * No chain identity is carried. A verifier that read `chain_id` from the file it is checking would
 * verify every file against whatever chain that file names, which is not a check.
 */
export function buildSigEnvelope(
  sig: TetAgentSignature,
  payloadType: string,
  payload: Uint8Array,
): TetAgentSigEnvelopeV1 {
  const edHex = sig.ed25519_pubkey_hex.trim().toLowerCase();
  return {
    payloadType: payloadType.trim(),
    payload: u8ToStdBase64(payload),
    signatures: [
      { keyid: `${TET_AGENT_KEYID_ED25519_PREFIX}${edHex}`, sig: sig.ed25519_sig_b64 },
      { keyid: mldsa44KeyId(sig.mldsa_pubkey_b64), sig: sig.mldsa_sig_b64 },
    ],
    tet: {
      v: 1,
      pae: TET_AGENT_PAYLOAD_DOMAIN_V1,
      agent_ed25519_pubkey_hex: edHex,
      agent_mldsa44_pubkey_b64: sig.mldsa_pubkey_b64.trim(),
    },
  };
}

/** Sign and wrap in one step. */
export async function signPayloadEnvelope(
  wallet: HybridKeyMaterial,
  payloadType: string,
  payload: Uint8Array,
  chain: TetChainBinding,
): Promise<TetAgentSigEnvelopeV1> {
  return buildSigEnvelope(await tetSign(wallet, payloadType, payload, chain), payloadType, payload);
}

/**
 * Verify a detached envelope against the caller's chain binding.
 *
 * Returns a reason on failure rather than a bare boolean, so a caller can say WHY it refused — the
 * habit that keeps "unverifiable" from being reported as something else.
 */
export async function verifySigEnvelope(
  envelope: TetAgentSigEnvelopeV1,
  chain: TetChainBinding,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const e = envelope as Partial<TetAgentSigEnvelopeV1>;
  if (!e.tet || e.tet.v !== 1) return { ok: false, reason: "unsupported envelope version" };
  if (e.tet.pae !== TET_AGENT_PAYLOAD_DOMAIN_V1) {
    return { ok: false, reason: `unknown pre-image encoding ${JSON.stringify(e.tet.pae)}` };
  }
  if (typeof e.payloadType !== "string" || !e.payloadType.trim()) {
    return { ok: false, reason: "empty payloadType" };
  }
  if (!Array.isArray(e.signatures) || e.signatures.length !== 2) {
    return { ok: false, reason: `expected exactly 2 signatures, got ${e.signatures?.length ?? 0}` };
  }
  const pick = (prefix: string, what: string) => {
    const hits = e.signatures!.filter((s) => typeof s?.keyid === "string" && s.keyid.startsWith(prefix));
    if (hits.length !== 1) throw new Error(`missing or duplicated ${what} signature`);
    return hits[0]!;
  };
  let edSig: DsseSignature;
  let mlSig: DsseSignature;
  try {
    edSig = pick(TET_AGENT_KEYID_ED25519_PREFIX, "ed25519");
    mlSig = pick(TET_AGENT_KEYID_MLDSA44_PREFIX, "ml-dsa-44");
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const edHex = String(e.tet.agent_ed25519_pubkey_hex ?? "").trim().toLowerCase();
  if (edSig.keyid !== `${TET_AGENT_KEYID_ED25519_PREFIX}${edHex}`) {
    return { ok: false, reason: "ed25519 keyid does not match the key it names" };
  }
  if (mlSig.keyid !== mldsa44KeyId(String(e.tet.agent_mldsa44_pubkey_b64 ?? ""))) {
    return { ok: false, reason: "ml-dsa-44 keyid does not match the key it names" };
  }

  const payload = new Uint8Array(Buffer.from(String(e.payload ?? ""), "base64"));
  const ok = await tetVerify(
    {
      ed25519_pubkey_hex: edHex,
      ed25519_sig_b64: edSig.sig,
      mldsa_pubkey_b64: String(e.tet.agent_mldsa44_pubkey_b64),
      mldsa_sig_b64: mlSig.sig,
    },
    e.payloadType,
    payload,
    chain,
  );
  return ok ? { ok: true } : { ok: false, reason: "signature verification failed" };
}
