"use client";

/**
 * Try TET, part 1: an anonymous board (docs/DEMO_NODE.md), as a 2ch-style text board with threads
 * (スレ). The board opens on its thread list (title · posts · last post, most recent activity
 * first); a thread shows its posts numbered from 1, with `>>n` jumping within the thread. Anyone
 * who can read the board can open a thread. Threads are a convention inside the post text
 * (`lib/board_threads.mjs`): the node never sees them. The honest limits are the pinned
 * `0 · notice`.
 *
 * Once in the anonymity set, one tap posts and the post shows at once with its progress. Joining the
 * set is a separate tap that never posts (see `wallet.tsx`: a post fired the moment a join takes
 * effect would point back at the join). Rules in `lib/board.mjs`, node calls in `lib/try_board.ts`.
 *
 * A named post's short id opens a DM with its wallet; an anonymous post has no author, so no DM.
 * #18 (follows, profiles, notifications) is later: `Author` is where a profile link would attach.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anonAllowance, boardPostPlan, inviteUrl, PROVER_DOCS_URL } from "../lib/board.mjs";
import { checkThreadTitle, encodeThreadPost, groupThreads, newThreadId, THREAD_TITLE_MAX } from "../lib/board_threads.mjs";
import { TMAIL_ANON_DISCLOSURE, secondsUntil } from "../lib/tmail_anon";
import { TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import { tmailBucketIndex } from "../lib/anon_tree.mjs";
import { announceBoard, postAnonymous, postNamed, readBoard, type BoardPost, type OpenBoard } from "../lib/try_board";
import { Badge, Button, FOCUS, INK, Input, MONO, PanelHead, PinnedNotice, TextArea, cx, fmtSeconds, fmtWhen, type Tone } from "./ui";
import { BASE, PROVER_URL, useTryWallet } from "./wallet";

const FEED_POLL_MS = 8_000;
/** Room for the thread header inside one Tmail message. */
const BODY_MAX = TMAIL_MAX_PLAINTEXT_CHARS - 200;

/** A post sent from this tab, shown at once and updated until the board has it. */
type Outgoing = {
  id: string;
  threadId: string;
  text: string;
  mode: "anonymous" | "named";
  step: "proving" | "depositing" | "sending" | "sent" | "failed";
  stepAtMs: number;
  msgId?: string;
  reason?: string;
};

type Label = BoardPost["label"];
type ThreadPost = { msgId: string; sentAtMs: number; label: Label; body: string };
type Thread = { threadId: string; title: string | null; posts: ThreadPost[]; count: number; lastAtMs: number };

function badgeFor(label: Label): { tone: Tone; text: string } {
  if (label.kind === "named") return { tone: "named", text: "named" };
  if (label.tone === "ok") return { tone: "ok", text: "anonymous · verified" };
  if (label.tone === "bad") return { tone: "bad", text: "anonymous · proof failed" };
  return { tone: "pending", text: "anonymous · checking proof" };
}

/**
 * Who wrote a post. A named post's short id opens a DM with that wallet; an anonymous post has no
 * author (`postLabel` never gives one), so there is nothing to message. #18 hook: a profile or
 * follow control attaches here.
 */
function Author(props: { walletId: string | null; onDm?: (walletId: string) => void }) {
  if (!props.walletId) return <span title="No DM: an anonymous post doesn't say who wrote it.">anonymous</span>;
  const id = props.walletId;
  return props.onDm ? (
    <button
      type="button"
      translate="no"
      data-author={id}
      title={`DM ${id}`}
      aria-label={`Send a DM to ${id.slice(0, 8)}`}
      onClick={() => props.onDm?.(id)}
      className={cx(FOCUS, "rounded-sm underline decoration-dotted underline-offset-2", INK.named)}
    >
      {id.slice(0, 8)}
    </button>
  ) : (
    <span translate="no" className={INK.named} data-author={id}>
      {id.slice(0, 8)}
    </span>
  );
}

