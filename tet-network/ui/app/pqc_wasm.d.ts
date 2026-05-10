declare module "/pqc/tet_pqc_wasm.js" {
  const init: (module_or_path?: unknown) => Promise<void>;
  export default init;
  export function mldsa44_keypair_from_mnemonic_b64(mnemonic12: string): { pubkey_b64: string; keypair_b64: string };
  export function mldsa44_sign_deterministic_b64(keypair_b64: string, msg_bytes: Uint8Array): string;
  export function mldsa44_verify_b64(pubkey_b64: string, sig_b64: string, msg_bytes: Uint8Array): boolean;
}

