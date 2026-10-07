"use client";

/**
 * A panel's honest limits as a board's rules post (`>>0`): plain, always visible, short lines.
 * Every /try panel opens with one.
 */
import type { ReactNode } from "react";
import { bevel, cx } from "../os/components/tokens";

export default function Notice(props: { items: ReactNode[]; label?: string }) {
  return (
    <div className={cx(bevel.inset, "bg-[#fffdf3] px-2 py-1 font-mono text-[11px] leading-[1.45] text-black/80")}>
      <div className="text-[#6b4e00]">
        <span className="font-bold">0</span> · {props.label ?? "notice"}
      </div>
      {props.items.map((it, i) => (
        <div key={i}>· {it}</div>
      ))}
    </div>
  );
}

/** One line saying what to do first. */
export function Hint(props: { children: ReactNode }) {
  return <p className="mb-1 font-mono text-[12px] text-black/80">{props.children}</p>;
}
