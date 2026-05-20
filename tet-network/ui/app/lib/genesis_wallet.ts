/**
 * Canonical founder wallet_id for dev genesis (tet-core `GENESIS_FOUNDER_DEV_PUBLIC_HEX`).
 * Must match `ledger::GENESIS_FOUNDER_DEV_PUBLIC_HEX` and auto-genesis in `main.rs`.
 */
export const GENESIS_FOUNDER_WALLET_ID_HEX =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID?.trim()) ||
  "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0";
