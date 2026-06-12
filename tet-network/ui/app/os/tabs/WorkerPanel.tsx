"use client";

import type { WorkerCockpitJson } from "../../lib/worker_cockpit";
import type { WorkerListJson, WorkerRewardsJson, WorkerStatusJson } from "../../lib/worker_network";
import Win95Panel from "../components/Win95Panel";
import { bevel, surface, cx } from "../components/tokens";
import { formatWorkerTet, formatTflops } from "../lib/format";

export type WorkerPanelProps = {
  caacLine: string;
  error: string;
  /** Normalized wallet id (empty → "unlock required"). */
  walletLabel: string;
  updatedAt: number | null;
  loading: boolean;
  onStartMining: () => void;
  miningOn: boolean;
  onMiningToggle: (on: boolean) => void;
  cockpit: WorkerCockpitJson | null;
  log: ReadonlyArray<string>;
  /** On-chain worker status (Phase 0.5). */
  workerStatus: WorkerStatusJson | null;
  workerRewards: WorkerRewardsJson | null;
  networkWorkers: WorkerListJson | null;
  enrollBusy: boolean;
  enrollError: string;
  onBecomeWorker: () => void;
};

/**
 * Worker tab — mainnet miner console + Phase 0.5 registration scaffold.
 *
 * "Start Mining" arms the local daemon SSE log stream; "Become a worker" submits the on-chain
 * `TxV1::WorkerRegister` (requires worker bond). Actual inference workload routing = Phase 1.
 */
