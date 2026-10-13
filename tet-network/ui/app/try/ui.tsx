"use client";

/**
 * The /try look ("Ledger", design pass 2): a light three-column shell, text first. Posts are
 * hairline-separated rows with a dense monospace meta line; badges are plain text in TET's verdict
 * colours; no cards, gradients, avatars or emoji. The desktop at /os keeps Win95.
 */
import { useState, type ReactNode, type Ref } from "react";
import { useLang } from "./i18n";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Text in the verdict colours (wallet ids, badges, errors, confirmations). */
export const INK = {
  ok: "text-[#1f5132]",
  bad: "text-[#8a1f1f]",
  named: "text-[#1a237e]",
  pending: "text-[#6b4e00]",
  neutral: "text-[#5d646d]",
} as const;
export type Tone = keyof typeof INK;

/** Visible keyboard focus, shared by every control on /try. */
export const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[#1a237e] focus-visible:ring-offset-2";

export const MONO = "font-mono [font-family:ui-monospace,'SF_Mono',Menlo,Consolas,monospace]";

/** A badge is plain text in a verdict colour. It reads on its own: no legend, no pill. */
export function Badge(props: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={props.title} className={cx(MONO, "text-[13px]", INK[props.tone])}>
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
        kind !== "quiet" && "min-h-11 rounded-md px-4 text-[15px] font-semibold",
        kind === "primary" && "bg-[#1c1f23] text-white hover:bg-[#33383e]",
        kind === "secondary" && "border border-[#c9ced4] bg-white text-[#1c1f23] hover:border-[#8b9198]",
        kind === "quiet" && "rounded py-1 text-[14px] text-[#3d434a] underline underline-offset-2 hover:text-[#1c1f23]",
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
  className?: string;
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
      className={cx(FOCUS, "w-full resize-y rounded-md border border-[#c9ced4] bg-white px-3 py-2 text-base leading-relaxed disabled:bg-[#f6f7f8]", props.className)}
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
  type?: string;
}) {
  return (
    <label className="block">
      {props.label ? <span className="mb-1 block text-[14px] text-[#3d434a]">{props.label}</span> : null}
      <input
        type={props.type ?? "text"}
        aria-label={props.label ? undefined : props.ariaLabel}
        autoComplete="off"
        spellCheck={props.mono ? false : undefined}
        translate={props.mono ? "no" : undefined}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className={cx(FOCUS, "min-h-11 w-full rounded-md border border-[#c9ced4] bg-white px-3 text-base", props.mono && cx(MONO, "text-[14px]"))}
      />
    </label>
  );
}

/** Pick-one options (recipients, modes), as small outlined toggles. */
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
            "min-h-9 rounded-md border px-3 text-[14px]",
            props.value === o.value ? "border-[#1c1f23] bg-[#1c1f23] text-white" : "border-[#c9ced4] bg-white text-[#1c1f23] hover:border-[#8b9198]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small on/off toggle for the composer ("burn after read", "schedule"). */
export function Toggle(props: { on: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      onClick={() => props.onChange(!props.on)}
      className={cx(
        FOCUS,
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[13.5px]",
        props.on ? "border-[#1a237e] bg-[#f3f4fd] text-[#1a237e]" : "border-[#c9ced4] text-[#3d434a] hover:border-[#8b9198]",
      )}
    >
      <span aria-hidden="true" className={MONO}>
        {props.on ? "✓" : "○"}
      </span>
      {props.children}
    </button>
  );
}

/**
 * The honest limits, as a pinned notice. The first rule always shows; the rest
 * open with one tap, so a phone screen is not all notice.
 */
