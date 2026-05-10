import { b64ToBytes, bytesToB64, bytesToHex } from "./encoding";

const LS_VAULT = "tet.vault.v1";
const PIN_SALT_BYTES = 16;
const GCM_IV_BYTES = 12;
const PBKDF2_ITERS = 150_000;

export type VaultRecordV1 = {
  v: 1;
  created_at_ms: number;
  wallet_id_hex: string;

  // mnemonic encrypted by PIN
  salt_b64: string;
  mnemonic_iv_b64: string;
  mnemonic_ct_b64: string;

  // ed25519 keys encrypted by PIN (pkcs8)
  pkcs8_iv_b64: string;
  pkcs8_ct_b64: string;

  // public key in clear (spki) for wallet id derivation + verify
  spki_b64: string;

  // ML-DSA-44 (PQC) keys: public key is clear, keypair bytes are encrypted by PIN.
  mldsa44_pubkey_b64?: string;
  mldsa44_keypair_iv_b64?: string;
  mldsa44_keypair_ct_b64?: string;
};

export type UnlockedVault = {
  record: VaultRecordV1;
  mnemonic12: string;
  walletIdHex: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  mldsa44_pubkey_b64: string;
  mldsa44_keypair_b64: string;
};

function nowMs(): number {
  return Date.now();
}

function isMasterPassword(pw: string): boolean {
  const s = (pw ?? "").trim();
  if (s.length < 8) return false;
  if (!/[0-9]/.test(s)) return false; // require a digit
  if (!/[a-zA-Z]/.test(s)) return false; // require a letter
  if (/^(.)\1+$/.test(s)) return false; // reject repeated single char

  const lower = s.toLowerCase();
  const banned = ["password", "admin", "qazwsx", "123456", "tet", "qwerty", "letmein"];
  if (banned.some((w) => lower.includes(w))) return false;

  if (/12345|23456|34567|45678|56789|01234/.test(lower)) return false;
  if (/abcde|bcdef|cdefg|defgh|efghi/.test(lower)) return false;

  return true;
}

async function deriveAesKeyFromMasterPassword(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const saltBuf = salt.buffer as ArrayBuffer;
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuf.slice(salt.byteOffset, salt.byteOffset + salt.byteLength),
      iterations: PBKDF2_ITERS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function aesGcmEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
  const iv = new Uint8Array(GCM_IV_BYTES);
  crypto.getRandomValues(iv);
  const ivBuf = iv.buffer as ArrayBuffer;
  const ptBuf = plaintext.buffer as ArrayBuffer;
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBuf.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) },
    key,
    ptBuf.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength),
  );
  return { iv, ct: new Uint8Array(ct) };
}

async function aesGcmDecrypt(key: CryptoKey, iv: Uint8Array, ct: Uint8Array): Promise<Uint8Array> {
  const ivBuf = iv.buffer as ArrayBuffer;
  const ctBuf = ct.buffer as ArrayBuffer;
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuf.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) },
    key,
    ctBuf.slice(ct.byteOffset, ct.byteOffset + ct.byteLength),
  );
  return new Uint8Array(pt);
}

function spkiToEd25519Pubkey32(spki: Uint8Array): Uint8Array {
  for (let i = 0; i + 3 + 32 <= spki.length; i++) {
    if (spki[i] === 0x03 && spki[i + 1] === 0x21 && spki[i + 2] === 0x00) return spki.slice(i + 3, i + 3 + 32);
  }
  return spki.slice(-32);
}

export function vaultExists(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(LS_VAULT);
}

export function clearVault(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LS_VAULT);
}

export function readVaultRecord(): VaultRecordV1 | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LS_VAULT);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as VaultRecordV1;
    if (j?.v !== 1) return null;
    return j;
  } catch {
    return null;
  }
}

export async function createVault(): Promise<never> {
  throw new Error("createVault is deprecated; use /setup with PQC hybrid generation");
}

