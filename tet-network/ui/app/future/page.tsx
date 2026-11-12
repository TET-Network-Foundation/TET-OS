/**
 * /future: "A guess at the 2030s". A static concept page that imagines one-shot signing keys
 * (docs/research/ONE_SHOT_TET.md, status: idea). It moves nothing and talks to no server.
 * scripts/future_concept_guard.mjs checks the banner, the sample figures, the send button and the
 * wording; scripts/try_money_guard.mjs scans it for money wording. The page follows the visitor's
 * language through the /try dictionaries (FutureView).
 */
import type { Metadata } from "next";
import { LangProvider } from "../try/i18n";
import { FutureView } from "./FutureView";

export const metadata: Metadata = {
  title: "A guess at the 2030s · TET",
  description: "A concept page. Nothing here moves value. No token exists. One-shot keys do not run on any machine today.",
};

export default function Future() {
  return (
    <LangProvider>
      <FutureView />
    </LangProvider>
  );
}