export function PinnedNotice(props: { lines: ReactNode[] }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [first, ...rest] = props.lines;
  return (
    <div className="my-3 border-l-[3px] border-[#c9a227] bg-[#fffbea] px-3 py-2 text-[14.5px] leading-relaxed text-[#1c1f23]">
      <div className={cx(MONO, "text-[13px] font-semibold text-[#6b4e00]")}>{t("notice")}</div>
      <p className="mt-0.5">{first}</p>
      {open
        ? rest.map((l, i) => (
            <p key={i} className="mt-1">
              {l}
            </p>
          ))
        : null}
      {rest.length ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cx(FOCUS, "mt-1 rounded text-[13px] text-[#6b4e00] underline")}>
          {open ? t("fewer rules") : t("{n} more rules", { n: rest.length })}
        </button>
      ) : null}
    </div>
  );
}

/** The top of every panel: its name, a mono sub-line, an optional action, and what to do first. */
export function PanelHead(props: { title: ReactNode; sub?: ReactNode; action?: ReactNode; todo: ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#e3e5e8] px-4 py-3 md:px-5">
        <h2 className="text-[17px] font-bold">{props.title}</h2>
        {props.sub ? <span className={cx(MONO, "text-[13px] text-[#5d646d]")}>{props.sub}</span> : null}
        {props.action ? <span className="ml-auto">{props.action}</span> : null}
      </div>
      <p className="border-b border-[#e3e5e8] bg-[#fafbfc] px-4 py-2 text-[15px] md:px-5">{props.todo}</p>
    </>
  );
}

/** One inline line asking to publish messaging keys (public), instead of a whole panel. */
export function KeysBanner(props: { what: string; onPublish: () => void; busy: boolean; error?: string }) {
  const { t } = useLang();
  return (
    <div className="mx-4 my-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[#c5cbef] bg-[#f3f4fd] px-3 py-2 text-[14.5px] md:mx-5">
      <span>
        {props.what} {t("Turning it on is public: it shows this ID can receive messages.")}
      </span>
      <Button className="min-h-9 px-3 text-[14px]" disabled={props.busy} onClick={props.onPublish}>
        {props.busy ? t("Publishing…") : t("Turn on inbox")}
      </Button>
      {props.error ? (
        <span role="alert" className={INK.bad}>
          {props.error}
        </span>
      ) : null}
    </div>
  );
}

/** Seconds as "28 s" / "1 min 4 s" (units read the same in all three languages). */
export function fmtSeconds(s: number): string {
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** A short, readable time in the visitor's locale: today as a time, otherwise date and time. */
export function fmtWhen(ms: number, nowMs: number, locale?: string): string {
  const d = new Date(ms);
  const sameDay = new Date(nowMs).toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { timeStyle: "short" } : { dateStyle: "short", timeStyle: "short" }).format(d);
}

/** A calendar date in the visitor's locale. */
export function fmtDate(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(ms));
}

/** A file picker that stays reachable by keyboard (the input is visually hidden, not removed). */
export function FilePick({
  children,
  onFile,
  className,
  ref,
  accept,
}: {
  children: ReactNode;
  onFile: (f: File | null) => void;
  className?: string;
  ref?: Ref<HTMLInputElement>;
  /** File types the picker offers (a hint to the picker, not a check). */
  accept?: string;
}) {
  return (
    <label className={cx("cursor-pointer focus-within:ring-2 focus-within:ring-[#1a237e] focus-within:ring-offset-2", className)}>
      {children}
      <input ref={ref} type="file" accept={accept} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}

/**
 * "Verify without TET": the standalone verifier (public/verify/, scripts/build_offline_verifier.mjs).
 * One file that checks a record on the visitor's own device with no server at all.
 */
export function OfflineVerifier() {
  const { t } = useLang();
  const link = cx(FOCUS, "rounded-sm underline underline-offset-2");
  return (
    <p className="text-[13.5px] text-[#5d646d]">
      {t("Even if TET disappears, this still works:")}{" "}
      <a href="/verify/tet-verify.html" download className={link}>
        {t("the offline verifier")}
      </a>{" "}
      {t("(one file: it checks a record on your device, with the network off)")} ·{" "}
      <a href="/verify/SHA256SUMS" className={link}>
        SHA-256
      </a>
    </p>
  );
}
