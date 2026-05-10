type PqcWasmModule = {
  default: (wasmPath: string) => Promise<void>;
  mldsa44_keypair_from_mnemonic_b64: (mnemonic12: string) => { pubkey_b64: string; keypair_b64: string };
  mldsa44_sign_deterministic_b64: (keypair_b64: string, msgBytes: Uint8Array) => string;
};

let initPromise: Promise<PqcWasmModule> | null = null;

export async function pqcInit(): Promise<PqcWasmModule> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const importer = new Function('return import("/pqc/tet_pqc_wasm.js")') as () => Promise<PqcWasmModule>;
    const mod = await importer();
    await mod.default("/pqc/tet_pqc_wasm_bg.wasm");
    return mod;
  })();
  return initPromise;
}

/**
 * Derive ML-DSA-44 key material from a BIP39 12-word phrase (WASM).
 * @throws Error with message suitable for UI — empty phrase or invalid mnemonic (no dev fallback).
 */
export async function mldsa44KeypairFromMnemonic(mnemonic12: string): Promise<{ pubkey_b64: string; keypair_b64: string }> {
  const phrase = mnemonic12.trim();
  if (!phrase) {
    throw new Error("No Wallet: mnemonic is empty.");
  }
  const m = await pqcInit();
  try {
    const out = m.mldsa44_keypair_from_mnemonic_b64(phrase);
    if (!out?.pubkey_b64 || !out?.keypair_b64) {
      throw new Error("mldsa keygen failed");
    }
    return { pubkey_b64: out.pubkey_b64, keypair_b64: out.keypair_b64 };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const low = msg.toLowerCase();
    if (low.includes("invalid") || low.includes("mnemonic") || low.includes("bip39")) {
      throw new Error(`Invalid Mnemonic: ${msg}`);
    }
    throw new Error(`Invalid Mnemonic: ML-DSA keygen failed (${msg})`);
  }
}

export async function mldsa44SignDeterministic(keypair_b64: string, msgBytes: Uint8Array): Promise<string> {
  const m = await pqcInit();
  return m.mldsa44_sign_deterministic_b64(keypair_b64, msgBytes);
}
