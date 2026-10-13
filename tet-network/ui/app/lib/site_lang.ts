/**
 * The site language, v1 (docs/plans/SITE_LANG.md): six blocks, four edit ops, one pure renderer.
 *
 * A page is a chain of signed edits (lib/site_store.ts, tet-core sites.rs). Each edit's body is one
 * op: `meta` (title, language, template), `add` a block, `replace` block n, or `remove` block n.
 * `applyEdits` folds the bodies into the page's state; `render` turns the state into one HTML
 * document. Both are pure: same edits, same bytes, anywhere — a reader can re-render and compare.
 *
 * - **No author HTML, no scripts.** Every piece of author text is escaped; the only formatting is
 *   **bold**, *italic* and [links](https://…) (http and https only). Every rendered page carries a
 *   Content-Security-Policy that forbids scripts outright, so even an escaping mistake can't run one.
 * - **Images** are PNG, JPEG, GIF or WebP data carried in the block, at most 1 MB, and their
 *   SHA-256 must match the data (shown under the image).
 * - **The proves line** is in every page's footer, in the site's language.
 */
import { sha256 } from "@noble/hashes/sha2";

export type Lang = "en" | "ja" | "zh-HK";
export const TEMPLATES = ["plain", "paper", "terminal"] as const;
export type Template = (typeof TEMPLATES)[number];

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data_b64: string; sha256: string; alt: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string; who?: string }
  | { type: "link"; url: string; label: string };

export type Op =
  | { op: "meta"; title: string; lang: Lang; template?: Template }
  | { op: "add"; block: Block; at?: number }
  | { op: "replace"; index: number; block: Block }
  | { op: "remove"; index: number };

export type SiteState = { title: string; lang: Lang; template: Template; blocks: Block[]; skipped: number };

export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const IMAGE_MAX_BYTES = 1_000_000;
export const TEXT_MAX = 20_000;
export const LIST_MAX_ITEMS = 200;

const LANGS: readonly Lang[] = ["en", "ja", "zh-HK"];

function b64ToBytes(b64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const isStr = (s: unknown, max = TEXT_MAX): s is string => typeof s === "string" && s.length <= max;

/** A safe absolute http(s) URL, or null. */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000 || /[\s"'<>`\\]/.test(raw)) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A well-formed block, or null (an unknown type, a wrong field, a bad URL or image). */
export function checkBlock(b: unknown): Block | null {
  const x = b as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return null;
  switch (x.type) {
    case "heading":
      return (x.level === 1 || x.level === 2 || x.level === 3) && isStr(x.text, 300) ? { type: "heading", level: x.level, text: x.text } : null;
    case "text":
      return isStr(x.text) ? { type: "text", text: x.text } : null;
    case "image": {
      if (!IMAGE_MIMES.includes(x.mime as (typeof IMAGE_MIMES)[number]) || !isStr(x.alt, 500) || typeof x.data_b64 !== "string" || typeof x.sha256 !== "string") return null;
      const bytes = b64ToBytes(x.data_b64);
      if (!bytes || bytes.length > IMAGE_MAX_BYTES || hex(sha256(bytes)) !== x.sha256.toLowerCase()) return null;
      return { type: "image", mime: x.mime as string, data_b64: x.data_b64, sha256: x.sha256.toLowerCase(), alt: x.alt };
    }
    case "list":
      return typeof x.ordered === "boolean" && Array.isArray(x.items) && x.items.length <= LIST_MAX_ITEMS && x.items.every((i) => isStr(i, 2000))
        ? { type: "list", ordered: x.ordered, items: x.items as string[] }
        : null;
    case "quote":
      return isStr(x.text) && (x.who === undefined || isStr(x.who, 200)) ? { type: "quote", text: x.text, ...(x.who ? { who: x.who as string } : {}) } : null;
    case "link": {
      const url = safeUrl(x.url);
      return url && isStr(x.label, 300) ? { type: "link", url, label: x.label } : null;
    }
    default:
      return null;
  }
}

/** Fold edit bodies (JSON text, in chain order) into the page. Malformed edits are skipped and counted. */
export function applyEdits(bodies: string[]): SiteState {
  const s: SiteState = { title: "", lang: "en", template: "plain", blocks: [], skipped: 0 };
  for (const body of bodies) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(body);
    } catch {
      s.skipped++;
      continue;
    }
    const idx = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) < s.blocks.length ? (n as number) : -1);
    if (o.op === "meta" && isStr(o.title, 200) && LANGS.includes(o.lang as Lang) && (o.template === undefined || TEMPLATES.includes(o.template as Template))) {
      s.title = o.title;
      s.lang = o.lang as Lang;
      if (o.template) s.template = o.template as Template;
    } else if (o.op === "add" && checkBlock(o.block)) {
      const at = o.at === undefined ? s.blocks.length : Number.isInteger(o.at) && (o.at as number) >= 0 && (o.at as number) <= s.blocks.length ? (o.at as number) : -1;
      if (at < 0) s.skipped++;
      else s.blocks.splice(at, 0, checkBlock(o.block)!);
    } else if (o.op === "replace" && idx(o.index) >= 0 && checkBlock(o.block)) {
      s.blocks[idx(o.index)] = checkBlock(o.block)!;
    } else if (o.op === "remove" && idx(o.index) >= 0) {
      s.blocks.splice(idx(o.index), 1);
    } else {
      s.skipped++;
    }
  }
  return s;
}

/** HTML-escape text for both element content and quoted attribute values. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const INLINE = /\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)|\*\*([^*\n]{1,1000})\*\*|\*([^*\n]{1,1000})\*/g;