/** Post text with `>>n` as a reference that jumps to and highlights post n of this thread. */
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
  "The node keeps each named poster's newest 5 posts on a board and the board's newest 100 anonymous posts, for 7 days. Older posts drop out of their threads; a thread whose first post has dropped out loses its title.",
  "Anyone who can read the board can post in any thread and start threads. A thread's title comes from the earliest post the node still has, and the sender sets a post's time.",
  "The node and the first relaying peer see your IP. Posts are not on the chain.",
  "Tap a named post's id to DM its wallet. Anonymous posts have no DM: nothing in them says who wrote them.",
  "Anyone with the invite link can read every post. An invite cannot be revoked: start a new board.",
  TMAIL_ANON_DISCLOSURE,
];

export const PUBLIC_LINE = "This board is public: its invite is listed in the directory, so anyone can read every post.";

export default function BoardPanel(props: {
  board: OpenBoard;
  /** Listed in the directory (public), or not (invite-only). */
  isPublic: boolean;
  /** The board's own 12 words, when this tab created it (needed to list it again). */
  boardWords?: string;
  directory: OpenBoard | null;
  onListed: () => void;
  /** Open a DM with a named post's wallet. */
  onDm?: (walletId: string) => void;
}) {
  const { board } = props;
  const [relist, setRelist] = useState<"closed" | "open" | "busy" | "done">("closed");
  const [relistWords, setRelistWords] = useState("");
  const [relistErr, setRelistErr] = useState("");
  const { wallet, anon, refreshAnon, joinAnon, ensureWallet, prover } = useTryWallet();
  const [joining, setJoining] = useState(false);
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [feedErr, setFeedErr] = useState("");
  const [err, setErr] = useState("");
  const [named, setNamed] = useState(false);
  const [text, setText] = useState("");
  const [newTitle, setNewTitle] = useState("");
  /** null = the thread list; "new" = the new-thread form; otherwise a thread id ("" = no thread). */
  const [open, setOpen] = useState<string | null>(null);
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
      setPosts(p);
      setFeedErr("");
      // An outgoing post the board now shows is done.
      const ids = new Set(p.map((x) => x.msgId));
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

  const threads: Thread[] = useMemo(
    () =>
      groupThreads(
        posts.flatMap((p) => (p.state === "open" ? [{ msgId: p.msgId, sentAtMs: p.sentAtMs, label: p.label, text: p.text }] : [])),
      ) as Thread[],
    [posts],
  );
  const unreadable = posts.filter((p) => p.state !== "open").length;
  const thread = open !== null && open !== "new" ? threads.find((t) => t.threadId === open) : undefined;

  function onRef(n: number) {
    setHighlight(n);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    listRef.current?.querySelector(`[data-post="${n}"]`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    setTimeout(() => mounted.current && setHighlight((h) => (h === n ? null : h)), 2_000);
  }

  async function relistNow(words: string) {
    if (!props.directory) return;
    setRelistErr("");
    setRelist("busy");
    try {
      await announceBoard(BASE, props.directory, board, words.trim());
      setRelist("done");
      setRelistWords("");
      props.onListed();
    } catch (e: unknown) {
      setRelist("open");
      setRelistErr(e instanceof Error ? e.message : String(e));
    }
  }

  function show(id: string | null) {
    setOpen(id);
    setErr("");
    setHighlight(null);
    window.scrollTo({ top: 0 });
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

  /** Post `body` into a thread: a reply to `open`, or the first post of a new thread. */
  async function onPost() {
    const body = text.trim();
    if (!body || body.length > BODY_MAX) return;
    const starting = open === "new";
    let threadId = open ?? "";
    let title: string | undefined;
    if (starting) {
      const c = checkThreadTitle(newTitle);
      if (!c.ok) {
        setErr(c.reason ?? "");
        return;
      }
      title = c.title;
      threadId = newThreadId();
    }
    if (!threadId) return;
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
    const plaintext = encodeThreadPost({ threadId, title, body });
    const id = `${Date.now()}-${Math.random()}`;
    const t0 = Date.now();
    setOutgoing((o) => [...o, { id, threadId, text: body, mode: plan.action === "anonymous" ? "anonymous" : "named", step: "sending", stepAtMs: t0 }]);
    setText("");
    setNewTitle("");
    if (starting) setOpen(threadId);
    try {
      if (plan.action === "named") {
        const msgId = await postNamed(BASE, board, plaintext);
        patch(id, { step: "sent", msgId });
      } else {
        // Only members get here: joining is a separate, earlier tap (see the header).
        const out = await postAnonymous(BASE, PROVER_URL, board, plaintext, (s) => {
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
  const titleOf = (t: Thread | undefined) => (t ? (t.threadId === "" ? "Posts without a thread" : (t.title ?? "Untitled (its first post has dropped out)")) : "");
  const mine = outgoing.filter((o) => o.threadId === open);

  const copyInvite = (
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
  );

  /** The composer: one textarea, one button (or the separate join), the anonymous/named switch. */
  const composer = (
    <div className="sticky bottom-0 border-t border-[#e3e5e8] bg-white px-4 pb-3.5 pt-2.5 md:px-5">
      <div className="max-w-[46rem]">
        {open === "new" ? (
          <div className="mb-2">
            <Input label="Thread title" value={newTitle} onChange={setNewTitle} placeholder={`One line, up to ${THREAD_TITLE_MAX} characters…`} />
          </div>
        ) : null}
        <TextArea
          label={open === "new" ? "First post" : "Your post"}
          value={text}
          onChange={setText}
          rows={text || open === "new" ? 3 : 1}
          maxLength={BODY_MAX}
          placeholder={open === "new" ? "The first post of the thread…" : "Write a post (>>2 replies to post 2)…"}
        />
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
            <Button disabled={!text.trim() || (open === "new" && !newTitle.trim()) || prover === "unknown"} onClick={() => void onPost()}>
              {prover === "unknown"
                ? "Checking for the prover…"
                : open === "new"
                  ? anonymous
                    ? "Start the thread anonymously"
                    : "Start the thread named"
                  : anonymous
                    ? "Post anonymously"
                    : "Post named"}
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
  );

  // ---- the thread list ---------------------------------------------------------------------------
  if (open === null) {
    return (
      <section className="flex flex-col" aria-label={board.name || "Board"}>
        <PanelHead
          title={board.name || "Untitled board"}
          sub={
            <span className="tabular-nums">
              {threads.filter((t) => t.threadId).length} threads · {today} posts today · {props.isPublic ? "public" : "invite-only"}
            </span>
          }
          action={copyInvite}
          todo={<>Open a thread to read it, or start a new one.</>}
        />
        <div className="px-4 pb-6 md:px-5">
          <div className="max-w-[46rem]">
            <PinnedNotice lines={props.isPublic ? [PUBLIC_LINE, ...BOARD_NOTICE(anon?.members ?? null)] : BOARD_NOTICE(anon?.members ?? null)} />
            {props.isPublic && props.directory ? (
              <div className="mb-3 text-[14px] text-[#5d646d]">
                {relist === "done" ? (
                  <span className={INK.ok}>Listed again for 7 days.</span>
                ) : relist === "closed" ? (
                  <Button kind="quiet" onClick={() => (props.boardWords ? void relistNow(props.boardWords) : setRelist("open"))}>
                    list this board again (needs the board&apos;s 12 words)
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    {props.boardWords ? null : (
                      <div className="min-w-[16rem] flex-1">
                        <Input ariaLabel="The board's 12 words" value={relistWords} onChange={setRelistWords} mono placeholder="The board's 12 words…" />
                      </div>
                    )}
                    <Button className="min-h-9 px-3 text-[14px]" disabled={relist === "busy"} onClick={() => void relistNow(props.boardWords ?? relistWords)}>
                      {relist === "busy" ? "Listing…" : "List again"}
                    </Button>
                  </div>
                )}
                {relistErr ? (
                  <span role="alert" className={cx("ml-2", INK.bad)}>
                    {relistErr}
                  </span>
                ) : null}
              </div>
            ) : null}
            <Button className="mb-2" onClick={() => show("new")}>
              New thread
            </Button>
            <ol aria-label="Threads" className="border-t border-[#eceef1]">
              {threads.map((t, i) => (
                <li key={t.threadId || "none"} className="border-b border-[#eceef1]">
                  <button type="button" onClick={() => show(t.threadId)} className={cx(FOCUS, "-mx-2 block w-[calc(100%+1rem)] px-2 py-2.5 text-left hover:bg-[#fafbfc]")}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className={cx(MONO, "text-[13px] font-bold")}>{t.threadId ? i + 1 : "–"}</span>
                      <span className={cx("text-base", t.threadId ? "font-semibold" : "text-[#5d646d]")}>{titleOf(t)}</span>
                      <span className={cx(MONO, "text-[13px] tabular-nums text-[#5d646d]")}>({t.count})</span>
                    </span>
                    <span className={cx(MONO, "block text-[12.5px] text-[#5d646d]")}>last post {fmtWhen(t.lastAtMs, now)}</span>
                  </button>
                </li>
              ))}
            </ol>
            {threads.length === 0 && !feedErr ? <p className="py-3 text-[15px] text-[#5d646d]">No threads yet. Start the first one.</p> : null}
            {unreadable ? (
              <p className="py-2 text-[14px] text-[#5d646d]">
                {unreadable} post{unreadable === 1 ? "" : "s"} can&apos;t be read with this invite.
              </p>
            ) : null}
            {feedErr ? <p className={cx("py-2 text-[15px]", INK.bad)}>{feedErr}</p> : null}
          </div>
        </div>
      </section>
    );
  }

  // ---- a thread, or the new-thread form ------------------------------------------------------------
  const startingNew = open === "new";
  const head = startingNew ? "New thread" : titleOf(thread) || "Thread";
  return (
    <section className="flex flex-col" aria-label={head}>
      <PanelHead
        title={head}
        sub={
          <>
            <button type="button" className={cx(FOCUS, "rounded underline")} onClick={() => show(null)}>
              ‹ {board.name || "board"}
            </button>
            {thread ? <span className="tabular-nums"> · {thread.count} posts</span> : null}
          </>
        }
        action={copyInvite}
        todo={startingNew ? "Give the thread a title and write its first post." : open === "" ? "Old posts from before threads. Start a thread to post." : <>Read, or reply below. Reply to a post with &gt;&gt;n.</>}
      />
      <div className="flex-1 px-4 pb-4 md:px-5">
        <div className="max-w-[46rem]">
          {startingNew ? (
            <p className="py-3 text-[15px] text-[#5d646d]">Anyone who can read this board can read and reply to the thread.</p>
          ) : (
            <ol ref={listRef} aria-label="Posts" className="pt-1">
              {(thread?.posts ?? []).map((p, i) => {
                const n = i + 1;
                const b = badgeFor(p.label);
                return (
                  <li
                    key={p.msgId}
                    data-post={n}
                    className={cx("-mx-2 border-b border-[#eceef1] px-2 py-2.5 transition-colors", highlight === n && "bg-[#fff6dc]")}
                  >
                    <Meta n={n}>
                      <Author walletId={p.label.author} onDm={props.onDm} />
                      <span>{fmtWhen(p.sentAtMs, now)}</span>
                      <Badge tone={b.tone} title={p.label.detail}>
                        {b.text}
                      </Badge>
                    </Meta>
                    <Body text={p.body} onRef={onRef} />
                  </li>
                );
              })}
              {mine.map((o, i) => {
                const secs = Math.max(0, Math.floor((now - o.stepAtMs) / 1000));
                const status =
                  o.step === "proving" ? `proving… ${fmtSeconds(secs)}` : o.step === "failed" ? `not posted: ${o.reason}` : o.step === "sent" ? "sent · waiting for the board" : `${o.step}…`;
                return (
                  <li key={o.id} className="-mx-2 border-b border-[#eceef1] bg-[#fafbfc] px-2 py-2.5" aria-live="polite">
                    <Meta n={(thread?.count ?? 0) + i + 1}>
                      <span>you · {o.mode}</span>
                      <Badge tone={o.step === "failed" ? "bad" : "pending"}>{status}</Badge>
                    </Meta>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-base leading-relaxed text-[#5d646d]">{o.text}</p>
                  </li>
                );
              })}
            </ol>
          )}
          {!startingNew && !thread && mine.length === 0 ? <p className="py-3 text-[15px] text-[#5d646d]">This thread has no posts the node still keeps.</p> : null}
        </div>
      </div>
      {open === "" ? null : composer}
    </section>
  );
}
