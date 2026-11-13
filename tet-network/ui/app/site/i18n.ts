"use client";
/**
 * The public site's languages: English and Japanese. English strings are the keys; each section's
 * text file (app/site/text/<section>.ts) gives the Japanese. The language itself is the shared one
 * from /try (?lang=), so a visitor's choice carries across.
 */
import { useLang } from "../try/i18n";
import { JA as home } from "./text/home";
import { JA as tags } from "./text/tags";
import { JA as machines } from "./text/machines";
import { JA as keys } from "./text/keys";
import { JA as services } from "./text/services";
import { JA as research } from "./text/research";
import { JA as about } from "./text/about";
import { JA as changelog } from "./text/changelog";
import { JA as numbers } from "./text/numbers";

export const SITE_JA: Record<string, string> = { ...home, ...tags, ...machines, ...keys, ...services, ...research, ...about, ...changelog, ...numbers };

type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export type SiteLang = "en" | "ja";
export type SiteT = (en: string, vars?: Vars) => string;

/** Japanese when chosen and present; otherwise English (the site offers EN and JA only). */
export function siteT(lang: SiteLang): SiteT {
  return (en, vars) => fill(lang === "ja" ? (SITE_JA[en] ?? en) : en, vars);
}

export function useSite(): { lang: SiteLang; t: SiteT; setLang: (l: SiteLang) => void } {
  const { lang, setLang } = useLang();
  const l: SiteLang = lang === "ja" ? "ja" : "en";
  return { lang: l, t: siteT(l), setLang };
}
