/**
 * The TET technical paper (paper.ts), for engineers. One page, one source: the standalone HTML and
 * the PDF are built from the same text (scripts/paper_build.mjs), and paper_guard checks the cited
 * files and the wording. The page follows the visitor's language (PaperView).
 */
import type { Metadata } from "next";
import { ABSTRACT, TITLE } from "./paper";
import { LangProvider } from "../try/i18n";
import { PaperView } from "./PaperView";

export const metadata: Metadata = { title: `${TITLE} · TET`, description: ABSTRACT };

export default function Whitepaper() {
  return (
    <LangProvider>
      <PaperView />
    </LangProvider>
  );
}
