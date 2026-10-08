"use client";

/**
 * Try TET's languages: English, 日本語, 繁體中文 (Hong Kong). `t()` is keyed by the English text, so
 * English is always the fallback and the source of truth; `{name}` placeholders are filled from
 * `vars`. The choice lives in the URL (`?lang=ja`), so it survives a reload of this tab and nothing
 * else: the try page keeps nothing in browser storage (scripts/try_wallet_guard.mjs).
 *
 * Translations are by meaning, not word for word. Tmail's locked disclosures stay byte-identical in
 * English (tet-core asserts them); the other languages carry their meaning.
 * scripts/try_i18n_guard.mjs fails if any `t("…")` on the try page lacks a translation.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getUi, setUi } from "../lib/device_store";
import { JA } from "./i18n_ja";
import { ZH_HK } from "./i18n_zh_hk";

export const LANGS = [
  { id: "en", label: "English", locale: "en" },
  { id: "ja", label: "日本語", locale: "ja-JP" },
  { id: "zh-HK", label: "繁體中文（香港）", locale: "zh-HK" },
] as const;
export type Lang = (typeof LANGS)[number]["id"];

const DICTS: Record<Lang, Record<string, string>> = { en: {}, ja: JA, "zh-HK": ZH_HK };

type Vars = Record<string, string | number>;
export type T = (en: string, vars?: Vars) => string;

function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** The translation of `en` in `lang`, with `{placeholders}` filled. */
export function translate(lang: Lang, en: string, vars?: Vars): string {
  return fill(DICTS[lang][en] ?? en, vars);
}

/** `locale` formats dates; undefined means the visitor's own browser locale (English pages). */
type Ctx = { lang: Lang; locale: string | undefined; t: T; setLang: (l: Lang) => void };
const LangCtx = createContext<Ctx>({ lang: "en", locale: undefined, t: (en, v) => fill(en, v), setLang: () => {} });

const isLang = (x: string | null): x is Lang => LANGS.some((l) => l.id === x);

export function LangProvider(props: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // The language in `?lang=` (this tab only).
  useEffect(() => {
    // `?lang=` wins; otherwise the language this device chose before (device_store, plain UI state).
    const q = new URLSearchParams(window.location.search).get("lang") ?? getUi("tet.ui.v1.lang");
    if (!isLang(q) || q === "en") return;
    const t0 = setTimeout(() => setLangState(q), 0);
    return () => clearTimeout(t0);
  }, []);

  useEffect(() => {
    document.documentElement.lang = LANGS.find((l) => l.id === lang)?.locale ?? "en";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setUi("tet.ui.v1.lang", l === "en" ? null : l);
    const url = new URL(window.location.href);
    if (l === "en") url.searchParams.delete("lang");
    else url.searchParams.set("lang", l);
    window.history.replaceState(null, "", url);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ lang, locale: lang === "en" ? undefined : LANGS.find((l) => l.id === lang)?.locale, t: (en, vars) => translate(lang, en, vars), setLang }),
    [lang, setLang],
  );
  return <LangCtx.Provider value={value}>{props.children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  return useContext(LangCtx);
}

/** The language switch (sidebar footer and the phone menu). */
export function LangSwitch() {
  const { lang, setLang, t } = useLang();
  return (
    <label className="block text-[13.5px] text-[#5d646d]">
      <span className="mr-2">{t("Language")}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="min-h-9 rounded-md border border-[#c9ced4] bg-white px-2 text-[14px] text-[#1c1f23]"
      >
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
