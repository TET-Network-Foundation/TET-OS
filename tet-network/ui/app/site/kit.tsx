"use client";
/**
 * The public site's kit: one look for the home page and its five sections. Original design.
 *
 * Layout rules (owner, 2026-11-13), pinned by scripts/site_guard.mjs where they can be checked:
 * - one centred column (max-w-3xl), body text at most about 70 characters a line (max-w-prose);
 * - a type scale of five sizes: text-sm, text-base, text-xl, text-2xl, text-4xl;
 * - two weights: font-normal and font-semibold;
 * - spacing on an 8 px grid (Tailwind steps in twos: 2, 4, 6, 8, 10, 12, 16, 20, 24 …);
 * - one accent colour, teal, with slate for everything else (status labels included);
 * - left-aligned text; consistent card sizes (cards fill their grid row);
 * - at most one primary button per page (<PrimaryLink>), everything else <SecondaryLink>.
 *
 * Rules the kit enforces by construction:
 * - a feature is shown only through <FeatureCard id> or <FeatureMini id>, which look it up in
 *   app/site/features and always render its status and what it shows and does not show;
 * - images come only from /site/… (drawn for this site, or screenshots of our own pages);
 * - every string goes through t() so the guard sees it and its Japanese.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { feature, SECTIONS } from "./features";
import { useSite, type SiteT } from "./i18n";
import type { Status } from "./types";

const cx = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(" ");
const FOCUS = "outline-none focus-visible:ring-4 focus-visible:ring-teal-600/40 rounded-lg";
/** The column every page sits in. */
export const COLUMN = "mx-auto w-full max-w-3xl px-4 sm:px-6";

/** What each status means, in a phrase. Teal for built, slate for not built; solid vs outline. */
export const STATUS_TEXT: Record<Status, { label: string; means: string; tone: string }> = {
  running: { label: "Running", means: "works today for anyone", tone: "bg-teal-700 text-white dark:bg-teal-400 dark:text-slate-950" },
  prototype: { label: "Prototype", means: "built, runs only on your own computer", tone: "border border-teal-700 text-teal-800 dark:border-teal-400 dark:text-teal-200" },
  planned: { label: "Planned", means: "decided, not built", tone: "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100" },
  idea: { label: "Idea", means: "not decided; being studied", tone: "border border-slate-400 text-slate-700 dark:border-slate-500 dark:text-slate-300" },
};

