"use client";

/**
 * The landing's live list, 2ch-index style: latest public threads, latest signed transactions,
 * latest blocks. Real data only: threads from the public boards (read like the directory reads
 * them), transactions and blocks from this node's `GET /status/live` (its last 20 events). An
 * empty column says so; nothing is simulated.
 */
import { useEffect, useState } from "react";
import { groupThreads } from "../lib/board_threads.mjs";
import { openBoard, readBoard, type OpenBoard } from "../lib/try_board";
import { FOCUS, MONO, cx } from "./ui";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

type LiveEvent = { at_ms: number; kind: string; height?: number; peer?: string };
type ThreadRow = { title: string; board: string; invite: string; count: number; lastAtMs: number };
type Listing = { name: string; invite: string; boardWalletId: string };

const H = "mb-1 border-b border-[#e3e5e8] pb-0.5 text-[14px] font-semibold";
const ROW = "flex gap-2 border-b border-dotted border-[#eceef1] py-0.5 text-[14px] leading-snug";
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function LandingLive(props: { listings: Listing[] | null; listingsError: string; onOpenBoard: (b: OpenBoard) => void }) {
  const { t } = useLang();
  const [events, setEvents] = useState<LiveEvent[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [height, setHeight] = useState<number | null>(null);
  const [liveErr, setLiveErr] = useState(false);
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`${BASE}/status/live`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { events?: LiveEvent[]; height?: number };
        if (live) {
          setEvents([...(j.events ?? [])].sort((a, b) => b.at_ms - a.at_ms));
          setLoadedAt(Date.now());
          setHeight(typeof j.height === "number" ? j.height : null);
          setLiveErr(false);
        }
      } catch {
        if (live) setLiveErr(true);
      }
    };
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!props.listings) return;
    let live = true;
    void (async () => {
      const rows: ThreadRow[] = [];
      // The newest few public boards: enough for a front page, few enough to read quickly.
      for (const l of props.listings!.slice(0, 5)) {
        try {
          const b = await openBoard(BASE, l.invite);
          const posts = (await readBoard(BASE, b, 100)).filter((p) => p.state === "open");
          for (const th of groupThreads(posts)) {
            if (!th.threadId) continue;
            rows.push({ title: th.title ?? t("Untitled"), board: l.name, invite: l.invite, count: th.count, lastAtMs: th.lastAtMs });
          }
        } catch {
          /* a board that doesn't open is skipped */
        }
      }
      if (live) setThreads(rows.sort((a, b) => b.lastAtMs - a.lastAtMs).slice(0, 8));
    })();
    return () => {
      live = false;
    };
  }, [props.listings, t]);

  const blocks = (events ?? []).filter((e) => e.kind === "block").slice(0, 6);
  const txs = (events ?? []).filter((e) => e.kind === "tx");
  const hourAgo = loadedAt - 3_600_000;
  const txHour = txs.filter((e) => e.at_ms >= hourAgo).length;

  return (
    <div className="grid gap-x-6 gap-y-4 md:grid-cols-3" aria-label={t("Live on this node")}>
      <div>
        <h2 className={H}>{t("Latest public threads")}</h2>
        {props.listingsError && props.listings === null ? (
          <p className="text-[14px] text-[#5d646d]">{t("The public-board directory didn't open on this node, so there are no threads to list.")}</p>
        ) : threads === null ? (
          <p className="text-[14px] text-[#5d646d]">{props.listings === null ? t("Reading the directory…") : t("Reading the boards…")}</p>
        ) : threads.length === 0 ? (
          <p className="text-[14px] text-[#5d646d]">{t("No public threads yet. Start one on a public board.")}</p>
        ) : (
          <ul>
            {threads.map((th, i) => (
              <li key={i} className={ROW}>
                <span className={cx(MONO, "shrink-0 text-[#5d646d]")}>{hhmm(th.lastAtMs)}</span>
                <span className="min-w-0">
                  <button type="button" className={cx(FOCUS, "rounded-sm text-left underline underline-offset-2")} onClick={() => void openBoard(BASE, th.invite).then(props.onOpenBoard)}>
                    {th.title}
                  </button>{" "}
                  <span className="text-[#5d646d]">
                    ({th.count}) · {th.board}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className={H}>{t("Latest signed transactions")}</h2>
        {liveErr ? (
          <p className="text-[14px] text-[#5d646d]">{t("This node doesn't serve live numbers right now.")}</p>
        ) : events === null ? (
          <p className="text-[14px] text-[#5d646d]">…</p>
        ) : txs.length === 0 ? (
          <p className="text-[14px] text-[#5d646d]">{t("None among this node's last 20 events. Every transaction is signed by its sender's key; this list shows when they arrive, not what they say.")}</p>
        ) : (
          <>
            <ul>
              {txs.slice(0, 6).map((e, i) => (
                <li key={i} className={ROW}>
                  <span className={cx(MONO, "shrink-0 text-[#5d646d]")}>{hhmm(e.at_ms)}</span>
                  <span>
                    {t("a signed transaction")} {e.peer ? <span className={cx(MONO, "text-[#5d646d]")}>…{e.peer}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-0.5 text-[13px] text-[#5d646d]">{t("{n} in the last hour", { n: txHour })}</p>
          </>
        )}
      </div>
      <div>
        <h2 className={H}>
          {t("Latest blocks")}
          {height !== null ? <span className={cx(MONO, "ml-1.5 font-normal text-[#5d646d]")}>· {t("height {h}", { h: height.toLocaleString() })}</span> : null}
        </h2>
        {liveErr ? (
          <p className="text-[14px] text-[#5d646d]">{t("This node doesn't serve live numbers right now.")}</p>
        ) : events === null ? (
          <p className="text-[14px] text-[#5d646d]">…</p>
        ) : blocks.length === 0 ? (
          <p className="text-[14px] text-[#5d646d]">{t("No blocks from peers among this node's last 20 events (a node that makes blocks itself doesn't list its own here).")}</p>
        ) : (
          <ul>
            {blocks.map((e, i) => (
              <li key={i} className={ROW}>
                <span className={cx(MONO, "shrink-0 text-[#5d646d]")}>{hhmm(e.at_ms)}</span>
                <span className={MONO}>#{(e.height ?? 0).toLocaleString()}</span>
                {e.peer ? <span className={cx(MONO, "text-[#5d646d]")}>…{e.peer}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[13px] text-[#5d646d] md:col-span-3">{t("One node's view, refreshed every 30 seconds. Nothing here is simulated.")}</p>
    </div>
  );
}
