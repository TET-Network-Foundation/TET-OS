/**
 * The TET technical paper (paper.ts), for engineers. One page, one source: the standalone HTML and
 * the PDF are built from the same text (scripts/paper_build.mjs), and paper_guard checks the cited
 * files and the wording.
 */
import type { Metadata } from "next";
import { ABSTRACT, DATE, SECTIONS, SEEDS_RUN, SUBTITLE, TITLE, WRITTEN_AGAINST, type Block } from "./paper";
import marksJson from "./marks.json";

/** The proof codes for the paper's text (HTML) and for the PDF file; null until made. */
type Mark = { code: string; sha256: string; file: string };
const MARKS = marksJson as { html: Mark | null; pdf: Mark | null };

export const metadata: Metadata = { title: `${TITLE} · TET`, description: ABSTRACT };

const REPO = "https://github.com/TET-Network-Foundation/TET-OS";

/** `code` spans; everything else is plain text. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="rounded bg-[#f1f3f5] px-1 font-mono text-[0.92em]">
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

export default function Whitepaper() {
  const link = "underline underline-offset-2";
  return (
    <main className="mx-auto max-w-3xl bg-white px-5 py-12 text-[16px] leading-relaxed text-[#1c1f23]">
      <p className="mb-6 text-[14px]">
        <a className={link} href="/try">
          ← TET
        </a>
      </p>
      <h1 className="text-[30px] font-bold">{TITLE}</h1>
      <p className="text-[17px] text-[#3d434a]">{SUBTITLE}</p>
      <p className="mt-2 text-[14px] text-[#5d646d]">
        {DATE} · written against commit{" "}
        <a className={`${link} font-mono`} href={`${REPO}/tree/${WRITTEN_AGAINST}`}>
          {WRITTEN_AGAINST.slice(0, 7)}
        </a>{" "}
        · the public seeds run <span className="font-mono">{SEEDS_RUN}</span> · this is a testnet; data may be reset
      </p>
      <p className="mt-3 text-[14px]">
        <a className={link} href="/paper/tet-technical-paper.pdf" download>
          Download the PDF
        </a>
        {MARKS.pdf ? (
          <>
            {" "}
            · proof code <span className="font-mono">{MARKS.pdf.code}</span> (marks this PDF file)
          </>
        ) : null}
      </p>

      <p className="mt-6 border-l-2 border-[#c9ced4] pl-4">{ABSTRACT}</p>

      <nav aria-label="Contents" className="mt-6 text-[15px]">
        <ol className="space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a className={link} href={`#${s.id}`}>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="mt-10">
          <h2 className="mb-3 text-[22px] font-semibold">{s.title}</h2>
          {s.body.map((b, i) => (
            <Body key={i} block={b} />
          ))}
          <p className="mt-2 text-[13px] text-[#5d646d]">
            Sources:{" "}
            {s.sources.map((f, i) => (
              <span key={f}>
                {i ? ", " : ""}
                <a className={`${link} font-mono`} href={`${REPO}/blob/${WRITTEN_AGAINST}/${f}`}>
                  {f}
                </a>
              </span>
            ))}
          </p>
        </section>
      ))}

      {MARKS.html ? (
        <p className="mt-10 border-t border-[#e3e5e8] pt-4 text-[14px] text-[#5d646d]">
          The text of this paper (<span className="font-mono">paper/tet-technical-paper.html</span>, SHA-256{" "}
          <span className="font-mono break-all">{MARKS.html.sha256}</span>) is marked with proof code{" "}
          <span className="font-mono">{MARKS.html.code}</span>. It proves this ID marked exactly that text; not who wrote it.
        </p>
      ) : null}
    </main>
  );
}
