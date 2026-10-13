/** µTET → "120" or "0.5" (at most 6 decimals, no trailing zeros), with thousands separators. */
export function formatTet(micro: number): string {
  const whole = Math.floor(micro / 1_000_000);
  const frac = String(micro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return whole.toLocaleString("en-US") + (frac ? `.${frac}` : "");
}
