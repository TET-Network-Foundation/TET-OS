"use client";

import type { ReactNode } from "react";
import { bevel, surface, cx } from "./tokens";

export type Win95PanelVariant = "outset" | "inset" | "face" | "panel";

export type Win95PanelProps = {
  children: ReactNode;
  /**
   * Surface + bevel recipe:
   *  - `outset` → raised bevel on the panel face (the common "card")
   *  - `inset`  → sunken bevel on the field face (sunken content area)
   *  - `face`   → flat window face, no bevel
   *  - `panel`  → flat panel face, no bevel
   */
  variant?: Win95PanelVariant;
  /** Optional Win95 title bar (navy caption) rendered above the children. */
  title?: ReactNode;
  /** Extra utility classes (padding / layout, e.g. `"p-3"`). */
  className?: string;
};

const VARIANT_CLASS: Record<Win95PanelVariant, string> = {
  outset: cx(bevel.outset, surface.panel),
  inset: cx(bevel.inset, surface.field),
  face: surface.face,
  panel: surface.panel,
};

/**
 * Win95 container. Combines a bevel + surface into the familiar 3D panel.
 * When `title` is provided, renders a navy caption bar above the content.
 */
export default function Win95Panel(props: Win95PanelProps) {
  const { children, variant = "outset", title, className } = props;
  return (
    <div className={cx(VARIANT_CLASS[variant], className)}>
      {title != null ? (
        <div className="bg-[#000080] text-white text-sm font-bold px-2 py-0.5 mb-2 select-none">
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}
