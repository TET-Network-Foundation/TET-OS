"use client";
/** /changelog: one plain line per merged pull request, newest first (app/site/changelog.ts). */
import { CHANGES } from "../../site/changelog";
import { Hero, SiteSection } from "../../site/kit";
import { useSite } from "../../site/i18n";

const PR = "https://github.com/TET-Network-Foundation/TET-OS/pull/";

export default function ChangelogView() {
  const { t } = useSite();
  return (
    <>
      <Hero title="Changelog" sentence="What changed, with the latest at the top. Each line is one merged pull request; the number links to it on GitHub." />
      <SiteSection title="Merged pull requests" lead="From the merged pull requests on GitHub, as listed on 2026-11-13.">
        <ol className="flex flex-col">
          {CHANGES.map((c) => (
            <li key={c.pr} className="grid gap-2 border-t border-slate-300 py-4 sm:grid-cols-[8rem_4rem_1fr] dark:border-slate-700">
              <span className="font-mono text-sm text-slate-600 dark:text-slate-400">{c.merged}</span>
              <a href={`${PR}${c.pr}`} className="font-mono text-sm underline underline-offset-4">
                #{c.pr}
              </a>
              <span className="leading-relaxed">{t(c.summary)}</span>
            </li>
          ))}
        </ol>
      </SiteSection>
    </>
  );
}
