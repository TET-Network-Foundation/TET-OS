/** TET-Core Axum REST client (port 5010). No WebSocket / Substrate. */

import {
  buildAiInferHybridHeaders,
  flopsBigIntToJsonNumber,
  sha256HexUtf8,
  u8ToStdBase64,
} from "./ai_infer_hybrid";
import { expectedChainBinding } from "./chain_binding";
import { getHybridSignerSession } from "./hybrid_signer_session";
import { type LedgerState, parseLedgerState } from "./ledger_state";
import { mldsa44SignDeterministic } from "./pqc";
import {
  buildInitialAirdropEnvelope,
  type InitialAirdropAcceptedResp,
  type SignedTxEnvelopeV1,
  type WalletTransferAcceptedResp,
  type WalletTransferNonceResp,
} from "./transfer";
import type { TmailEnvelopeV1 } from "./tmail";
import type { TmailKeyRegistrationV1 } from "./tmail_keys";
import type { FileDeleteRequestV1, FileEnvelopeV1 } from "./files";

/** @deprecated Use `SyncUiState` from `ledger_state.ts` (ledger sync gate). */
export type ChainConnectionStatus = "connecting" | "synced" | "disconnected";

/** Whitepaper: 1 TET = 10^6 Stevemon (micro-TET ledger units). */
export const STEVEMON_PER_TET = 1_000_000n;

export type LogHttpFailurePayload = {
  url: string;
  /** HTTP status when available (4xx/5xx); 0 or omitted when fetch threw before response. */
  status?: number;
  /** Full `response.text()` from the server on HTTP failure (not truncated). */
  responseBody?: string;
  /** Extra detail (network error message, parse note, etc.). */
  detail?: string;
};

