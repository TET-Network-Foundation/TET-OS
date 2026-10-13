/** /agents: what TET offers automated agents today, what is planned, and one idea (agents_text.ts). */
import type { Metadata } from "next";
import { LangProvider } from "../try/i18n";
import { AgentsView } from "./AgentsView";
import { EN } from "./agents_text";

export const metadata: Metadata = { title: `${EN.title} · TET`, description: EN.lead };

export default function Agents() {
  return (
    <LangProvider>
      <AgentsView />
    </LangProvider>
  );
}
