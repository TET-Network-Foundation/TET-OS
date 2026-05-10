import { fetchJson, normalizeWalletId64, tetCoreUrl } from "./tet_core_http";

export type WorkerCockpitJson = {
  wallet: string;
  role: string;
  online: boolean;
  balance_micro: number;
  estimated_total_rewards_micro: number;
  processed_task_count: number;
  zk_success_count: number;
  daemon: {
    enabled: boolean;
    poll_ms: number;
    current_task_count: number;
  };
  hardware: {
    gpu_detected: boolean;
    gpu_hint: string;
    tflops_est: number;
    caac_latency_ms?: number | null;
    server_wall_ms?: number | null;
    cpu_logical_cores: number;
    ram_total_bytes: number;
  };
  last_seen_ms?: number | null;
};

export type WorkerCockpitResult =
  | { ok: true; status: number; data: WorkerCockpitJson }
  | { ok: false; status: number; error: string };

export async function fetchWorkerCockpit(baseUrl: string, walletId: string): Promise<WorkerCockpitResult> {
  const wid = normalizeWalletId64(walletId);
  if (!wid) {
    return { ok: false, status: 400, error: "wallet_id must be 64 lowercase hex chars" };
  }
  const res = await fetchJson<WorkerCockpitJson>(tetCoreUrl(baseUrl, `/worker/cockpit/${wid}`), {
    cache: "no-store",
  });
  if (!res.ok || !res.data) {
    return { ok: false, status: res.status, error: res.text ?? "worker cockpit unavailable" };
  }
  return { ok: true, status: res.status, data: res.data };
}

export function microTetToTet(micro: number): number {
  if (!Number.isFinite(micro) || micro <= 0) return 0;
  return micro / 1_000_000;
}
