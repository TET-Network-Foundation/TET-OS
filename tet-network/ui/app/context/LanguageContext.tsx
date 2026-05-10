"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Language = "en" | "jp";

type LanguageCtx = {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
};

const Ctx = createContext<LanguageCtx | null>(null);

const LS_KEY = "tet.lang";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const v = (window.localStorage.getItem(LS_KEY) ?? "").toLowerCase();
      // Back-compat: accept old "ja" storage and map to "jp".
      if (v === "ja") return "jp";
      if (v === "jp" || v === "en") return v as Language;
    } catch {
      // ignore
    }
    return "en";
  });

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LS_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((cur) => {
      const next = cur === "en" ? "jp" : "en";
      try {
        window.localStorage.setItem(LS_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const value = useMemo<LanguageCtx>(() => ({ lang, setLang, toggleLang }), [lang, setLang, toggleLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLanguage(): LanguageCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLanguage must be used within LanguageProvider");
  return v;
}

