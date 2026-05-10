/**
 * Canonical founder wallet_id for Sovereign OS dev session (`FOUNDER_SIGNING_URI = "//Ferdie"`).
 * Must match tet-core `ledger::GENESIS_FOUNDER_DEV_PUBLIC_HEX` and auto-genesis in `main.rs`.
 */
export const GENESIS_FOUNDER_WALLET_ID_HEX =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID?.trim()) ||
  "1cbd2d43530a44705ad088af313e18f80b53ef16b36177cd4b77b846f2a5f07c";