export function tetCoreUrl(baseUrl: string, path: string, params?: Record<string, string>): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const raw = /^https?:\/\//i.test(base) ? new URL(suffix, base).toString() : `${base || ""}${suffix}`;
  if (!params) return raw;
  const qs = new URLSearchParams(params).toString();
  if (!qs) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}${qs}`;
}

function logHttpFailure(context: string, payload: LogHttpFailurePayload): void {
  if (typeof console === "undefined" || !console.error) return;
  const d = payload.detail ?? "";
  const hint =
    d.includes("Failed to fetch") || d.includes("NetworkError") || d.includes("Load failed")
      ? " (network: offline, CORS blocked, or wrong NEXT_PUBLIC_TET_CORE_URL / NEXT_PUBLIC_API_URL)"
      : d.includes("ECONNREFUSED") || d.includes("Connection refused")
        ? " (connection refused — is TET-Core running?)"
        : "";
  console.error(`[tet_core_http] ${context}${hint}`, {
    url: payload.url,
    ...(payload.status !== undefined && payload.status > 0 ? { httpStatus: payload.status } : {}),
    ...(payload.responseBody !== undefined ? { responseBody: payload.responseBody } : {}),
    ...(payload.detail !== undefined && payload.detail !== "" ? { detail: payload.detail } : {}),
  });
}

export type LedgerMeJson = {
  wallet_id: string;
  balance_micro_tet: number;
  total_supply_micro_tet?: number;
  total_burned_micro_tet?: number;
  balance_tet?: number;
};

export type MarketIndexJson = {
  total_supply_micro: number;
  total_supply_tet: number;
  total_supply_cap_tet: number;
};

export type NetworkStatsJson = {
  active_worker_nodes: number;
  total_burned_micro: number;
  total_supply_micro: number;
};

export type AuditEventJson = {
  seq: number;
  ts_ms: number;
  record: Record<string, unknown>;
};

export type LedgerBlockSummaryJson = {
  height: number;
  block_id: string;
  state_root: string;
  tx_count: number;
  ts_ms?: number;
};

export type TxIndexRecordJson = {
  v: number;
  hash: string;
  block_height: number;
  tx_index: number;
  tx_kind: string;
  workload_flag: number;
  signer_wallet: string;
  tx: Record<string, unknown>;
  indexed_at_ms?: number;
};

export type LedgerBlockDetailJson = {
  block: LedgerBlockSummaryJson;
  txs: TxIndexRecordJson[];
};

export type ExplorerTxJson = {
  found: boolean;
  source: string;
  hash: string;
  block_height: number;
  tx_index: number;
  tx_kind: string;
  workload_flag: number;
  signer_wallet: string;
  indexed_at_ms?: number;
  tx: Record<string, unknown>;
  zk_journal?: Record<string, unknown> | null;
  task?: Record<string, unknown> | null;
};

export type EnterpriseInferenceSubmitResult = {
  ok: boolean;
  status: number;
  text?: string;
  queued?: boolean;
  workload_flag?: number;
  task_id_hint?: string;
};

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; status: number; text?: string }> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    });
    const text = await r.text();
    if (!r.ok) {
      logHttpFailure("HTTP error response", {
        url,
        status: r.status,
        responseBody: text,
        detail: `HTTP ${r.status}`,
      });
      return { ok: false, status: r.status, text };
    }
    try {
      return { ok: true, status: r.status, data: JSON.parse(text) as T };
    } catch {
      logHttpFailure("JSON parse error (non-JSON or malformed body)", {
        url,
        status: r.status,
        responseBody: text,
        detail: "JSON.parse failed on successful HTTP status",
      });
      return { ok: false, status: r.status, text };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logHttpFailure("fetch threw", { url, detail: msg });
    return { ok: false, status: 0, text: msg };
  }
}

/** 32-byte public key → 64-char lowercase hex (no `0x`). */
export function walletIdHexFromPublicKey(pub: Uint8Array): string {
  let s = "";
  for (let i = 0; i < pub.length; i++) s += pub[i]!.toString(16).padStart(2, "0");
  return s;
}

/** Normalize UI/API wallet id: strip optional `0x`, lowercase, require 64 hex chars (REST contract). */
export function normalizeWalletId64(walletId: string): string {
  let s = walletId.trim().toLowerCase();
  if (s.startsWith("0x")) s = s.slice(2);
  if (s.length !== 64 || !/^[0-9a-f]{64}$/.test(s)) return "";
  return s;
}

/**
 * Read a JSON u64 field from raw response text as BigInt (avoids JS Number precision loss above 2^53).
 * Serde emits `"field": 12345` with no quotes on the value.
 */
export function uint64FromJsonText(text: string, key: string): bigint | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`"${escaped}"\\s*:\\s*([0-9]+)`);
  const m = text.match(re);
  if (!m?.[1]) return null;
  try {
    return BigInt(m[1]);
  } catch {
    return null;
  }
}

const LEDGER_ME_PATHS = ["/v1/vision/ledger/me", "/ledger/me"] as const;

export type LedgerBalanceResult =
  | { ok: true; micro: bigint }
  | { ok: false; micro: null; reason: string };

export async function getLedgerMeBalanceMicro(baseUrl: string, walletId64: string): Promise<LedgerBalanceResult> {
  const wid = normalizeWalletId64(walletId64);
  if (!wid) {
    return { ok: false, micro: null, reason: "invalid wallet_id (expected 64 hex chars)" };
  }

  let lastDetail = "no successful response";
  for (const path of LEDGER_ME_PATHS) {
    const urlStr = tetCoreUrl(baseUrl, path, { wallet_id: wid });
    let text: string;
    try {
      const r = await fetch(urlStr, { headers: { Accept: "application/json" } });
      text = await r.text();
      if (!r.ok) {
        lastDetail = `HTTP ${r.status}: ${text.slice(0, 120)}`;
        logHttpFailure("ledger/me", { url: urlStr, status: r.status, responseBody: text, detail: lastDetail });
        continue;
      }
    } catch (e: unknown) {
      lastDetail = e instanceof Error ? e.message : String(e);
      logHttpFailure("ledger/me", { url: urlStr, detail: lastDetail });
      continue;
    }
    const fromText = uint64FromJsonText(text, "balance_micro_tet");
    if (fromText !== null) return { ok: true, micro: fromText };
    try {
      const j = JSON.parse(text) as LedgerMeJson;
      const m = j.balance_micro_tet;
      if (typeof m === "number" && Number.isFinite(m) && m >= 0 && m <= Number.MAX_SAFE_INTEGER) {
        return { ok: true, micro: BigInt(Math.floor(m)) };
      }
      lastDetail = "balance_micro_tet missing or unparsable";
    } catch {
      lastDetail = "invalid JSON";
    }
  }
  return { ok: false, micro: null, reason: lastDetail };
}

export type WalletInferenceBurnResult =
  | { ok: true; micro: bigint }
  | { ok: false; micro: null; reason: string };

/** GET /ledger/me — cumulative inference-linked burn share for this wallet (`wallet_inference_burn_micro`). */
export async function getLedgerMeWalletInferenceBurnMicro(
  baseUrl: string,
  walletId64: string,
): Promise<WalletInferenceBurnResult> {
  const wid = normalizeWalletId64(walletId64);
  if (!wid) {
    return { ok: false, micro: null, reason: "invalid wallet_id (expected 64 hex chars)" };
  }

  let lastDetail = "no successful response";
  for (const path of LEDGER_ME_PATHS) {
    const urlStr = tetCoreUrl(baseUrl, path, { wallet_id: wid });
    let text: string;
    try {
      const r = await fetch(urlStr, { headers: { Accept: "application/json" } });
      text = await r.text();
      if (!r.ok) {
        lastDetail = `HTTP ${r.status}: ${text.slice(0, 120)}`;
        logHttpFailure("ledger/me wallet_infer_burn", { url: urlStr, status: r.status, responseBody: text, detail: lastDetail });
        continue;
      }
    } catch (e: unknown) {
      lastDetail = e instanceof Error ? e.message : String(e);
      logHttpFailure("ledger/me wallet_infer_burn", { url: urlStr, detail: lastDetail });
      continue;
    }
    const fromText = uint64FromJsonText(text, "wallet_inference_burn_micro");
    if (fromText !== null) return { ok: true, micro: fromText };
    try {
      const j = JSON.parse(text) as { wallet_inference_burn_micro?: number };
      const m = j.wallet_inference_burn_micro;
      if (typeof m === "number" && Number.isFinite(m) && m >= 0 && m <= Number.MAX_SAFE_INTEGER) {
        return { ok: true, micro: BigInt(Math.floor(m)) };
      }
      lastDetail = "wallet_inference_burn_micro missing or unparsable";
    } catch {
      lastDetail = "invalid JSON";
    }
  }
  return { ok: false, micro: null, reason: lastDetail };
}

export type InferCostEstimateJson = {
  total_micro_ledger: number;
  to_worker_reward_micro: number;
  to_protocol_burn_micro: number;
  /** §4.2 discrete thermodynamic R before 50/50 settlement split (Stevemon micro). */
  thermodynamic_r_micro?: number;
  notes: string;
};

export type VisionCaacProfileJson = {
  role: "POC" | "POR";
  hw: {
    fingerprint_sha256_hex: string;
    cpu_logical_cores: number;
    ram_total_bytes: number;
    gpu_detected: boolean;
    gpu_hint: string;
  };
};

/** GET /v1/vision/ai/infer/estimate — §4.2 thermodynamic fee (ledger Stevemon micro). */
export async function getVisionInferEstimate(
  baseUrl: string,
  flops: bigint | string,
): Promise<{ ok: boolean; data?: InferCostEstimateJson; status: number; text?: string }> {
  const flopsStr = typeof flops === "bigint" ? flops.toString() : flops.trim();
  return fetchJson<InferCostEstimateJson>(tetCoreUrl(baseUrl, "/v1/vision/ai/infer/estimate", { flops: flopsStr }));
}

export async function getVisionCaacProfile(
  baseUrl: string,
): Promise<{ ok: boolean; data?: VisionCaacProfileJson; status: number; text?: string }> {
  return fetchJson<VisionCaacProfileJson>(tetCoreUrl(baseUrl, "/v1/vision/caac/profile"));
}

/** GET /worker/stats/:wallet — online + optional CAAC attestation from ledger / registry. */
export type WorkerStatsJson = {
  wallet: string;
  online: boolean;
  tflops_est: number;
  last_seen_ms: number;
  caac_role?: string;
  caac_latency_ms?: number;
};

export async function getWorkerStats(
  baseUrl: string,
  walletId64: string,
): Promise<{ ok: boolean; data?: WorkerStatsJson; status: number; text?: string }> {
  const wid = normalizeWalletId64(walletId64);
  if (!wid) {
    return { ok: false, status: 400, text: "wallet_id must be 64 hex chars" };
  }
  return fetchJson<WorkerStatsJson>(tetCoreUrl(baseUrl, `/worker/stats/${wid}`));
}

const NETWORK_STATS_PATHS = ["/v1/vision/network/stats", "/network/stats"] as const;
const MARKET_INDEX_PATHS = ["/v1/vision/market/index", "/market/index"] as const;

/** GET market index — supplies total_supply_micro (parsed safely from raw JSON text). */
export async function fetchMarketTotalSupplyMicro(baseUrl: string): Promise<bigint | null> {
  for (const path of MARKET_INDEX_PATHS) {
    const url = tetCoreUrl(baseUrl, path);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const text = await r.text();
      if (!r.ok) {
        logHttpFailure("market/index", { url, status: r.status, responseBody: text, detail: `HTTP ${r.status}` });
        continue;
      }
      const v = uint64FromJsonText(text, "total_supply_micro");
      if (v !== null) return v;
    } catch (e: unknown) {
      logHttpFailure("market/index", { url, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return null;
}

/** GET /v1/vision/pqc/status — ML-DSA / PQC bridge probe JSON. */
export async function getVisionPqcStatus(
  baseUrl: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; status: number; text?: string }> {
  return fetchJson<Record<string, unknown>>(tetCoreUrl(baseUrl, "/v1/vision/pqc/status"));
}

export type NetworkStatsMicro = {
  total_supply_micro: bigint | null;
  total_burned_micro: bigint | null;
  active_worker_nodes: number | null;
  /** Ledger balance of system worker pool wallet (Stevemon micro). */
  system_worker_pool_balance_micro: bigint | null;
  consensus_block_height: bigint | null;
  epoch: number | null;
  is_genesis_boost: boolean;
  /** Aggregate TFLOPS from worker registry (same as REST `total_compute_tflops`). */
  total_compute_tflops: number | null;
};

function uintFromJsonText(text: string, key: string): number | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`"${escaped}"\\s*:\\s*([0-9]+)`);
  const m = text.match(re);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** GET /v1/vision/network/stats or /network/stats — burn + supply with u64-safe parsing. */
export async function fetchNetworkStatsMicro(baseUrl: string): Promise<{ ok: boolean } & NetworkStatsMicro> {
  const emptyFail = (): { ok: boolean } & NetworkStatsMicro => ({
    ok: false,
    total_supply_micro: null,
    total_burned_micro: null,
    active_worker_nodes: null,
    system_worker_pool_balance_micro: null,
    consensus_block_height: null,
    epoch: null,
    is_genesis_boost: false,
    total_compute_tflops: null,
  });

  for (const path of NETWORK_STATS_PATHS) {
    const url = tetCoreUrl(baseUrl, path);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const text = await r.text();
      if (!r.ok) {
        logHttpFailure("network/stats", { url, status: r.status, responseBody: text, detail: `HTTP ${r.status}` });
        continue;
      }
      let epoch: number | null = null;
      let isGenesis = false;
      let tflops: number | null = null;
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        const ep = j.epoch;
        if (typeof ep === "number" && Number.isFinite(ep)) epoch = ep;
        isGenesis = j.is_genesis_boost === true;
        const tf = j.total_compute_tflops;
        if (typeof tf === "number" && Number.isFinite(tf)) tflops = tf;
      } catch {
        if (/\bis_genesis_boost"\s*:\s*true\b/.test(text)) isGenesis = true;
      }
      return {
        ok: true,
        total_supply_micro: uint64FromJsonText(text, "total_supply_micro"),
        total_burned_micro: uint64FromJsonText(text, "total_burned_micro"),
        active_worker_nodes: uintFromJsonText(text, "active_worker_nodes"),
        system_worker_pool_balance_micro: uint64FromJsonText(text, "system_worker_pool_balance_micro"),
        consensus_block_height: uint64FromJsonText(text, "consensus_block_height"),
        epoch,
        is_genesis_boost: isGenesis,
        total_compute_tflops: tflops,
      };
    } catch (e: unknown) {
      logHttpFailure("network/stats", { url, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  logHttpFailure("network/stats", { url: baseUrl, detail: "all paths failed" });
  return emptyFail();
}

const LEDGER_STATE_PATHS = ["/v1/vision/ledger/state", "/ledger/state"] as const;

export async function fetchLedgerState(
  baseUrl: string,
): Promise<{ ok: boolean; state?: LedgerState; status: number; text?: string }> {
  for (const path of LEDGER_STATE_PATHS) {
    const r = await fetchJson<unknown>(tetCoreUrl(baseUrl, path));
    if (!r.ok) continue;
    const state = parseLedgerState(r.data);
    if (state) return { ok: true, state, status: r.status };
  }
  const r = await fetchJson<unknown>(tetCoreUrl(baseUrl, "/ledger/state"));
  return { ok: false, status: r.status, text: r.text };
}

export async function fetchWalletTransferNonce(
  baseUrl: string,
  walletIdHex64: string,
): Promise<{ ok: boolean; data?: WalletTransferNonceResp; status: number; text?: string }> {
  const wid = normalizeWalletId64(walletIdHex64);
  if (!wid) return { ok: false, status: 400, text: "wallet_id must be 64 hex chars" };
  return fetchJson<WalletTransferNonceResp>(
    tetCoreUrl(baseUrl, `/wallet/nonce/${encodeURIComponent(wid)}`),
  );
}

/**
 * Submit a hybrid-signed transfer envelope. Returns `202 Accepted` with a pending `tx_hash`;
 * the transfer is committed only after a producer mines it into a block. Poll
 * {@link fetchExplorerTx} with the returned `tx_hash` to detect block inclusion.
 */
export async function postWalletTransfer(
  baseUrl: string,
  env: SignedTxEnvelopeV1,
): Promise<{ ok: boolean; data?: WalletTransferAcceptedResp; status: number; text?: string }> {
  return fetchJson<WalletTransferAcceptedResp>(tetCoreUrl(baseUrl, "/wallet/transfer"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(env),
  });
}

export async function fetchLedgerBlocks(
  baseUrl: string,
): Promise<{ ok: boolean; blocks: LedgerBlockSummaryJson[]; status: number; text?: string }> {
  const r = await fetchJson<LedgerBlockSummaryJson[]>(tetCoreUrl(baseUrl, "/ledger/blocks"));
  if (!r.ok) return { ok: false, blocks: [], status: r.status, text: r.text };
  return { ok: true, blocks: Array.isArray(r.data) ? r.data : [], status: r.status };
}

export async function fetchLedgerBlock(
  baseUrl: string,
  height: string | number,
): Promise<{ ok: boolean; data?: LedgerBlockDetailJson; status: number; text?: string }> {
  const h = String(height).trim();
  return fetchJson<LedgerBlockDetailJson>(tetCoreUrl(baseUrl, `/ledger/block/${encodeURIComponent(h)}`));
}

export async function fetchExplorerTx(
  baseUrl: string,
  hash: string,
): Promise<{ ok: boolean; data?: ExplorerTxJson; status: number; text?: string }> {
  return fetchJson<ExplorerTxJson>(tetCoreUrl(baseUrl, `/explorer/tx/${encodeURIComponent(hash.trim())}`));
}

/** Legacy typed fetch (may lose precision for large u64). Prefer fetchNetworkStatsMicro. */
export async function getNetworkStats(
  baseUrl: string,
): Promise<{ ok: boolean; data?: NetworkStatsJson; status: number; text?: string }> {
  return fetchJson<NetworkStatsJson>(tetCoreUrl(baseUrl, "/network/stats"));
}

/** GET /v1/vision/thermo/genesis — thermodynamic / issuance metadata (whitepaper alignment probe). */
export async function getVisionThermoGenesis(
  baseUrl: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; status: number; text?: string }> {
  return fetchJson<Record<string, unknown>>(tetCoreUrl(baseUrl, "/v1/vision/thermo/genesis"));
}

/** GET /v1/vision/network/config — bootnodes / worker registry hints. */
export async function getVisionNetworkConfig(
  baseUrl: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; status: number; text?: string }> {
  return fetchJson<Record<string, unknown>>(tetCoreUrl(baseUrl, "/v1/vision/network/config"));
}

const INITIAL_AIRDROP_CLAIM_PATHS = ["/v1/vision/ledger/initial_airdrop/claim", "/ledger/initial_airdrop/claim"] as const;

/**
 * Submit the one-time welcome-airdrop claim (1,000 TET) through consensus. Builds a hybrid-signed
 * `SignedTxEnvelopeV1` (`TxV1::InitialAirdrop`) and POSTs it; the node verifies the signature,
 * enqueues the claim into the mempool, and gossips it to peers. Returns `202 Accepted` with a
 * pending `tx_hash` (the credit lands once a producer mines it), or `200 OK` with
 * `outcome: "already_claimed"` for a wallet that already received its airdrop. Poll
 * {@link fetchExplorerTx} with the returned `tx_hash` to detect block inclusion.
 */
export async function postInitialAirdropClaim(
  baseUrl: string,
  walletId64: string,
): Promise<{ ok: boolean; outcome?: string; txHash?: string; status: number; text?: string }> {
  const wid = normalizeWalletId64(walletId64);
  if (!wid) {
    return { ok: false, status: 400, text: "wallet_id must be 64 hex chars" };
  }
  let env: SignedTxEnvelopeV1;
  try {
    env = await buildInitialAirdropEnvelope(wid, baseUrl);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 401, text: msg };
  }

  let lastStatus = 404;
  let lastText: string | undefined;
  for (const path of INITIAL_AIRDROP_CLAIM_PATHS) {
    const url = tetCoreUrl(baseUrl, path);
    const r = await fetchJson<InitialAirdropAcceptedResp>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(env),
    });
    lastStatus = r.status;
    lastText = r.text;
    if (r.status === 404) continue;
    if (!r.ok) {
      return { ok: false, status: r.status, text: r.text };
    }
    return {
      ok: true,
      outcome: r.data?.outcome ?? r.data?.status,
      txHash: r.data?.tx_hash,
      status: r.status,
    };
  }
  return { ok: false, status: lastStatus, text: lastText ?? "not found" };
}

export async function postAiInfer(
  baseUrl: string,
  walletId64: string,
  prompt: string,
  flops: bigint,
): Promise<{ ok: boolean; responseText?: string; welcome_airdrop_micro?: number; error?: string; status: number }> {
  const wid = normalizeWalletId64(walletId64);
  if (!wid) {
    return { ok: false, error: "wallet_id must be 64 hex chars (sr25519 public key)", status: 400 };
  }
  const trimmed = prompt.trim();
  let flopsNum: number;
  try {
    flopsNum = flopsBigIntToJsonNumber(flops);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, status: 400 };
  }

  let hybrid: Record<string, string>;
  try {
    // Obtain monotonic nonce (replay protection).
    const nRes = await fetchJson<{ wallet_id: string; nonce: number }>(tetCoreUrl(baseUrl, "/ai/nonce", { wallet_id: wid }));
    const nonce =
      nRes.ok && nRes.data && typeof nRes.data.nonce === "number" && Number.isFinite(nRes.data.nonce) && nRes.data.nonce > 0
        ? BigInt(Math.floor(nRes.data.nonce))
        : null;
    if (nonce == null) {
      return { ok: false, error: nRes.text ?? `nonce unavailable (HTTP ${nRes.status})`, status: nRes.status };
    }
    hybrid = await buildAiInferHybridHeaders(wid, trimmed, flops, nonce, baseUrl);
    const r = await fetchJson<Record<string, unknown>>(tetCoreUrl(baseUrl, "/ai/infer"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...hybrid,
      },
      body: JSON.stringify({ wallet_id: wid, prompt: trimmed, flops: flopsNum, nonce: Number(nonce) }),
    });
    if (!r.ok) return { ok: false, error: r.text ?? `HTTP ${r.status}`, status: r.status };
    const d = r.data;
    if (d && typeof d === "object" && d.response != null) {
      const welcomeRaw = (d as Record<string, unknown>).welcome_airdrop_micro;
      const welcome_airdrop_micro =
        typeof welcomeRaw === "number" && Number.isFinite(welcomeRaw)
          ? welcomeRaw
          : typeof welcomeRaw === "string" && /^\d+$/.test(welcomeRaw)
            ? Number(welcomeRaw)
            : undefined;
      return { ok: true, responseText: String(d.response), status: r.status, welcome_airdrop_micro };
    }
    if (d && typeof d === "object" && typeof d.message === "string") {
      return { ok: false, error: d.message, status: r.status };
    }
    return { ok: true, responseText: JSON.stringify(d), status: r.status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, status: 401 };
  }
}

function enterpriseInferenceHybridAuthMessageBytes(
  enterpriseWalletId: string,
  nonce: bigint,
  amountMicro: bigint,
  promptSha256Hex: string,
  model: string,
  attestationRequired: boolean,
  mldsaPubkeyB64: string,
  chainId: string,
  genesisHash: string,
): Uint8Array {
  const w = enterpriseWalletId.trim().toLowerCase();
  const h = promptSha256Hex.trim().toLowerCase();
  const m = model.trim();
  const att = attestationRequired ? 1 : 0;
  const p = mldsaPubkeyB64.trim();
  return new TextEncoder().encode(
    `tet enterprise inference v1|chain_id=${chainId}|genesis_hash=${genesisHash}|${w}|${nonce.toString()}|${amountMicro.toString()}|${h}|${m}|${att}|${p}`,
  );
}

async function fetchFreshAiNonce(baseUrl: string, walletId64: string): Promise<bigint> {
  const r = await fetchJson<{ wallet_id?: string; nonce?: number | string }>(
    tetCoreUrl(baseUrl, "/ai/nonce", { wallet_id: walletId64 }),
    { cache: "no-store" },
  );
  const raw = r.data?.nonce;
  const nonce =
    typeof raw === "number" && Number.isFinite(raw)
      ? BigInt(Math.floor(raw))
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? BigInt(raw)
        : 0n;
  if (!r.ok || nonce <= 0n) {
    throw new Error(r.text ?? `nonce unavailable (HTTP ${r.status})`);
  }
  return nonce;
}

async function signEnterpriseInferenceEnvelope(
  baseUrl: string,
  walletId64: string,
  prompt: string,
  model: string,
  amountMicro: bigint,
): Promise<{ envelope: Record<string, unknown>; taskIdHint: string }> {
  const sess = getHybridSignerSession();
  if (!sess) throw new Error("No Wallet: unlock your wallet before submitting L1 AI demand.");
  const wid = normalizeWalletId64(walletId64);
  if (!wid || wid !== sess.walletIdHex64) {
    throw new Error("Wallet mismatch: session wallet does not match enterprise wallet_id.");
  }
  if (amountMicro <= 0n || amountMicro > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("amount_micro must be positive and fit JSON safe integer for UI submission.");
  }
  const trimmedPrompt = prompt.trim();
  const promptSha256Hex = await sha256HexUtf8(trimmedPrompt);
  const attestationRequired = false;
  const { chainId, genesisHash } = await expectedChainBinding(baseUrl);
  const nonce = await fetchFreshAiNonce(baseUrl, wid);
  const tx = {
    kind: "enterprise_inference",
    enterprise_wallet_id: wid,
    prompt: trimmedPrompt,
    model: model.trim() || "llama3",
    amount_micro: Number(amountMicro),
    nonce: Number(nonce),
    prompt_sha256_hex: promptSha256Hex,
    workload_flag: 1,
    attestation_required: attestationRequired,
  };
  const msg = enterpriseInferenceHybridAuthMessageBytes(
    wid,
    nonce,
    amountMicro,
    promptSha256Hex,
    tx.model,
    attestationRequired,
    sess.mldsa44_pubkey_b64,
    chainId,
    genesisHash,
  );
  const edSig = await Promise.resolve(sess.signEd25519(msg));
  const mldsaSig = await mldsa44SignDeterministic(sess.mldsa44_keypair_b64, msg);
  const envelope = {
    v: 1,
    tx,
    sig: {
      ed25519_pubkey_hex: wid,
      ed25519_sig_b64: u8ToStdBase64(edSig),
      mldsa_pubkey_b64: sess.mldsa44_pubkey_b64,
      mldsa_sig_b64: mldsaSig,
    },
    attestation: {
      platform: "tet-network-ui",
      report_b64: "",
    },
  };
  const txJson = JSON.stringify(tx);
  const taskIdHint = `0x${await sha256HexUtf8(txJson)}`;
  return { envelope, taskIdHint };
}

export async function postEnterpriseInference(
  baseUrl: string,
  walletId64: string,
  prompt: string,
  amountMicro: bigint,
  model = "llama3",
): Promise<EnterpriseInferenceSubmitResult> {
  const wid = normalizeWalletId64(walletId64);
  if (!wid) return { ok: false, status: 400, text: "wallet_id must be 64 hex chars" };
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, status: 400, text: "prompt required" };
  let signed: { envelope: Record<string, unknown>; taskIdHint: string };
  try {
    signed = await signEnterpriseInferenceEnvelope(baseUrl, wid, trimmed, model, amountMicro);
  } catch (e: unknown) {
    return { ok: false, status: 401, text: e instanceof Error ? e.message : String(e) };
  }
  const r = await fetchJson<Record<string, unknown>>(tetCoreUrl(baseUrl, "/enterprise/inference/submit"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signed.envelope),
  });
  if (!r.ok) return { ok: false, status: r.status, text: r.text, task_id_hint: signed.taskIdHint };
  const d = r.data ?? {};
  return {
    ok: true,
    status: r.status,
    queued: d.queued === true,
    workload_flag: typeof d.workload_flag === "number" ? d.workload_flag : undefined,
    task_id_hint: signed.taskIdHint,
  };
}

/* ------------------------------------------------------------------------- *
 * Tmail (Sovereign OS Messages) — off-ledger E2EE messaging REST client.
 * Endpoints mirror tet-core `src/rest/handlers/tmail.rs`.
 * ------------------------------------------------------------------------- */

export type TmailSendResult = {
  ok: boolean;
  status: number;
  msgId?: string;
  /** Set when the node already buffered this `msg_id` (HTTP 409). */
  duplicate?: boolean;
  text?: string;
};

/**
 * `POST /tmail/send` — submit a hybrid-signed Basic E2EE envelope. The node verifies the signature,
 * buffers it locally (dedup by `msg_id`), and gossips it. Returns `202 Accepted`; `409` means the
 * envelope was already buffered (treated as success for idempotent resend).
 */
export async function postTmailSend(baseUrl: string, env: TmailEnvelopeV1): Promise<TmailSendResult> {
  const r = await fetchJson<{ ok?: boolean; msg_id?: string; status?: string }>(
    tetCoreUrl(baseUrl, "/tmail/send"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(env),
    },
  );
  if (r.ok) {
    return { ok: true, status: r.status, msgId: r.data?.msg_id ?? env.msg_id };
  }
  if (r.status === 409) {
    return { ok: true, status: r.status, msgId: env.msg_id, duplicate: true };
  }
  return { ok: false, status: r.status, text: r.text };
}

export type TmailInboxResult = {
  ok: boolean;
  status: number;
  messages: TmailEnvelopeV1[];
  count: number;
  text?: string;
};

/**
 * `GET /tmail/inbox/:wallet_id?limit=N` — non-expired envelopes addressed to `wallet_id`, newest
 * first. The payloads stay encrypted; the caller decrypts with its own KEM secret keys.
 */
export async function getTmailInbox(
  baseUrl: string,
  walletId: string,
  limit = 50,
): Promise<TmailInboxResult> {
  const wid = normalizeWalletId64(walletId);
  if (!wid) return { ok: false, status: 400, messages: [], count: 0, text: "wallet_id must be 64 hex chars" };
  const clamped = Math.max(1, Math.min(200, Math.floor(limit)));
  const r = await fetchJson<{ ok?: boolean; count?: number; messages?: TmailEnvelopeV1[] }>(
    tetCoreUrl(baseUrl, `/tmail/inbox/${wid}`, { limit: String(clamped) }),
  );
  if (!r.ok) return { ok: false, status: r.status, messages: [], count: 0, text: r.text };
  const messages = Array.isArray(r.data?.messages) ? r.data!.messages! : [];
  return { ok: true, status: r.status, messages, count: messages.length };
}

export type TmailKeysResult = {
  ok: boolean;
  status: number;
  /** `null` when the wallet has not registered keys yet (HTTP 404). */
  registration: TmailKeyRegistrationV1 | null;
  text?: string;
};

/** `GET /tmail/keys/:wallet_id` — registered X25519 + ML-KEM keys, or `null` on 404. */
export async function getTmailKeys(baseUrl: string, walletId: string): Promise<TmailKeysResult> {
  const wid = normalizeWalletId64(walletId);
  if (!wid) return { ok: false, status: 400, registration: null, text: "wallet_id must be 64 hex chars" };
  const r = await fetchJson<{ ok?: boolean; registration?: TmailKeyRegistrationV1 }>(
    tetCoreUrl(baseUrl, `/tmail/keys/${wid}`),
  );
  if (r.status === 404) return { ok: true, status: 404, registration: null };
  if (!r.ok) return { ok: false, status: r.status, registration: null, text: r.text };
  return { ok: true, status: r.status, registration: r.data?.registration ?? null };
}

export type TmailPutKeysResult = {
  ok: boolean;
  status: number;
  registeredAtMs?: number;
  text?: string;
};

/** `PUT /tmail/keys/:wallet_id` — register/refresh the wallet's hybrid-signed KEM public keys. */
export async function putTmailKeys(
  baseUrl: string,
  walletId: string,
  registration: TmailKeyRegistrationV1,
): Promise<TmailPutKeysResult> {
  const wid = normalizeWalletId64(walletId);
  if (!wid) return { ok: false, status: 400, text: "wallet_id must be 64 hex chars" };
  const r = await fetchJson<{ ok?: boolean; registered_at_ms?: number }>(
    tetCoreUrl(baseUrl, `/tmail/keys/${wid}`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(registration),
    },
  );
  if (!r.ok) return { ok: false, status: r.status, text: r.text };
  return { ok: true, status: r.status, registeredAtMs: r.data?.registered_at_ms ?? registration.registered_at_ms };
}

/* ------------------------------------------------------------------------- *
 * File Sharing (Sovereign OS Files) — off-ledger E2EE file transfer REST client.
 * Endpoints mirror tet-core `src/rest/handlers/files.rs`.
 * ------------------------------------------------------------------------- */

export type FilesUploadResult = {
  ok: boolean;
  status: number;
  fileId?: string;
  storageNode?: string;
  /** Storage node's consensus wallet id — the 50% payout target for the Step 4 fee settlement. */
  storageWallet?: string;
  feeMicro?: number;
  text?: string;
};

/**
 * `POST /files/upload` — multipart (`envelope` JSON field + `body` encrypted blob). The node verifies
 * the envelope, checks `sha256(body) == file_sha256` + size cap, stores blob+meta+inbox, and gossips
 * the announce. Returns `202 { file_id, storage_node }`.
 */
export async function postFilesUpload(
  baseUrl: string,
  envelope: FileEnvelopeV1,
  bodyCiphertext: Uint8Array,
): Promise<FilesUploadResult> {
  const url = tetCoreUrl(baseUrl, "/files/upload");
  try {
    const form = new FormData();
    form.append("envelope", JSON.stringify(envelope));
    // Copy into a fresh ArrayBuffer-backed view so Blob gets clean bytes regardless of the source.
    const blob = new Blob([bodyCiphertext.slice()], { type: "application/octet-stream" });
    form.append("body", blob, `${envelope.file_id}.bin`);
    const r = await fetch(url, { method: "POST", body: form, headers: { Accept: "application/json" } });
    const text = await r.text();
    if (!r.ok) return { ok: false, status: r.status, text };
    try {
      const data = JSON.parse(text) as {
        file_id?: string;
        storage_node?: string;
        storage_wallet?: string;
        fee_micro?: number;
      };
      return {
        ok: true,
        status: r.status,
        fileId: data.file_id ?? envelope.file_id,
        storageNode: data.storage_node,
        storageWallet: data.storage_wallet,
        feeMicro: data.fee_micro,
      };
    } catch {
      return { ok: true, status: r.status, fileId: envelope.file_id };
    }
  } catch (e: unknown) {
    return { ok: false, status: 0, text: e instanceof Error ? e.message : String(e) };
  }
}

export type FilesAnnounceResult = { ok: boolean; status: number; fileId?: string; text?: string };

/** `POST /files/announce` — verify + gossip a file envelope (metadata only, no blob). */
export async function postFilesAnnounce(baseUrl: string, envelope: FileEnvelopeV1): Promise<FilesAnnounceResult> {
  const r = await fetchJson<{ ok?: boolean; file_id?: string }>(tetCoreUrl(baseUrl, "/files/announce"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!r.ok) return { ok: false, status: r.status, text: r.text };
  return { ok: true, status: r.status, fileId: r.data?.file_id ?? envelope.file_id };
}

export type FilesInboxResult = {
  ok: boolean;
  status: number;
  files: FileEnvelopeV1[];
  count: number;
  text?: string;
};

/**
 * `GET /files/inbox/:wallet_id?limit=N` — non-expired file envelopes addressed to `wallet_id`,
 * newest first. Envelopes carry encrypted filename/MIME; the caller decrypts with its KEM keys.
 */
export async function getFilesInbox(baseUrl: string, walletId: string, limit = 50): Promise<FilesInboxResult> {
  const wid = normalizeWalletId64(walletId);
  if (!wid) return { ok: false, status: 400, files: [], count: 0, text: "wallet_id must be 64 hex chars" };
  const clamped = Math.max(1, Math.min(200, Math.floor(limit)));
  const r = await fetchJson<{ ok?: boolean; count?: number; files?: FileEnvelopeV1[] }>(
    tetCoreUrl(baseUrl, `/files/inbox/${wid}`, { limit: String(clamped) }),
  );
  if (!r.ok) return { ok: false, status: r.status, files: [], count: 0, text: r.text };
  const files = Array.isArray(r.data?.files) ? r.data!.files! : [];
  return { ok: true, status: r.status, files, count: files.length };
}

export type FilesFetchResult = { ok: boolean; status: number; bytes?: Uint8Array; text?: string };

/** `GET /files/fetch/:file_id` — return the encrypted blob bytes (octet-stream), or an error. */
export async function getFilesFetch(baseUrl: string, fileId: string): Promise<FilesFetchResult> {
  const id = fileId.trim();
  const url = tetCoreUrl(baseUrl, `/files/fetch/${encodeURIComponent(id)}`);
  try {
    const r = await fetch(url, { headers: { Accept: "application/octet-stream" } });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return { ok: false, status: r.status, text };
    }
    const buf = await r.arrayBuffer();
    return { ok: true, status: r.status, bytes: new Uint8Array(buf) };
  } catch (e: unknown) {
    return { ok: false, status: 0, text: e instanceof Error ? e.message : String(e) };
  }
}

export type FilesFeeResult = { ok: boolean; status: number; fileId?: string; text?: string };

/**
 * `POST /files/fee` — submit a hybrid-signed `TxV1::FileFee` settlement envelope (Step 4, spec §7).
 * The node prechecks (signature, exact 1000 µTET fee, spendable balance), enqueues into the mempool
 * and gossips; the 25/50/25 treasury/storage/burn split applies when a producer mines it.
 */
export async function postFilesFee(
  baseUrl: string,
  env: import("./transfer").SignedTxEnvelopeV1,
): Promise<FilesFeeResult> {
  const r = await fetchJson<{ ok?: boolean; file_id?: string }>(tetCoreUrl(baseUrl, "/files/fee"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(env),
  });
  if (!r.ok) return { ok: false, status: r.status, text: r.text };
  return { ok: true, status: r.status, fileId: r.data?.file_id };
}

export type FilesDeleteResult = { ok: boolean; status: number; deleted?: boolean; text?: string };

/** `DELETE /files/item/:file_id` — sender-only cancel; body is a hybrid-signed delete request. */
export async function deleteFilesItem(
  baseUrl: string,
  fileId: string,
  req: FileDeleteRequestV1,
): Promise<FilesDeleteResult> {
  const id = fileId.trim();
  const r = await fetchJson<{ ok?: boolean; deleted?: boolean }>(
    tetCoreUrl(baseUrl, `/files/item/${encodeURIComponent(id)}`),
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(req),
    },
  );
  if (!r.ok) return { ok: false, status: r.status, text: r.text };
  return { ok: true, status: r.status, deleted: r.data?.deleted ?? true };
}
