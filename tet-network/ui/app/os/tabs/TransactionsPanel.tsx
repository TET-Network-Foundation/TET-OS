"use client";

import Win95Button from "../components/Win95Button";
import Win95Panel from "../components/Win95Panel";

/** One row of the local "Recent Transactions" history (mirrors the legacy inline shape). */
export type TxHistoryRow = {
  date: string;
  type: string;
  address: string;
  amount: string;
};

export type TransactionsPanelProps = {
  /** Newest-first local tx history (rendered up to 30 rows). */
  rows: ReadonlyArray<TxHistoryRow>;
  /** Clears the local history (localStorage + state). */
  onClear: () => void;
};

/**
 * Transactions tab — read-only local history table.
 *
 * Extracted verbatim from `OsClient.tsx` as the first proof-of-concept refactor onto the
 * `Win95*` component family. Visual output is identical to the original inline markup:
 * an outset panel wrapping an inset field that holds the table.
 */
export default function TransactionsPanel(props: TransactionsPanelProps) {
  const { rows, onClear } = props;
  return (
    <Win95Panel variant="outset" className="p-3">
      <div className="text-sm mb-2 flex flex-wrap items-center gap-2">
        <span>Recent Transactions</span>
        <Win95Button onClick={onClear} className="px-2 py-0.5 text-xs">
          Clear history
        </Win95Button>
      </div>
      <Win95Panel variant="inset" className="p-2 text-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="text-left font-normal pb-1">Date</th>
              <th className="text-left font-normal pb-1">Type</th>
              <th className="text-left font-normal pb-1">Address</th>
              <th className="text-left font-normal pb-1">Amount</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-2 font-sans text-sm">
                  (no transactions)
                </td>
              </tr>
            ) : (
              rows.slice(0, 30).map((r, idx) => (
                <tr key={idx}>
                  <td className="pr-3 py-0.5 font-sans text-xs">{r.date}</td>
                  <td className="pr-3 py-0.5">{r.type}</td>
                  <td className="pr-3 py-0.5">{r.address}</td>
                  <td className="py-0.5">
                    <div>{r.amount}</div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Win95Panel>
    </Win95Panel>
  );
}
