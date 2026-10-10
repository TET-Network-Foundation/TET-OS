/**
 * The plain message in a node's refusal. Many routes answer `{"ok":false,"error":"…"}`; the page
 * shows (and translates) the message, never the JSON around it.
 * @param {string | undefined} text
 */
export function plainNodeError(text) {
  const s = String(text ?? "");
  try {
    const j = JSON.parse(s);
    if (j && typeof j.error === "string" && j.error.trim()) return j.error.trim();
  } catch {
    /* not JSON: the text is the message */
  }
  return s;
}
