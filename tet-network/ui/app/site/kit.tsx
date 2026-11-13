"use client";
/**
 * The public site's kit: one look for the home page and its five sections. Built on the plain kit
 * (app/components/plain/Plain.tsx): large type, cards, one accent colour (teal), light and dark, phone
 * first. Original design.
 *
 * Rules the kit enforces by construction (scripts/site_guard.mjs checks the pages use it):
 * - a feature is shown only through <FeatureCard id="…">, which looks it up in app/site/features and
 *   always renders its status and its Shows / Does not show;
 * - images come only from /site/… (drawn for this site, or screenshots of our own pages);
 * - every string goes through t() so the guard sees it and its Japanese.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ShowsBlock } from "../components/plain/Plain";
import { feature, SECTIONS } from "./features";
import { useSite, type SiteT } from "./i18n";
import type { Status } from "./types";

const cx = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(" ");
const FOCUS = "outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50 rounded-lg";

/** What each status means, in a phrase. */
export const STATUS_TEXT: Record<Status, { label: string; means: string; tone: string }> = {
  running: { label: "Running", means: "works today for anyone", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" },
  prototype: { label: "Prototype", means: "built, runs only on your own computer", tone: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100" },
  planned: { label: "Planned", means: "decided, not built", tone: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100" },
  idea: { label: "Idea", means: "not decided; being studied", tone: "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100" },
};

export function StatusBadge(props: { status: Status }) {
  const { t } = useSite();
  const s = STATUS_TEXT[props.status];
  return (
    <span title={t(s.means)} className={cx("inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-semibold", s.tone)}>
      {t(s.label)}
      <span className="sr-only">: {t(s.means)}</span>
    </span>
  );
}

const NAV = [
  { href: "/tags", label: "Tags" },
  { href: "/machines", label: "Machines" },
  { href: "/keys", label: "Keys" },
  { href: "/services", label: "Services" },
  { href: "/research", label: "Research" },
];

/** Header, language switch and footer around every page of the site. */
export function SiteFrame(props: { children: ReactNode }) {
  const { lang, t, setLang } = useSite();
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" className={cx("text-xl font-bold tracking-tight", FOCUS)}>
            TET
          </Link>
          <nav aria-label={t("Sections")} className="order-3 flex w-full gap-4 overflow-x-auto text-base sm:order-none sm:w-auto">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={cx("whitespace-nowrap py-1 text-slate-700 hover:text-teal-700 dark:text-slate-300 dark:hover:text-teal-300", FOCUS)}>
                {t(n.label)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex gap-1 text-sm" role="group" aria-label={t("Language")}>
            {(["en", "ja"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={cx("rounded-lg px-3 py-1.5", lang === l ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-700 dark:text-slate-300", FOCUS)}
              >
                {l === "en" ? "English" : "日本語"}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main>{props.children}</main>
      <footer className="mt-20 border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-10 text-base text-slate-600 sm:px-6 dark:text-slate-400">
          <p>{t("Open source. Every feature on this site carries a status, and the status matches the repository.")}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {(["running", "prototype", "planned", "idea"] as const).map((s) => (
              <span key={s}>
                <strong>{t(STATUS_TEXT[s].label)}</strong>: {t(STATUS_TEXT[s].means)}
              </span>
            ))}
          </p>
          <a href="https://github.com/TET-Network-Foundation/TET-OS" className={cx("w-fit underline underline-offset-4", FOCUS)}>
            {t("The code on GitHub")}
          </a>
        </div>
      </footer>
    </div>
  );
}

/** The top of a page: one plain sentence, large, and an illustration beside it. */
export function Hero(props: { title: string; sentence: string; art?: ReactNode }) {
  const { t } = useSite();
  return (
    <section className="mx-auto grid max-w-5xl items-center gap-8 px-4 pb-10 pt-12 sm:px-6 sm:pt-20 md:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-5">
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{t(props.title)}</h1>
        <p className="text-xl leading-relaxed text-slate-700 sm:text-2xl dark:text-slate-300">{t(props.sentence)}</p>
      </div>
      {props.art ? <div className="mx-auto w-full max-w-sm">{props.art}</div> : null}
    </section>
  );
}

/** A short section with a heading. */
export function SiteSection(props: { title: string; id?: string; lead?: string; children: ReactNode }) {
  const { t } = useSite();
  return (
    <section id={props.id} className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t(props.title)}</h2>
      {props.lead ? <p className="mt-3 max-w-3xl text-lg leading-relaxed text-slate-700 dark:text-slate-300">{t(props.lead)}</p> : null}
      <div className="mt-6">{props.children}</div>
    </section>
  );
}

export function CardGrid(props: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{props.children}</div>;
}

/** Shows / Does not show in the site's words (the plain kit's block, translated). */
export function ShowsDoesNot(props: { shows: string[]; doesNot: string[] }) {
  const { t } = useSite();
  return <ShowsBlock showsTitle={t("Shows")} doesNotTitle={t("Does not show")} shows={props.shows.map((s) => t(s))} doesNot={props.doesNot.map((s) => t(s))} />;
}

/**
 * One feature, from the registry: title, status, summary, Shows / Does not show, and a link to the
 * real page when there is one. There is no other way to show a feature on the site.
 */
export function FeatureCard(props: { id: string }) {
  const { t } = useSite();
  const f = feature(props.id);
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xl font-semibold">{t(f.title)}</h3>
        <StatusBadge status={f.status} />
      </div>
      <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300">{t(f.summary)}</p>
      <ShowsDoesNot shows={f.shows} doesNot={f.doesNot} />
      {f.link ? (
        <Link href={f.link.href} className={cx("w-fit rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white hover:bg-teal-800 dark:bg-teal-500 dark:text-slate-950", FOCUS)}>
          {t(f.link.label)}
        </Link>
      ) : null}
    </article>
  );
}

/** An illustration or a screenshot. Only files under /site/ (drawn for this site, or our own pages). */
export function Figure(props: { src: `/site/${string}`; alt: string; caption?: string; wide?: boolean }) {
  const { t } = useSite();
  return (
    <figure className={cx("flex flex-col gap-2", props.wide ? "" : "mx-auto max-w-xl")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={props.src} alt={t(props.alt)} className="w-full rounded-2xl border border-slate-200 dark:border-slate-700" />
      {props.caption ? <figcaption className="text-sm text-slate-600 dark:text-slate-400">{t(props.caption)}</figcaption> : null}
    </figure>
  );
}

/** A clearly labelled guess (e.g. "Where we think this goes"). */
export function Guess(props: { title: string; children: ReactNode }) {
  const { t } = useSite();
  return (
    <aside className="rounded-2xl border-2 border-dashed border-slate-300 p-6 dark:border-slate-600">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("A guess, not a plan")}</p>
      <h3 className="mt-1 text-xl font-semibold">{t(props.title)}</h3>
      <div className="mt-3 text-base leading-relaxed">{props.children}</div>
    </aside>
  );
}

/** A banner across the top of a page (e.g. "Nothing on this page runs."). */
export function Notice(props: { text: string }) {
  const { t } = useSite();
  return (
    <div role="note" className="bg-slate-900 px-4 py-3 text-center text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900">
      {t(props.text)}
    </div>
  );
}

/** The home page's card for one section: its sentence and the status of each feature it names. */
export function SectionCard(props: { index: number }) {
  const { t } = useSite();
  const { section, features } = SECTIONS[props.index];
  return (
    <Link href={section.href} className={cx("flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-teal-600 dark:border-slate-700 dark:bg-slate-900", FOCUS)}>
      <h2 className="text-2xl font-semibold">{t(section.title)}</h2>
      <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300">{t(section.sentence)}</p>
      <ul className="mt-auto flex flex-wrap gap-2" aria-label={t("Status of each feature")}>
        {features.map((f) => (
          <li key={f.id} className="flex items-center gap-2 text-sm">
            <StatusBadge status={f.status} />
            <span>{t(f.title)}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

export type { SiteT };
