"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getHybridSignerSession } from "../lib/hybrid_signer_session";
import { normalizeWalletId64 } from "../lib/tet_core_http";
import { fetchWorkerCockpit, microTetToTet, type WorkerCockpitJson } from "../lib/worker_cockpit";

const DEFAULT_CORE_URL =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_TET_CORE_URL?.trim()
    ? process.env.NEXT_PUBLIC_TET_CORE_URL.trim()
    : "http://127.0.0.1:5010";

const WALLET_STORAGE_KEY = "tetWorkerCockpitWallet";

function shortWallet(wallet: string): string {
  if (!wallet) return "not connected";
  return `${wallet.slice(0, 8)}...${wallet.slice(-6)}`;
}

function formatTet(micro: number): string {
  const tet = microTetToTet(micro);
  return `${tet.toLocaleString(undefined, { maximumFractionDigits: tet >= 100 ? 2 : 6 })} TET`;
}

function formatTflops(v: number): string {
  return `${(Number.isFinite(v) ? v : 0).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} TFLOPS`;
}

function formatRam(bytes: number): string {
  const gib = bytes / (1024 ** 3);
  return `${gib.toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`;
}

function StatCard(props: {
  label: string;
  value: string;
  sub?: string;
  hot?: boolean;
  pulse?: boolean;
}) {
  return (
    <div
      className={[
        "relative overflow-hidden rounded-2xl border bg-black/50 p-5 shadow-2xl backdrop-blur",
        props.hot ? "border-fuchsia-400/70 shadow-fuchsia-500/20" : "border-cyan-300/30 shadow-cyan-500/10",
        props.pulse ? "animate-pulse" : "",
      ].join(" ")}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />
      <div className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">{props.label}</div>
      <div className="mt-3 text-3xl font-black tracking-tight text-white md:text-4xl">{props.value}</div>
      {props.sub ? <div className="mt-2 text-sm text-cyan-100/60">{props.sub}</div> : null}
    </div>
  );
}

function RoleBadge({ role, online }: { role: string; online: boolean }) {
  const isPoc = role.toUpperCase() === "POC";
  return (
    <div
      className={[
        "inline-flex items-center gap-3 rounded-full border px-5 py-2 text-sm font-black uppercase tracking-[0.28em]",
        isPoc
          ? "border-emerald-300 bg-emerald-400/10 text-emerald-200 shadow-lg shadow-emerald-500/20"
          : "border-sky-300 bg-sky-400/10 text-sky-200 shadow-lg shadow-sky-500/20",
      ].join(" ")}
    >
      <span className={online ? "h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_#6ee7b7]" : "h-2.5 w-2.5 rounded-full bg-rose-400"} />
      {role || "UNKNOWN"} / {online ? "ONLINE" : "STANDBY"}
    </div>
  );
}

