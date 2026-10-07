"use client";

/**
 * Try TET, part 1: the anonymous board (docs/DEMO_NODE.md). A text board: numbered posts, anonymous
 * by default, text first, `>>n` replies as plain text. The honest limits are the pinned post `0`.
 * One tap posts: the wallet, the anonymity-set join and the proof all happen behind one button, and
 * the post shows at once with its progress. Rules in `lib/board.mjs`, node calls in
 * `lib/try_board.ts`.
 *
 * #18 (follows, profiles, notifications) is later: `Author` is where a profile link would attach.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { anonAllowance, boardPostPlan, inviteUrl, PROVER_DOCS_URL, probeProver } from "../lib/board.mjs";
import { DEFAULT_PROVER_URL } from "../lib/anon_poster.mjs";
import { TMAIL_ANON_DISCLOSURE, secondsUntil } from "../lib/tmail_anon";
import { TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import { tmailBucketIndex } from "../lib/anon_tree.mjs";
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
import { Badge, Button, Input, PinnedNotice, TextArea, cx, fmtSeconds, fmtWhen, type Tone } from "./ui";
import { BASE, useTryWallet } from "./wallet";

const FEED_POLL_MS = 8_000;
const PROVER_URL = process.env.NEXT_PUBLIC_TET_PROVER_URL || DEFAULT_PROVER_URL;

/** A post sent from this tab, shown at once and updated until the board has it. */
type Outgoing = {
  id: string;
  text: string;
  mode: "anonymous" | "named";
  step: "joining" | "proving" | "depositing" | "sending" | "sent" | "failed";
  startedAtMs: number;
  stepAtMs: number;
  readyAtMs?: number;
  msgId?: string;
  reason?: string;
};

function badgeFor(p: BoardPost): { tone: Tone; text: string } {
  if (p.label.kind === "named") return { tone: "named", text: "named" };
  if (p.label.tone === "ok") return { tone: "ok", text: "✓ anonymous · verified" };
  if (p.label.tone === "bad") return { tone: "bad", text: "anonymous · proof failed" };
  return { tone: "pending", text: "anonymous · checking proof" };
}

/** Who wrote a post. #18 hook: a profile or follow control attaches here. */
function Author(props: { walletId: string | null }) {
  return props.walletId ? (
    <span className="font-mono text-[14px] text-[#1a237e]" data-author={props.walletId}>
      {props.walletId.slice(0, 8)}
    </span>
  ) : (
    <span className="text-[14px] text-neutral-500">anonymous</span>
  );
}

