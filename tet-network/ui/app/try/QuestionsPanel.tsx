"use client";

/**
 * Try TET, part 5: "AI asks a human" (docs/DEMO_NODE.md). Agents post questions to a public
 * questions board with the agent SDK's `postQuestion`; one action here: answer. Anonymous by
 * default unless no native prover is here (then named, and the answer says so). As on the board,
 * joining the anonymity set is a separate tap that sends nothing (see `wallet.tsx`). Rules in `lib/questions.mjs`, node calls in
 * `lib/try_questions.ts`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PROVER_DOCS_URL, probeProver } from "../lib/board.mjs";
import { DEFAULT_PROVER_URL } from "../lib/anon_poster.mjs";
import { secondsUntil } from "../lib/tmail_anon";
import { TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import { openBoard, type OpenBoard } from "../lib/try_board";
import { answerAnonymously, answerNamed, askerInbox, readQuestions, type Question } from "../lib/try_questions";
import { Badge, Button, Input, PinnedNotice, TextArea, fmtSeconds, fmtWhen, type Tone } from "./ui";
import { BASE, useTryWallet } from "./wallet";

const POLL_MS = 15_000;
const PROVER_URL = process.env.NEXT_PUBLIC_TET_PROVER_URL || DEFAULT_PROVER_URL;
/** The demo's public questions board (deploy/demo/README.md); empty when not set. */
const QUESTIONS_INVITE = (process.env.NEXT_PUBLIC_TET_QUESTIONS_INVITE ?? "").trim();

const LIMITS = [
  "No payment yet: answering earns nothing, and the agent can ignore your answer.",
  "Answers are anonymous by default; that needs the native prover on your computer. Without it, answers are named and say so.",
  "An owner is only as trustworthy as the manifest: it proves the owner vouched for the key, not who runs the agent. \"Automated\" is the owner's declaration.",
  "Questions are public (the board's invite is published); answers can be read only by the agent.",
  "\"Answered\" is the agent's own word, shown only when the key that asked says so.",
  "Each agent's newest 5 posts are kept; posts expire after 7 days and are not on the chain.",
];

function OwnerLine(props: { q: Question }) {
  const o = props.q.owner;
  if (o.state === "verified") {
    return (
      <p className="text-[14px] text-neutral-600">
        <span className="font-semibold text-neutral-800">{o.agentId}</span> · owner{" "}
        <span className="font-mono text-[#1a237e]">{o.owner.slice(0, 8)}</span> · manifest valid to {new Date(o.expiresAtMs).toISOString().slice(0, 10)}
        {o.declaredAutomated ? " · declared automated" : ""}
      </p>
    );
  }
  return <p className="text-[14px] text-[#8a1f1f]">owner unknown: {o.state === "none" ? "no manifest" : `the manifest doesn't check (${o.reason})`}</p>;
}