/** Author text with the three inline forms; everything else escaped. */
export function inline(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    out += esc(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const url = safeUrl(m[2]);
      out += url ? `<a href="${esc(url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(m[1])}</a>` : esc(m[0]);
    } else if (m[3] !== undefined) out += `<strong>${esc(m[3])}</strong>`;
    else out += `<em>${esc(m[4])}</em>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + esc(text.slice(last));
}

export const PROVES: Record<Lang, (version: string) => string> = {
  en: (v) => `Every block here was published by this site's key, in this order (version ${v}). That doesn't show who holds the key, or that a person wrote the text.`,
  ja: (v) => `ここにあるすべてのブロックは、このサイトの鍵によって、この順番で公開されました（バージョン ${v}）。鍵を誰が持っているか、人が書いた文章かどうかは示しません。`,
  "zh-HK": (v) => `此處每個區塊均由此網站的鑰匙按此順序發佈（版本 ${v}）。這並不表示鑰匙由誰持有，也不表示文字由人撰寫。`,
};
const SKIPPED: Record<Lang, (n: number) => string> = {
  en: (n) => `${n} edit(s) in this chain couldn't be shown and were skipped.`,
  ja: (n) => `このチェーンの ${n} 件の編集は表示できないため省略しました。`,
  "zh-HK": (n) => `此鏈中有 ${n} 項編輯無法顯示，已略過。`,
};
const SITE_KEY: Record<Lang, string> = { en: "site key", ja: "サイトの鍵", "zh-HK": "網站鑰匙" };

const CSS: Record<Template, string> = {
  plain:
    "body{margin:0;background:#fff;color:#1c1f23;font:17px/1.6 ui-sans-serif,system-ui,sans-serif}main,footer{max-width:42rem;margin:0 auto;padding:24px 16px}h1,h2,h3{line-height:1.25}img{max-width:100%;height:auto}figcaption,.host,footer{color:#5d646d;font-size:13px}footer{overflow-wrap:anywhere;border-top:1px solid #e3e5e8}blockquote{margin:0;padding-left:14px;border-left:3px solid #c9ced4}a{color:#1a237e}code,.mono{font-family:ui-monospace,monospace}@media (prefers-color-scheme:dark){body{background:#15171a;color:#e6e8eb}a{color:#9fa8ff}footer{border-color:#2c3036}}",
  paper:
    "body{margin:0;background:#fbfaf6;color:#22201c;font:18px/1.65 Georgia,'Times New Roman',serif}main,footer{max-width:40rem;margin:0 auto;padding:32px 18px}img{max-width:100%;height:auto}figcaption,.host,footer{color:#6b665c;font-size:13px}footer{overflow-wrap:anywhere;border-top:1px solid #d9d4c7}blockquote{margin:0;padding-left:16px;border-left:2px solid #b9b4a6;font-style:italic}a{color:#1a237e}.mono{font-family:ui-monospace,monospace}@media (prefers-color-scheme:dark){body{background:#17161a;color:#e9e6dc}a{color:#9fa8ff}}",
  terminal:
    "body{margin:0;background:#0b0d0a;color:#c9d1c0;font:15px/1.6 ui-monospace,Menlo,monospace}main,footer{max-width:46rem;margin:0 auto;padding:24px 16px}h1,h2,h3{color:#8fd3a8}img{max-width:100%;height:auto}figcaption,.host,footer{color:#6c737b;font-size:12px}footer{overflow-wrap:anywhere;border-top:1px dashed #3a4036}blockquote{margin:0;padding-left:12px;border-left:2px solid #3a4036}a{color:#ffd166}.mono{font-family:inherit}",
};

const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

function blockHtml(b: Block): string {
  switch (b.type) {
    case "heading":
      return `<h${b.level}>${esc(b.text)}</h${b.level}>`;
    case "text":
      return b.text
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p) => `<p>${inline(p).replace(/\n/g, "<br>")}</p>`)
        .join("");
    case "image":
      return `<figure><img src="data:${b.mime};base64,${b.data_b64}" alt="${esc(b.alt)}"><figcaption class="mono">sha256 ${esc(b.sha256)}</figcaption></figure>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${tag}>`;
    }
    case "quote":
      return `<blockquote><p>${inline(b.text)}</p>${b.who ? `<p>— ${esc(b.who)}</p>` : ""}</blockquote>`;
    case "link": {
      const host = new URL(b.url).host;
      return `<p><a href="${esc(b.url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(b.label)}</a> <span class="host mono">(${esc(host)})</span></p>`;
    }
  }
}

/** The page as one HTML document. Pure: the same state, site and version give the same bytes. */
export function render(state: SiteState, siteId: string, version: string): string {
  const lang = state.lang;
  return [
    "<!doctype html>",
    `<html lang="${esc(lang)}"><head><meta charset="utf-8">`,
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="generator" content="TET site language v1">`,
    `<title>${esc(state.title || siteId.slice(0, 12))}</title>`,
    `<style>${CSS[state.template]}</style></head><body>`,
    `<main>${state.blocks.map(blockHtml).join("\n")}</main>`,
    `<footer><p>${esc(PROVES[lang](version))}</p>`,
    state.skipped ? `<p>${esc(SKIPPED[lang](state.skipped))}</p>` : "",
    `<p class="mono">${esc(SITE_KEY[lang])} ${esc(siteId)}</p></footer>`,
    "</body></html>",
  ].join("\n");
}
