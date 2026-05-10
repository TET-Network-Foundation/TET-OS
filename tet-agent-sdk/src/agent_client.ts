import { buildAiInferHybridHeaders, flopsBigIntToJsonNumber } from "./hybrid_infer.js";
import { loadHybridWalletFromMnemonic } from "./wallet_from_mnemonic.js";
import type { HybridKeyMaterial } from "./types.js";
import { estimateVisionInferFlopsFromPromptChars, type InferCostEstimateJson } from "./estimate.js";

export type AgentClientOptions = {
  /** Tet-Core REST base URL (no trailing slash), e.g. `http://5.75.175.170:5010`. */
  baseUrl: string;
  /** 12-word BIP39 phrase (same normalization as Sovereign OS). */
  mnemonic: string;
};

export type InferenceResult =
  | {
      ok: true;
      responseText: string;
      status: number;
      raw: Record<string, unknown>;
    }
  | {
      ok: false;
      status: number;
      error: string;
      raw?: unknown;
    };

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function fetchInferEstimate(baseUrl: string, flops: bigint): Promise<InferCostEstimateJson | null> {
  const u = new URL("/v1/vision/ai/infer/estimate", baseUrl);
  u.searchParams.set("flops", flops.toString());
  let r: Response;
  try {
    r = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  } catch {
    return null;
  }
  if (!r.ok) return null;
  try {
    return (await r.json()) as InferCostEstimateJson;
  } catch {
    return null;
  }
}

async function fetchAiNonce(baseUrl: string, walletIdHex64: string): Promise<bigint> {
  const u = new URL("/ai/nonce", baseUrl);
  u.searchParams.set("wallet_id", walletIdHex64.trim().toLowerCase());
  const r = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("invalid nonce JSON");
  }
  const n = (j as { nonce?: number }).nonce;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new Error("nonce missing");
  return BigInt(Math.floor(n));
}

export class AgentClient {
  readonly baseUrl: string;
  private readonly wallet: HybridKeyMaterial;

  private constructor(baseUrl: string, wallet: HybridKeyMaterial) {
    this.baseUrl = baseUrl;
    this.wallet = wallet;
  }

  /** Construct from explicit options (mnemonic in memory only — load from `process.env` by your runner). */
  static async create(opts: AgentClientOptions): Promise<AgentClient> {
    const baseUrl = normalizeBaseUrl(opts.baseUrl);
    const w = await loadHybridWalletFromMnemonic(opts.mnemonic);
    const wallet: HybridKeyMaterial = {
      walletIdHex64: w.walletIdHex64,
      mldsa44PubkeyB64: w.mldsa44PubkeyB64,
      mldsa44KeypairB64: w.mldsa44KeypairB64,
      signEd25519: w.signEd25519,
    };
    return new AgentClient(baseUrl, wallet);
  }

  /**
   * Reads `TET_CORE_URL` (default `http://5.75.175.170:5010`) and `TET_MNEMONIC` or `TET_MNEMONIC_12`.
   */
  static async fromEnv(): Promise<AgentClient> {
    const baseUrl = normalizeBaseUrl(process.env.TET_CORE_URL ?? "http://5.75.175.170:5010");
    const m = (process.env.TET_MNEMONIC ?? process.env.TET_MNEMONIC_12 ?? "").trim();
    if (!m) {
      throw new Error("TET_MNEMONIC (or TET_MNEMONIC_12) is required");
    }
    return AgentClient.create({ baseUrl, mnemonic: m });
  }

  get walletIdHex64(): string {
    return this.wallet.walletIdHex64;
  }

  /**
   * Signed `POST /ai/infer` with hybrid auth headers.
   * `maxStevemon`: if > 0, performs a single lightweight estimate GET; aborts before POST when projected ledger debit exceeds the cap.
   */
  async requestInference(prompt: string, maxStevemon: number): Promise<InferenceResult> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return { ok: false, status: 400, error: "prompt required" };
    }

    const flops = estimateVisionInferFlopsFromPromptChars(trimmed.length);

    if (maxStevemon > 0) {
      const est = await fetchInferEstimate(this.baseUrl, flops);
      const total = est?.total_micro_ledger;
      if (typeof total === "number" && Number.isFinite(total) && total > maxStevemon) {
        return {
          ok: false,
          status: 402,
          error: `estimate ${total} micro exceeds max_stevemon ${maxStevemon}`,
        };
      }
    }

    let flopsNum: number;
    try {
      flopsNum = flopsBigIntToJsonNumber(flops);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 400, error: msg };
    }

    const nonce = await fetchAiNonce(this.baseUrl, this.wallet.walletIdHex64);
    const hybrid = await buildAiInferHybridHeaders(this.wallet, trimmed, flops, nonce);
    const url = new URL("/ai/infer", this.baseUrl).toString();
    let r: Response;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...hybrid,
        },
        body: JSON.stringify({
          wallet_id: this.wallet.walletIdHex64,
          prompt: trimmed,
          flops: flopsNum,
          nonce: Number(nonce),
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 0, error: msg };
    }

    const text = await r.text();
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, status: r.status, error: text || `HTTP ${r.status}`, raw: text };
    }

    if (!r.ok) {
      const msg =
        typeof raw.message === "string"
          ? raw.message
          : typeof raw.error === "string"
            ? raw.error
            : text;
      return { ok: false, status: r.status, error: msg, raw };
    }

    if (raw.response != null) {
      return { ok: true, responseText: String(raw.response), status: r.status, raw };
    }
    return { ok: true, responseText: JSON.stringify(raw), status: r.status, raw };
  }
}
