export type TxType = "Send" | "Receive" | "Mine" | "Execute" | "Genesis Reward";

export type TxRowV0 = {
  ts_ms: number;
  type: TxType;
  address: string;
  amount_tet: string; // "5.00"
  amount_stevemon: string; // "5000000"
  message?: string; // optional memo (<= 64 chars)
};

export type TxStoreV0 = {
  v: 0;
  rows: TxRowV0[];
};

const KEY = "tet.txs.v0";

export function loadTxs(): TxStoreV0 {
  if (typeof window === "undefined") return { v: 0, rows: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { v: 0, rows: [] };
    const j = JSON.parse(raw) as Partial<TxStoreV0> | null;
    if (!j || j.v !== 0 || !Array.isArray(j.rows)) return { v: 0, rows: [] };
    const rows = j.rows
      .filter((r) => r && typeof r === "object")
      .map((r) => r as Partial<TxRowV0>)
      .filter((r) => typeof r.ts_ms === "number" && typeof r.type === "string" && typeof r.address === "string")
      .map((r) => ({
        ts_ms: r.ts_ms!,
        type: r.type as TxType,
        address: r.address!,
        amount_tet: typeof r.amount_tet === "string" ? r.amount_tet : "0.00",
        amount_stevemon: typeof r.amount_stevemon === "string" ? r.amount_stevemon : "0",
        message: typeof r.message === "string" ? r.message : undefined,
      }));
    return { v: 0, rows };
  } catch {
    return { v: 0, rows: [] };
  }
}

export function saveTxs(s: TxStoreV0) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