export async function createVaultWithMnemonic(
  pin6: string,
  mnemonic12: string,
  mldsa44: { pubkey_b64: string; keypair_b64: string },
): Promise<{ record: VaultRecordV1; mnemonic12: string }> {
  if (typeof window === "undefined") throw new Error("vault must be used in browser");
  if (!isMasterPassword(pin6)) throw new Error("master password too short");
  if (!mnemonic12.trim()) throw new Error("mnemonic required");
  if (!mldsa44.pubkey_b64.trim() || !mldsa44.keypair_b64.trim()) throw new Error("mldsa44 required");

  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pk32 = spkiToEd25519Pubkey32(spki);
  const walletIdHex = bytesToHex(pk32);

  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));

  const salt = new Uint8Array(PIN_SALT_BYTES);
  crypto.getRandomValues(salt);
  const key = await deriveAesKeyFromMasterPassword(pin6, salt);

  const mEnc = await aesGcmEncrypt(key, new TextEncoder().encode(mnemonic12));
  const kEnc = await aesGcmEncrypt(key, pkcs8);
  const pqcEnc = await aesGcmEncrypt(key, new TextEncoder().encode(mldsa44.keypair_b64.trim()));

  const record: VaultRecordV1 = {
    v: 1,
    created_at_ms: nowMs(),
    wallet_id_hex: walletIdHex,
    salt_b64: bytesToB64(salt),
    mnemonic_iv_b64: bytesToB64(mEnc.iv),
    mnemonic_ct_b64: bytesToB64(mEnc.ct),
    pkcs8_iv_b64: bytesToB64(kEnc.iv),
    pkcs8_ct_b64: bytesToB64(kEnc.ct),
    spki_b64: bytesToB64(spki),
    mldsa44_pubkey_b64: mldsa44.pubkey_b64.trim(),
    mldsa44_keypair_iv_b64: bytesToB64(pqcEnc.iv),
    mldsa44_keypair_ct_b64: bytesToB64(pqcEnc.ct),
  };

  window.localStorage.setItem(LS_VAULT, JSON.stringify(record));
  return { record, mnemonic12 };
}

export async function unlockVault(pin6: string): Promise<UnlockedVault> {
  if (typeof window === "undefined") throw new Error("vault must be used in browser");
  if (!isMasterPassword(pin6)) throw new Error("master password too short");

  const record = readVaultRecord();
  if (!record) throw new Error("vault not found");

  const salt = b64ToBytes(record.salt_b64);
  const key = await deriveAesKeyFromMasterPassword(pin6, salt);

  const mnemonicPt = await aesGcmDecrypt(key, b64ToBytes(record.mnemonic_iv_b64), b64ToBytes(record.mnemonic_ct_b64));
  const mnemonic12 = new TextDecoder().decode(mnemonicPt);

  const pkcs8Pt = await aesGcmDecrypt(key, b64ToBytes(record.pkcs8_iv_b64), b64ToBytes(record.pkcs8_ct_b64));
  const pkcs8Buf = pkcs8Pt.buffer as ArrayBuffer;
  const spkiBytes = b64ToBytes(record.spki_b64);
  const spkiBuf = spkiBytes.buffer as ArrayBuffer;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Buf.slice(pkcs8Pt.byteOffset, pkcs8Pt.byteOffset + pkcs8Pt.byteLength),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    spkiBuf.slice(spkiBytes.byteOffset, spkiBytes.byteOffset + spkiBytes.byteLength),
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  const mldsa_pub = (record.mldsa44_pubkey_b64 ?? "").trim();
  const mldsa_k_iv = (record.mldsa44_keypair_iv_b64 ?? "").trim();
  const mldsa_k_ct = (record.mldsa44_keypair_ct_b64 ?? "").trim();
  if (!mldsa_pub || !mldsa_k_iv || !mldsa_k_ct) throw new Error("vault missing ML-DSA-44 keys");
  const pqcPt = await aesGcmDecrypt(key, b64ToBytes(mldsa_k_iv), b64ToBytes(mldsa_k_ct));
  const mldsa44_keypair_b64 = new TextDecoder().decode(pqcPt).trim();
  if (!mldsa44_keypair_b64) throw new Error("vault missing ML-DSA-44 keypair");

  return {
    record,
    mnemonic12,
    walletIdHex: record.wallet_id_hex,
    publicKey,
    privateKey,
    mldsa44_pubkey_b64: mldsa_pub,
    mldsa44_keypair_b64,
  };
}

