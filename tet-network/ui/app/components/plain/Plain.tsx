/**
 * The plain kit: one look for the pages a newcomer reads first (/try's machine-log tab, /agents,
 * /signin, /future). Large type, generous spacing, cards, one accent colour (teal), light and dark,
 * phone width first. Original design; it imitates no product.
 *
 * Text is never written here: every string arrives already translated from the page, so each page's
 * guard can see all its words in its own `t("…")` calls.
 */
import { useState, type ReactNode } from "react";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** The one accent colour, and the two result colours. */
export const PLAIN = {
  accent: "bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400",
  focus: "outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50",
  card: "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7 dark:border-slate-700 dark:bg-slate-900",
  ok: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-50",
  bad: "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-50",
  neutral: "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50",
} as const;

export type PlainTone = "ok" | "bad" | "neutral";

/** The page frame: a readable column with room around it. */
export function PlainPage(props: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">{props.children}</div>
    </main>
  );
}

/** The title and the one plain sentence that says what the page is for. */
export function PlainLead(props: { title: ReactNode; lead: ReactNode; status?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3">
      {props.status ? (
        <p className="w-fit rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300">
          {props.status}
        </p>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{props.title}</h1>
      <p className="text-lg leading-relaxed text-slate-700 sm:text-xl dark:text-slate-300">{props.lead}</p>
    </header>
  );
}

export function PlainCard(props: { children: ReactNode; className?: string }) {
  return <section className={cx(PLAIN.card, props.className)}>{props.children}</section>;
}

/** The one primary action on a page. */
export function PrimaryButton(props: { onClick: () => void; children: ReactNode; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={cx("min-h-12 rounded-xl px-6 py-3 text-lg font-semibold transition disabled:opacity-50", PLAIN.accent, PLAIN.focus)}
    >
      {props.children}
    </button>
  );
}

/** A second, quieter action next to the primary one. */
export function SecondaryButton(props: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={cx(
        "min-h-12 rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800",
        PLAIN.focus,
      )}
    >
      {props.children}
    </button>
  );
}

/**
 * The result first: a colour, a label (VALID / INVALID stay visible) and one short sentence. Details
 * sit behind "Show details".
 */
export function ResultCard(props: {
  tone: PlainTone;
  label: ReactNode;
  sentence: ReactNode;
  /** Required, already translated: the kit holds no words of its own. */
  detailsLabel: ReactNode;
  hideLabel: ReactNode;
  details?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section role="status" aria-live="polite" className={cx("rounded-2xl border-2 p-5 sm:p-7", PLAIN[props.tone])}>
      <div className="flex flex-wrap items-center gap-3">
        <span translate="no" className="rounded-lg bg-white/70 px-3 py-1 font-mono text-base font-bold tracking-wide dark:bg-black/30">
          {props.label}
        </span>
        <p className="text-xl font-semibold leading-snug sm:text-2xl">{props.sentence}</p>
      </div>
      {props.details ? (
        <Details label={props.detailsLabel} hideLabel={props.hideLabel}>
          {props.details}
        </Details>
      ) : null}
      {props.children ? <div className="mt-5">{props.children}</div> : null}
    </section>
  );
}

/** A fold: closed by default. */
export function Details(props: { label: ReactNode; hideLabel: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx("text-base font-medium underline underline-offset-4", PLAIN.focus)}
      >
        {open ? props.hideLabel : props.label}
      </button>
      {open ? <div className="mt-3 text-base leading-relaxed">{props.children}</div> : null}
    </div>
  );
}

/** Shows / Does not show: two short lists, side by side on a wide screen, stacked on a phone. */
export function ShowsBlock(props: { showsTitle: ReactNode; doesNotTitle: ReactNode; shows: ReactNode[]; doesNot: ReactNode[] }) {
  const list = (items: ReactNode[]) => (
    <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-base leading-relaxed">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
  return (
    <div className="grid gap-4 rounded-xl bg-white/60 p-4 sm:grid-cols-2 dark:bg-black/20">
      <div>
        <h3 className="text-base font-semibold">{props.showsTitle}</h3>
        {list(props.shows)}
      </div>
      <div>
        <h3 className="text-base font-semibold">{props.doesNotTitle}</h3>
        {list(props.doesNot)}
      </div>
    </div>
  );
}

/**
 * A place to drop files or a folder. It highlights while something is dragged over it (children
 * included, so the highlight does not flicker over its buttons) and hands the drop's DataTransfer to
 * the page, read synchronously inside the event (its items are gone once the handler returns).
 */
export function DropZone(props: { label: string; onDrop: (dt: DataTransfer) => void; children: ReactNode }) {
  const [depth, setDepth] = useState(0);
  return (
    <div
      role="group"
      aria-label={props.label}
      data-dropzone=""
      onDragEnter={(e) => {
        e.preventDefault();
        setDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => setDepth((d) => Math.max(0, d - 1))}
      onDrop={(e) => {
        e.preventDefault();
        setDepth(0);
        props.onDrop(e.dataTransfer);
      }}
      className={cx(
        "rounded-2xl border-2 border-dashed p-5 text-center transition sm:p-6",
        depth > 0
          ? "border-teal-600 bg-teal-50 dark:border-teal-400 dark:bg-teal-950"
          : "border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/50",
      )}
    >
      {props.children}
    </div>
  );
}

/** A labelled one-line text field. `mono` for values typed as code (a folder, a name, a number). */
export function TextField(props: { label: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; inputMode?: "text" | "numeric" }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-base font-medium">{props.label}</span>
      <input
        type="text"
        autoComplete="off"
        spellCheck={props.mono ? false : undefined}
        translate={props.mono ? "no" : undefined}
        inputMode={props.inputMode}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className={cx(
          "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100",
          props.mono && "font-mono",
          PLAIN.focus,
        )}
      />
    </label>
  );
}
