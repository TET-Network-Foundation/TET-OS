"use client";

/**
 * The technical paper's page body, in the visitor's language (the same pick as /try: `?lang=`, the
 * earlier choice, the browser). English is authoritative; the Japanese text is a translation of a
 * named English commit (paper_ja.ts) and says so. Hong Kong Chinese shows the English text under a
 * note until its translation exists.
 */
import { useEffect } from "react";
import * as EN from "./paper";
import * as JA from "./paper_ja";
import type { Block, Section } from "./paper";
import marksJson from "./marks.json";
import { LangSwitch, useLang } from "../try/i18n";

type Mark = { code: string; sha256: string; file: string };
const MARKS = marksJson as { html: Mark | null; pdf: Mark | null };
const REPO = "https://github.com/TET-Network-Foundation/TET-OS";
const link = "underline underline-offset-2";

/** `code` spans; everything else is plain text. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} translate="no" className="rounded bg-[#f1f3f5] px-1 font-mono text-[0.92em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Body({ block }: { block: Block }) {
  if ("p" in block) return <p className="mb-3">{<Inline text={block.p} />}</p>;
  if ("ul" in block)
    return (
      <ul className="mb-3 list-disc space-y-1 pl-6">
        {block.ul.map((x, i) => (
          <li key={i}>
            <Inline text={x} />
          </li>
        ))}
      </ul>
    );
  return (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left text-[15px]">
        <thead>
          <tr className="border-b border-[#c9ced4]">
            {block.table.head.map((h) => (
              <th key={h} className="py-1.5 pr-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((r, i) => (
            <tr key={i} className="border-b border-[#eceef1] align-top">
              {r.map((c, j) => (
                <td key={j} className="py-1.5 pr-3">
                  <Inline text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaperView() {
  const { lang, t } = useLang();
  const P: { TITLE: string; SUBTITLE: string; DATE: string; ABSTRACT: string; SECTIONS: Section[] } = lang === "ja" ? JA : EN;
  const translated = lang === "ja";
  // zh-HK: the English text until the translation exists (lang_render_guard lists it, by name).
  const pending = lang !== "en" && !translated;
  // The tab title in the visitor's language (Next's static metadata is English).
  const title = `${translated ? JA.TITLE : t("TET technical paper")} · TET`;
  useEffect(() => {
    document.title = title;
    const id = setTimeout(() => (document.title = title), 300);
    return () => clearTimeout(id);
  }, [title]);
  return (
    <main className="mx-auto max-w-3xl bg-white px-5 py-12 text-[16px] leading-relaxed text-[#1c1f23]">
      <div className="mb-6 flex items-center justify-between gap-4 text-[14px]">
        <a className={link} href="/try">
          ← TET
        </a>
        <LangSwitch />
      </div>
      {translated ? (
        <p className="mb-4 rounded-md border border-[#e3c66b] bg-[#fff8e1] p-3 text-[14px]">
          {t("Draft translation of the English version at commit {commit}; the English version is authoritative. This translation isn't marked yet: the proof codes below are for the English files.", { commit: JA.TRANSLATION_OF.slice(0, 7) })}
        </p>
      ) : lang !== "en" ? (
        <p className="mb-4 rounded-md border border-[#e3c66b] bg-[#fff8e1] p-3 text-[14px]">
          {t("This paper isn't translated into this language yet. Below is the English version, which is authoritative.")}
        </p>
      ) : null}
      <div data-pending-translation={pending ? "zh-HK" : undefined} lang={pending ? "en" : undefined}>
      <h1 className="text-[30px] font-bold">{P.TITLE}</h1>
      <p className="text-[17px] text-[#3d434a]">{P.SUBTITLE}</p>
      <p className="mt-2 text-[14px] text-[#5d646d]">
        {t("{date} · written against commit {commit} · the public seeds run {seeds} · this is a testnet; data may be reset", {
          date: P.DATE,
          commit: EN.WRITTEN_AGAINST.slice(0, 7),
          seeds: EN.SEEDS_RUN,
        })}{" "}
        <a className={`${link} font-mono`} href={`${REPO}/tree/${EN.WRITTEN_AGAINST}`}>
          {t("(the code)")}
        </a>
      </p>
      <p className="mt-3 text-[14px]">
        <a className={link} href="/paper/tet-technical-paper.pdf" download>
          {t("Download the PDF (English)")}
        </a>
        {MARKS.pdf ? (
          <>
            {" "}
            · {t("proof code {code} (marks this PDF file)", { code: MARKS.pdf.code })}
          </>
        ) : null}
      </p>
      <p className="mt-1 text-[13px] text-[#5d646d]">
        {t("Version 1 (2026-10-09, superseded, kept):")}{" "}
        <a className={link} href="/paper/tet-technical-paper-v1.html">
          {t("text")}
        </a>{" "}
        ·{" "}
        <a className={link} href="/paper/tet-technical-paper-v1.pdf" download>
          PDF
        </a>{" "}
        · {t("proof codes {a} and {b}", { a: "TET-418B-CFT2", b: "TET-QQGQ-B5MM" })}
      </p>

      <p className="mt-6 border-l-2 border-[#c9ced4] pl-4">{P.ABSTRACT}</p>

      <nav aria-label={t("Contents")} className="mt-6 text-[15px]">
        <ol className="space-y-0.5">
          {P.SECTIONS.map((s) => (
            <li key={s.id}>
              <a className={link} href={`#${s.id}`}>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {P.SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="mt-10">
          <h2 className="mb-3 text-[22px] font-semibold">{s.title}</h2>
          {s.body.map((b, i) => (
            <Body key={i} block={b} />
          ))}
          <p className="mt-2 text-[13px] text-[#5d646d]">
            {t("Sources:")}{" "}
            {s.sources.map((f, i) => (
              <span key={f}>
                {i ? ", " : ""}
                <a translate="no" className={`${link} font-mono`} href={`${REPO}/blob/${EN.WRITTEN_AGAINST}/${f}`}>
                  {f}
                </a>
              </span>
            ))}
          </p>
        </section>
      ))}

      {MARKS.html ? (
        <p className="mt-10 border-t border-[#e3e5e8] pt-4 text-[14px] text-[#5d646d]">
          {t("The English text of this paper ({file}, SHA-256 {sha}) is marked with proof code {code}. It proves this ID marked exactly that text; not who wrote it.", {
            file: "paper/tet-technical-paper.html",
            sha: MARKS.html.sha256,
            code: MARKS.html.code,
          })}
        </p>
      ) : null}
      </div>
    </main>
  );
}
