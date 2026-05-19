/**
 * Chain binding for hybrid-signed REST messages.
 * Genesis hash MUST match tet-core `ledger::deterministic_genesis_hash` (SHA-256 over UTF-8 payload).
 */
/** 1 TET = 1_000_000 Stevemon (6 decimals); max supply 10B TET. */
const STEVEMON = 1_000_000n;
const MAX_SUPPLY_MICRO = 10_000_000_000n * STEVEMON;

const GENESIS_FOUNDER_SHARE_MICRO = 2_500_000_000n * STEVEMON;
const GENESIS_WORKER_POOL_SHARE_MICRO = 5_000_000_000n * STEVEMON;
const GENESIS_TREASURY_SHARE_MICRO = 2_500_000_000n * STEVEMON;
const GENESIS_PROTOCOL_RESERVE_SHARE_MICRO = 0n;

/** Matches `ledger::WALLET_WORKER_POOL` / `WALLET_SYSTEM_WORKER_POOL`. */
const WALLET_WORKER_POOL =
  "0000000000000000000000000000000000000000000000000000000000000001";
const WALLET_PROTOCOL_RESERVE =
  "0000000000000000000000000000000000000000000000000000000000000003";

/** Matches `ledger::GENESIS_FOUNDER_DEV_PUBLIC_HEX` (default founder when env unset). */
export const GENESIS_FOUNDER_DEV_PUBLIC_HEX =
  "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0";

export async function sha256HexUtf8(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const out = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < out.length; i++) hex += out[i]!.toString(16).padStart(2, "0");
  return hex;
}

function envText(name: string): string {
  const map: Record<string, string | undefined> = {
    NEXT_PUBLIC_TET_CHAIN_ID: process.env.NEXT_PUBLIC_TET_CHAIN_ID,
    NEXT_PUBLIC_TET_MAINNET: process.env.NEXT_PUBLIC_TET_MAINNET,
    NEXT_PUBLIC_TET_GENESIS_HASH: process.env.NEXT_PUBLIC_TET_GENESIS_HASH,
    NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID: process.env.NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID,
    NEXT_PUBLIC_TET_FOUNDER_WALLET: process.env.NEXT_PUBLIC_TET_FOUNDER_WALLET,
    NEXT_PUBLIC_TET_TREASURY_ADDRESS: process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS,
  };
  return map[name]?.trim() ?? "";
}

function truthyEnv(name: string): boolean {
  const v = envText(name).toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Mirrors tet-core `ledger::chain_id_from_env`. */
export function publicChainId(): string {
  const explicit = envText("NEXT_PUBLIC_TET_CHAIN_ID");
  if (explicit) return explicit;
  if (truthyEnv("NEXT_PUBLIC_TET_MAINNET")) return "tet-mainnet-1";
  return "tet-local-dev";
}

function normalizeWalletId(raw: string, label: string): string {
  const w = raw.trim().toLowerCase();
  if (!w) {
    throw new Error(`${label} must not be empty`);
  }
  if (w.length !== 64 || !/^[0-9a-f]+$/.test(w)) {
    throw new Error(`${label} must be 64 lowercase hex chars`);
  }
  return w;
}

/** Mirrors tet-core `ledger::expected_genesis_founder_wallet_from_env`. */
export function expectedFounderWalletId(): string {
  const explicit =
    envText("NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID") ||
    envText("NEXT_PUBLIC_TET_FOUNDER_WALLET");
  if (explicit) return normalizeWalletId(explicit, "founder wallet");
  return GENESIS_FOUNDER_DEV_PUBLIC_HEX;
}

/** Mirrors tet-core `ledger::treasury_address_from_env` / `normalize_treasury_address`. */
export function expectedTreasuryWalletId(): string {
  return normalizeWalletId(
    envText("NEXT_PUBLIC_TET_TREASURY_ADDRESS"),
    "NEXT_PUBLIC_TET_TREASURY_ADDRESS",
  );
}

export type GenesisBindingInputs = {
  chainId: string;
  founderWalletId: string;
  treasuryWalletId: string;
};

/**
 * Byte-for-byte payload string from tet-core `deterministic_genesis_hash` (ledger.rs).
 * Field order and `|` separators are normative.
 */
export function buildGenesisPayloadV1(inputs: GenesisBindingInputs): string {
  const founder = inputs.founderWalletId.trim().toLowerCase();
  const treasury = inputs.treasuryWalletId.trim().toLowerCase();
  return (
    `tet-genesis-v1|chain_id=${inputs.chainId}` +
    `|founder=${founder}` +
    `|founder_micro=${GENESIS_FOUNDER_SHARE_MICRO}` +
    `|worker_pool=${WALLET_WORKER_POOL}` +
    `|worker_pool_micro=${GENESIS_WORKER_POOL_SHARE_MICRO}` +
    `|treasury=${treasury}` +
    `|treasury_micro=${GENESIS_TREASURY_SHARE_MICRO}` +
    `|reserve=${WALLET_PROTOCOL_RESERVE}` +
    `|reserve_micro=${GENESIS_PROTOCOL_RESERVE_SHARE_MICRO}` +
    `|max_supply_micro=${MAX_SUPPLY_MICRO}`
  );
}

export async function deterministicGenesisHashHex(
  inputs: GenesisBindingInputs,
): Promise<string> {
  const payload = buildGenesisPayloadV1(inputs);
  return `0x${await sha256HexUtf8(payload)}`;
}

async function runtimeFounderWalletId(baseUrl?: string): Promise<string> {
  const explicit = expectedFounderWalletId();
  if (!baseUrl) return explicit;

  let statusFounder = "";
  try {
    const base = baseUrl.trim().replace(/\/+$/, "");
    const url = `${base || ""}/status`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const d = r.ok ? ((await r.json()) as { founder_wallet_id?: unknown }) : {};
    statusFounder = typeof d.founder_wallet_id === "string" ? d.founder_wallet_id : "";
  } catch {
    statusFounder = "";
  }
  if (statusFounder) return normalizeWalletId(statusFounder, "founder wallet");
  return explicit;
}

export async function expectedChainBinding(baseUrl?: string): Promise<{
  chainId: string;
  genesisHash: string;
}> {
  const explicitHash = envText("NEXT_PUBLIC_TET_GENESIS_HASH").toLowerCase();
  const chainId = publicChainId();
  if (explicitHash) return { chainId, genesisHash: explicitHash };

  const founder = await runtimeFounderWalletId(baseUrl);
  const treasury = expectedTreasuryWalletId();
  const genesisHash = await deterministicGenesisHashHex({
    chainId,
    founderWalletId: founder,
    treasuryWalletId: treasury,
  });
  return { chainId, genesisHash };
}
