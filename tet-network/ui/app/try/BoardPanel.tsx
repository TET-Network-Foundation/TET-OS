"use client";

/**
 * Try TET, part 1: an anonymous board (docs/DEMO_NODE.md), as a text board: numbered posts with a
 * dense monospace meta line, anonymous by default, `>>n` as plain text that jumps to and highlights
 * the post it names, and the honest limits as the pinned `0 · notice`. The shell (page.tsx) keeps
 * the list of open boards; this panel shows one.
 *
 * Once in the anonymity set, one tap posts and the post shows at once with its progress. Joining the
 * set is a separate tap that never posts (see `wallet.tsx`: a post fired the moment a join takes
 * effect would point back at the join). Rules in `lib/board.mjs`, node calls in `lib/try_board.ts`.
 *
 * #18 (follows, profiles, notifications) is later: `Author` is where a profile link would attach.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { anonAllowance, boardPostPlan, inviteUrl, PROVER_DOCS_URL } from "../lib/board.mjs";
import { TMAIL_ANON_DISCLOSURE, secondsUntil } from "../lib/tmail_anon";
import { TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import { tmailBucketIndex } from "../lib/anon_tree.mjs";
import { postAnonymous, postNamed, readBoard, type BoardPost, type OpenBoard } from "../lib/try_board";
import { Badge, Button, FOCUS, INK, MONO, PanelHead, PinnedNotice, TextArea, cx, fmtSeconds, fmtWhen, type Tone } from "./ui";
import { BASE, PROVER_URL, useTryWallet } from "./wallet";

const FEED_POLL_MS = 8_000;

/** A post sent from this tab, shown at once and updated until the board has it. */
type Outgoing = {
  id: string;
  text: string;
  mode: "anonymous" | "named";
  step: "proving" | "depositing" | "sending" | "sent" | "failed";
  startedAtMs: number;
  stepAtMs: number;
  msgId?: string;
  reason?: string;
};

function badgeFor(p: BoardPost): { tone: Tone; text: string } {
  if (p.label.kind === "named") return { tone: "named", text: "named" };
  if (p.label.tone === "ok") return { tone: "ok", text: "anonymous · verified" };
  if (p.label.tone === "bad") return { tone: "bad", text: "anonymous · proof failed" };
  return { tone: "pending", text: "anonymous · checking proof" };
}

/** Who wrote a post. #18 hook: a profile or follow control attaches here. */
function Author(props: { walletId: string | null }) {
  return props.walletId ? (
    <span translate="no" className={INK.named} data-author={props.walletId}>
      {props.walletId.slice(0, 8)}
    </span>
  ) : (
    <span>anonymous</span>
  );
}

