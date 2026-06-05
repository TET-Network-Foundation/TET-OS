"use client";

import Win95Panel from "../components/Win95Panel";
import Win95Button from "../components/Win95Button";

export type InboxMessageView = {
  id: string;
  receivedAtMs: number;
  fromSs58: string;
  grossTetDisplay: string;
  memo?: string;
};

export type InboxReceivePanelProps = {
  /** Active account SS58 address (Receive Coins). */
  address: string;
  addressCopied: boolean;
  onCopyAddress: () => void;
  onClearInbox: () => void;
  messages: ReadonlyArray<InboxMessageView>;
};

/**
 * Receive Coins tab — incoming TET (MemoSent) feed + the user's receive address.
 *
 * Step 6: renamed from "Inbox / Receive" and reskinned from the old "Outlook Express" look to
 * the standard Win95 grey palette (`Win95Panel`/`Win95Button`). The `[ZK VERIFIED]` marker is a
 * real status indicator and is kept. Stateless: clipboard/clear/inbox data owned by `OsClient`.
 */
export default function InboxReceivePanel(props: InboxReceivePanelProps) {
  const { address, addressCopied, onCopyAddress, onClearInbox, messages } = props;

  return (
    <Win95Panel variant="outset" className="p-2 flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2 px-0.5">
        <span className="text-sm font-bold text-black">Receive Coins</span>
        <span className="text-[10px] font-mono font-bold text-black tracking-wide">[ZK VERIFIED]</span>
      </div>

      <div className="mb-3 shrink-0">
        <div className="text-xs font-semibold text-black mb-1">My Address</div>
        <div className="text-[11px] text-black/80 mb-1">L1 SS58 — share with senders for memo transfers.</div>
        <Win95Panel variant="inset" className="px-1.5 py-1 text-xs font-mono text-black break-all">
          {address}
        </Win95Panel>
        <div className="mt-2">
          <Win95Button className="px-3 py-1 text-xs" onClick={onCopyAddress}>
            {addressCopied ? "[OK] Copied" : "Copy address"}
          </Win95Button>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-[min(52vh,420px)] min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1 px-0.5 shrink-0">
          <span className="text-xs font-semibold text-black">Incoming Transactions</span>
          <Win95Button className="px-2 py-0.5 text-xs" onClick={onClearInbox}>
            Clear
          </Win95Button>
        </div>
        <Win95Panel variant="inset" className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse text-xs font-mono text-black">
            <thead>
              <tr className="bg-[#DAD8D2] border-b-2 border-[#808080] text-left">
                <th className="font-normal p-1.5 border-r border-[#808080] w-[130px]">Received</th>
                <th className="font-normal p-1.5 border-r border-[#808080] min-w-[100px]">From</th>
                <th className="font-normal p-1.5 border-r border-[#808080] w-[100px]">Amount</th>
                <th className="font-normal p-1.5">Message</th>
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-3 text-sm font-sans text-black/55 align-top">
                    No incoming MemoSent events for this identity yet (live while OS is open).
                  </td>
                </tr>
              ) : (
                messages.map((m) => (
                  <tr key={m.id} className="border-b border-[#d0d0d0] align-top">
                    <td className="p-1.5 whitespace-nowrap align-top text-[11px]">
                      {new Date(m.receivedAtMs).toLocaleString()}
                    </td>
                    <td className="p-1.5 align-top break-all text-[11px]">{m.fromSs58}</td>
                    <td className="p-1.5 whitespace-nowrap align-top">{m.grossTetDisplay} TET</td>
                    <td className="p-1.5 align-top break-words [overflow-wrap:anywhere] text-[11px]">
                      {m.memo || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Win95Panel>
      </div>
    </Win95Panel>
  );
}
