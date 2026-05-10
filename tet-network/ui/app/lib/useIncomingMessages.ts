"use client";

import { useCallback, useEffect, useState } from "react";
import { encodeAddress, decodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";

import type { AuditEventJson } from "./tet_core_http";
import { fetchJson, tetCoreUrl } from "./tet_core_http";

const STEVEMON_PER_TET = 1_000_000n;
const LS_KEY = "tet.inbox.messages.v1";
const MAX_STORED = 250;

export type InboxMessage = {
  id: string;
  receivedAtMs: number;
  fromSs58: string;
  toSs58: string;
  fromPubkeyHex?: string;
  toPubkeyHex?: string;
  grossTetDisplay: string;
  memo: string;
};

type StoreV1 = { v: 1; items: InboxMessage[] };

function stripAllHexPrefixes(input: string): string {
  let s = input.trim().toLowerCase();
  while (s.startsWith("0x")) s = s.slice(2);
  return s;
}

export function normalizePubkeyHex(input: string | null | undefined): string | null {
  if (input == null || input === "" || input === "—") return null;
  const t = input.trim();
  let s = stripAllHexPrefixes(t);
  if (/^[0-9a-f]{64}$/.test(s)) return `0x${s}`;
  try {
    const decoded = decodeAddress(t);
    const raw = stripAllHexPrefixes(u8aToHex(decoded, -1, false));
    if (/^[0-9a-f]{64}$/.test(raw)) return `0x${raw}`;
  } catch {
    // not SS58
  }
  return null;
}

function loadAll(): InboxMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as Partial<StoreV1> | null;
    if (!j || j.v !== 1 || !Array.isArray(j.items)) return [];
    const rows = j.items.filter(
      (x) =>
        x &&
        typeof x.id === "string" &&
        typeof x.fromSs58 === "string" &&
        typeof x.toSs58 === "string" &&
        typeof x.grossTetDisplay === "string" &&
        typeof x.memo === "string" &&
        typeof x.receivedAtMs === "number",
    ) as InboxMessage[];
    return rows.map((m) => ({
      ...m,
      fromPubkeyHex: normalizePubkeyHex(m.fromPubkeyHex ?? m.fromSs58) ?? m.fromPubkeyHex,
      toPubkeyHex: normalizePubkeyHex(m.toPubkeyHex ?? m.toSs58) ?? m.toPubkeyHex,
    }));
  } catch {
    return [];
  }
}

function saveAll(items: InboxMessage[]) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = items.slice(-MAX_STORED);
    window.localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, items: trimmed } satisfies StoreV1));
  } catch {
    // ignore
  }
}

function grossMicroToTetDisplay(micro: number | string): string {
  const n = typeof micro === "string" ? BigInt(micro || "0") : BigInt(Math.floor(micro));
  const whole = n / STEVEMON_PER_TET;
  const frac = n % STEVEMON_PER_TET;
  const fracStr = frac.toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

function shortAddr(a: string, head = 6, tail = 4): string {
  if (!a || a.length <= head + tail + 3) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function formatInboxLine(m: InboxMessage): string {
  const msg = m.memo ? ` | Msg: "${m.memo.replace(/\r?\n/g, " ")}"` : "";
  return `[From: ${shortAddr(m.fromSs58)}] Received ${m.grossTetDisplay} TET${msg}`;
}

export function resolveMessageDestCanonical(m: InboxMessage): string | null {
  if (m.toPubkeyHex) {
    const h = normalizePubkeyHex(m.toPubkeyHex);
    if (h) return h;
  }
  return normalizePubkeyHex(m.toSs58);
}

export function filterInboxMessagesForRecipient(
  messages: InboxMessage[],
  activePubkeyCanonical: string | null,
): InboxMessage[] {
  if (!activePubkeyCanonical) return [];
  return messages
    .filter((m) => {
      const dest = resolveMessageDestCanonical(m);
      return dest !== null && dest === activePubkeyCanonical;
    })
    .sort((a, b) => b.receivedAtMs - a.receivedAtMs);
}

function hexWalletToDisplaySs58(hex64: string, ss58: number): string {
  const h = stripAllHexPrefixes(hex64);
  if (h.length !== 64) return hex64;
  const u8 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) u8[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  try {
    return encodeAddress(u8, ss58);
  } catch {
    return shortAddr(hex64, 8, 6);
  }
}

/**
 * Inbox from `GET /explorer/events` (ledger audit). Replaces Substrate `MemoSent` subscription.
 */
export function useIncomingMessages(baseUrl: string, recipientCanonicalHex: string | null) {
  const [messages, setMessages] = useState<InboxMessage[]>(() => loadAll());
  const ss58 = 42;

  useEffect(() => {
    let cancelled = false;
    const seen = new Set<string>();

    const tick = async () => {
      if (cancelled || !recipientCanonicalHex) return;
      const my = stripAllHexPrefixes(recipientCanonicalHex);
      if (my.length !== 64) return;

      const r = await fetchJson<AuditEventJson[]>(tetCoreUrl(baseUrl, "/explorer/events?limit=500"));
      if (!r.ok || !Array.isArray(r.data)) return;

      const batch: InboxMessage[] = [];
      for (const ev of r.data) {
        const rec = ev.record;
        if (String(rec?.action ?? "") !== "transfer") continue;
        const toW = String(rec.to_wallet ?? "").toLowerCase();
        if (toW.length !== 64) continue;
        if (toW !== my) continue;
        const fromW = String(rec.from_wallet ?? "").toLowerCase();
        const amountMicro = rec.amount_micro;
        const am =
          typeof amountMicro === "number"
            ? amountMicro
            : typeof amountMicro === "string"
              ? Number(amountMicro)
              : 0;
        const id = `ev-${ev.seq}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const fromDisp = hexWalletToDisplaySs58(fromW, ss58);
        const toDisp = hexWalletToDisplaySs58(toW, ss58);
        batch.push({
          id,
          receivedAtMs: Number(ev.ts_ms) || Date.now(),
          fromSs58: fromDisp,
          toSs58: toDisp,
          fromPubkeyHex: `0x${fromW}`,
          toPubkeyHex: `0x${toW}`,
          grossTetDisplay: grossMicroToTetDisplay(Number.isFinite(am) ? am : 0),
          memo: "",
        });
      }
      if (batch.length === 0) return;
      setMessages((prev) => {
        const merged = [...batch, ...prev];
        const deduped: InboxMessage[] = [];
        const k = new Set<string>();
        for (const m of merged) {
          if (k.has(m.id)) continue;
          k.add(m.id);
          deduped.push(m);
        }
        const next = deduped.slice(0, MAX_STORED);
        saveAll(next);
        return next;
      });
    };

    void tick();
    const id = window.setInterval(() => void tick(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [baseUrl, recipientCanonicalHex]);

  const clearInboxForRecipient = useCallback((recipientPubkeyCanonical: string | null) => {
    if (!recipientPubkeyCanonical) return;
    setMessages((prev) => {
      const next = prev.filter((m) => {
        const dest = resolveMessageDestCanonical(m);
        return dest !== recipientPubkeyCanonical;
      });
      saveAll(next);
      return next;
    });
  }, []);

  return { allMessages: messages, clearInboxForRecipient };
}
