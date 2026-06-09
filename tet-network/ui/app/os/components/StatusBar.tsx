"use client";

export interface StatusBarProps {
  /** Sync badge className. */
  badgeClass: string;
  /** Sync badge text. */
  badgeText: string;
  /** REST base URL. */
  baseUrl: string;
  /** Connected peer count (pre-formatted, "—" when unknown). */
  connectionsDisplay: string;
  /** Whether the security/anon indicator is active (green emphasis). */
  securityActive: boolean;
  /** Security/anon status label. */
  securityLabel: string;
  /** Worker count (pre-formatted, "—" when unknown). */
  workersDisplay: string;
  /** Network compute estimate label (TFLOPS). */
  networkComputeTflopsLabel: string;
  /** Network epoch (pre-formatted, "—" when unknown). */
  epochDisplay: string;
  /** Short PQC status string. */
  pqcStatusShort: string;
  /** Best block height (pre-formatted, "—" when unknown). */
  blockDisplay: string;
  /** Short sync label appended after the block height. */
  shortLabel: string;
}

/**
 * Bottom status bar (Windows-classic chrome) of the OS shell.
 * Extracted verbatim from `OsClient.tsx` (UI Polish Step 9); presentation-only — all
 * values are passed in pre-formatted so this component holds no formatting logic
 * (mirrors `WalletSummaryHeader` / `NetworkStatusPanel`).
 *
 * Note: the status bar uses its own `#D4D0C8` face + 1px bevels (no `tokens.ts`
 * equivalent — `bevel.*` is 2px, `surface.*` is a different tone), so the original
 * class strings are kept verbatim to preserve pixel fidelity.
 */
export default function StatusBar({
  badgeClass,
  badgeText,
  baseUrl,
  connectionsDisplay,
  securityActive,
  securityLabel,
  workersDisplay,
  networkComputeTflopsLabel,
  epochDisplay,
  pqcStatusShort,
  blockDisplay,
  shortLabel,
}: StatusBarProps) {
  return (
    <div className="shrink-0 bg-[#D4D0C8] px-2 py-1 border-t border-l border-b border-r border-t-[#808080] border-l-[#808080] border-b-white border-r-white">
      <div className="flex gap-2 text-sm text-black font-sans">
        <div
          className={`flex-1 min-w-0 px-2 py-0.5 border border-t-[#808080] border-l-[#808080] border-b-white border-r-white rounded-none truncate font-mono text-xs`}
        >
          <span className={badgeClass}>{badgeText}</span>
          <span> · API: {baseUrl}</span>
          <span> · </span>
          <span>
            Connections: {connectionsDisplay} (Post-Quantum P2P)
          </span>
          <span className={securityActive ? " text-[#0b5c2e] font-semibold" : ""}>
            {" "}
            · {securityLabel}
          </span>
          <span className="text-black font-sans text-sm">
            {" "}
            · Workers: {workersDisplay} · Network Compute: ~{networkComputeTflopsLabel} TFLOPS
          </span>
          <span
            className=" text-black/80 tabular-nums"
          >
            {" "}
            · Epoch: {epochDisplay}
          </span>
          <span className="text-black font-sans text-sm">
            {" "}
            · {pqcStatusShort}
          </span>
        </div>
        <div className="w-[min(320px,38vw)] shrink-0 px-2 py-0.5 border border-t-[#808080] border-l-[#808080] border-b-white border-r-white rounded-none text-right font-mono text-xs leading-tight">
          Block: {blockDisplay} {shortLabel}
        </div>
      </div>
    </div>
  );
}
