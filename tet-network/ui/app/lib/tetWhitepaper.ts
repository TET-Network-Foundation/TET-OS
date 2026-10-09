/**
 * The technical paper as plain text, for the /os desktop's reader. Derived from the one source
 * (app/whitepaper/paper.ts), so the desktop can't show an older paper.
 */
import { ABSTRACT, DATE, SECTIONS, SUBTITLE, TITLE, WRITTEN_AGAINST } from "../whitepaper/paper";

export const TET_WHITEPAPER_TITLE = TITLE;
export const TET_WHITEPAPER_VERSION = SUBTITLE;
export const TET_WHITEPAPER_DATE = DATE;

export const TET_WHITEPAPER_FULL_TEXT = [
  `${TITLE}: ${SUBTITLE}`,
  `${DATE} · written against commit ${WRITTEN_AGAINST.slice(0, 7)}`,
  "",
  ABSTRACT,
  ...SECTIONS.flatMap((s) => [
    "",
    s.title,
    "",
    ...s.body.flatMap((b) =>
      "p" in b ? [b.p, ""] : "ul" in b ? [...b.ul.map((x) => `- ${x}`), ""] : [b.table.head.join(" | "), ...b.table.rows.map((r) => r.join(" | ")), ""],
    ),
    `Sources: ${s.sources.join(", ")}`,
  ]),
]
  .join("\n")
  .replace(/`/g, "");
