"use client";

import { useEffect, useRef, useState } from "react";
import { bevel, surface, cx } from "./tokens";

export type Win95MenuItem = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
};

export type Win95MenuProps = {
  /** Menu label, e.g. `"File"`. The first character is underlined as the hotkey. */
  label: string;
  items: ReadonlyArray<Win95MenuItem>;
  /** Override the underlined hotkey character (defaults to the first letter). */
  hotkey?: string;
  /** Fired with the selected item after its own `onClick` runs. */
  onSelect?: (item: Win95MenuItem) => void;
};

/**
 * Win95 menu-bar dropdown (File / Options / Help style). Self-manages its open
 * state and closes on outside click. The label's hotkey letter is underlined and
 * the trigger inverts to navy (#000080) while open — matching the legacy
 * `MenuButton` + `MenuDropdown` pair.
 */
export default function Win95Menu(props: Win95MenuProps) {
  const { label, items, hotkey, onSelect } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const hk = (hotkey ?? label.charAt(0)).charAt(0);
  const hkIndex = label.indexOf(hk);
  const before = hkIndex >= 0 ? label.slice(0, hkIndex) : "";
  const mid = hkIndex >= 0 ? label.charAt(hkIndex) : label.charAt(0);
  const after = hkIndex >= 0 ? label.slice(hkIndex + 1) : label.slice(1);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cx("px-2 py-0.5 text-sm select-none", open ? "bg-[#000080] text-white" : "")}
      >
        {before}
        <span className="underline underline-offset-2">{mid}</span>
        {after}
      </button>
      {open ? (
        <div
          className={cx(bevel.outset, surface.panel, "absolute mt-1 text-sm z-50")}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick?.();
                onSelect?.(it);
              }}
              className={cx(
                "block w-full text-left px-4 py-1",
                it.disabled ? "opacity-50 cursor-default" : "hover:bg-[#000080] hover:text-white",
              )}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
