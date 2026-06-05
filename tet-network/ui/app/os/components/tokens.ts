/**
 * Win95 design tokens for the TET Sovereign OS desktop.
 *
 * These mirror the inline string constants that historically lived in `OsClient.tsx`
 * (`outset`/`inset`/`face`/`panel`/`field`/`winBtn`). Centralising them here lets the
 * `Win95*` component family share one source of truth so every tab stays pixel-identical
 * to the classic 3D bevel look. Values are Tailwind class strings (arbitrary hex values
 * are intentional — they match the original palette byte-for-byte).
 */

/** Raw palette (classic Windows 95 face/shadow/highlight tones tuned for TET). */
export const win95Colors = {
  /** Window/desktop face. */
  face: "#D6D4CE",
  /** Slightly lighter panel face. */
  panel: "#DAD8D2",
  /** Sunken input/content field. */
  field: "#F9F9F6",
  /** Standard 3D shadow edge. */
  shadow: "#808080",
  /** Deeper shadow edge (used by some sunken frames). */
  shadowDeep: "#404040",
  /** 3D highlight edge. */
  highlight: "#FFFFFF",
  /** Active title bar / selected menu. */
  navy: "#000080",
  /** Text on navy. */
  onNavy: "#FFFFFF",
  /** Error/danger text. */
  danger: "#8a1f1f",
  /** Success text. */
  success: "#1f5132",
} as const;

/** Bevel border recipes (no background — combine with a `surface.*`). */
export const bevel = {
  /** Raised 3D edge (light top/left, dark bottom/right). */
  outset:
    "border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] rounded-none",
  /** Sunken 3D edge (dark top/left, light bottom/right). */
  inset:
    "border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white rounded-none",
} as const;

/** Background surfaces. */
export const surface = {
  face: "bg-[#D6D4CE]",
  panel: "bg-[#DAD8D2]",
  field: "bg-[#F9F9F6]",
} as const;

/**
 * Pushable button bevel: raised by default, depresses (inset + 1px nudge) while `:active`.
 * Identical to the legacy `winBtn` constant.
 */
export const buttonBevel =
  "rounded-none border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] select-none active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white active:translate-x-px active:translate-y-px";

/** Tahoma-first stack matching `globals.css` body font. */
export const win95Font = 'Tahoma, "MS Sans Serif", Arial, sans-serif';

/** Common spacing presets (Tailwind padding utilities). */
export const spacing = {
  panel: "p-3",
  panelTight: "p-2",
  fieldX: "px-2",
  fieldY: "py-1",
} as const;

/** Join class strings, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
