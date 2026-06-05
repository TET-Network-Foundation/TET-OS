"use client";

import type { FormEvent } from "react";
import type { ExplorerTxJson, LedgerBlockDetailJson } from "../../lib/tet_core_http";
import Win95Panel from "../components/Win95Panel";
import { bevel, surface, buttonBevel, cx } from "../components/tokens";
import { shortHash } from "../lib/format";

export type ExplorerBlockRow = {
  height: number;
  block_id: string;
  state_root?: string;
  tx_count: number;
  ts_ms?: number;
};

export type ExplorerPanelProps = {
  baseUrl: string;
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: (e: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  error: string;
  block: LedgerBlockDetailJson | null;
  tx: ExplorerTxJson | null;
  recentBlocks: ReadonlyArray<ExplorerBlockRow>;
  /** Owner-formatted supply summary strings. */
  totalSupplyDisplay: string;
  totalSupplyTitle: string;
  workerPoolDisplay: string;
  workerPoolTitle?: string;
};

/**
 * TET Explorer tab — block/tx lookup + latest-blocks overview.
 *
 * Extracted verbatim from `OsClient.tsx`. Stateless: query text, fetch results, and the
 * search handler are owned by `OsClient`. Polling/refresh stays in the owner's effects.
 */
export default function ExplorerPanel(props: ExplorerPanelProps) {
  const {
    baseUrl,
    query,
    onQueryChange,
    onSearch,
    loading,
    error,
    block,
    tx,
    recentBlocks,
    totalSupplyDisplay,
    totalSupplyTitle,
    workerPoolDisplay,
    workerPoolTitle,
  } = props;

  return (
    <Win95Panel variant="outset" className="p-3 flex flex-col min-h-[min(74vh,620px)]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-sm font-semibold text-black">TET Explorer</div>
          <div className="text-[11px] text-black/65 mt-0.5 font-mono">
            Unified OS window · blocks, tx hashes, and workload proofs stay inside TET-OS.
          </div>
        </div>
        <div className="text-[11px] font-mono text-black/65">Core: {baseUrl}</div>
      </div>
      <form onSubmit={onSearch} className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className={cx(bevel.inset, surface.field, "min-w-0 flex-1 px-2 py-1 text-sm font-mono outline-none")}
          placeholder="Block height or 64-hex tx hash"
        />
        <button type="submit" disabled={loading} className={cx(buttonBevel, surface.panel, "px-3 py-1 text-sm font-semibold")}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {error ? <div className="mb-2 text-sm font-mono text-red-800">{error}</div> : null}
      <div className={cx(bevel.inset, surface.field, "flex-1 min-h-0 overflow-auto p-2")}>
        {block ? (
          <div className="space-y-3 text-sm">
            <div className="font-semibold">Block #{block.block.height}</div>
            <div className="grid grid-cols-1 gap-2 text-xs font-mono md:grid-cols-2">
              <div className={cx(bevel.inset, "bg-white p-2 break-all")}>block_id: {block.block.block_id}</div>
              <div className={cx(bevel.inset, "bg-white p-2 break-all")}>state_root: {block.block.state_root}</div>
              <div className={cx(bevel.inset, "bg-white p-2")}>tx_count: {block.block.tx_count}</div>
              <div className={cx(bevel.inset, "bg-white p-2")}>
                time: {block.block.ts_ms ? new Date(block.block.ts_ms).toLocaleString() : "—"}
              </div>
            </div>
            <div className="font-semibold">Transactions</div>
            {block.txs.length === 0 ? (
              <div className="text-sm text-black/55">(coinbase-only block)</div>
            ) : (
              <table className="w-full border-collapse text-xs font-mono">
                <tbody>
                  {block.txs.map((t) => (
                    <tr key={t.hash} className="border-b border-black/10 align-top">
                      <td className="py-1 pr-2">#{t.tx_index}</td>
                      <td className="py-1 pr-2 font-semibold">{t.tx_kind}</td>
                      <td className="py-1 break-all">{shortHash(t.hash, 14, 10)}</td>
                      <td className="py-1 pl-2 text-right">{t.workload_flag === 1 ? "AI" : "STD"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : tx ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Transaction</span>
              <span className={cx(bevel.inset, "bg-white px-2 py-0.5 text-xs font-mono")}>{tx.tx_kind}</span>
              <span className={cx(bevel.inset, "bg-white px-2 py-0.5 text-xs font-mono")}>
                {tx.workload_flag === 1 ? "AI workload" : "standard"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs font-mono md:grid-cols-2">
              <div className={cx(bevel.inset, "bg-white p-2 break-all")}>hash: {tx.hash}</div>
              <div className={cx(bevel.inset, "bg-white p-2")}>block: #{tx.block_height}</div>
              <div className={cx(bevel.inset, "bg-white p-2")}>index: {tx.tx_index}</div>
              <div className={cx(bevel.inset, "bg-white p-2 break-all")}>signer: {tx.signer_wallet}</div>
            </div>
            <pre className={cx(bevel.inset, "bg-white p-2 max-h-72 overflow-auto text-[11px] whitespace-pre-wrap break-words")}>
              {JSON.stringify(tx.tx, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Win95Panel variant="outset" className="p-2">
                <div className="text-[11px] uppercase tracking-wide text-black/60">Latest Height</div>
                <div className="mt-1 text-2xl font-mono font-bold">#{recentBlocks[0]?.height ?? "—"}</div>
              </Win95Panel>
              <Win95Panel variant="outset" className="p-2">
                <div className="text-[11px] uppercase tracking-wide text-black/60">Total Supply</div>
                <div className="mt-1 truncate text-lg font-mono font-bold" title={totalSupplyTitle}>
                  {totalSupplyDisplay} TET
                </div>
              </Win95Panel>
              <Win95Panel variant="outset" className="p-2">
                <div className="text-[11px] uppercase tracking-wide text-black/60">Worker Pool</div>
                <div className="mt-1 truncate text-lg font-mono font-bold" title={workerPoolTitle}>
                  {workerPoolDisplay}
                </div>
              </Win95Panel>
            </div>
            <table className="w-full border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b-2 border-[#808080] text-left">
                  <th className="py-1 pr-2 font-normal">Height</th>
                  <th className="py-1 pr-2 font-normal">Block ID</th>
                  <th className="py-1 pr-2 font-normal">State Root</th>
                  <th className="py-1 text-right font-normal">Tx</th>
                </tr>
              </thead>
              <tbody>
                {recentBlocks.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-sm text-black/55">
                      No blocks yet.
                    </td>
                  </tr>
                ) : (
                  recentBlocks.map((b) => (
                    <tr key={`${b.height}-${b.block_id}`} className="border-b border-black/10">
                      <td className="py-1 pr-2 font-bold">#{b.height}</td>
                      <td className="py-1 pr-2 break-all">{shortHash(b.block_id)}</td>
                      <td className="py-1 pr-2 break-all">{shortHash(b.state_root ?? "")}</td>
                      <td className="py-1 text-right">{b.tx_count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Win95Panel>
  );
}