/** Post text with `>>n` as a reference that jumps to and highlights post n. */
function Body(props: { text: string; onRef: (n: number) => void }) {
  return (
    <p className="mt-0.5 whitespace-pre-wrap break-words text-base leading-relaxed text-[#1c1f23]">
      {props.text.split(/(>>\d+)/g).map((part, i) => {
        const m = /^>>(\d+)$/.exec(part);
        return m ? (
          <button
            key={i}
            type="button"
            onClick={() => props.onRef(Number(m[1]))}
            aria-label={`Go to post ${m[1]}`}
            className={cx(FOCUS, MONO, "rounded-sm bg-[#eceefb] px-0.5 text-[14px]", INK.named)}
          >
            {part}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </p>
  );
}

/** The dense meta line: number, author, time, verdict. */
function Meta(props: { n: number; children: React.ReactNode }) {
  return (
    <div className={cx(MONO, "flex flex-wrap gap-x-2 text-[13px] text-[#5d646d]")}>
      <span className="font-bold text-[#1c1f23]">{props.n}</span>
      {props.children}
    </div>
  );
}

export const BOARD_NOTICE = (members: number | null) => [
  "Posts are anonymous by default: a zero-knowledge proof shows you are a member, not which one. That needs the native prover on your computer; without it you post named, and the post says so.",
  `You are anonymous among the registered members only (${members ?? "?"} on this node). Joining the set is public, and it is a separate step: posting right after you join makes the post easier to link to your join.`,
  "One anonymous post per board per UTC day (up to 3 around 00:00 UTC).",
  "The node and the first relaying peer see your IP. Posts expire with their TTL and are not on the chain.",
  "Anyone with the invite link can read every post. An invite cannot be revoked: start a new board.",
  TMAIL_ANON_DISCLOSURE,
];

export default function BoardPanel(props: { board: OpenBoard }) {
  const { board } = props;
  const { wallet, anon, refreshAnon, joinAnon, ensureWallet, prover } = useTryWallet();
  const [joining, setJoining] = useState(false);
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [feedErr, setFeedErr] = useState("");
  const [err, setErr] = useState("");
  const [named, setNamed] = useState(false);
  const [text, setText] = useState("");
  const [postedBuckets, setPostedBuckets] = useState<number[]>([]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const p = await readBoard(BASE, board);
      if (!mounted.current) return;
      const sorted = [...p].sort((a, b) => a.sentAtMs - b.sentAtMs || a.msgId.localeCompare(b.msgId));
      setPosts(sorted);
      setFeedErr("");
      // An outgoing post the board now shows is done.
      const ids = new Set(sorted.map((x) => x.msgId));
      setOutgoing((o) => o.filter((x) => !(x.msgId && ids.has(x.msgId))));
    } catch (e: unknown) {
      if (mounted.current) setFeedErr(e instanceof Error ? e.message : String(e));
    }
  }, [board]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), FEED_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  function onRef(n: number) {
    setHighlight(n);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    listRef.current?.querySelector(`[data-post="${n}"]`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    setTimeout(() => mounted.current && setHighlight((h) => (h === n ? null : h)), 2_000);
  }

  const patch = (id: string, p: Partial<Outgoing>) =>
    mounted.current && setOutgoing((o) => o.map((x) => (x.id === id ? { ...x, ...p, stepAtMs: p.step ? Date.now() : x.stepAtMs } : x)));

  const allowance = anonAllowance({ nowMs: now, postedBuckets });
  // Anonymous by default. Named only when chosen, or when no prover is here (and the button says so).
  const anonymous = prover !== "missing" && !named;
  // Anonymous posting needs membership; until then the one button is the (separate) join.
  const needsJoin = anonymous && prover === "found" && !anon?.member;

  useEffect(() => {
    if (wallet && prover === "found") void refreshAnon().catch(() => {});
  }, [wallet, prover, refreshAnon]);

  async function onPost() {
    const body = text.trim();
    if (!body || body.length > TMAIL_MAX_PLAINTEXT_CHARS) return;
    setErr("");
    await ensureWallet();
    const plan = boardPostPlan({ mode: anonymous ? "anonymous" : "named", prover, hasWallet: true });
    if (plan.action === "refuse") {
      setErr(plan.reason);
      return;
    }
    if (plan.action === "anonymous" && !anon?.member) {
      setErr("Join the anonymity set first.");
      return;
    }
    if (plan.action === "anonymous" && allowance.remaining === 0) {
      setErr("Today's anonymous post on this board is used. Post named, or wait until 00:00 UTC.");
      return;
    }
    const id = `${Date.now()}-${Math.random()}`;
    const t0 = Date.now();
    setOutgoing((o) => [...o, { id, text: body, mode: plan.action === "anonymous" ? "anonymous" : "named", step: "sending", startedAtMs: t0, stepAtMs: t0 }]);
    setText("");
    try {
      if (plan.action === "named") {
        const msgId = await postNamed(BASE, board, body);
        patch(id, { step: "sent", msgId });
      } else {
        // Only members get here: joining is a separate, earlier tap (see the header).
        const out = await postAnonymous(BASE, PROVER_URL, board, body, (s) => {
          if (s.state === "proving") patch(id, { step: "proving" });
          else if (s.state === "depositing") patch(id, { step: "depositing" });
          else if (s.state === "sending") patch(id, { step: "sending" });
        });
        if (out.state === "sent") {
          setPostedBuckets((b) => [...b, tmailBucketIndex(t0)]);
          patch(id, { step: "sent", msgId: out.msgId });
        } else {
          patch(id, { step: "failed", reason: out.state === "failed" ? out.reason : "not in the anonymity set yet" });
        }
      }
      void refresh();
    } catch (e: unknown) {
      patch(id, { step: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }

  const today = posts.filter((p) => new Date(p.sentAtMs).toDateString() === new Date(now).toDateString()).length;
  const link = typeof window !== "undefined" ? inviteUrl(window.location.origin, board.invite) : "";

  return (
    <section className="flex flex-col" aria-label={board.name || "Board"}>
      <PanelHead
        title={board.name || "Untitled board"}
        sub={
          <span className="tabular-nums">
            {today} posts today · invite-only
          </span>
        }
        action={
          <Button
            kind="quiet"
            onClick={() => {
              void navigator.clipboard?.writeText(link);
              setCopied(true);
              setTimeout(() => mounted.current && setCopied(false), 1_500);
            }}
          >
            {copied ? "invite copied" : "copy invite"}
          </Button>
        }
        todo={<>Read, or write a post below. Reply with &gt;&gt;n.</>}
      />

      <div className="flex-1 px-4 md:px-5">
        <div className="max-w-[46rem]">
          <PinnedNotice lines={BOARD_NOTICE(anon?.members ?? null)} />
          <ol ref={listRef} aria-label="Posts">
            {posts.map((p, i) => {
              const n = i + 1;
              const b = badgeFor(p);
              return (
                <li
                  key={p.msgId}
                  data-post={n}
                  className={cx("-mx-2 border-b border-[#eceef1] px-2 py-2.5 transition-colors", highlight === n && "bg-[#fff6dc]")}
                >
                  <Meta n={n}>
                    <Author walletId={p.label.author} />
                    <span>{fmtWhen(p.sentAtMs, now)}</span>
                    <Badge tone={b.tone} title={p.label.detail}>
                      {b.text}
                    </Badge>
                  </Meta>
                  {p.state === "open" ? (
                    <Body text={p.text} onRef={onRef} />
                  ) : (
                    <p className="mt-0.5 text-[15px] text-[#5d646d]">Cannot be read with this invite.</p>
                  )}
                </li>
              );
            })}
            {outgoing.map((o) => {
              const secs = Math.max(0, Math.floor((now - o.stepAtMs) / 1000));
              const status =
                o.step === "proving"
                  ? `proving… ${fmtSeconds(secs)}`
                  : o.step === "failed"
                    ? `not posted: ${o.reason}`
                    : o.step === "sent"
                      ? "sent · waiting for the board"
                      : `${o.step}…`;
              return (
                <li key={o.id} className="-mx-2 border-b border-[#eceef1] bg-[#fafbfc] px-2 py-2.5" aria-live="polite">
                  <Meta n={posts.length + 1}>
                    <span>you · {o.mode}</span>
                    <Badge tone={o.step === "failed" ? "bad" : "pending"}>{status}</Badge>
                  </Meta>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-base leading-relaxed text-[#5d646d]">{o.text}</p>
                </li>
              );
            })}
          </ol>
          {posts.length === 0 && outgoing.length === 0 && !feedErr ? <p className="py-3 text-[15px] text-[#5d646d]">No posts yet. Write the first one below.</p> : null}
          {feedErr ? <p className={cx("py-2 text-[15px]", INK.bad)}>{feedErr}</p> : null}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-[#e3e5e8] bg-white px-4 pb-3.5 pt-2.5 md:px-5">
        <div className="max-w-[46rem]">
          <TextArea label="Your post" value={text} onChange={setText} rows={text ? 3 : 1} maxLength={TMAIL_MAX_PLAINTEXT_CHARS} placeholder="Write a post (>>2 replies to post 2)…" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[14px] text-[#5d646d]">
            {needsJoin ? (
              <Button
                disabled={joining || !!anon?.joined}
                onClick={() => {
                  setErr("");
                  setJoining(true);
                  void joinAnon()
                    .catch((e: unknown) => mounted.current && setErr(e instanceof Error ? e.message : String(e)))
                    .finally(() => mounted.current && setJoining(false));
                }}
              >
                {joining ? "Joining…" : anon?.joined ? `Ready in ${fmtSeconds(secondsUntil(anon.nextEpochAtMs, now))}` : "Join the anonymity set"}
              </Button>
            ) : (
              <Button disabled={!text.trim() || prover === "unknown"} onClick={() => void onPost()}>
                {prover === "unknown" ? "Checking for the prover…" : anonymous ? "Post anonymously" : "Post named"}
              </Button>
            )}
            {prover === "found" ? (
              <Button kind="quiet" onClick={() => setNamed(!named)}>
                {named ? "post anonymously instead" : "post named instead"}
              </Button>
            ) : null}
            <span>
              {prover === "missing" ? (
                <>
                  No prover here, so posts show your wallet id.{" "}
                  <a className="underline" href={PROVER_DOCS_URL} target="_blank" rel="noreferrer">
                    Run the prover
                  </a>{" "}
                  to post anonymously.
                </>
              ) : needsJoin && anon?.joined ? (
                <>Joined (public). Your draft stays here; nothing is posted until you tap Post. Waiting longer hides you among more members.</>
              ) : needsJoin ? (
                <>To post anonymously, join the set first: a separate, public step that posts nothing.</>
              ) : anonymous ? (
                <span className="tabular-nums">{allowance.remaining} anonymous post left today · about 30 s to prove</span>
              ) : (
                <>shows your wallet id</>
              )}
            </span>
          </div>
          {err ? (
            <p role="alert" className={cx("mt-1 text-[15px]", INK.bad)}>
              {err}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
