"use client";

import {
  TET_WHITEPAPER_DATE,
  TET_WHITEPAPER_FULL_TEXT,
  TET_WHITEPAPER_TITLE,
  TET_WHITEPAPER_VERSION,
} from "../lib/tetWhitepaper";

export default function Whitepaper() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 bg-white text-black">
      <header className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight mb-4 font-mono">{TET_WHITEPAPER_TITLE}</h1>
        <p className="text-gray-700 text-sm font-mono">
          In-app summary — {TET_WHITEPAPER_VERSION} · {TET_WHITEPAPER_DATE} · §12.5–12.7 marked Future Work in canonical WP
        </p>
      </header>

      <article className="font-mono text-sm whitespace-pre-wrap leading-relaxed text-black">
        {TET_WHITEPAPER_FULL_TEXT}
      </article>
    </main>
  );
}
