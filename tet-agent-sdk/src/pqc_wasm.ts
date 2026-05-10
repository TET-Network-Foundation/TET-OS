import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type PqcGlue = {
  default: (wasm?: unknown) => Promise<void>;
  initSync: (module: WebAssembly.Module | BufferSource) => unknown;
  mldsa44_keypair_from_mnemonic_b64: (mnemonic12: string) => { pubkey_b64: string; keypair_b64: string };
  mldsa44_sign_deterministic_b64: (keypair_b64: string, msgBytes: Uint8Array) => string;
};

let glue: PqcGlue | null = null;

function packageRootDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export async function ensurePqcWasmLoaded(): Promise<PqcGlue> {
  if (glue) return glue;
  const root = packageRootDir();
  const wasmPath = join(root, "vendor", "tet_pqc_wasm_bg.wasm");
  const bytes = readFileSync(wasmPath);
  const mod = (await import(pathToFileURL(join(root, "vendor", "tet_pqc_wasm.js")).href)) as PqcGlue;
  mod.initSync(bytes);
  glue = mod;
  return mod;
}

export async function mldsa44KeypairFromMnemonic(mnemonic12: string): Promise<{ pubkey_b64: string; keypair_b64: string }> {
  const m = await ensurePqcWasmLoaded();
  const phrase = mnemonic12.trim();
  if (!phrase) throw new Error("mnemonic empty");
  const out = m.mldsa44_keypair_from_mnemonic_b64(phrase);
  if (!out?.pubkey_b64 || !out?.keypair_b64) throw new Error("mldsa keygen failed");
  return { pubkey_b64: out.pubkey_b64, keypair_b64: out.keypair_b64 };
}

export async function mldsa44SignDeterministic(keypairB64: string, msg: Uint8Array): Promise<string> {
  const m = await ensurePqcWasmLoaded();
  return m.mldsa44_sign_deterministic_b64(keypairB64, msg);
}
