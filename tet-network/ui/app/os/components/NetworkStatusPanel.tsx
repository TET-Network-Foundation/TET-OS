"use client";

import { bevel } from "./tokens";

const inset = bevel.inset;

export interface NetworkStatusPanelProps {
  /** Adds the green sync tint ring when true. */
  panelGreenTint: boolean;
  /** Sync status dot className. */
  dotClass: string;
  /** Total network supply (compact display, or fallback string). */
  totalSupplyDisplay: string;
  /** Title/tooltip for total supply (full TET, or fallback string). */
  totalSupplyTitle: string;
  /** Total supply in Stevemon; `null` hides the "(… Stevemon)" sub-span. */
  totalSupplyStevemonDisplay: string | null;
  /** Worker pool (compact display, or "—"). */
  workerPoolDisplay: string;
  /** Title/tooltip for worker pool (full TET, or undefined). */
  workerPoolTitle?: string;
  /** Worker pool in Stevemon; `null` hides the "(… Stevemon)" sub-span. */
  workerPoolStevemonDisplay: string | null;
  /** REST base URL. */
  baseUrl: string;
  /** Polling cadence hint line. */
  pollingHint: string;
  /** Shortened state root; `null` hides the root segment. */
  stateRootShort: string | null;
  /** Full state root for the root tooltip. */
  stateRootFull: string | null;
  /** Extra sync detail lines. */
  detailLines: string[];
  /** Network-total burn (compact display); `null` renders "—". */
  burnDisplay: string | null;
  /** Network-total burn in Stevemon (paired with `burnDisplay`). */
  burnStevemonDisplay: string | null;
}

/**
 * Network supply / mining pool / thermodynamic burn status panel (top of OS shell).
 * Extracted verbatim from `OsClient.tsx` (UI Polish Step 8); presentation-only — all
 * values are passed in pre-formatted so this component holds no formatting logic
 * (mirrors `WalletSummaryHeader`).
 */
export default function NetworkStatusPanel({
  panelGreenTint,
  dotClass,
  totalSupplyDisplay,
  totalSupplyTitle,
  totalSupplyStevemonDisplay,
  workerPoolDisplay,
  workerPoolTitle,
  workerPoolStevemonDisplay,
  baseUrl,
  pollingHint,
  stateRootShort,
  stateRootFull,
  detailLines,
  burnDisplay,
  burnStevemonDisplay,
}: NetworkStatusPanelProps) {
  return (
    <div
      className={`${inset} bg-[#c0c0c0] px-3 py-2 text-sm text-black ${
        panelGreenTint ? "shadow-[inset_0_0_0_1px_rgba(42,255,154,0.35)]" : ""
      }`}
    >
      <div className="flex flex-wrap gap-x-6 gap-y-1 items-baseline justify-between">
        <span className="min-w-0 max-w-full truncate">
          <span className={dotClass} aria-hidden />
          Total network supply:{" "}
          <span className="tabular-nums font-semibold" title={totalSupplyTitle}>
            {totalSupplyDisplay}
          </span>{" "}
          TET
          {totalSupplyStevemonDisplay != null ? (
            <span className="text-[#2a4a3a] font-medium hidden xl:inline">
              {" "}
              (<span className="tabular-nums">{totalSupplyStevemonDisplay}</span> Stevemon)
            </span>
          ) : null}
        </span>
        <span className="min-w-0 max-w-full truncate">
          Worker pool (ledger):{" "}
          <span
            className="tabular-nums font-semibold"
            title={workerPoolTitle}
          >
            {workerPoolDisplay}
          </span>{" "}
          TET
          {workerPoolStevemonDisplay != null ? (
            <span className="text-[#2a4a3a] font-medium hidden xl:inline">
              {" "}
              (<span className="tabular-nums">{workerPoolStevemonDisplay}</span>{" "}
              Stevemon)
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-black/65">
        API: {baseUrl} · {pollingHint}
        {stateRootShort != null ? (
          <>
            {" "}
            · root{" "}
            <span className="font-mono" title={stateRootFull ?? undefined}>
              {stateRootShort}
            </span>
          </>
        ) : null}
      </div>
      {detailLines.length > 0 ? (
        <div className="mt-0.5 font-mono text-[10px] text-black/70 space-y-0.5">
          {detailLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}
      <div className="mt-1 text-sm text-black tabular-nums leading-snug">
        [THERMODYNAMIC BURN]{" "}
        <span className="text-[10px] font-sans text-black/55 normal-case">(network total)</span> Extinguished:{" "}
        {burnDisplay != null ? (
          <>
            <span className="font-mono font-semibold">
              {burnDisplay}
            </span>{" "}
            TET
            <span className="text-[#2a4a3a] font-medium font-sans hidden xl:inline">
              {" "}
              (
              <span className="tabular-nums font-mono">{burnStevemonDisplay}</span>{" "}
              Stevemon)
            </span>
          </>
        ) : (
          <span className="font-mono">—</span>
        )}
      </div>
    </div>
  );
}
