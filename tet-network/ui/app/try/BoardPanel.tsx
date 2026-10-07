"use client";

/**
 * Try TET, part 1: the anonymous board (docs/DEMO_NODE.md), laid out like a classic text board:
 * the rules post at the top (`>>0`), numbered posts oldest first with one line of meta each, and
 * one compose box at the bottom. Rules in `lib/board.mjs`, node calls in `lib/try_board.ts`.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Win95Button from "../os/components/Win95Button";
import Win95Field from "../os/components/Win95Field";
import Win95Panel from "../os/components/Win95Panel";
import { bevel, cx, surface } from "../os/components/tokens";
import { anonAllowance, boardPostPlan, inviteUrl, PROVER_DOCS_URL, probeProver } from "../lib/board.mjs";
import { DEFAULT_PROVER_URL } from "../lib/anon_poster.mjs";
import { TMAIL_ANON_DISCLOSURE, secondsUntil, type AnonSendState } from "../lib/tmail_anon";
import { TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import {
  anonMembership,
  createBoard,
  openBoard,
  postAnonymous,
  postNamed,
  readBoard,
  registerForAnon,
  type BoardPost,
  type OpenBoard,
} from "../lib/try_board";
import Notice from "./Notice";

const FEED_POLL_MS = 10_000;
const PROVER_URL = process.env.NEXT_PUBLIC_TET_PROVER_URL || DEFAULT_PROVER_URL;

type Mode = "anonymous" | "named";

/** The TET verdict colours, as a small badge. */
const BADGE: Record<string, { text: string; cls: string }> = {
  ok: { text: "verified", cls: "bg-[#eef8ee] text-[#1f5132]" },
  pending: { text: "pending", cls: "bg-[#fff8e1] text-[#6b4e00]" },
  bad: { text: "failed", cls: "bg-[#fff1f1] text-[#8a1f1f]" },
  named: { text: "named", cls: "bg-[#e8eaf6] text-[#1a237e]" },
};

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

/** Post text with `>>N` as a jump to post N. Plain text otherwise. */
function Body(props: { text: string; jump: (n: number) => void }) {
  const parts = props.text.split(/(>>\d+)/g);
  return (
    <div className="whitespace-pre-wrap break-words pl-4 text-[13px] leading-[1.5]">
      {parts.map((p, i) => {
        const m = /^>>(\d+)$/.exec(p);
        return m ? (
          <button key={i} type="button" className="text-[#1a237e] underline" onClick={() => props.jump(Number(m[1]))}>
            {p}
          </button>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        );
      })}
    </div>
  );
}

