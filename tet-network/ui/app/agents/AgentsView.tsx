"use client";

/** /agents in the visitor's language (the same pick as /try: `?lang=`, the earlier choice, the browser). */
import { useEffect } from "react";
import { LangSwitch, useLang } from "../try/i18n";
import { EN, JA, PLAN_URL, ZH, type Block } from "./agents_text";

const link = "underline underline-offset-2";

function Body({ block }: { block: Block }) {
  if (typeof block === "string") return <p className="mb-3">{block}</p>;
  return (
    <ul className="mb-3 list-disc space-y-2 pl-6">
      {block.ul.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export function AgentsView() {
  const { lang } = useLang();
  const T = lang === "ja" ? JA : lang === "zh-HK" ? ZH : EN;
  // The tab's title in the visitor's language too (the metadata is English); again after Next sets it.
  useEffect(() => {
    const title = `${T.title} · TET`;
    document.title = title;
    const id = setTimeout(() => (document.title = title), 300);
    return () => clearTimeout(id);
  }, [T.title]);
  return (
    <main lang={lang === "en" ? "en" : lang} className="mx-auto max-w-3xl bg-white px-5 py-12 text-[16px] leading-relaxed text-[#1c1f23]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-[14px]">
        <a href="/try" className={link}>
          {T.back}
        </a>
        <LangSwitch />
      </div>
      <h1 className="mb-3 text-[28px] font-bold leading-tight">{T.title}</h1>
      <p className="mb-8 text-[#3d434a]">{T.lead}</p>
      {T.sections.map((s, i) => (
        <section key={i} className="mb-8">
          <h2 className="mb-2 text-[20px] font-bold">
            {s.h}
            {s.tag ? <span className="ml-2 inline-block rounded border border-[#8a5a00] px-1.5 py-0.5 align-middle text-[12.5px] font-semibold text-[#8a5a00]">{s.tag}</span> : null}
          </h2>
          {s.body.map((b, j) => (
            <Body key={j} block={b} />
          ))}
          {i === 3 ? (
            <p>
              <a href={PLAN_URL} className={link} rel="noopener">
                {T.plan}
              </a>
            </p>
          ) : null}
        </section>
      ))}
    </main>
  );
}
