"use client";

/**
 * The /try look: a modern, mobile-first entrance (the desktop at /os keeps Win95). Text first,
 * readable type (16 px and up), one obvious action per panel, and TET's verdict colours for badges.
 * No marketing copy.
 */
import type { ReactNode, Ref } from "react";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** The TET verdict colours. A badge reads on its own: no legend needed. */
export const TONE = {
  ok: "bg-[#e7f5ea] text-[#1f5132] border-[#b9dfc2]",
  pending: "bg-[#fff6dc] text-[#6b4e00] border-[#ecd79a]",
  bad: "bg-[#fdecec] text-[#8a1f1f] border-[#efbcbc]",
  named: "bg-[#eceefb] text-[#1a237e] border-[#c5cbef]",
  neutral: "bg-neutral-100 text-neutral-700 border-neutral-200",
} as const;
export type Tone = keyof typeof TONE;

/** Text in the verdict colours (wallet ids, errors, confirmations). */
export const INK = {
  ok: "text-[#1f5132]",
  bad: "text-[#8a1f1f]",
  named: "text-[#1a237e]",
  pending: "text-[#6b4e00]",
} as const;

/** Visible keyboard focus, shared by every control on /try. */
export const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[#1a237e] focus-visible:ring-offset-2";

export function Badge(props: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={props.title}
      className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-medium", TONE[props.tone])}
    >
      {props.children}
    </span>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "quiet";
  className?: string;
  type?: "button" | "submit";
}) {
  const kind = props.kind ?? "primary";
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={cx(
        FOCUS,
        "transition-[background-color,transform] motion-safe:active:scale-[0.98] disabled:opacity-40",
        kind !== "quiet" && "min-h-11 rounded-xl px-4 text-base font-semibold",
        kind === "primary" && "bg-neutral-900 text-white hover:bg-neutral-800",
        kind === "secondary" && "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50",
        kind === "quiet" && "rounded py-1 text-[15px] font-medium text-neutral-600 underline underline-offset-2 hover:text-neutral-900",
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

export function TextArea(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  maxLength?: number;
  /** Read by screen readers; the placeholder is not a label. */
  label: string;
}) {
  return (
    <textarea
      aria-label={props.label}
      autoComplete="off"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      rows={props.rows ?? 3}
      disabled={props.disabled}
      maxLength={props.maxLength}
      className={cx(FOCUS, "w-full resize-y rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base leading-relaxed disabled:bg-neutral-50")}
    />
  );
}

export function Input(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  /** Shown above the field; without it, `ariaLabel` names the field. */
  label?: string;
  ariaLabel?: string;
}) {
  return (
    <label className="block">
      {props.label ? <span className="mb-1 block text-[15px] text-neutral-600">{props.label}</span> : null}
      <input
        aria-label={props.label ? undefined : props.ariaLabel}
        autoComplete="off"
        spellCheck={props.mono ? false : undefined}
        translate={props.mono ? "no" : undefined}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className={cx(
          FOCUS,
          "min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base",
          props.mono && "font-mono text-[15px]",
        )}
      />
    </label>
  );
}

/** Pick-one chips (recipients, modes). */
export function Chips(props: { options: { label: string; value: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => props.onChange(o.value)}
          aria-pressed={props.value === o.value}
          className={cx(
            FOCUS,
            "min-h-9 rounded-full border px-3 text-[15px]",
            props.value === o.value ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The honest limits, as the pinned first post (`0`). Always there; the first line shows, the rest
 * opens with one tap so a phone screen is not all notice.
 */
export function PinnedNotice(props: { lines: ReactNode[]; title?: string }) {
  const [first, ...rest] = props.lines;
  return (
    <details className="group rounded-xl border border-[#ecd79a] bg-[#fffbeb] px-3 py-2 text-[15px] leading-relaxed text-neutral-800">
      <summary className={cx(FOCUS, "cursor-pointer list-none rounded")}>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[13px] font-semibold text-[#6b4e00]">0</span>
          <span className="text-[14px] font-semibold text-[#6b4e00]">{props.title ?? "Limits"}</span>
          <span className="ml-auto text-[13px] text-[#6b4e00] underline group-open:hidden">{rest.length} more</span>
        </span>
        <span className="mt-1 block">{first}</span>
      </summary>
      {rest.map((l, i) => (
        <p key={i} className="mt-1">
          {l}
        </p>
      ))}
    </details>
  );
}

/** Seconds as "28 s" / "1 min 4 s". */
export function fmtSeconds(s: number): string {
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** A short, readable time in the visitor's locale: today as a time, otherwise date and time. */
export function fmtWhen(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const sameDay = new Date(nowMs).toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay ? { timeStyle: "short" } : { dateStyle: "short", timeStyle: "short" }).format(d);
}

/** A calendar date in the visitor's locale. */
export function fmtDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(ms));
}

/** A file picker that stays reachable by keyboard (the input is visually hidden, not removed). */
export function FilePick({
  children,
  onFile,
  className,
  ref,
}: {
  children: ReactNode;
  onFile: (f: File | null) => void;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <label className={cx("cursor-pointer focus-within:ring-2 focus-within:ring-[#1a237e] focus-within:ring-offset-2", className)}>
      {children}
      <input ref={ref} type="file" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}
