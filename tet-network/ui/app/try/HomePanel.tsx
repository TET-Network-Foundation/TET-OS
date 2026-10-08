"use client";

/**
 * Try TET's first screen, on its own (no sidebars): the logo, "TET v0.2 · testnet" and one search
 * box, centred both ways; under it the four links (Try · Sign · Verify · How it works) and one
 * small "continue" line. The live chain strip and the footer are the page's (page.tsx). Everything
 * else is behind "How it works" (HowPanel). The search box works today over what this node serves
 * publicly; later the same box becomes TetSearch.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { readPublicThreads, searchThreads, type PublicListing, type PublicThread } from "../lib/public_search";
import type { OpenBoard } from "../lib/try_board";
import { openBoard } from "../lib/try_board";
import { FOCUS, MONO, cx } from "./ui";
import { BASE, useTryWallet } from "./wallet";
import { useLang } from "./i18n";
import ContinueBlock from "./ContinueBlock";
import GenuineCheck from "./GenuineCheck";

/** A real sample marked as genuine on this node (deploy: scripts/make_sample.mjs); empty: no link. */
const SAMPLE_CODE = (process.env.NEXT_PUBLIC_TET_SAMPLE_CODE ?? "").trim();
const SAMPLE_URL = "/sample/tet-sample.txt";
import { parseProofCode } from "../lib/proof_code";

const LINK = cx(FOCUS, "rounded-sm underline underline-offset-2");

