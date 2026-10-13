/**
 * Which language a page opens in:
 * 1. `?lang=` in the link (for that page only; not remembered);
 * 2. else the language this visitor chose before on this device;
 * 3. else, on a first visit, the browser's languages in order (`navigator.languages`, the same list
 *    the browser sends as Accept-Language): ja → 日本語, any Chinese → 繁體中文（香港）, en → English;
 * 4. else English.
 */
export type PickLang = "en" | "ja" | "zh-HK";

export function asLang(v: string | null | undefined): PickLang | null {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "en") return "en";
  if (s === "ja") return "ja";
  if (s === "zh-hk") return "zh-HK";
  return null;
}

export function fromBrowser(langs: readonly string[]): PickLang | null {
  for (const raw of langs) {
    const l = raw.trim().toLowerCase();
    if (l === "ja" || l.startsWith("ja-")) return "ja";
    if (l === "zh" || l.startsWith("zh-")) return "zh-HK";
    if (l === "en" || l.startsWith("en-")) return "en";
  }
  return null;
}

export function pickLang(query: string | null, stored: string | null, browser: readonly string[]): PickLang {
  return asLang(query) ?? asLang(stored) ?? fromBrowser(browser) ?? "en";
}
