"use client";

/**
 * Try TET, part 1: the anonymous board window (docs/DEMO_NODE.md). Rules in `lib/board.mjs`,
 * node calls in `lib/try_board.ts`; this file only renders and wires them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Win95Button from "../os/components/Win95Button";
import Win95Field from "../os/components/Win95Field";
import Win95Panel from "../os/components/Win95Panel";
import { bevel, cx, surface } from "../os/components/tokens";
import {
  anonAllowance,
  boardPostPlan,
  inviteUrl,
  NAMED_LABEL,
  PROVER_DOCS_URL,
  probeProver,
} from "../lib/board.mjs";
import { DEFAULT_PROVER_URL } from "../lib/anon_poster.mjs";
import { TMAIL_ANON_DISCLOSURE, secondsUntil, type AnonSendState } from "../lib/tmail_anon";
import { TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import {
  anonSetSize,
  createBoard,
  openBoard,
  postAnonymous,
  postNamed,
  readBoard,
  registerForAnon,
  type BoardPost,
  type OpenBoard,
} from "../lib/try_board";

const FEED_POLL_MS = 10_000;
const PROVER_URL = process.env.NEXT_PUBLIC_TET_PROVER_URL || DEFAULT_PROVER_URL;

type Mode = "anonymous" | "named";

const TONE: Record<string, string> = {
  ok: "bg-[#eef8ee] text-[#1f5132]",
  pending: "bg-[#fff8e1] text-[#6b4e00]",
  bad: "bg-[#fff1f1] text-[#8a1f1f]",
  named: "bg-[#e8eaf6] text-[#1a237e]",
};

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function fmtWait(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export default function BoardPanel(props: { baseUrl: string; walletId: string | null }) {
  const { baseUrl, walletId } = props;
  const [board, setBoard] = useState<OpenBoard | null>(null);
  const [ownerWords, setOwnerWords] = useState<string | null>(null);
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
  const [anonMembers, setAnonMembers] = useState<number | null>(null);
  const [regNote, setRegNote] = useState("");
  const [postedBuckets, setPostedBuckets] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

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
    void (async () => {
      try {
        const b = await openBoard(baseUrl, h);
        if (mounted.current) setBoard(b);
      } catch (e: unknown) {
        if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [baseUrl]);

  useEffect(() => {
    void probeProver({ url: PROVER_URL }).then((p) => {
      if (mounted.current) {
        setProver(p);
        if (p === "missing") setMode("named");
      }
    });
    void anonSetSize(baseUrl).then((n) => mounted.current && setAnonMembers(n));
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [baseUrl]);

  const refresh = useCallback(async () => {
    if (!board) return;
    try {
      const p = await readBoard(baseUrl, board);
      if (mounted.current) {
        setPosts(p);
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

  async function onCreate() {
    setErr("");
    setBusy(true);
    try {
      const { board: b, ownerWords: w } = await createBoard(baseUrl, newName);
      if (!mounted.current) return;
      setBoard(b);
      setOwnerWords(w);
      window.history.replaceState(null, "", `#board=${b.invite}`);
    } catch (e: unknown) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function onJoin() {
    setErr("");
    setBusy(true);
    try {
      const b = await openBoard(baseUrl, inviteText);
      if (!mounted.current) return;
      setBoard(b);
      setOwnerWords(null);
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
    setOwnerWords(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function onRegister() {
    setRegNote("Registering…");
    try {
      const outcome = await registerForAnon(baseUrl);
      if (mounted.current) {
        setRegNote(`Registered (${outcome}). You join the anonymity set at the next epoch, within about a minute.`);
      }
      void anonSetSize(baseUrl).then((n) => mounted.current && setAnonMembers(n));
    } catch (e: unknown) {
      if (mounted.current) setRegNote(e instanceof Error ? e.message : String(e));
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
      setNotice({ kind: "err", text: "You've used today's anonymous post on this board." });
      return;
    }
    setBusy(true);
    try {
      if (plan.action === "named") {
        const id = await postNamed(baseUrl, board, body);
        if (!mounted.current) return;
        setNotice({ kind: "ok", text: `Posted, named (msg ${id.slice(0, 8)}…). Your wallet id is shown with it.` });
        setText("");
      } else {
        const out = await postAnonymous(baseUrl, PROVER_URL, board, body, (s) => mounted.current && setAnonState(s));
        if (!mounted.current) return;
        if (out.state === "sent") {
          setPostedBuckets((b) => [...b, allowance.bucket]);
          setNotice({ kind: "ok", text: "Posted anonymously. It shows as pending until the node checks the proof." });
          setText("");
        } else if (out.state === "not_in_set") {
          setNotice({
            kind: "err",
            text: `Not in the anonymity set yet. Register, then try again after ${fmtTime(out.nextEpochAtMs)}. Nothing was sent.`,
          });
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

  return (
    <Win95Panel title="Anonymous board" className="p-2">
      <p className="text-[13px]">
        Post to a board with a zero-knowledge proof that you&apos;re a member, not who you are. Anyone
        with the invite link can read it.
      </p>

      {!board ? (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Win95Panel variant="inset" className="p-2">
            <div className="font-bold text-[13px]">Start a board</div>
            <Win95Field label="Name (optional, shown to invitees)" value={newName} onChange={setNewName} maxLength={40} />
            <Win95Button className="mt-2 px-3 py-0.5 text-sm" onClick={() => void onCreate()} disabled={busy}>
              Create board
            </Win95Button>
          </Win95Panel>
          <Win95Panel variant="inset" className="p-2">
            <div className="font-bold text-[13px]">Join with an invite</div>
            <Win95Field label="Invite link" value={inviteText} onChange={setInviteText} mono placeholder="…/try#board=tetboard1…" />
            <Win95Button className="mt-2 px-3 py-0.5 text-sm" onClick={() => void onJoin()} disabled={busy || !inviteText.trim()}>
              Open board
            </Win95Button>
          </Win95Panel>
        </div>
      ) : (
        <>
          <Win95Panel variant="inset" className="mt-2 p-2 text-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>{board.name || "Untitled board"}</b> · board{" "}
                <code>{board.boardWalletId.slice(0, 12)}…</code>
              </span>
              <span className="flex gap-1">
                <Win95Button className="px-2 py-0.5 text-xs" onClick={() => void navigator.clipboard?.writeText(link)}>
                  Copy invite link
                </Win95Button>
                <Win95Button className="px-2 py-0.5 text-xs" onClick={onLeave}>
                  Leave
                </Win95Button>
              </span>
            </div>
            <p className="mt-1 text-black/70">
              The invite link is the key to read this board. Whoever has it can read every post. It sits
              after the <code>#</code>, so it is never sent to the demo node.
            </p>
            {ownerWords ? (
              <p className="mt-1 text-black/70">
                Board wallet words (only to re-register its keys; not in the invite):{" "}
                <code className="break-words">{ownerWords}</code>
              </p>
            ) : null}
          </Win95Panel>

          <div className={cx(bevel.inset, surface.field, "mt-2 max-h-80 overflow-auto p-1")} aria-live="polite">
            {posts.length === 0 ? <p className="p-2 text-black/60">No posts yet.</p> : null}
            {posts.map((p) => (
              <div key={p.msgId} className="border-b border-[#c0c0c0] p-2 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={cx("px-1 font-bold", TONE[p.label.tone])} title={p.label.detail}>
                    {p.label.text}
                  </span>
                  <span className="text-black/60">{fmtTime(p.sentAtMs)}</span>
                  {p.label.author ? (
                    <span className="text-black/60">
                      from <code>{p.label.author.slice(0, 12)}…</code>
                    </span>
                  ) : null}
                </div>
                {p.state === "open" ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13px]">{p.text}</p>
                ) : (
                  <p className="mt-1 text-[12px] text-black/50">Can&apos;t be read with this invite.</p>
                )}
              </div>
            ))}
          </div>
          {feedErr ? <p className="mt-1 text-[12px] text-[#8a1f1f]">{feedErr}</p> : null}

          <Win95Panel variant="inset" className="mt-2 p-2 text-[13px]">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="board-mode"
                  checked={mode === "anonymous"}
                  disabled={prover !== "found"}
                  onChange={() => setMode("anonymous")}
                />
                Anonymous
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="board-mode" checked={mode === "named"} onChange={() => setMode("named")} />
                Named, not anonymous
              </label>
            </div>
            {prover === "missing" ? (
              <p className="mt-1 text-[12px] text-black/70">
                No native prover on this computer, so posts here are named: your wallet id is shown with
                them. Anonymous posting needs the prover running locally:{" "}
                <a className="underline" href={PROVER_DOCS_URL} target="_blank" rel="noreferrer">
                  how to run it
                </a>
                .
              </p>
            ) : null}
            {mode === "anonymous" ? (
              <p className="mt-1 text-[12px] text-black/70">
                Today&apos;s allowance: {allowance.remaining} anonymous post on this board (resets in{" "}
                {fmtWait(secondsUntil(allowance.resetsAtMs, now))}, at 00:00 UTC).{" "}
                {anonMembers != null ? `The anonymity set has ${anonMembers} member${anonMembers === 1 ? "" : "s"}.` : ""}{" "}
                <Win95Button className="ml-1 px-2 py-0 text-xs" onClick={() => void onRegister()} disabled={!walletId}>
                  Join the anonymity set
                </Win95Button>
                {regNote ? <span className="ml-1">{regNote}</span> : null}
              </p>
            ) : (
              <p className="mt-1 text-[12px] font-bold text-[#1a237e]">
                {NAMED_LABEL}: this post shows your wallet id
                {walletId ? <code className="ml-1 font-normal">{walletId.slice(0, 12)}…</code> : null}.
              </p>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={TMAIL_MAX_PLAINTEXT_CHARS}
              rows={3}
              className={cx(bevel.inset, surface.field, "mt-2 w-full px-2 py-1 text-sm outline-none")}
              placeholder={walletId ? "Write a post…" : "Create a disposable wallet first."}
              disabled={!walletId}
            />
            <div className="mt-1 flex items-center gap-2">
              <Win95Button variant="primary" className="px-3 py-0.5 text-sm" onClick={() => void onPost()} disabled={busy || !walletId}>
                {mode === "anonymous" ? "Post anonymously" : "Post named"}
              </Win95Button>
              {busy && mode === "anonymous" ? (
                <span className="text-[12px] text-black/60">{anonState.state.replace("_", " ")}…</span>
              ) : null}
            </div>
            {notice ? (
              <p className={cx("mt-1 text-[12px]", notice.kind === "ok" ? "text-[#1f5132]" : "text-[#8a1f1f]")}>
                {notice.text}
              </p>
            ) : null}
          </Win95Panel>
        </>
      )}
      {err ? <p className="mt-2 text-[12px] text-[#8a1f1f]">{err}</p> : null}

      <ul className="mt-2 list-disc pl-5 text-[11px] text-black/70">
        <li>Anonymous posting needs the native prover on your own computer. Without it, posts are named and labelled so.</li>
        <li>
          You&apos;re anonymous only among the registered members ({anonMembers ?? "?"} on this node). Registering is
          public: it shows your wallet is a member, not what it posts.
        </li>
        <li>One anonymous post per member per board per UTC day (up to 3 around midnight UTC, as nodes&apos; clocks differ).</li>
        <li>The demo node and the first relaying peer see your IP address. Posts expire with their TTL and are not on the chain.</li>
        <li>Anyone with the invite can read every post; there is no way to revoke an invite but to start a new board.</li>
        <li>{TMAIL_ANON_DISCLOSURE}</li>
      </ul>
    </Win95Panel>
  );
}
