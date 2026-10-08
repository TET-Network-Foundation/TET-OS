"use client";

/**
 * The home view's left column: this node's own chain events as a monospace stream, newest first,
 * from `GET /status/live` every 5 seconds. Real data only: a block line is a block this node
 * received, a tx line is a signed transaction that arrived. If the node doesn't answer, it says so.
 */
import { useEffect, useState } from "react";
import { MONO, cx } from "./ui";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

type LiveEvent = { at_ms: number; kind: string; height?: number; peer?: string };
type Live = { height: number; peers: number; events: LiveEvent[] };

const hms = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export default function LiveTerminal() {
  const { t } = useLang();
  const [live, setLive] = useState<Live | null>(null);
  const [down, setDown] = useState("");
  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const r = await fetch(`${BASE}/status/live`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as Partial<Live>;
        if (on) {
          setLive({ height: Number(j.height ?? 0), peers: Number(j.peers ?? 0), events: [...(j.events ?? [])].sort((a, b) => b.at_ms - a.at_ms) });
          setDown("");
        }
      } catch (e: unknown) {
        if (on) setDown(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = setInterval(() => void load(), 5_000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  const txs = live?.events.filter((e) => e.kind === "tx").length ?? 0;
  const line = (e: LiveEvent) => {
    if (e.kind === "block") return `${t("block")} #${(e.height ?? 0).toLocaleString()}`;
    if (e.kind === "tx") return t("signed tx");
    if (e.kind === "tmail") return t("message");
    if (e.kind === "file") return t("file");
    if (e.kind === "peer_connected") return t("peer joined");
    if (e.kind === "peer_disconnected") return t("peer left");
    return e.kind;
  };
  return (
    <div className={cx(MONO, "rounded-md border border-[#1c1f23] bg-[#16181b] p-3 text-[12.5px] leading-[1.55] text-[#c9d1d9]")} aria-label={t("This node, live")} role="log">
      {down ? (
        <p className="text-[#f19a9a]">{t("node down: {why}", { why: down })}</p>
      ) : !live ? (
        <p>…</p>
      ) : (
        <>
          <p className="text-[#8fd3a8]">
            {t("height")} {live.height.toLocaleString()} · {t("peers")} {live.peers} · {t("signed tx")} {txs}
          </p>
          <p className="mb-1 text-[#6c737b]">{t("last {n} events on this node", { n: live.events.length })}</p>
          {live.events.length === 0 ? <p className="text-[#6c737b]">{t("nothing yet")}</p> : null}
          {live.events.slice(0, 14).map((e, i) => (
            <p key={i} className="truncate">
              <span className="text-[#6c737b]">{hms(e.at_ms)}</span> {line(e)}
              {e.peer ? <span className="text-[#6c737b]"> …{e.peer}</span> : null}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
