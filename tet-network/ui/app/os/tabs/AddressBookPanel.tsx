"use client";

import { useState } from "react";
import Win95Button from "../components/Win95Button";
import Win95Field from "../components/Win95Field";
import Win95Panel from "../components/Win95Panel";
import type { AddressBookEntryV0 } from "../../lib/address_book_store";

export type AddressBookPanelProps = {
  /** Saved contacts (newest-first), owned by `OsClient`. */
  contacts: ReadonlyArray<AddressBookEntryV0>;
  /** Persist a new contact (trim/cap/localStorage handled by the owner). */
  onAdd: (label: string, addr: string) => void;
};

/**
 * Address Book tab — add + list local contacts.
 *
 * Extracted from `OsClient.tsx` onto the `Win95*` component family. Visual output is
 * identical to the original inline markup. The `label`/`address` draft inputs are local
 * UI state; persistence stays in `OsClient` via {@link AddressBookPanelProps.onAdd}.
 *
 * Note: the inline left-aligned captions are kept as sibling `<span>`s so the row layout
 * stays pixel-identical — `Win95Field` is used in input-only mode (its built-in label is
 * top-aligned).
 */
export default function AddressBookPanel({ contacts, onAdd }: AddressBookPanelProps) {
  const [label, setLabel] = useState("");
  const [addr, setAddr] = useState("");

  return (
    <Win95Panel variant="outset" className="p-3">
      <div className="text-sm mb-2">Address Book</div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-16">Label:</span>
          <Win95Field value={label} onChange={setLabel} className="flex-1" />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16">Address:</span>
          <Win95Field value={addr} onChange={setAddr} mono className="flex-1" />
        </div>
        <div className="pt-1">
          <Win95Button
            className="px-4 py-1 text-sm"
            onClick={() => {
              onAdd(label, addr);
              setLabel("");
              setAddr("");
            }}
          >
            Add
          </Win95Button>
        </div>
      </div>

      <div className="mt-3 text-sm mb-1">Entries</div>
      <Win95Panel variant="inset" className="p-2 text-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="text-left font-normal pb-1">Label</th>
              <th className="text-left font-normal pb-1">Address</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-2 font-sans text-sm">
                  (empty)
                </td>
              </tr>
            ) : (
              contacts.map((e) => (
                <tr key={`${e.label}:${e.created_at_ms}`}>
                  <td className="pr-4 py-0.5">{e.label}</td>
                  <td className="py-0.5">{e.address}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Win95Panel>
    </Win95Panel>
  );
}
