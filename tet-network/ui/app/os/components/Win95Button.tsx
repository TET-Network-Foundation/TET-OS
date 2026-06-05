"use client";

import type { ReactNode } from "react";
import { buttonBevel, cx } from "./tokens";

export type Win95ButtonVariant = "default" | "primary" | "danger";

export type Win95ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: Win95ButtonVariant;
  type?: "button" | "submit" | "reset";
  /** Extra utility classes (padding / text size, e.g. `"px-2 py-0.5 text-xs"`). */
  className?: string;
  title?: string;
  ariaLabel?: string;
};

/**
 * Classic Win95 push button. Raised bevel by default; depresses on `:active`
 * (handled by {@link buttonBevel}). Padding/typography are intentionally left to
 * the caller via `className` so call sites stay pixel-identical to the legacy markup.
 */
const VARIANT_CLASS: Record<Win95ButtonVariant, string> = {
  default: "bg-[#DAD8D2] text-black",
  primary: "bg-[#DAD8D2] text-black font-bold",
  danger: "bg-[#DAD8D2] text-[#8a1f1f]",
};

export default function Win95Button(props: Win95ButtonProps) {
  const { children, onClick, disabled = false, variant = "default", type = "button", className, title, ariaLabel } = props;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cx(
        buttonBevel,
        VARIANT_CLASS[variant],
        disabled ? "opacity-60 cursor-default" : "",
        className,
      )}
    >
      {children}
    </button>
  );
}
