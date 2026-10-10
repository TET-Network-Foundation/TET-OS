"use client";

/**
 * TetSearch v1 (lib/tetsearch.ts): search the signed sites vouched members listed. Members only.
 * The search runs on this device; the node only serves the list of sites (to a member's signed
 * read) and the sites themselves (public). Old-search-engine plainness: title, URL, snippet, one
 * meta line.
 */
import { useState } from "react";
import { fetchListings, loadDocs, rank, type Doc } from "../lib/tetsearch";
import { mldsa44Verify } from "../lib/pqc";
import { Button, Input, MONO, PanelHead, cx, fmtDate } from "./ui";
import { BASE, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

type Hit = Doc & { score: number; snippet: string };

export default function SearchPanel(props: { active: boolean }) {
  const { t, locale } = useLang();
  const { wallet, ensureWallet } = useTryWallet();
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "members-only" | "error">("idle");
  const [err, setErr] = useState("");

  async function search() {
    setErr("");
    setState("loading");
    try {
      await ensureWallet();
      let d = docs;
      if (!d) {
        const l = await fetchListings(BASE);
        if (l.status === 401 || l.status === 403) return setState("members-only");
        if (l.status !== 200) throw new Error(l.error);
        d = await loadDocs(BASE, l.listings, mldsa44Verify);
        setDocs(d);
      }
      setHits(rank(d, q));
      setState("idle");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  if (!props.active) return null;
  return (
    <div>
      <PanelHead title="TetSearch" todo={t("Only vouched people can publish. Built to keep out mass AI generation.")} />
      <div className="space-y-3 px-4 py-4 md:px-5">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Input value={q} onChange={setQ} placeholder={t("search signed TET sites")} />
          <Button type="submit" disabled={state === "loading" || !q.trim()}>
            {t("Search")}
          </Button>
        </form>
        <p className="text-[13.5px] text-[#5d646d]">
          {t("Keys without a human vouch can't publish. A member can still paste AI-written text: vouching limits how many people publish, not what they write.")}{" "}
          {t("Your search runs on this device; this node doesn't see what you search for. It does see that you read the list of sites.")}
        </p>
        {state === "loading" ? <p>{t("Checking each listed site's signatures…")}</p> : null}
        {state === "members-only" ? <p>{t("TetSearch is for vouched members (Shelter). Joining needs an in-person vouch from a member.")}</p> : null}
        {state === "error" ? <p className="text-[#9a1c1c]">{t(err)}</p> : null}
        {hits && state === "idle" ? (
          hits.length ? (
            <ol className="space-y-5">
              {hits.map((h) => (
                <li key={h.siteId}>
                  <a className="text-[17px] text-[#1a237e] underline-offset-2 hover:underline" href={`/s/${h.siteId}`}>
                    {h.title}
                  </a>
                  <p translate="no" className={cx(MONO, "text-[13px] text-[#1e6b35]")}>
                    /s/{h.siteId}
                  </p>
                  <p className="text-[14.5px]">{h.snippet}</p>
                  <p className="text-[13px] text-[#5d646d]">
                    {t("signed · version {n} · {date}", { n: h.version, date: fmtDate(h.signedAtMs, locale) })}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("No listed site matches.")}</p>
          )
        ) : null}
        <p className="border-t border-[#e3e5e8] pt-3 text-[13px] text-[#5d646d]">
          {t("Proves: each result's site was listed by a vouched member and every block on it is signed by the site's key. Doesn't prove: that a person wrote it, or that it's true.")}
        </p>
        {wallet ? null : <p className="text-[13px] text-[#5d646d]">{t("Searching makes an ID in this tab (to sign the members-only read).")}</p>}
      </div>
    </div>
  );
}