export default function WorkerPanel(props: WorkerPanelProps) {
  const {
    caacLine,
    error,
    walletLabel,
    updatedAt,
    loading,
    onStartMining,
    miningOn,
    onMiningToggle,
    cockpit,
    log,
    workerStatus,
    workerRewards,
    networkWorkers,
    enrollBusy,
    enrollError,
    onBecomeWorker,
  } = props;

  const registered = workerStatus?.registered ?? false;
  const bondOk = workerStatus?.bond_sufficient ?? false;
  const canEnroll = Boolean(walletLabel && walletLabel !== "unlock required" && bondOk && !registered);

  return (
    <Win95Panel variant="outset" className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-sm font-semibold text-black">Worker</div>
          <div className="text-[11px] text-black/65 mt-0.5 font-mono">
            Join the network as a worker, then arm the local runtime for AI settlement.
          </div>
        </div>
        <div className={cx(bevel.inset, surface.field, "px-2 py-1 text-xs font-mono")}>
          CAAC: {caacLine}
        </div>
      </div>
      {error ? <div className="mb-2 text-sm font-mono text-red-800">{error}</div> : null}
      {enrollError ? <div className="mb-2 text-sm font-mono text-red-800">{enrollError}</div> : null}

      <div className={cx(bevel.inset, surface.field, "p-2 text-xs font-mono break-all mb-3")}>
        Wallet: {walletLabel || "unlock required"} · Refresh: 5s
        {updatedAt ? ` · Last pulse: ${new Date(updatedAt).toLocaleTimeString()}` : ""}
        {loading ? " · syncing…" : ""}
      </div>

      {/* My Worker Status */}
      <Win95Panel variant="outset" className="p-3 mb-3">
        <div className="text-sm font-semibold mb-2">My Worker Status</div>
        {!walletLabel || walletLabel === "unlock required" ? (
          <div className="text-xs font-mono text-black/70">Unlock your wallet to register as a worker.</div>
        ) : !registered ? (
          <div className="space-y-2">
            <div className="text-xs font-mono">
              {bondOk
                ? "Not registered on-chain. Stake is sufficient — submit registration to join the worker registry."
                : `Worker bond below minimum (${formatWorkerTet(workerStatus?.min_worker_bond_micro ?? 1_000_000_000)} required). Stake via Ledger → Worker bond, then retry.`}
            </div>
            <button
              type="button"
              disabled={!canEnroll || enrollBusy}
              onClick={onBecomeWorker}
              className={cx(
                bevel.outset,
                "px-3 py-2 text-sm font-semibold disabled:opacity-50",
                canEnroll ? "bg-[#000080] text-white" : surface.field,
              )}
            >
              {enrollBusy ? "Registering…" : "Become a worker"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs font-mono">
            <div>
              Status: <span className="font-bold">{workerStatus?.registry?.status ?? "registered"}</span>
              {workerStatus?.online ? " · heartbeat ONLINE" : " · heartbeat offline"}
            </div>
            <div>
              Profile: {workerStatus?.registry?.hardware_profile ?? "—"}
            </div>
            <div>
              Bond: {formatWorkerTet(workerStatus?.worker_bond_micro ?? 0)}
            </div>
            <div>
              Rewards (est.): {formatWorkerTet(workerRewards?.estimated_total_rewards_micro ?? 0)}
            </div>
            <div className="sm:col-span-2">
              Capabilities: {(workerStatus?.registry?.capabilities ?? []).join(", ") || "—"}
            </div>
          </div>
        )}
      </Win95Panel>

      {/* Network Workers */}
      <Win95Panel variant="outset" className="p-3 mb-3">
        <div className="text-sm font-semibold mb-2">Network Workers</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs font-mono">
          <div>
            <div className="text-black/60 uppercase tracking-wide">Registered</div>
            <div className="text-lg font-bold">{networkWorkers?.registered_count ?? 0}</div>
          </div>
          <div>
            <div className="text-black/60 uppercase tracking-wide">Heartbeat active</div>
            <div className="text-lg font-bold">{networkWorkers?.active_heartbeat_count ?? 0}</div>
          </div>
          <div>
            <div className="text-black/60 uppercase tracking-wide">Registry TFLOPS</div>
            <div className="text-lg font-bold">
              {formatTflops(networkWorkers?.registry_total_tflops ?? 0)}
            </div>
          </div>
          <div>
            <div className="text-black/60 uppercase tracking-wide">Live TFLOPS</div>
            <div className="text-lg font-bold">
              {formatTflops(networkWorkers?.heartbeat_total_tflops ?? 0)}
            </div>
          </div>
        </div>
      </Win95Panel>

      <button
        type="button"
        onClick={onStartMining}
        className={[
          "mb-3 w-full rounded-none border-2 px-3 py-3 text-left font-mono",
          "border-t-white border-l-white border-b-[#404040] border-r-[#404040]",
          "bg-[#101010] text-[#d7d7d7]",
          "shadow-[inset_0_0_0_1px_rgba(0,255,128,0.18)] active:border-t-[#404040] active:border-l-[#404040] active:border-b-white active:border-r-white active:translate-x-px active:translate-y-px",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-base font-bold tracking-[0.08em]">Start Mining (GPU)</span>
          <span className={miningOn ? "animate-pulse text-[#39ff88]" : "text-[#9a9a9a]"}>
            {miningOn ? "[ WORKER ONLINE ]" : "[ ARM WORKER ]"}
          </span>
        </div>
        <div className="mt-1 text-xs text-[#9a9a9a]">
          Arms the local daemon channel for proof generation and L1 settlement (Phase 1 routes useful work).
        </div>
      </button>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Win95Panel variant="outset" className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-black/60">Live Balance</div>
          <div className="mt-1 text-2xl font-mono font-bold">
            {cockpit ? formatWorkerTet(cockpit.balance_micro) : "0 TET"}
          </div>
        </Win95Panel>
        <Win95Panel variant="outset" className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-black/60">Estimated Rewards</div>
          <div className="mt-1 text-2xl font-mono font-bold">
            {workerRewards
              ? formatWorkerTet(workerRewards.estimated_total_rewards_micro)
              : cockpit
                ? formatWorkerTet(cockpit.estimated_total_rewards_micro)
                : "0 TET"}
          </div>
        </Win95Panel>
        <Win95Panel variant="outset" className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-black/60">AI Tasks Cleared</div>
          <div className="mt-1 text-2xl font-mono font-bold">
            {workerRewards?.ai_tasks_cleared ?? cockpit?.processed_task_count ?? 0}
          </div>
        </Win95Panel>
        <Win95Panel variant="outset" className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-black/60">ZK Proof Wins</div>
          <div className="mt-1 text-2xl font-mono font-bold">
            {workerRewards?.zk_proof_wins ?? cockpit?.zk_success_count ?? 0}
          </div>
        </Win95Panel>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className={cx(bevel.inset, surface.field, "p-2 text-sm")}>
          <div className="font-semibold mb-1">Daemon Status</div>
          <div className="font-mono text-xs">
            state: {cockpit?.daemon.enabled ? "RUNNING" : "OFF"} · queue:{" "}
            {cockpit?.daemon.current_task_count ?? 0} tasks · poll: {cockpit?.daemon.poll_ms ?? 0}ms
          </div>
        </div>
        <div className={cx(bevel.inset, surface.field, "p-2 text-sm")}>
          <div className="font-semibold mb-1">Hardware Power</div>
          <div className="font-mono text-xs">
            {cockpit ? formatTflops(cockpit.hardware.tflops_est) : "0 TFLOPS"} · CPU{" "}
            {cockpit?.hardware.cpu_logical_cores ?? 0} · RAM{" "}
            {cockpit ? `${(cockpit.hardware.ram_total_bytes / 1024 ** 3).toFixed(1)}GiB` : "0GiB"} ·{" "}
            {cockpit?.hardware.gpu_detected ? `GPU ${cockpit.hardware.gpu_hint}` : "CPU proving"}
          </div>
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm select-none">
        <input type="checkbox" checked={miningOn} onChange={(e) => onMiningToggle(e.target.checked)} />
        Local worker runtime enabled
      </label>
      <div className="mt-2 text-sm mb-1">Worker Log</div>
      <div className={cx(bevel.inset, surface.field, "p-2 h-[24vh] overflow-auto text-xs font-mono whitespace-pre text-black")}>
        {log.join("\n")}
      </div>
    </Win95Panel>
  );
}
