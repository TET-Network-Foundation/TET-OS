import localFont from "next/font/local";
import type { ReactNode } from "react";
import { LangProvider } from "../try/i18n";
import { SiteFrame } from "../site/kit";

/** One sans and one mono font, self-hosted (app/site/fonts, SIL OFL 1.1; sources in SOURCES.txt). */
const sans = localFont({
  src: [
    { path: "../site/fonts/Inter-Regular.woff2", weight: "400", style: "normal" },
    { path: "../site/fonts/Inter-SemiBold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "../site/fonts/JetBrainsMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "../site/fonts/JetBrainsMono-SemiBold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

/** The project site: the home page, its five sections, /about and /changelog share one frame. */
export default function SiteLayout(props: { children: ReactNode }) {
  return (
    <div className={`${sans.variable} ${mono.variable} font-sans`}>
      <LangProvider>
        <SiteFrame>{props.children}</SiteFrame>
      </LangProvider>
    </div>
  );
}
