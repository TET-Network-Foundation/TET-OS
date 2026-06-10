"use client";

import { forwardRef } from "react";
import { bevel, surface } from "./tokens";

export interface LedgerConsoleProps {
  /** Signer label shown right of the header (pre-formatted). */
  signerLabel: string;
  /** Console output, pre-joined with "\n" by the caller — no formatting happens here. */
  text: string;
}

/**
 * Right pane "The Thermodynamic Ledger" console of the OS shell.
 * Extracted verbatim from `OsClient.tsx` (UI Polish Step 10); presentation-only —
 * the ledger lines arrive pre-joined so this component holds no formatting logic
 * (mirrors `StatusBar` / `NetworkStatusPanel`).
 *
 * The forwarded ref targets the inner scrollable output `<div>` so the parent's
 * `appendLedger` auto-scroll (`el.scrollTop = el.scrollHeight`) keeps working unchanged.
 */
const LedgerConsole = forwardRef<HTMLDivElement, LedgerConsoleProps>(
  function LedgerConsole({ signerLabel, text }, ref) {
    return (
      <section className={`${bevel.outset} ${surface.panel} p-3 flex flex-col min-h-0`}>
        <div className="text-sm mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span>The Thermodynamic Ledger</span>
          <span className="text-xs text-black/70">Signer: {signerLabel}</span>
        </div>
        <div
          ref={ref}
          className={`${bevel.inset} ${surface.field} p-2 flex-1 min-h-0 overflow-auto text-xs font-mono text-black whitespace-pre`}
        >
          {text}
        </div>
      </section>
    );
  },
);

export default LedgerConsole;
