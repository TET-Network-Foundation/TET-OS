export type SessionV0 = {
  v: 0;
  address: string;
  balance_tet: string;
  created_at_ms: number;
};

const KEY = "tet.session.v0";

export function loadSession(): SessionV0 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<SessionV0> | null;
    if (!j || j.v !== 0) return null;
    if (typeof j.address !== "string") return null;
    if (typeof j.balance_tet !== "string") return null;
    if (typeof j.created_at_ms !== "number") return null;
    return j as SessionV0;
  } catch {
    return null;
  }
}

export function saveSession(s: SessionV0) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

