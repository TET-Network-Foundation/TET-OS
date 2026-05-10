"use client";

import { useMemo } from "react";
import { useLanguage } from "../context/LanguageContext";
import { translations, type Lang, type TKey } from "./translations";

export function useT() {
  const { lang } = useLanguage();

  return useMemo(() => {
    const table = translations[lang as Lang] ?? translations.en;
    const fallback = translations.en;
    const t = (k: TKey): string => table[k] ?? fallback[k] ?? k;
    return { t, lang };
  }, [lang]);
}

