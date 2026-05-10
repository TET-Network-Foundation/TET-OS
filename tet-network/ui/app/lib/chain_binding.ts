import { GENESIS_FOUNDER_WALLET_ID_HEX } from "./genesis_wallet";

const MAX_SUPPLY_MICRO = "10000000000000000";
const GENESIS_FOUNDER_SHARE_MICRO = "2500000000000000";
const GENESIS_WORKER_POOL_SHARE_MICRO = "5000000000000000";
const GENESIS_ECOSYSTEM_SHARE_MICRO = "2500000000000000";
const GENESIS_PROTOCOL_RESERVE_SHARE_MICRO = "0";
const WALLET_SYSTEM_WORKER_POOL = "system:worker_pool";
const WALLET_ECOSYSTEM = "0000000000000000000000000000000000000000000000000000000000000002";
const WALLET_PROTOCOL_RESERVE = "0000000000000000000000000000000000000000000000000000000000000003";
const GENESIS_FOUNDER_DEV_PUBLIC_HEX = "57e0b29d233917a619d0f335dfc1135add3359c49590720cfb0f9f70d71f36a0";

export async function sha256HexUtf8(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const out = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < out.length; i++) hex += out[i]!.toString(16).padStart(2, "0");
  return hex;
}

function envText(name: string): string {
  const v =
    name === "NEXT_PUBLIC_TET_CHAIN_ID"
      ? process.env.NEXT_PUBLIC_TET_CHAIN_ID
      : name === "NEXT_PUBLIC_TET_MAINNET"
        ? process.env.NEXT_PUBLIC_TET_MAINNET
        : name === "NEXT_PUBLIC_TET_GENESIS_HASH"
          ? process.env.NEXT_PUBLIC_TET_GENESIS_HASH
          : name === "NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID"
            ? process.env.NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID
            : name === "NEXT_PUBLIC_TET_FOUNDER_WALLET"
              ? process.env.NEXT_PUBLIC_TET_FOUNDER_WALLET
              : "";
  return v?.trim() ?? "";
}

function truthyEnv(name: string): boolean {
  const v = envText(name).toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function publicChainId(founderWalletId: string): string {
  const explicit = envText("NEXT_PUBLIC_TET_CHAIN_ID");
  if (explicit) return explicit;
  if (truthyEnv("NEXT_PUBLIC_TET_MAINNET")) return "tet-mainnet-1";
  return founderWalletId.trim().toLowerCase() !== GENESIS_FOUNDER_DEV_PUBLIC_HEX
    ? "tet-mainnet-1"
    : "tet-local-dev";
}

async function runtimeFounderWalletId(baseUrl?: string): Promise<string> {
  const explicit =
    envText("NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID") ||
    envText("NEXT_PUBLIC_TET_FOUNDER_WALLET") ||
    GENESIS_FOUNDER_WALLET_ID_HEX;
  if (!baseUrl) return explicit.trim().toLowerCase();

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
  return (statusFounder || explicit).trim().toLowerCase();
}

export async function expectedChainBinding(baseUrl?: string): Promise<{ chainId: string; genesisHash: string }> {
  const explicitHash = envText("NEXT_PUBLIC_TET_GENESIS_HASH").toLowerCase();
  const founder = await runtimeFounderWalletId(baseUrl);
  const chainId = publicChainId(founder);
  if (explicitHash) return { chainId, genesisHash: explicitHash };

  const payload =
    `tet-genesis-v1|chain_id=${chainId}` +
    `|founder=${founder}` +
    `|founder_micro=${GENESIS_FOUNDER_SHARE_MICRO}` +
    `|worker_pool=${WALLET_SYSTEM_WORKER_POOL}` +
    `|worker_pool_micro=${GENESIS_WORKER_POOL_SHARE_MICRO}` +
    `|ecosystem=${WALLET_ECOSYSTEM}` +
    `|ecosystem_micro=${GENESIS_ECOSYSTEM_SHARE_MICRO}` +
    `|reserve=${WALLET_PROTOCOL_RESERVE}` +
    `|reserve_micro=${GENESIS_PROTOCOL_RESERVE_SHARE_MICRO}` +
    `|max_supply_micro=${MAX_SUPPLY_MICRO}`;
  return { chainId, genesisHash: `0x${await sha256HexUtf8(payload)}` };
}
