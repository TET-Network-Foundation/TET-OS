"use client";

/**
 * "What's inside TET": a plain directory of what this node holds right now, with live counts, the
 * time they were read, and how long each kind is kept. Retention comes from the node's own settings
 * (GET /stats/inside, the values the stores apply); nothing here is hard-coded (try_inside_guard).
 * Counts only: no names, no content. The node can't read what it holds, so it knows only how many
 * messages it has in all; public boards are counted here, in the visitor's tab, from their posts.
 */
import { useEffect, useState } from "react";
import { FOCUS, cx } from "./ui";
import { useLang } from "./i18n";
import { tetCoreUrl } from "../lib/tet_core_http";
import { readPublicThreads, type PublicListing } from "../lib/public_search";
import { LISTING_TTL_MS } from "../lib/board_directory.mjs";

const BASE = "/tet-node-api";

export type InsideStats = {
  at_ms: number;
  counts: { blocks: number; messages_and_posts: number; files: number; signatures: number; sites: number };
  retention: {
    messages_and_posts_ms: { default: number; max: number };
    files_ms: { default: number; max: number };
    sites_after_last_edit_ms: number;
  };
};

/** A duration as whole days, or hours under a day. */
export function spanText(ms: number, t: (s: string, v?: Record<string, string | number>) => string): string {
  const h = Math.round(ms / 3_600_000);
  return h >= 24 ? t("{n} days", { n: Math.round(h / 24) }) : t("{n} hours", { n: Math.max(1, h) });
}

export default function InsidePanel(props: { listings: PublicListing[] | null; go: (tool: string) => void }) {
  const { t } = useLang();
  const [s, setS] = useState<InsideStats | null>(null);
  const [err, setErr] = useState("");
  const [pub, setPub] = useState<{ threads: number; posts: number } | null>(null);

  useEffect(() => {
    let on = true;
    fetch(tetCoreUrl(BASE, "/stats/inside"))
      .then((r) => (r.ok ? (r.json() as Promise<InsideStats>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => on && setS(j))
      .catch((e: unknown) => on && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (!props.listings) return;
    let on = true;
    void readPublicThreads(BASE, props.listings, props.listings.length)
      .then((th) => on && setPub({ threads: th.length, posts: th.reduce((n, x) => n + x.count, 0) }))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [props.listings]);

  const link = cx(FOCUS, "rounded-sm underline underline-offset-2");
  const num = (n: number | undefined) => (n === undefined ? "…" : n.toLocaleString());
  const kept = (r: { default: number; max: number }) =>
    r.default === r.max ? spanText(r.default, t) : t("{d} (up to {m})", { d: spanText(r.default, t), m: spanText(r.max, t) });

  const rows: { what: string; count: string; keep: string; tool?: string; note?: string }[] = [
    { what: t("Blocks"), count: num(s?.counts.blocks), keep: t("On the chain; not deleted"), tool: "live" },
    {
      what: t("Public boards"),
      count: num(props.listings?.length),
      // A listing is a post on the directory board: it lasts as long as both allow.
      keep: s ? t("Listed for {d} after each announcement", { d: spanText(Math.min(LISTING_TTL_MS, s.retention.messages_and_posts_ms.default), t) }) : "…",
      tool: "directory",
    },
    { what: t("Threads on public boards"), count: num(pub?.threads), keep: s ? kept(s.retention.messages_and_posts_ms) : "…", tool: "directory" },
    { what: t("Posts on public boards"), count: num(pub?.posts), keep: s ? kept(s.retention.messages_and_posts_ms) : "…", tool: "directory" },
    {
      what: t("All messages and posts"),
      count: num(s?.counts.messages_and_posts),
      keep: s ? kept(s.retention.messages_and_posts_ms) : "…",
      note: t("Public and invite-only boards, and direct messages. The node can't read any of them, so it knows only the total; how many invite-only boards there are isn't known."),
    },
    { what: t("Marked as genuine"), count: num(s?.counts.signatures), keep: t("No expiry on this node"), tool: "genuine" },
    { what: t("Files"), count: num(s?.counts.files), keep: s ? kept(s.retention.files_ms) : "…", tool: "files" },
    { what: t("Sites"), count: num(s?.counts.sites), keep: s ? t("{d} after the last edit", { d: spanText(s.retention.sites_after_last_edit_ms, t) }) : "…", note: t("A list of sites is coming.") },
  ];

  return (
    <article className="px-4 pb-4 pt-2 text-[16px] leading-relaxed md:px-5">
      <h1 className="text-[26px] font-bold">{t("What's inside TET")}</h1>
      <p className="text-[14px] text-[#5d646d]">
        {s ? t("Counted at {time}, on this node.", { time: new Date(s.at_ms).toLocaleString() }) : err ? t("The node didn't answer ({why}).", { why: err }) : t("Counting…")}
      </p>
      <table className="mt-3 w-full border-collapse text-left text-[15px]">
        <thead>
          <tr className="border-b border-[#c9ced4]">
            <th className="py-1.5 pr-3 font-semibold">{t("What")}</th>
            <th className="py-1.5 pr-3 text-right font-semibold">{t("How many")}</th>
            <th className="py-1.5 font-semibold">{t("How long it's kept")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.what} className="border-b border-[#eceef1] align-top">
              <th scope="row" className="py-1.5 pr-3 font-normal">
                {r.tool ? (
                  <button type="button" className={cx(link, "text-left")} onClick={() => props.go(r.tool!)}>
                    {r.what}
                  </button>
                ) : (
                  r.what
                )}
                {r.note ? <span className="block text-[13px] text-[#5d646d]">{r.note}</span> : null}
              </th>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.count}</td>
              <td className="py-1.5">{r.keep}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[14px] text-[#5d646d]">{t("This is a testnet. Data may be reset.")}</p>
    </article>
  );
}
