"use client";

/**
 * Live: the demo node's own numbers, read every few seconds from `GET /status/live` (tet-core
 * `live_feed`): height, connected peers, apply-queue depth, the last 20 things it saw on the
 * network, and the source commit its build recorded. Nothing here is simulated; an idle network
 * shows an idle list.
 */
import { useEffect, useRef, useState } from "react";
import { INK, MONO, PanelHead, PinnedNotice, cx, fmtWhen } from "./ui";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

const POLL_MS = 3_000;
const REPO = "https://github.com/TET-Network-Foundation/TET-OS";

type LiveEvent = { at_ms: number; kind: string; height?: number; peer?: string };
type Live = { height: number; peers: number | null; apply_queue_depth: number; commit: string | null; events: LiveEvent[]; now_ms: number };

export default function LivePanel() {
  const { t, locale } = useLang();
  const [live, setLive] = useState<Live | null>(null);
  const [err, setErr] = useState("");
  const [readAt, setReadAt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await fetch(`${BASE}/status/live`);
        if (!r.ok) throw new Error(r.status === 404 ? t("This node doesn't serve live numbers yet (it predates /status/live).") : `HTTP ${r.status}`);
        const j = (await r.json()) as Live;
        if (mounted.current) {
          setLive(j);
          setErr("");
          setReadAt(Date.now());
        }
      } catch (e: unknown) {
        if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
      }
      if (mounted.current) timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      mounted.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [t]);

  const KIND: Record<string, string> = {
    block: t("block"),
    tx: t("transaction"),
    tmail: t("Tmail message"),
    file: t("file announcement"),
    other: t("other gossip"),
    peer_connected: t("peer connected"),
    peer_disconnected: t("peer disconnected"),
  };
  const stat = (label: string, value: React.ReactNode) => (
    <div>
      <div className="text-[13px] text-[#5d646d]">{label}</div>
      <div className={cx(MONO, "text-[22px] font-semibold tabular-nums")}>{value}</div>
    </div>
  );

  return (
    <section aria-label={t("Live")}>
      <PanelHead
        title={t("Live")}
        sub={readAt ? t("read {when}", { when: fmtWhen(readAt, readAt, locale) }) : undefined}
        todo={t("Watch what this node sees, as it sees it. Nothing to do here.")}
      />
      <div className="max-w-[46rem] px-4 pb-6 md:px-5">
        <PinnedNotice
          lines={[
            t("These are this demo node's own numbers, read every 3 seconds. Nothing is simulated: a quiet network shows a quiet list."),
            t("An event says what kind of message arrived and from which peer (the last 6 characters of its id). Never what it said, who wrote it, or an IP address."),
            t("This is one node's view; other nodes see their own peers and events."),
            t("The commit is the one this node's build recorded. A build that didn't record it says so."),
          ]}
        />
        {err ? (
          <p role="alert" className={cx("py-2 text-[15px]", INK.bad)}>
            {err}
          </p>
        ) : null}
        {live ? (
          <>
            <div className="grid grid-cols-3 gap-4 border-y border-[#eceef1] py-3">
              {stat(t("height"), live.height.toLocaleString())}
              {stat(t("peers"), live.peers ?? "—")}
              {stat(t("apply queue"), live.apply_queue_depth)}
            </div>
            <p className="py-2 text-[14px] text-[#3d434a]">
              {t("Source commit:")}{" "}
              {live.commit ? (
                <a className={cx(MONO, "underline")} href={`${REPO}/commit/${live.commit}`} target="_blank" rel="noreferrer">
                  {live.commit.slice(0, 12)}
                </a>
              ) : (
                <span className="text-[#5d646d]">{t("not recorded by this build")}</span>
              )}
            </p>
            <h3 className="mt-2 text-[15px] font-semibold">{t("Recent events ({n})", { n: live.events.length })}</h3>
            <ol aria-live="polite" className="border-t border-[#eceef1]">
              {live.events.length === 0 ? <li className="py-3 text-[15px] text-[#5d646d]">{t("Nothing yet since this node started.")}</li> : null}
              {live.events.map((e, i) => (
                <li key={`${e.at_ms}-${i}`} className={cx(MONO, "flex flex-wrap gap-x-3 border-b border-[#eceef1] py-1.5 text-[13.5px]")}>
                  <span className="tabular-nums text-[#5d646d]">{fmtWhen(e.at_ms, live.now_ms, locale)}</span>
                  <span>{KIND[e.kind] ?? e.kind}</span>
                  {e.height !== undefined ? <span className="tabular-nums">#{e.height.toLocaleString()}</span> : null}
                  {e.peer ? (
                    <span translate="no" className={INK.named}>
                      …{e.peer}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        ) : !err ? (
          <p className="py-3 text-[15px] text-[#5d646d]">{t("Reading the node…")}</p>
        ) : null}
      </div>
    </section>
  );
}
