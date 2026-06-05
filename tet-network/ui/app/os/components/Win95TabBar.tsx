"use client";

import { cx } from "./tokens";

export type Win95Tab = {
  id: string;
  /** Display label (defaults to `id`). */
  label?: string;
};

export type Win95TabBarProps = {
  tabs: ReadonlyArray<Win95Tab>;
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
};

/**
 * Win95 tab strip. Active tab is raised and "connected" to the panel below
 * (it bleeds 1px down over the content seam), inactive tabs sit slightly back.
 * Matches the legacy `TabButton` rendering byte-for-byte.
 */
export default function Win95TabBar(props: Win95TabBarProps) {
  const { tabs, activeTab, onChange, className } = props;
  return (
    <div className={cx("flex items-end gap-1 px-2 pt-2 overflow-x-auto", className)}>
      {tabs.map((t) => {
        const active = activeTab === t.id;
        const label = t.label ?? t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cx(
              "rounded-none border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] px-3 py-1 text-sm select-none",
              active
                ? "bg-[#D4D0C8] relative top-[1px] z-10 border-b-[#D4D0C8]"
                : "bg-[#C0C0C0] border-b-[#808080]",
              "focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-black focus-visible:outline-offset-2",
            )}
          >
            <span
              className={
                active
                  ? "outline outline-1 outline-dotted outline-black outline-offset-[2px] px-0.5"
                  : undefined
              }
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