export default function BoardPanel(props: { baseUrl: string; walletId: string | null }) {
  const { baseUrl, walletId } = props;
  const [board, setBoard] = useState<OpenBoard | null>(null);
  const [newName, setNewName] = useState("");
  const [inviteText, setInviteText] = useState("");
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [feedErr, setFeedErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prover, setProver] = useState<"unknown" | "found" | "missing">("unknown");
  const [mode, setMode] = useState<Mode>("anonymous");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [anonState, setAnonState] = useState<AnonSendState>({ state: "idle" });
  const [member, setMember] = useState<{ member: boolean; members: number; nextEpochAtMs: number } | null>(null);
  const [joining, setJoining] = useState(false);
  const [postedBuckets, setPostedBuckets] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // An invite in the URL fragment opens its board. The fragment never reaches a server.
  useEffect(() => {
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (!h.startsWith("#board=")) return;
    void openBoard(baseUrl, h)
      .then((b) => mounted.current && setBoard(b))
      .catch((e: unknown) => mounted.current && setErr(e instanceof Error ? e.message : String(e)));
  }, [baseUrl]);

  useEffect(() => {
    void probeProver({ url: PROVER_URL }).then((p) => {
      if (mounted.current) {
        setProver(p);
        if (p === "missing") setMode("named");
      }
    });
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const refreshMembership = useCallback(async () => {
    try {
      const m = await anonMembership(baseUrl);
      if (mounted.current) setMember(m);
    } catch {
      /* the countdown line just stays as it was */
    }
  }, [baseUrl]);

  // Membership: on wallet change, and every 5 s while waiting for the next epoch after joining.
  useEffect(() => {
    if (!walletId) return;
    const first = setTimeout(() => void refreshMembership(), 0);
    return () => clearTimeout(first);
  }, [walletId, refreshMembership]);
  useEffect(() => {
    if (!joining) return;
    const t = setInterval(() => void refreshMembership(), 5_000);
    return () => clearInterval(t);
  }, [joining, refreshMembership]);
  useEffect(() => {
    if (joining && member?.member) {
      const done = setTimeout(() => setJoining(false), 0);
      return () => clearTimeout(done);
    }
  }, [joining, member]);

  const refresh = useCallback(async () => {
    if (!board) return;
    try {
      const p = await readBoard(baseUrl, board);
      if (mounted.current) {
        setPosts([...p].sort((a, b) => a.sentAtMs - b.sentAtMs || a.msgId.localeCompare(b.msgId)));
        setFeedErr("");
      }
    } catch (e: unknown) {
      if (mounted.current) setFeedErr(e instanceof Error ? e.message : String(e));
    }
  }, [baseUrl, board]);

  useEffect(() => {
    if (!board) return;
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), FEED_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [board, refresh]);

  function jump(n: number) {
    feedRef.current?.querySelector(`[data-post="${n}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function open(make: () => Promise<OpenBoard>) {
    setErr("");
    setBusy(true);
    try {
      const b = await make();
      if (!mounted.current) return;
      setBoard(b);
      window.history.replaceState(null, "", `#board=${b.invite}`);
    } catch (e: unknown) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function onLeave() {
    setBoard(null);
    setPosts([]);
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function onJoin() {
    setNotice(null);
    try {
      await registerForAnon(baseUrl);
      if (mounted.current) setJoining(true);
      void refreshMembership();
    } catch (e: unknown) {
      if (mounted.current) setNotice({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  }

  const allowance = anonAllowance({ nowMs: now, postedBuckets });

  async function onPost() {
    if (!board) return;
    setNotice(null);
    const body = text;
    if (!body.trim() || body.length > TMAIL_MAX_PLAINTEXT_CHARS) {
      setNotice({ kind: "err", text: "The post is empty or too long." });
      return;
    }
    const plan = boardPostPlan({ mode, prover, hasWallet: walletId != null });
    if (plan.action === "refuse") {
      setNotice({ kind: "err", text: plan.reason });
      return;
    }
    if (plan.action === "anonymous" && allowance.remaining === 0) {
      setNotice({ kind: "err", text: "Today's anonymous post on this board is used. Post named, or wait for 00:00 UTC." });
      return;
    }
    setBusy(true);
    try {
      if (plan.action === "named") {
        await postNamed(baseUrl, board, body);
        if (mounted.current) setText("");
      } else {
        const out = await postAnonymous(baseUrl, PROVER_URL, board, body, (s) => mounted.current && setAnonState(s));
        if (!mounted.current) return;
        if (out.state === "sent") {
          setPostedBuckets((b) => [...b, allowance.bucket]);
          setText("");
        } else if (out.state === "not_in_set") {
          setNotice({ kind: "err", text: "Not in the anonymity set yet. Nothing was sent." });
          setJoining(true);
        } else if (out.state === "failed") {
          setNotice({ kind: "err", text: `Not posted: ${out.reason}` });
        }
      }
      void refresh();
    } catch (e: unknown) {
      if (mounted.current) setNotice({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const link = board && typeof window !== "undefined" ? inviteUrl(window.location.origin, board.invite) : "";
  const proving = busy && mode === "anonymous" && anonState.state !== "idle";

  /** The one line above the compose box: what anonymous posting needs right now. */
  function joinLine() {
    if (prover === "missing") {
      return (
        <>
          No native prover here, so posts are named.{" "}
          <a className="underline" href={PROVER_DOCS_URL} target="_blank" rel="noreferrer">
            Run the prover
          </a>{" "}
          to post anonymously.
        </>
      );
    }
    if (!walletId) return <>Create a wallet first (top of the page).</>;
    if (member?.member) {
      return (
        <>
          In the anonymity set ({member.members} member{member.members === 1 ? "" : "s"}) · {allowance.remaining} anonymous post
          left today
        </>
      );
    }
    if (joining) {
      const s = member ? secondsUntil(member.nextEpochAtMs, now) : null;
      return <>Joined · ready in {s ?? "…"} s (the next epoch)</>;
    }
    return (
      <>
        <button type="button" className="underline" onClick={() => void onJoin()}>
          Join the anonymity set
        </button>{" "}
        to post anonymously. Joining is public: it shows this wallet is a member, not what it posts.
      </>
    );
  }

  return (
    <Win95Panel title={board ? `Anonymous board · ${board.name || "untitled"}` : "Anonymous board"} className="p-2 font-mono">
      <Notice
        items={[
          "Anonymous posts need the native prover on your computer. Without it you post named, and the post says so.",
          `You are anonymous among the registered members only (${member?.members ?? "?"} on this node). Joining is public.`,
          "One anonymous post per board per UTC day (up to 3 around 00:00 UTC).",
          "The node and the first relaying peer see your IP. Posts expire with their TTL and are not on the chain.",
          "Anyone with the invite link can read every post. An invite cannot be revoked: start a new board.",
          TMAIL_ANON_DISCLOSURE,
        ]}
      />

      {!board ? (
        <div className="mt-2 grid gap-2 font-mono text-[12px] sm:grid-cols-2">
          <div className="flex items-end gap-1">
            <Win95Field className="flex-1" label="New board (name optional)" value={newName} onChange={setNewName} maxLength={40} />
            <Win95Button className="px-2 py-1 text-xs" onClick={() => void open(async () => (await createBoard(baseUrl, newName)).board)} disabled={busy}>
              Create
            </Win95Button>
          </div>
          <div className="flex items-end gap-1">
            <Win95Field className="flex-1" label="Or open an invite link" value={inviteText} onChange={setInviteText} mono placeholder="…/try#board=tetboard1…" />
            <Win95Button className="px-2 py-1 text-xs" onClick={() => void open(() => openBoard(baseUrl, inviteText))} disabled={busy || !inviteText.trim()}>
              Open
            </Win95Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-1 font-mono text-[11px] text-black/70">
            <span>
              board {board.boardWalletId.slice(0, 8)} · the invite link is the read key; it sits after the #, so the node never sees
              it
            </span>
            <span className="flex gap-1">
              <Win95Button className="px-2 py-0 text-[11px]" onClick={() => void navigator.clipboard?.writeText(link)}>
                Copy invite link
              </Win95Button>
              <Win95Button className="px-2 py-0 text-[11px]" onClick={onLeave}>
                Leave
              </Win95Button>
            </span>
          </div>

          <div ref={feedRef} className={cx(bevel.inset, surface.field, "mt-1 max-h-96 overflow-auto px-2 py-1 font-mono")} aria-live="polite">
            {posts.length === 0 ? <p className="py-1 text-[12px] text-black/50">No posts yet.</p> : null}
            {posts.map((p, i) => {
              const b = BADGE[p.label.tone];
              return (
                <div key={p.msgId} data-post={i + 1} className="py-1">
                  <div className="text-[11px] text-black/60">
                    <span className="font-bold text-black">{i + 1}</span> ·{" "}
                    {p.label.author ? <span className="text-[#1a237e]">{p.label.author.slice(0, 8)}</span> : <span className="text-[#1f5132]">anonymous</span>} ·{" "}
                    {fmtTime(p.sentAtMs)}{" "}
                    <span className={cx("px-1", b.cls)} title={p.label.detail}>
                      {b.text}
                    </span>
                  </div>
                  {p.state === "open" ? (
                    <Body text={p.text} jump={jump} />
                  ) : (
                    <div className="pl-4 text-[12px] text-black/40">(cannot be read with this invite)</div>
                  )}
                </div>
              );
            })}
          </div>
          {feedErr ? <p className="mt-1 font-mono text-[11px] text-[#8a1f1f]">{feedErr}</p> : null}

          <div className="mt-2 font-mono text-[12px]">
            <p className="text-black/70">{joinLine()}</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={TMAIL_MAX_PLAINTEXT_CHARS}
              rows={3}
              className={cx(bevel.inset, surface.field, "mt-1 w-full px-2 py-1 text-[13px] outline-none")}
              placeholder={walletId ? "Write a post. >>2 refers to post 2." : "Create a wallet first."}
              disabled={!walletId}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Win95Button variant="primary" className="px-3 py-0.5 text-sm" onClick={() => void onPost()} disabled={busy || !walletId}>
                {mode === "anonymous" ? "Post anonymously" : "Post named"}
              </Win95Button>
              {prover === "found" ? (
                <button type="button" className="text-[11px] underline text-black/60" onClick={() => setMode(mode === "anonymous" ? "named" : "anonymous")}>
                  {mode === "anonymous" ? "post named instead (shows your wallet id)" : "post anonymously instead"}
                </button>
              ) : null}
              {proving ? <span className="text-[11px] text-black/60">{anonState.state.replace("_", " ")}…</span> : null}
            </div>
            {notice ? <p className={cx("mt-1 text-[12px]", notice.kind === "ok" ? "text-[#1f5132]" : "text-[#8a1f1f]")}>{notice.text}</p> : null}
          </div>
        </>
      )}
      {err ? <p className="mt-2 font-mono text-[12px] text-[#8a1f1f]">{err}</p> : null}
    </Win95Panel>
  );
}
