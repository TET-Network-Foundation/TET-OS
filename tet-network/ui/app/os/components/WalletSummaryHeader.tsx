"use client";

import { bevel, surface } from "./tokens";

const outset = bevel.outset;
const inset = bevel.inset;
const panel = surface.panel;
const field = surface.field;

export interface WalletSummaryHeaderProps {
  /** Local CAAC role label (e.g. "Poc"). */
  visionCaacRole: string;
  /** Network-wide CAAC summary line. */
  networkCaacLine: string;
  /** Pre-formatted wallet balance in TET (already display-ready, e.g. "—" when unknown). */
  balanceTetDisplay: string;
  /** Pre-formatted wallet balance in Stevemon. */
  balanceStevemonDisplay: string;
  /** Pre-formatted ledger burn for this wallet in TET; `null` hides the burn line. */
  burnTetFullDisplay: string | null;
  /** Pre-formatted ledger burn for this wallet in Stevemon (paired with `burnTetFullDisplay`). */
  burnStevemonDisplay: string | null;
  /** 64-hex wallet id. */
  walletId: string;
  /** Active signer address. */
  signerAddress: string;
}

/**
 * Persistent wallet/identity summary shown above the tab content in the OS shell.
 * Extracted verbatim from `OsClient.tsx` (UI Polish Step 7); presentation-only — all
 * values are passed in pre-formatted so this component holds no formatting logic.
 */
export default function WalletSummaryHeader({
  visionCaacRole,
  networkCaacLine,
  balanceTetDisplay,
  balanceStevemonDisplay,
  burnTetFullDisplay,
  burnStevemonDisplay,
  walletId,
  signerAddress,
}: WalletSummaryHeaderProps) {
  return (
    <div className={`${outset} ${panel} p-3`}>
      <div className="mb-2">
        <div className="text-sm font-semibold text-black">AI Task Terminal</div>
        <div className="text-[11px] text-black/70 mt-1 font-mono">
          CAAC: local {visionCaacRole} · network {networkCaacLine}
        </div>
      </div>
      <div className="text-sm font-mono text-black">
        Balance: {balanceTetDisplay} TET ({balanceStevemonDisplay} Stevemon)
        {burnTetFullDisplay != null ? (
          <span className="text-[11px] text-black/75">
            {" "}
            · Burned (ledger, this wallet):{" "}
            <span className="font-mono font-semibold tabular-nums text-black/90">
              {burnTetFullDisplay}
            </span>{" "}
            TET
            <span className="text-[#2a4a3a] font-medium font-sans">
              {" "}
              (
              <span className="tabular-nums font-mono">
                {burnStevemonDisplay}
              </span>{" "}
              Stevemon)
            </span>
          </span>
        ) : null}
      </div>
      <div className="mt-2">
        <div className="text-sm mb-1">Wallet ID:</div>
        <div className={`${inset} ${field} px-2 py-1 text-sm font-mono break-all`}>{walletId}</div>
      </div>
      <div className="mt-2">
        <div className="text-sm mb-1">Address (signer):</div>
        <div className={`${inset} ${field} px-2 py-1 text-sm font-mono`}>{signerAddress}</div>
      </div>
    </div>
  );
}