export default function WorkerCockpitClient() {
  const [wallet, setWallet] = useState(() => {
    if (typeof window === "undefined") return "";
    const sessionWallet = getHybridSignerSession()?.walletIdHex64 ?? "";
    const stored = window.localStorage.getItem(WALLET_STORAGE_KEY) ?? "";
    return normalizeWalletId64(sessionWallet) || normalizeWalletId64(stored);
  });
  const [data, setData] = useState<WorkerCockpitJson | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [spark, setSpark] = useState(false);
  const previous = useRef<WorkerCockpitJson | null>(null);

  const baseUrl = useMemo(() => DEFAULT_CORE_URL, []);
  const walletValid = normalizeWalletId64(wallet);

  useEffect(() => {
    if (walletValid && typeof window !== "undefined") {
      window.localStorage.setItem(WALLET_STORAGE_KEY, walletValid);
    }
  }, [walletValid]);

  const refresh = useCallback(async () => {
    if (!walletValid) {
      setError("Enter a 64-hex worker wallet id.");
      setData(null);
      return;
    }
    setLoading(true);
    const res = await fetchWorkerCockpit(baseUrl, walletValid);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError("");
    const prev = previous.current;
    const changed =
      !prev ||
      prev.balance_micro !== res.data.balance_micro ||
      prev.processed_task_count !== res.data.processed_task_count ||
      prev.zk_success_count !== res.data.zk_success_count;
    previous.current = res.data;
    setData(res.data);
    setLastUpdated(new Date());
    if (changed) {
      setSpark(true);
      window.setTimeout(() => setSpark(false), 900);
    }
  }, [baseUrl, walletValid]);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [refresh]);

  const role = data?.role ?? "UNKNOWN";
  const online = data?.online ?? false;
  const isPoc = role.toUpperCase() === "POC";

  return (
    <main className="min-h-screen overflow-hidden bg-[#05020b] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_78%_5%,rgba(217,70,239,0.2),transparent_25%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[length:auto,auto,48px_48px,48px_48px]" />
      <section className="relative mx-auto max-w-7xl px-5 py-10 md:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-4 inline-flex rounded-full border border-fuchsia-300/30 bg-fuchsia-500/10 px-4 py-1 text-xs font-bold uppercase tracking-[0.35em] text-fuchsia-100">
              Mainnet Miner Console
            </div>
            <h1 className="text-5xl font-black tracking-tight md:text-7xl">
              WORKER <span className="text-cyan-300 drop-shadow-[0_0_22px_rgba(34,211,238,0.8)]">COCKPIT</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-cyan-100/65">
              PoC/PoR role, live rewards, ZK proof output, and hardware power in one low-latency dashboard.
            </p>
          </div>
          <RoleBadge role={role} online={online} />
        </div>

        <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-black/45 p-4 shadow-2xl shadow-cyan-500/10 backdrop-blur">
          <label className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Worker Wallet</label>
          <div className="mt-3 flex flex-col gap-3 md:flex-row">
            <input
              value={wallet}
              onChange={(e) => setWallet(e.target.value.trim().toLowerCase())}
              placeholder="64-hex wallet id"
              className="min-w-0 flex-1 rounded-xl border border-cyan-300/25 bg-slate-950/80 px-4 py-3 font-mono text-sm text-cyan-50 outline-none ring-0 transition focus:border-cyan-300 focus:shadow-[0_0_28px_rgba(34,211,238,0.25)]"
            />
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-xl border border-fuchsia-300/60 bg-fuchsia-500/15 px-6 py-3 text-sm font-black uppercase tracking-[0.25em] text-fuchsia-100 shadow-lg shadow-fuchsia-500/20 transition hover:bg-fuchsia-400/25"
            >
              Sync
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-cyan-100/55">
            <span>Core: {baseUrl}</span>
            <span>Wallet: {shortWallet(walletValid || wallet)}</span>
            <span>Refresh: 5s</span>
            {lastUpdated ? <span>Last pulse: {lastUpdated.toLocaleTimeString()}</span> : null}
          </div>
          {error ? <div className="mt-3 rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Live Balance"
            value={data ? formatTet(data.balance_micro) : "0 TET"}
            sub="Spendable wallet power"
            hot
            pulse={spark}
          />
          <StatCard
            label="Estimated Rewards"
            value={data ? formatTet(data.estimated_total_rewards_micro) : "0 TET"}
            sub="Cockpit reward meter"
            pulse={spark}
          />
          <StatCard
            label="AI Tasks Cleared"
            value={`${data?.processed_task_count ?? 0}`}
            sub="Settled enterprise inference jobs"
            hot={isPoc}
            pulse={spark}
          />
          <StatCard
            label="ZK Proof Wins"
            value={`${data?.zk_success_count ?? 0}`}
            sub="Verified proof receipts"
            pulse={spark}
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-cyan-300/25 bg-black/45 p-6 shadow-2xl shadow-cyan-500/10">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">Daemon Status</div>
                <div className="mt-2 text-2xl font-black">{data?.daemon.enabled ? "AI Worker Daemon Armed" : "Daemon Disabled"}</div>
              </div>
              <div className={data?.daemon.enabled ? "rounded-full bg-emerald-400/15 px-4 py-2 text-sm font-black text-emerald-200" : "rounded-full bg-rose-400/15 px-4 py-2 text-sm font-black text-rose-200"}>
                {data?.daemon.enabled ? "RUNNING" : "OFF"}
              </div>
            </div>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <Mini label="Current Queue" value={`${data?.daemon.current_task_count ?? 0} tasks`} />
              <Mini label="Poll Interval" value={`${data?.daemon.poll_ms ?? 0} ms`} />
              <Mini label="Heartbeat" value={loading ? "syncing..." : online ? "hot" : "cold"} />
            </div>
          </div>

          <div className="rounded-2xl border border-fuchsia-300/25 bg-black/45 p-6 shadow-2xl shadow-fuchsia-500/10">
            <div className="text-xs uppercase tracking-[0.35em] text-fuchsia-200/70">Hardware Power</div>
            <div className="mt-3 text-4xl font-black text-white">{data ? formatTflops(data.hardware.tflops_est) : "0 TFLOPS"}</div>
            <div className="mt-2 text-sm text-fuchsia-100/60">{data?.hardware.gpu_detected ? `GPU detected: ${data.hardware.gpu_hint}` : "GPU not detected. CPU proving mode."}</div>
            <div className="mt-5 grid gap-3">
              <Mini label="CPU Cores" value={`${data?.hardware.cpu_logical_cores ?? 0}`} />
              <Mini label="RAM" value={data ? formatRam(data.hardware.ram_total_bytes) : "0 GiB"} />
              <Mini label="CAAC Latency" value={data?.hardware.caac_latency_ms != null ? `${data.hardware.caac_latency_ms} ms` : "unverified"} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[10px] uppercase tracking-[0.28em] text-white/40">{label}</div>
      <div className="mt-2 font-mono text-lg font-bold text-cyan-50">{value}</div>
    </div>
  );
}
