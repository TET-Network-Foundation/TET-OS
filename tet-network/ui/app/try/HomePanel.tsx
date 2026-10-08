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
import { SignatureResults, useSignaturesBoard } from "./ProofCode";
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
}) {
  const { t } = useLang();
  const { ensureWallet } = useTryWallet();
  const [q, setQ] = useState(props.initialQuery ?? "");
  const [asked, setAsked] = useState(props.initialQuery ?? "");
  const sigBoard = useSignaturesBoard();
  // A proof code, a file SHA-256 or a signer key looks up signatures; anything else searches threads.
  const signatureQuery = !!asked && (!!parseProofCode(asked) || /^(0x)?[0-9a-f]{64}$/i.test(asked));
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

  const hits = useMemo(() => (threads && asked ? searchThreads(threads, asked) : []), [threads, asked]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAsked(q.trim());
  };

  return (
    <section aria-label={t("TET")} className={cx("flex flex-1 flex-col items-center px-4", asked ? "pt-10 md:pt-14" : "justify-center py-10")}>
      <div className="w-full max-w-[36rem] space-y-4 text-center">
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/tet-logo.svg" width={88} height={88} alt={t("TET logo")} className="tet-logo h-[88px] w-[88px]" />
          <p className="text-[22px] font-semibold">TET v0.2 · testnet</p>
        </div>
        <form onSubmit={submit} className="flex gap-2" role="search">
          <input
            aria-label={t("Search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search threads, or enter a proof code")}
            className={cx(FOCUS, "min-w-0 flex-1 rounded-full border border-[#c9ced4] bg-white px-4 py-2.5 text-[16px]")}
          />
          <button type="submit" className={cx(FOCUS, "rounded-full border border-[#c9ced4] px-4 py-2.5 text-[15px] hover:bg-[#fafbfc]")}>
            {t("Search")}
          </button>
        </form>
        <p className="text-[15px]">
          <button type="button" className={LINK} onClick={() => void ensureWallet().then(() => props.go("directory"))}>
            {t("Try")}
          </button>
          {" · "}
          <button type="button" className={LINK} onClick={() => props.go("sign")}>
            {t("Sign")}
          </button>
          {" · "}
          <button type="button" className={LINK} onClick={() => props.go("verify")}>
            {t("Verify")}
          </button>
          {" · "}
          <button type="button" className={LINK} onClick={() => props.go("how")}>
            {t("How it works")}
          </button>
        </p>
        <ContinueBlock lastBoard={props.lastBoard} onOpenBoard={props.onOpenBoard} />

        {signatureQuery ? (
          <div aria-live="polite" className="text-left">
            <SignatureResults query={asked} board={sigBoard.board} boardError={sigBoard.error} />
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
