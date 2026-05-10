import { readInAppWalletRecord } from "./inapp_wallet";
import { readVaultRecord } from "./pin_vault";
import { loadWalletStore } from "./wallet_store";

export type OsWalletStorageKind = "none" | "vault" | "inapp" | "legacy_plain";

/**
 * Which persisted wallet exists: `/setup` vault > AES-GCM keystore (`tet_wallet_keystore`) >
 * legacy `tet.wallet.v0` (plain mnemonic — migrate on next unlock).
 */
export function detectOsWalletStorageKind(): OsWalletStorageKind {
  if (typeof window === "undefined") return "none";
  if (readVaultRecord()) return "vault";
  if (readInAppWalletRecord()) return "inapp";
  if (loadWalletStore()) return "legacy_plain";
  return "none";
}
