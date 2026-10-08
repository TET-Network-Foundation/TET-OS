"use client";

/**
 * Public boards: the directory (`lib/board_directory.mjs`). Lists the boards whose own wallet
 * announced them, searchable by name, with each board's threads and posts today read from the board
 * itself. Opening one checks its keys against the node, as any invite does.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { searchListings } from "../lib/board_directory.mjs";
import { groupThreads } from "../lib/board_threads.mjs";
import { openBoard, readBoard, type OpenBoard } from "../lib/try_board";
import { FOCUS, INK, Input, MONO, PanelHead, PinnedNotice, cx, fmtDate } from "./ui";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

type Listing = { boardWalletId: string; name: string; invite: string; listedAtMs: number };
type Stats = { threads: number; today: number } | "unreadable";

/** How many boards get their numbers read (each costs a request to the node). */
const STATS_FOR = 12;

const directoryNotice = (t: (en: string) => string) => [
  t("A public board's invite is published here, so anyone can read every post on it."),
  t("Only a board's own wallet can list it: listings by anyone else are ignored. Nobody can list your invite-only board."),
  t("A listing lasts 7 days after its newest announcement; to keep a board listed, announce it again with the board's 12 words."),
  t("This page reads the directory's newest 200 posts. Anyone can list a board, and names are not checked: a name says nothing about who runs a board."),
  t("A listing proves the board's own key listed it. It doesn't prove who runs the board or that its name is true."),
];

export default function DirectoryPanel(props: { directory: OpenBoard | null; listings: Listing[] | null; error: string; onOpen: (b: OpenBoard) => void }) {
  const { t, locale } = useLang();
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [opening, setOpening] = useState("");
  const [err, setErr] = useState("");
  const asked = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const shown: Listing[] = useMemo(() => (props.listings ? (searchListings(props.listings, query) as Listing[]) : []), [props.listings, query]);

  // Numbers for the first boards shown, one request at a time. A read already started always lands
  // (a new search only stops the loop), so no board is left at "…".
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const l of shown.slice(0, STATS_FOR)) {
        if (!live || !mounted.current) return;
        if (asked.current.has(l.boardWalletId)) continue;
        asked.current.add(l.boardWalletId);
        try {
          const b = await openBoard(BASE, l.invite);
          const posts = await readBoard(BASE, b);
          const open = posts.flatMap((p) => (p.state === "open" ? [{ msgId: p.msgId, sentAtMs: p.sentAtMs, text: p.text }] : []));
          const today = new Date().toDateString();
          const s: Stats = {
            threads: groupThreads(open).filter((t: { threadId: string }) => t.threadId).length,
            today: posts.filter((p) => new Date(p.sentAtMs).toDateString() === today).length,
          };
          if (mounted.current) setStats((x) => ({ ...x, [l.boardWalletId]: s }));
        } catch {
          if (mounted.current) setStats((x) => ({ ...x, [l.boardWalletId]: "unreadable" }));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [shown]);

  async function open(l: Listing) {
    setErr("");
    setOpening(l.boardWalletId);
    try {
      props.onOpen(await openBoard(BASE, l.invite));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening("");
    }
  }

  return (
    <section aria-label={t("Public boards")}>
      <PanelHead
        title={t("Public boards")}
        sub={props.listings ? <span className="tabular-nums">{t("{n} listed", { n: props.listings.length })}</span> : undefined}
        todo={t("Find a board by name and open it, or start your own from “start or open a board”.")}
      />
      <div className="max-w-[46rem] px-4 pb-6 md:px-5">
        <PinnedNotice lines={directoryNotice(t)} />
        {!props.directory ? (
          <p className="py-2 text-[15px] text-[#5d646d]">{props.error || t("This node has no directory set up, so there are no public boards here yet.")}</p>
        ) : (
          <>
            <Input ariaLabel={t("Search boards by name")} value={query} onChange={setQuery} placeholder={t("Search by name…")} />
            <ol aria-label={t("Boards")} className="mt-3">
              {shown.map((l) => {
                const s = stats[l.boardWalletId];
                return (
                  <li key={l.boardWalletId} className="truncate py-1 text-[15px]">
                    <button
                      type="button"
                      disabled={!!opening}
                      onClick={() => void open(l)}
                      className={cx(FOCUS, "rounded-sm text-left text-[#1a237e] underline underline-offset-2 disabled:opacity-60")}
                    >
                      {l.name}
                    </button>{" "}
                    <span className="text-[13.5px] text-[#5d646d]">
                      — {s === undefined ? "…" : s === "unreadable" ? <span className={INK.bad}>{t("doesn't open")}</span> : t("{threads} threads · {today} posts today", { threads: s.threads, today: s.today })} ·{" "}
                      {t("listed {date}", { date: fmtDate(l.listedAtMs, locale) })}
                      {opening === l.boardWalletId ? ` · ${t("opening…")}` : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
            {props.listings === null ? <p className="py-3 text-[15px] text-[#5d646d]">{t("Reading the directory…")}</p> : null}
            {props.listings && shown.length === 0 ? (
              <p className="py-3 text-[15px] text-[#5d646d]">{query.trim() ? t("No public board has that in its name.") : t("No public boards yet.")}</p>
            ) : null}
            {err || props.error ? (
              <p role="alert" className={cx("py-2 text-[15px]", INK.bad)}>
                {err || props.error}
              </p>
            ) : null}
          </>
        )}
        <p className="mt-4 text-[14px] text-[#5d646d]">
          {t("The directory is itself a board anyone can read; its posts are the listings.")}
        </p>
      </div>
    </section>
  );
}
