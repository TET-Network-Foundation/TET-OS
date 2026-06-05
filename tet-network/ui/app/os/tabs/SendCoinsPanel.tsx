"use client";

import { useEffect, useRef, useState } from "react";
import Win95Button from "../components/Win95Button";
import Win95Field from "../components/Win95Field";
import Win95Panel from "../components/Win95Panel";
import { bevel, surface, cx } from "../components/tokens";

/** Minimal contact shape (structurally compatible with `AddressBookEntryV0`). */
export type SendContact = { label: string; address: string };

/** Pre-formatted fee split strings (TET) — formatting stays in the owner. */
export type SendFeeBreakdown = { netToRecipient: string; feeTotal: string };

export type SendCoinsPanelProps = {
  /** Raw 64-hex sender id (shown as the From tooltip). */
  fromWalletId: string;
  /** Normalized sender id for display (or "" → renders "—"). */
  fromWalletDisplay: string;
  payTo: string;
  onPayToChange: (v: string) => void;
  amount: string;
  onAmountChange: (v: string) => void;
  /** e.g. "(123 Stevemon)" or "". */
  amountStevemonDisplay: string;
  feeBreakdown: SendFeeBreakdown | null;
  memo: string;
  onMemoChange: (v: string) => void;
  /** Status line text (success/failure/info). */
  userMessage: string;
  /** Transfer phase, drives the status line color. */
  phase: string;
  sending: boolean;
  signerReady: boolean;
  buttonLabel: string;
  onSend: () => void;
  /** Address-book contacts for the "From Address Book" picker. */
  contacts: ReadonlyArray<SendContact>;
};

function shortAddr(a: string): string {
  return a.length === 64 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

/**
 * "From Address Book ▾" dropdown — fills the Pay To field from a saved contact.
 * Manual 64-hex entry remains available; this is purely additive (inventory UX
 * pain point #1). Local open state is UI-only.
 */
function AddressBookPicker(props: {
  contacts: ReadonlyArray<SendContact>;
  onPick: (addr: string) => void;
}) {
  const { contacts, onPick } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Win95Button onClick={() => setOpen((v) => !v)} className="px-2 py-0.5 text-xs">
        From Address Book ▾
      </Win95Button>
      {open ? (
        <div
          className={cx(bevel.outset, surface.panel, "absolute left-0 mt-1 z-50 min-w-[18rem] max-h-60 overflow-auto")}
        >
          {contacts.length === 0 ? (
            <div className="px-3 py-2 text-xs text-black/60">No contacts yet — add in Address Book tab</div>
          ) : (
            contacts.map((c, i) => (
              <button
                key={`${c.label}:${i}`}
                type="button"
                onClick={() => {
                  onPick(c.address);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-1 text-left text-sm hover:bg-[#000080] hover:text-white"
              >
                <span className="truncate">{c.label}</span>
                <span className="font-mono text-[11px] opacity-70">{shortAddr(c.address)}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Send Coins tab — controlled transfer form. All transfer state/handlers live in
 * `OsClient`; this panel is a presentation surface built on the `Win95*` family.
 * The existing fields render pixel-identically to the original inline markup; the only
 * addition is the "From Address Book" picker above Pay To.
 */
export default function SendCoinsPanel(props: SendCoinsPanelProps) {
  const {
    fromWalletId,
    fromWalletDisplay,
    payTo,
    onPayToChange,
    amount,
    onAmountChange,
    amountStevemonDisplay,
    feeBreakdown,
    memo,
    onMemoChange,
    userMessage,
    phase,
    sending,
    signerReady,
    buttonLabel,
    onSend,
    contacts,
  } = props;

  return (
    <Win95Panel variant="outset" className="p-3">
      <div className="text-sm mb-2">Send Coins</div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-20">From:</span>
          <span
            className={cx(bevel.inset, "flex-1", surface.field, "px-2 py-1 text-xs font-mono text-black/80 truncate")}
            title={fromWalletId}
          >
            {fromWalletDisplay || "—"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-20" />
          <AddressBookPicker contacts={contacts} onPick={onPayToChange} />
        </div>

        <div className="flex items-center gap-2">
          <span className="w-20">Pay To:</span>
          <Win95Field value={payTo} onChange={onPayToChange} mono className="flex-1" />
        </div>

        <div className="flex items-center gap-2">
          <span className="w-20">Amount:</span>
          <Win95Field value={amount} onChange={onAmountChange} mono placeholder="0.001" className="w-40" />
          <span className="text-sm">TET</span>
          {amountStevemonDisplay ? (
            <span className="text-xs text-black/70">{amountStevemonDisplay}</span>
          ) : null}
        </div>

        {feeBreakdown ? (
          <div className="text-xs text-black/75 pl-[5.5rem] leading-snug">
            Net to recipient: {feeBreakdown.netToRecipient} TET · Fee (1%): {feeBreakdown.feeTotal} TET (½ founder · ½
            burn)
          </div>
        ) : null}

        <div className="flex items-start gap-2">
          <span className="w-20 pt-1">Message:</span>
          <div className="flex-1">
            <Win95Field
              value={memo}
              onChange={onMemoChange}
              maxLength={64}
              placeholder="(Optional local note, not on-chain)"
            />
            <div className="mt-1 text-xs text-black/70">{memo.length} / 64</div>
          </div>
        </div>

        {userMessage ? (
          <div
            className={cx(
              "text-xs pl-[5.5rem] leading-snug",
              phase === "confirmed"
                ? "text-[#0b5c2e] font-medium"
                : phase === "failed"
                  ? "text-red-800 font-medium"
                  : "text-black/75",
            )}
            role="status"
          >
            {userMessage}
          </div>
        ) : null}

        <div className="pt-2">
          <Win95Button
            onClick={onSend}
            disabled={sending || !signerReady}
            className={cx("px-4 py-1 text-sm max-w-full text-left", sending ? "text-xs" : "")}
          >
            {buttonLabel}
          </Win95Button>
        </div>
      </div>
    </Win95Panel>
  );
}
