import { b64ToBytes, bytesToB64 } from "./encoding";
import { cryptoWaitReady, mnemonicGenerate, mnemonicValidate } from "@polkadot/util-crypto";

/** Canonical localStorage key for AES-GCM encrypted mnemonic (PBKDF2 PIN). */
export const TET_WALLET_KEYSTORE_LS_KEY = "tet_wallet_keystore";
const KEY_LEGACY_INAPP = "tet.inapp_wallet.v1";
const PIN_SALT_BYTES = 16;
const GCM_IV_BYTES = 12;
const PBKDF2_ITERS = 150_000;
const PIN_RE_6_8 = /^\d{6,8}$/;

export type InAppWalletRecordV1 = {
  v: 1;
  created_at_ms: number;
  salt_b64: string;
  mnemonic_iv_b64: string;
  mnemonic_ct_b64: string;
};

export type InAppWalletRecordV2 = {
  v: 2;
  created_at_ms: number;
  salt_b64: string;
  mnemonic_iv_b64: string;
  mnemonic_ct_b64: string;
};

export type InAppWalletRecord = InAppWalletRecordV1 | InAppWalletRecordV2;

function nowMs(): number {
  return Date.now();
}

/** 6–8 digit numeric PIN for encrypting the local keystore. */
export function isValidWalletPin(pin: string): boolean {
  return PIN_RE_6_8.test((pin ?? "").trim());
}

async function deriveAesKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
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

function parseRecord(raw: string): InAppWalletRecord | null {
  try {
    const j = JSON.parse(raw) as Partial<InAppWalletRecord>;
    if (j?.v !== 1 && j?.v !== 2) return null;
    if (typeof j.created_at_ms !== "number") return null;
    if (typeof j.salt_b64 !== "string") return null;
    if (typeof j.mnemonic_iv_b64 !== "string") return null;
    if (typeof j.mnemonic_ct_b64 !== "string") return null;
    return j as InAppWalletRecord;
  } catch {
    return null;
  }
}

function migrateLegacyInAppKeyIfNeeded(rec: InAppWalletRecord): InAppWalletRecord {
  if (typeof window === "undefined") return rec;
  const legacyRaw = window.localStorage.getItem(KEY_LEGACY_INAPP);
  if (!legacyRaw) return rec;
  try {
    window.localStorage.setItem(TET_WALLET_KEYSTORE_LS_KEY, JSON.stringify({ ...rec, v: 2 }));
    window.localStorage.removeItem(KEY_LEGACY_INAPP);
  } catch {
    // ignore
  }
  return rec;
}

export function inAppWalletExists(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.localStorage.getItem(TET_WALLET_KEYSTORE_LS_KEY) || window.localStorage.getItem(KEY_LEGACY_INAPP));
}

export function readInAppWalletRecord(): InAppWalletRecord | null {
  if (typeof window === "undefined") return null;
  const primary = window.localStorage.getItem(TET_WALLET_KEYSTORE_LS_KEY);
  if (primary) {
    const rec = parseRecord(primary);
    return rec;
  }
  const legacy = window.localStorage.getItem(KEY_LEGACY_INAPP);
  if (!legacy) return null;
  const rec = parseRecord(legacy);
  if (!rec) return null;
  return migrateLegacyInAppKeyIfNeeded(rec);
}

export function clearInAppWallet(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TET_WALLET_KEYSTORE_LS_KEY);
  window.localStorage.removeItem(KEY_LEGACY_INAPP);
}

export async function generateMnemonic12Polkadot(): Promise<string> {
  if (typeof window === "undefined") throw new Error("mnemonic must be generated in browser");
  await cryptoWaitReady();
  const m = mnemonicGenerate(12);
  if (!mnemonicValidate(m)) throw new Error("mnemonic validation failed");
  return m;
}

export async function createInAppWalletWithMnemonic(pin: string, mnemonic12: string): Promise<void> {
  if (typeof window === "undefined") throw new Error("wallet must be used in browser");
  if (!isValidWalletPin(pin)) throw new Error("PIN must be 6–8 digits");
  if (!mnemonic12.trim()) throw new Error("mnemonic required");
  if (!mnemonicValidate(mnemonic12.trim())) throw new Error("invalid mnemonic");

  const salt = new Uint8Array(PIN_SALT_BYTES);
  crypto.getRandomValues(salt);
  const key = await deriveAesKeyFromPin(pin.trim(), salt);
  const enc = await aesGcmEncrypt(key, new TextEncoder().encode(mnemonic12.trim()));

  const record: InAppWalletRecordV2 = {
    v: 2,
    created_at_ms: nowMs(),
    salt_b64: bytesToB64(salt),
    mnemonic_iv_b64: bytesToB64(enc.iv),
    mnemonic_ct_b64: bytesToB64(enc.ct),
  };

  window.localStorage.setItem(TET_WALLET_KEYSTORE_LS_KEY, JSON.stringify(record));
  window.localStorage.removeItem(KEY_LEGACY_INAPP);
}

export async function unlockInAppWallet(pin: string): Promise<{ mnemonic12: string; record: InAppWalletRecord }> {
  if (typeof window === "undefined") throw new Error("wallet must be used in browser");
  if (!isValidWalletPin(pin)) throw new Error("PIN must be 6–8 digits");

  const record = readInAppWalletRecord();
  if (!record) throw new Error("wallet not found");

  const salt = b64ToBytes(record.salt_b64);
  const key = await deriveAesKeyFromPin(pin.trim(), salt);
  let pt: Uint8Array;
  try {
    pt = await aesGcmDecrypt(key, b64ToBytes(record.mnemonic_iv_b64), b64ToBytes(record.mnemonic_ct_b64));
  } catch {
    throw new Error("Invalid PIN or wallet corrupt.");
  }
  const mnemonic12 = new TextDecoder().decode(pt).trim();
  if (!mnemonicValidate(mnemonic12)) throw new Error("decrypted mnemonic invalid");
  return { mnemonic12, record };
}

export async function changeInAppWalletPin(oldPin: string, newPin: string): Promise<void> {
  if (!isValidWalletPin(oldPin) || !isValidWalletPin(newPin)) throw new Error("PIN must be 6–8 digits");
  const { mnemonic12 } = await unlockInAppWallet(oldPin);
  await createInAppWalletWithMnemonic(newPin, mnemonic12);
}