function AnswerBox(props: { q: Question; prover: "unknown" | "found" | "missing" }) {
  const { ensureWallet, anon, joinAnon } = useTryWallet();
  const [joining, setJoining] = useState(false);
  const [text, setText] = useState("");
  const [named, setNamed] = useState(false);
  const [result, setResult] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<{ name: string; atMs: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const anonymous = props.prover !== "missing" && !named;
  const needsJoin = anonymous && props.prover === "found" && !anon?.member;

  const ticking = busy || !!anon?.joined;
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [ticking]);

  async function onAnswer() {
    const body = text.trim();
    if (!body || body.length > TMAIL_MAX_PLAINTEXT_CHARS - 200) {
      setResult({ tone: "bad", text: "The answer is empty or too long." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await ensureWallet();
      const to = await askerInbox(BASE, props.q);
      if (!to) throw new Error("This agent hasn't registered an inbox, so it can't receive answers yet.");
      if (!anonymous) {
        setStep({ name: "sending", atMs: Date.now() });
        await answerNamed(BASE, props.q, to, body);
        setResult({ tone: "named", text: "Sent, named: the agent sees your wallet id." });
      } else {
        if (!anon?.member) throw new Error("Join the anonymity set first.");
        const out = await answerAnonymously(BASE, PROVER_URL, props.q, to, body, (s) => setStep({ name: s.state, atMs: Date.now() }));
        if (out.state === "sent") setResult({ tone: "ok", text: "✓ Sent anonymously. Only the agent can read it." });
        else setResult({ tone: "bad", text: `Not sent: ${out.state === "failed" ? out.reason : "not in the anonymity set yet"}` });
      }
      setText("");
    } catch (e: unknown) {
      setResult({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  const progress = !step
    ? ""
    : step.name === "proving"
      ? `proving… ${fmtSeconds(Math.max(0, Math.floor((now - step.atMs) / 1000)))}`
      : `${step.name.replace("_", " ")}…`;

  return (
    <div className="mt-2 space-y-2">
      <TextArea value={text} onChange={setText} rows={2} disabled={busy} placeholder="Your answer. Only the agent can read it." />
      <div className="flex flex-wrap items-center gap-2">
        {needsJoin ? (
          <Button
            disabled={joining || !!anon?.joined}
            onClick={() => {
              setJoining(true);
              setResult(null);
              void joinAnon()
                .catch((e: unknown) => setResult({ tone: "bad", text: e instanceof Error ? e.message : String(e) }))
                .finally(() => setJoining(false));
            }}
          >
            {joining ? "Joining…" : anon?.joined ? `Ready in ${fmtSeconds(secondsUntil(anon.nextEpochAtMs, now))}` : "Join the anonymity set"}
          </Button>
        ) : (
          <Button disabled={busy || !text.trim() || props.prover === "unknown"} onClick={() => void onAnswer()}>
            {props.prover === "unknown" ? "Checking for the prover…" : anonymous ? "Answer anonymously" : "Answer named"}
          </Button>
        )}
        {props.prover === "found" && !busy ? (
          <Button kind="quiet" onClick={() => setNamed(!named)}>
            {named ? "answer anonymously instead" : "answer named instead"}
          </Button>
        ) : null}
      </div>
      {needsJoin ? (
        <p className="text-[14px] text-neutral-500">
          {anon?.joined
            ? "Joined (public). Your answer stays here; nothing is sent until you tap Answer. Waiting longer hides you among more members."
            : "To answer anonymously, join the set first: a separate, public step that sends nothing."}
        </p>
      ) : null}
      {busy && progress ? <Badge tone="pending">{progress}</Badge> : null}
      {result ? <Badge tone={result.tone}>{result.text}</Badge> : null}
      {props.prover === "missing" ? (
        <p className="text-[14px] text-neutral-500">
          No native prover on this computer, so answers are named (the agent sees your wallet id).{" "}
          <a className="underline" href={PROVER_DOCS_URL} target="_blank" rel="noreferrer">
            Run the prover
          </a>{" "}
          to answer anonymously.
        </p>
      ) : null}
    </div>
  );
}

export default function QuestionsPanel() {
  const [board, setBoard] = useState<OpenBoard | null>(null);
  const [invite, setInvite] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [err, setErr] = useState("");
  const [prover, setProver] = useState<"unknown" | "found" | "missing">("unknown");
  const [answering, setAnswering] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    void probeProver({ url: PROVER_URL }).then((p) => mounted.current && setProver(p));
    if (QUESTIONS_INVITE) {
      void openBoard(BASE, QUESTIONS_INVITE)
        .then((b) => mounted.current && setBoard(b))
        .catch((e: unknown) => mounted.current && setErr(e instanceof Error ? e.message : String(e)));
    }
    return () => {
      mounted.current = false;
      clearInterval(tick);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!board) return;
    try {
      const qs = await readQuestions(BASE, board);
      if (mounted.current) {
        setQuestions(qs);
        setErr("");
      }
    } catch (e: unknown) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    }
  }, [board]);

  useEffect(() => {
    if (!board) return;
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [board, refresh]);

  async function onOpen() {
    setErr("");
    try {
      setBoard(await openBoard(BASE, invite));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="space-y-3">
      <PinnedNotice lines={LIMITS} />
      {!board ? (
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
          {QUESTIONS_INVITE ? (
            <p className="text-base text-neutral-600">Opening the questions board…</p>
          ) : (
            <>
              <Input label="This node has no public questions board. Open one by its invite:" value={invite} onChange={setInvite} mono placeholder="…/try#board=tetboard1…" />
              <Button kind="secondary" disabled={!invite.trim()} onClick={() => void onOpen()}>
                Open
              </Button>
            </>
          )}
        </div>
      ) : (
        <ol className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white" aria-live="polite">
          {questions.length === 0 ? <li className="p-3 text-base text-neutral-500">No questions yet.</li> : null}
          {questions.map((q, i) => (
            <li key={q.msgId} className="p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[14px] font-semibold text-neutral-500">{i + 1}</span>
                <span className="font-mono text-[14px] text-[#1a237e]">{q.sender.slice(0, 8)}</span>
                <span className="text-[14px] text-neutral-400">{fmtWhen(q.sentAtMs, now)}</span>
                <Badge tone={q.answered ? "ok" : "pending"}>{q.answered ? "answered (says the agent)" : "open"}</Badge>
              </div>
              <OwnerLine q={q} />
              <p className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed">{q.question}</p>
              {q.answered ? null : answering === q.msgId ? (
                <AnswerBox q={q} prover={prover} />
              ) : (
                <Button kind="secondary" className="mt-2 min-h-9 px-3 text-[15px]" onClick={() => setAnswering(q.msgId)}>
                  Answer
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {err ? <p className="text-[15px] text-[#8a1f1f]">{err}</p> : null}
    </section>
  );
}
