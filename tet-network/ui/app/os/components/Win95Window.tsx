"use client";

import type { ReactNode } from "react";
import { bevel, surface, buttonBevel, cx } from "./tokens";

export type Win95WindowProps = {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** CSS width (number → px). Defaults to a comfortable dialog width. */
  width?: number | string;
  /** CSS height (number → px). Defaults to auto. */
  height?: number | string;
  /** Extra classes on the window body wrapper. */
  className?: string;
  /** Close when the backdrop is clicked (default: true). */
  closeOnBackdrop?: boolean;
  /**
   * Hide the title-bar X button (default: false). Use for mandatory/non-dismissable
   * windows (e.g. a required wallet unlock). Title bar styling is preserved.
   */
  hideClose?: boolean;
  /**
   * Optional short status text shown on the title-bar right side. Only rendered when
   * {@link hideClose} is true (it occupies the slot where the X button would be), e.g.
   * a "Required" marker for a mandatory unlock window.
   */
  badge?: string;
};

function toCss(value: number | string | undefined): string | undefined {
  if (value == null) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * Win95 modal window: navy (#000080) title bar with a raised close button, raised
 * window frame, and a self-managed dimmed backdrop. Drag handle is cosmetic only.
 */
export default function Win95Window(props: Win95WindowProps) {
  const {
    title,
    onClose,
    children,
    width = 480,
    height,
    className,
    closeOnBackdrop = true,
    hideClose = false,
    badge,
  } = props;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        style={{ width: toCss(width), height: toCss(height) }}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx(bevel.outset, surface.panel, "flex flex-col max-w-full max-h-full")}
      >
        <div className="flex items-center justify-between bg-[#000080] text-white px-2 py-1 select-none cursor-default">
          <span className="text-sm font-bold truncate pr-2">{title}</span>
          {hideClose ? (
            badge ? (
              <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-white/85 select-none">
                {badge}
              </span>
            ) : null
          ) : (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={cx(buttonBevel, "bg-[#DAD8D2] text-black px-2 leading-none text-sm")}
            >
              ×
            </button>
          )}
        </div>
        <div className={cx("p-3 overflow-auto min-h-0", className)}>{children}</div>
      </div>
    </div>
  );
}
