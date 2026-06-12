import { fetchJson, normalizeWalletId64, tetCoreUrl } from "./tet_core_http";

export type WorkerRegistryRecordJson = {
  v: number;
  wallet_id: string;
  hardware_id_hex: string;
  hardware_profile: string;
  capabilities: string[];
  tflops_declared: number;
  registered_at_height: number;
  registered_at_ms: number;
  status: string;
  total_rewards_micro: number;
};

export type WorkerListJson = {
  ok: boolean;
  count: number;
  registered_count: number;
  active_heartbeat_count: number;
  registry_total_tflops: number;
  heartbeat_total_tflops: number;
  workers: WorkerRegistryRecordJson[];
};

export type WorkerStatusJson = {
  ok: boolean;
  wallet_id: string;
  registered: boolean;
  registry: WorkerRegistryRecordJson | null;
  worker_bond_micro: number;
  min_worker_bond_micro: number;
  bond_sufficient: boolean;
  online: boolean;
  last_seen_ms?: number | null;
  heartbeat_tflops_est?: number | null;
};

export type WorkerRewardsJson = {
  ok: boolean;
  wallet_id: string;
  registered: boolean;
  balance_micro: number;
  registry_total_rewards_micro: number;
  ai_tasks_cleared: number;
  zk_proof_wins: number;
  estimated_total_rewards_micro: number;
};

export async function postWorkerEnroll(baseUrl: string, envelope: unknown) {
  return fetchJson<{ ok: boolean; status: string; wallet_id: string }>(
    tetCoreUrl(baseUrl, "/worker/enroll"),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope) },
  );
}

export async function fetchWorkerList(baseUrl: string, limit = 64) {
  return fetchJson<WorkerListJson>(tetCoreUrl(baseUrl, `/worker/list?limit=${limit}`), {
    cache: "no-store",
  });
}

export async function fetchWorkerStatus(baseUrl: string, walletId: string) {
  const wid = normalizeWalletId64(walletId);
  if (!wid) return { ok: false as const, status: 400, text: "invalid wallet" };
  return fetchJson<WorkerStatusJson>(tetCoreUrl(baseUrl, `/worker/status/${wid}`), {
    cache: "no-store",
  });
}

export async function fetchWorkerRewards(baseUrl: string, walletId: string) {
  const wid = normalizeWalletId64(walletId);
  if (!wid) return { ok: false as const, status: 400, text: "invalid wallet" };
  return fetchJson<WorkerRewardsJson>(tetCoreUrl(baseUrl, `/worker/rewards/${wid}`), {
    cache: "no-store",
  });
}

/** Best-effort local hardware profile for registration (Phase 0.5 — no GPU integration). */
export function detectLocalWorkerProfile(cockpit?: {
  hardware?: { gpu_detected?: boolean; gpu_hint?: string; tflops_est?: number };
} | null): {
  hardwareIdHex: string;
  hardwareProfile: string;
  capabilities: string[];
  tflopsDeclared: number;
} {
  const gpu = cockpit?.hardware?.gpu_detected ?? false;
  const hint = (cockpit?.hardware?.gpu_hint ?? "").trim() || "cpu-prover";
  const tflops = cockpit?.hardware?.tflops_est ?? 1;
  const profile = gpu ? `gpu-${hint.replace(/\s+/g, "-").toLowerCase()}` : "cpu-prover-v1";
  const caps = gpu ? ["inference", "zk_prove"] : ["zk_prove"];
  const hwSeed = `${profile}|${tflops}|${typeof navigator !== "undefined" ? navigator.userAgent : "node"}`;
  let hash = 0;
  for (let i = 0; i < hwSeed.length; i++) {
    hash = (hash * 31 + hwSeed.charCodeAt(i)) >>> 0;
  }
  const hardwareIdHex = hash.toString(16).padStart(16, "0").slice(0, 32);
  return {
    hardwareIdHex,
    hardwareProfile: profile,
    capabilities: caps,
    tflopsDeclared: tflops,
  };
}