/** Post text with `>>n` as a tappable reference that highlights post n. */
function Body(props: { text: string; onRef: (n: number) => void }) {
  return (
    <p className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed text-neutral-900">
      {props.text.split(/(>>\d+)/g).map((part, i) => {
        const m = /^>>(\d+)$/.exec(part);
        return m ? (
          <button key={i} type="button" onClick={() => props.onRef(Number(m[1]))} className="rounded bg-[#eceefb] px-1 font-mono text-[15px] text-[#1a237e]">
            {part}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </p>
  );
}

export default function BoardPanel() {
  const { ensureWallet } = useTryWallet();
  const [board, setBoard] = useState<OpenBoard | null>(null);
  const [newName, setNewName] = useState("");
  const [inviteText, setInviteText] = useState("");
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [feedErr, setFeedErr] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [prover, setProver] = useState<"unknown" | "found" | "missing">("unknown");
  const [named, setNamed] = useState(false);
  const [text, setText] = useState("");
  const [members, setMembers] = useState<number | null>(null);
  const [postedBuckets, setPostedBuckets] = useState<number[]>([]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    void probeProver({ url: PROVER_URL }).then((p) => mounted.current && setProver(p));
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h.startsWith("#board=")) {
      void openBoard(BASE, h)
        .then((b) => mounted.current && setBoard(b))
        .catch((e: unknown) => mounted.current && setErr(e instanceof Error ? e.message : String(e)));
    }
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!board) return;
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
    if (!board) return;
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), FEED_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [board, refresh]);

  function onRef(n: number) {
    setHighlight(n);
    listRef.current?.querySelector(`[data-post="${n}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => mounted.current && setHighlight((h) => (h === n ? null : h)), 2_000);
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

  const patch = (id: string, p: Partial<Outgoing>) =>
    mounted.current && setOutgoing((o) => o.map((x) => (x.id === id ? { ...x, ...p, stepAtMs: p.step ? Date.now() : x.stepAtMs } : x)));

  const allowance = anonAllowance({ nowMs: now, postedBuckets });
  // Anonymous by default. Named only when chosen, or when no prover is here (and the button says so).
  const anonymous = prover !== "missing" && !named;

  async function onPost() {
    if (!board) return;
    const body = text.trim();
    if (!body || body.length > TMAIL_MAX_PLAINTEXT_CHARS) return;
    setErr("");
    await ensureWallet();
    const plan = boardPostPlan({ mode: anonymous ? "anonymous" : "named", prover, hasWallet: true });
    if (plan.action === "refuse") {
      setErr(plan.reason);
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
        // Join the anonymity set if needed, and wait for the epoch that admits us.
        let m = await anonMembership(BASE);
        if (m && !m.member) {
          await registerForAnon(BASE);
          m = await anonMembership(BASE);
          while (m && !m.member && mounted.current) {
            patch(id, { step: "joining", readyAtMs: m.nextEpochAtMs });
            const wait = Math.min(5_000, Math.max(1_000, m.nextEpochAtMs - Date.now() + 1_500));
            await new Promise((r) => setTimeout(r, wait));
            m = await anonMembership(BASE);
          }
        }
        if (m) setMembers(m.members);
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
  const link = board && typeof window !== "undefined" ? inviteUrl(window.location.origin, board.invite) : "";

  const notice = [
    "Posts are anonymous by default: a zero-knowledge proof shows you are a member, not which one. That needs the native prover on your computer; without it you post named, and the post says so.",
    `You are anonymous among the registered members only (${members ?? "?"} on this node). Joining the set is public.`,
    "One anonymous post per board per UTC day (up to 3 around 00:00 UTC).",
    "The node and the first relaying peer see your IP. Posts expire with their TTL and are not on the chain.",
    "Anyone with the invite link can read every post. An invite cannot be revoked: start a new board.",
    TMAIL_ANON_DISCLOSURE,
  ];

  if (!board) {
    return (
      <section className="space-y-3">
        <PinnedNotice lines={notice} />
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
          <Input label="Start a board (name optional)" value={newName} onChange={setNewName} />
          <Button className="w-full" disabled={busy} onClick={() => void open(async () => (await createBoard(BASE, newName)).board)}>
            Start a board
          </Button>
        </div>
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
          <Input label="Or open an invite link" value={inviteText} onChange={setInviteText} mono placeholder="…/try#board=tetboard1…" />
          <Button kind="secondary" className="w-full" disabled={busy || !inviteText.trim()} onClick={() => void open(() => openBoard(BASE, inviteText))}>
            Open
          </Button>
        </div>
        {err ? <p className="text-[15px] text-[#8a1f1f]">{err}</p> : null}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-lg font-semibold">{board.name || "Untitled board"}</h2>
        <span className="text-[15px] text-neutral-500">{today} posts today ·</span>
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
      </div>

      <ol ref={listRef} className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        <li className="p-3">
          <PinnedNotice lines={notice} />
        </li>
        {posts.map((p, i) => {
          const n = i + 1;
          const b = badgeFor(p);
          return (
            <li key={p.msgId} data-post={n} className={cx("p-3 transition-colors", highlight === n && "bg-[#fff6dc]")}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[14px] font-semibold text-neutral-500">{n}</span>
                <Author walletId={p.label.author} />
                <span className="text-[14px] text-neutral-400">{fmtWhen(p.sentAtMs, now)}</span>
                <Badge tone={b.tone} title={p.label.detail}>
                  {b.text}
                </Badge>
              </div>
              {p.state === "open" ? <Body text={p.text} onRef={onRef} /> : <p className="mt-1 text-[15px] text-neutral-400">Cannot be read with this invite.</p>}
            </li>
          );
        })}
        {outgoing.map((o) => {
          const secs = Math.max(0, Math.floor((now - o.stepAtMs) / 1000));
          const status =
            o.step === "joining"
              ? `joining the anonymity set · ready in ${fmtSeconds(secondsUntil(o.readyAtMs ?? now, now))}`
              : o.step === "proving"
                ? `proving… ${fmtSeconds(secs)}`
                : o.step === "failed"
                  ? `not posted: ${o.reason}`
                  : o.step === "sent"
                    ? "sent · waiting for the board"
                    : `${o.step}…`;
          return (
            <li key={o.id} className="bg-neutral-50 p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[14px] font-semibold text-neutral-400">{posts.length + 1}</span>
                <span className="text-[14px] text-neutral-500">you · {o.mode}</span>
                <Badge tone={o.step === "failed" ? "bad" : "pending"}>{status}</Badge>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed text-neutral-500">{o.text}</p>
            </li>
          );
        })}
      </ol>
      {feedErr ? <p className="text-[15px] text-[#8a1f1f]">{feedErr}</p> : null}

      <div className="sticky bottom-0 space-y-2 rounded-xl border border-neutral-200 bg-white/95 p-3 backdrop-blur">
        <TextArea value={text} onChange={setText} rows={text ? 3 : 1} maxLength={TMAIL_MAX_PLAINTEXT_CHARS} placeholder="Write a post (>>2 replies to post 2)" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button disabled={!text.trim() || prover === "unknown"} onClick={() => void onPost()}>
            {prover === "unknown" ? "Checking for the prover…" : anonymous ? "Post anonymously" : "Post named"}
          </Button>
          {prover === "found" ? (
            <Button kind="quiet" onClick={() => setNamed(!named)}>
              {named ? "post anonymously instead" : "post named instead"}
            </Button>
          ) : null}
          <span className="text-[14px] text-neutral-500">
            {prover === "missing" ? (
              <>
                No prover here, so posts show your wallet id.{" "}
                <a className="underline" href={PROVER_DOCS_URL} target="_blank" rel="noreferrer">
                  Run the prover
                </a>{" "}
                to post anonymously.
              </>
            ) : anonymous ? (
              <>{allowance.remaining} anonymous post left today · about 30 s to prove</>
            ) : (
              <>shows your wallet id</>
            )}
          </span>
        </div>
        {err ? <p className="text-[15px] text-[#8a1f1f]">{err}</p> : null}
      </div>
    </section>
  );
}