export default function HomePanel(props: {
  go: (tool: string) => void;
  listings: PublicListing[] | null;
  listingsError: string;
  onBoard: (b: OpenBoard) => void;
  lastBoard: { name: string; invite: string | null } | null;
  onOpenBoard: (invite: string) => void;
  /** A query to search on arrival (a `#code=` link). */
  initialQuery?: string;
  /** A search handed over from an inner page's top bar (a new `n` runs it again). */
  search?: { q: string; n: number };
}) {
  const { t } = useLang();
  const { ensureWallet } = useTryWallet();
  const [q, setQ] = useState(props.initialQuery ?? "");
  const [asked, setAsked] = useState(props.initialQuery ?? "");
  // A proof code, a file SHA-256 or a signer key looks up signatures; anything else searches threads.
  const [byFile, setByFile] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
  const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;
  const signatureQuery = !!asked && (asked === "@dates" || !!parseProofCode(asked) || /^(0x)?[0-9a-f]{64}$/i.test(asked));
  async function onFile(f: File | undefined) {
    if (!f) return;
    // Hashed here, in this tab: the file itself is never uploaded.
    const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer())), (x) => x.toString(16).padStart(2, "0")).join("");
    setByFile(true);
    setQ(h);
    setAsked(h);
  }
  const [threads, setThreads] = useState<PublicThread[] | null>(null);

  // Read the public boards only once someone searches for words (the node rate-limits reads).
  const wantThreads = !!asked && !signatureQuery;
  useEffect(() => {
    if (!props.listings || !wantThreads || threads) return;
    let on = true;
    void readPublicThreads(BASE, props.listings).then((th) => on && setThreads(th));
    return () => {
      on = false;
    };
  }, [props.listings, wantThreads, threads]);

  // The newest public threads (real data), read once the directory is in; hidden while empty.
  const [newest, setNewest] = useState<PublicThread[]>([]);
  useEffect(() => {
    if (!props.listings || props.listings.length === 0) return;
    let on = true;
    void readPublicThreads(BASE, props.listings, 8)
      .then((th) => on && setNewest([...th].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 8)))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [props.listings]);

  const hits = useMemo(() => (threads && asked ? searchThreads(threads, asked) : []), [threads, asked]);
  useEffect(() => {
    if (!props.search) return;
    setQ(props.search.q);
    setAsked(props.search.q);
  }, [props.search]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setByFile(false);
    setAsked(q.trim());
  };

  return (
    <section aria-label={t("TET")} className={cx("flex flex-1 flex-col items-center px-4", asked ? "pt-10 md:pt-14" : "justify-center py-10")}>
      <div className="w-full max-w-[36rem] space-y-4 text-center">
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/tet-logo.svg" width={88} height={88} alt={t("TET logo")} className="tet-logo h-[88px] w-[88px]" />
          <p className="text-[22px] font-semibold">
            TET v0.2{" "}
            <span className="ml-1 rounded-full border border-[#6b4e00] px-2 py-0.5 align-middle text-[12px] font-semibold text-[#6b4e00]">{t("trial")}</span>
          </p>
        </div>
        <p className="text-[16px] text-[#3d434a]">{t("A network where anyone can check who made something, and when.")}</p>
        <form
          onSubmit={submit}
          className="flex gap-2"
          role="search"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <input
            aria-label={t("Search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Enter a proof code, or drop a file here")}
            className={cx(FOCUS, "min-w-0 flex-1 rounded-full border border-[#c9ced4] bg-white px-4 py-2.5 text-[16px]")}
          />
          <button type="submit" className={cx(FOCUS, "rounded-full border border-[#c9ced4] px-4 py-2.5 text-[15px] hover:bg-[#fafbfc]")}>
            {t("Search")}
          </button>
        </form>
        {SAMPLE_CODE ? (
          <p className="text-[14px]">
            <button
              type="button"
              className={LINK}
              onClick={() => {
                setByFile(false);
                setQ(SAMPLE_CODE);
                setAsked(SAMPLE_CODE);
              }}
            >
              {t("try it: verify this sample")}
            </button>
          </p>
        ) : null}
        <p className="text-[15px]">
          <button type="button" className={LINK} onClick={() => props.go("genuine")}>
            {t("Mark as genuine")}
          </button>
          {" · "}
          <button type="button" className={LINK} onClick={() => props.go("seal")}>
            {t("Sealed prediction")}
          </button>
          {" · "}
          <button type="button" className={LINK} onClick={() => props.go("what")}>
            {t("What is TET")}
          </button>
          {" · "}
          <button type="button" className={LINK} onClick={() => props.go("inside")}>
            {t("Inside")}
          </button>
          {" · "}
          <button type="button" className={LINK} onClick={() => void ensureWallet().then(() => props.go("directory"))}>
            {t("Try")}
          </button>

          {" · "}
          <button type="button" className={LINK} onClick={() => props.go("verify")}>
            {t("Verify")}
          </button>
        </p>
        <details className="text-[13.5px] text-[#5d646d]">
          <summary className={cx(FOCUS, "cursor-pointer rounded-sm")}>{t("Find marks by file or date")}</summary>
          <div className="mt-2 space-y-2 text-left">
            <label className="block">
              {t("Drop or choose a file: its SHA-256 is computed in this tab, and the file is never uploaded.")}
              <input type="file" aria-label={t("A file to find its signatures")} onChange={(e) => void onFile(e.target.files?.[0])} className="mt-1 block text-[13.5px]" />
            </label>
            <p>{t("Exact files only: re-compressed or edited copies won't match.")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <label>
                {t("published from")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-[#c9ced4] px-1" />
              </label>
              <label>
                {t("to")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-[#c9ced4] px-1" />
              </label>
              <button
                type="button"
                className={cx(FOCUS, "rounded-sm underline underline-offset-2")}
                disabled={!from && !to}
                onClick={() => {
                  setByFile(false);
                  setAsked("@dates");
                }}
              >
                {t("list signatures in these dates")}
              </button>
            </div>
            <p>{t("Only signatures their signers chose to publish are listed. Anonymous posts and votes are never in it.")}</p>
          </div>
        </details>
        <ContinueBlock lastBoard={props.lastBoard} onOpenBoard={props.onOpenBoard} />
        {newest.length && !asked ? (
          <div className="text-left">
            <h2 className="mb-1 text-[14px] font-semibold text-[#5d646d]">{t("Newest threads")}</h2>
            <ol className="space-y-0.5 text-[15px]">
              {newest.map((h, i) => (
                <li key={i} className="truncate">
                  <button type="button" className={cx(LINK, "text-left")} onClick={() => void openBoard(BASE, h.invite).then(props.onBoard)}>
                    {h.title || t("Untitled")}
                  </button>{" "}
                  <span className="text-[13px] text-[#5d646d]">
                    ({h.count}) · {h.board} · {new Date(h.createdAtMs).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {signatureQuery ? (
          <div aria-live="polite" className="text-left">
            <GenuineCheck
              query={asked}
              fromMs={fromMs}
              toMs={toMs}
              byFile={byFile}
              sample={SAMPLE_CODE && asked === SAMPLE_CODE ? { url: SAMPLE_URL } : undefined}
              onId={(k) => {
                setByFile(false);
                setQ(k);
                setAsked(k);
              }}
            />
          </div>
        ) : asked ? (
          <div aria-live="polite" className="text-left">
            {props.listingsError && props.listings === null ? (
              <p className="text-[14px] text-[#5d646d]">{t("The public-board directory didn't open on this node, so there is nothing to search.")}</p>
            ) : threads === null ? (
              <p className="text-[14px] text-[#5d646d]">{t("Reading the public boards…")}</p>
            ) : hits.length === 0 ? (
              <p className="text-[14px] text-[#5d646d]">{t("Nothing found among {n} public threads.", { n: threads.length })}</p>
            ) : (
              <ol className="space-y-2">
                {hits.slice(0, 20).map((h, i) => (
                  <li key={i}>
                    <button type="button" className={cx(LINK, "text-left text-[16px]")} onClick={() => void openBoard(BASE, h.invite).then(props.onBoard)}>
                      {h.title || t("Untitled")}
                    </button>
                    <p className="text-[13.5px] text-[#5d646d]">
                      {h.board} · {t("{n} posts", { n: h.count })} · <span className={MONO}>{new Date(h.lastAtMs).toLocaleString()}</span>
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-[13px] text-[#5d646d]">{t("Searches the public boards' threads on this node, in your tab. Later this box becomes TetSearch.")}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