export function StatusBadge(props: { status: Status }) {
  const { t } = useSite();
  const s = STATUS_TEXT[props.status];
  return (
    <span title={t(s.means)} className={cx("inline-flex w-fit items-center rounded-full px-2 py-0 text-sm font-semibold", s.tone)}>
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
    <div className="min-h-screen bg-white text-base text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className={cx(COLUMN, "flex flex-wrap items-center gap-x-6 gap-y-2 py-4")}>
          <Link href="/" className={cx("text-xl font-semibold", FOCUS)}>
            TET
          </Link>
          <nav aria-label={t("Sections")} className="order-last flex w-full gap-4 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={cx("whitespace-nowrap py-2 text-slate-700 hover:text-teal-700 dark:text-slate-300 dark:hover:text-teal-300", FOCUS)}>
                {t(n.label)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex gap-2 text-sm" role="group" aria-label={t("Language")}>
            {(["en", "ja"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={cx("rounded-lg px-2 py-2", lang === l ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-700 dark:text-slate-300", FOCUS)}
              >
                {l === "en" ? "English" : "日本語"}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main>{props.children}</main>
      <footer className="mt-20 border-t border-slate-200 dark:border-slate-800">
        <div className={cx(COLUMN, "flex flex-col gap-4 py-10 text-slate-600 dark:text-slate-400")}>
          <p className="max-w-prose">{t("Open source. Every feature on this site carries a status, and the status matches the repository.")}</p>
          <ul className="flex flex-col gap-2 text-sm">
            {(["running", "prototype", "planned", "idea"] as const).map((s) => (
              <li key={s} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={s} /> {t(STATUS_TEXT[s].means)}
              </li>
            ))}
          </ul>
          <a href="https://github.com/TET-Network-Foundation/TET-OS" className={cx("w-fit underline underline-offset-4", FOCUS)}>
            {t("The code on GitHub")}
          </a>
        </div>
      </footer>
    </div>
  );
}

/** The page's one primary button (a link; "#id" scrolls). At most one per page. */
export function PrimaryLink(props: { href: string; label: string }) {
  const { t } = useSite();
  return (
    <a href={props.href} className={cx("inline-flex w-fit rounded-xl bg-teal-700 px-6 py-4 font-semibold text-white hover:bg-teal-800 dark:bg-teal-400 dark:text-slate-950 dark:hover:bg-teal-300", FOCUS)}>
      {t(props.label)}
    </a>
  );
}

/** Every other action: an outlined link. */
export function SecondaryLink(props: { href: string; label: string }) {
  const { t } = useSite();
  const external = /^https?:/.test(props.href);
  const cls = cx("inline-flex w-fit rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-900 hover:border-teal-700 hover:text-teal-800 dark:border-slate-600 dark:text-slate-100 dark:hover:border-teal-400 dark:hover:text-teal-200", FOCUS);
  return external ? (
    <a href={props.href} className={cls}>
      {t(props.label)}
    </a>
  ) : (
    <Link href={props.href} className={cls}>
      {t(props.label)}
    </Link>
  );
}

/** The top of a page: a heading, one plain sentence, optionally the page's primary button and a picture. */
export function Hero(props: { title: string; sentence: string; art?: ReactNode; action?: { href: string; label: string } }) {
  const { t } = useSite();
  return (
    <section className={cx(COLUMN, "flex flex-col gap-6 pb-10 pt-12 sm:pt-20")}>
      <h1 className="text-4xl font-semibold leading-tight">{t(props.title)}</h1>
      <p className="max-w-prose text-xl leading-relaxed text-slate-700 dark:text-slate-300">{t(props.sentence)}</p>
      {props.action ? <PrimaryLink href={props.action.href} label={props.action.label} /> : null}
      {props.art ? <div className="w-full">{props.art}</div> : null}
    </section>
  );
}

/** A short section: a heading, an optional lead (at most a few sentences), then its content. */
export function SiteSection(props: { title: string; id?: string; lead?: string; children?: ReactNode }) {
  const { t } = useSite();
  return (
    <section id={props.id} className={cx(COLUMN, "scroll-mt-20 py-10")}>
      <h2 className="text-2xl font-semibold">{t(props.title)}</h2>
      {props.lead ? <p className="mt-4 max-w-prose leading-relaxed text-slate-700 dark:text-slate-300">{t(props.lead)}</p> : null}
      {props.children ? <div className="mt-6">{props.children}</div> : null}
    </section>
  );
}

/** Cards in a grid; every card fills its row, so cards in one row are the same size. */
export function CardGrid(props: { children: ReactNode }) {
  return <div className="grid auto-rows-fr gap-4 sm:grid-cols-2">{props.children}</div>;
}

const CARD = "flex h-full flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900";

/** Shows / Does not show: two short lists, side by side on a wide screen, stacked on a phone. */
export function ShowsDoesNot(props: { shows: string[]; doesNot: string[] }) {
  const { t } = useSite();
  const list = (title: string, items: string[]) => (
    <div>
      <h4 className="font-semibold">{t(title)}</h4>
      <ul className="mt-2 flex list-disc flex-col gap-2 pl-6 leading-relaxed">
        {items.map((s) => (
          <li key={s}>{t(s)}</li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 dark:bg-slate-800">
      {list("Shows", props.shows)}
      {list("Does not show", props.doesNot)}
    </div>
  );
}

/**
 * One feature, from the registry: title, status, summary, Shows / Does not show, and a link to the
 * real page when there is one. Together with FeatureMini, the only way to show a feature on the site.
 */
export function FeatureCard(props: { id: string }) {
  const { t } = useSite();
  const f = feature(props.id);
  return (
    <article className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-semibold">{t(f.title)}</h3>
        <StatusBadge status={f.status} />
      </div>
      <p className="max-w-prose leading-relaxed text-slate-700 dark:text-slate-300">{t(f.summary)}</p>
      <ShowsDoesNot shows={f.shows} doesNot={f.doesNot} />
      {f.link ? <SecondaryLink href={f.link.href} label={f.link.label} /> : null}
    </article>
  );
}

/** A feature in short, for the home page: status, one line it shows, one it does not, and "Try it". */
export function FeatureMini(props: { id: string }) {
  const { t } = useSite();
  const f = feature(props.id);
  return (
    <article className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-semibold">{t(f.title)}</h3>
        <StatusBadge status={f.status} />
      </div>
      <dl className="flex flex-col gap-2 text-sm leading-relaxed">
        <div>
          <dt className="font-semibold">{t("Shows")}</dt>
          <dd>{t(f.shows[0])}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t("Does not show")}</dt>
          <dd>{t(f.doesNot[0])}</dd>
        </div>
      </dl>
      <div className="mt-auto">{f.link ? <SecondaryLink href={f.link.href} label="Try it" /> : null}</div>
    </article>
  );
}

/** An illustration or a screenshot. Only files under /site/ (drawn for this site, or our own pages). */
export function Figure(props: { src: `/site/${string}`; alt: string; caption?: string; wide?: boolean }) {
  const { t } = useSite();
  return (
    <figure className={cx("flex flex-col gap-2", props.wide ? "" : "max-w-xl")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={props.src} alt={t(props.alt)} className="w-full rounded-2xl border border-slate-200 dark:border-slate-700" />
      {props.caption ? <figcaption className="max-w-prose text-sm text-slate-600 dark:text-slate-400">{t(props.caption)}</figcaption> : null}
    </figure>
  );
}

/** A clearly labelled guess (e.g. "Where we think this goes"). */
export function Guess(props: { title: string; children: ReactNode }) {
  const { t } = useSite();
  return (
    <aside className="rounded-2xl border-2 border-dashed border-slate-300 p-6 dark:border-slate-600">
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">{t("A guess, not a plan")}</p>
      <h3 className="mt-2 text-xl font-semibold">{t(props.title)}</h3>
      <div className="mt-4 max-w-prose leading-relaxed">{props.children}</div>
    </aside>
  );
}

/** A banner across the top of a page (e.g. "Nothing on this page runs."). */
export function Notice(props: { text: string }) {
  const { t } = useSite();
  return (
    <div role="note" className="bg-slate-900 py-4 font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
      <p className={COLUMN}>{t(props.text)}</p>
    </div>
  );
}

/** The home page's card for one section: its sentence and the status of each feature it names. */
export function SectionCard(props: { index: number }) {
  const { t } = useSite();
  const { section, features } = SECTIONS[props.index];
  return (
    <Link href={section.href} className={cx(CARD, "transition hover:border-teal-700 dark:hover:border-teal-400", FOCUS)}>
      <h3 className="text-xl font-semibold">{t(section.title)}</h3>
      <p className="leading-relaxed text-slate-700 dark:text-slate-300">{t(section.sentence)}</p>
      <ul className="mt-auto flex flex-col gap-2 text-sm" aria-label={t("Status of each feature")}>
        {features.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <StatusBadge status={f.status} />
            <span>{t(f.title)}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

export type { SiteT };
