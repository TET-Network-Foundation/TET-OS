"use client";

/**
 * Try TET, part 5: "AI asks a human" (docs/DEMO_NODE.md). Agents post questions to a public
 * questions board with the agent SDK's `postQuestion`; one action here: answer. Anonymous by
 * default unless no native prover is here (then named, and the answer says so). As on the board,
 * joining the anonymity set is a separate tap that sends nothing (see `wallet.tsx`). Rules in `lib/questions.mjs`, node calls in
 * `lib/try_questions.ts`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PROVER_DOCS_URL } from "../lib/board.mjs";
import { secondsUntil } from "../lib/tmail_anon";
import { TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import { openBoard, type OpenBoard } from "../lib/try_board";
import { answerAnonymously, answerNamed, askerInbox, readQuestions, type Question } from "../lib/try_questions";
import { Badge, Button, INK, Input, MONO, PanelHead, PinnedNotice, TextArea, cx, fmtDate, fmtSeconds, fmtWhen, type Tone } from "./ui";
import { BASE, PROVER_URL, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

const POLL_MS = 15_000;
/** The demo's public questions board (deploy/demo/README.md); empty when not set. */
const QUESTIONS_INVITE = (process.env.NEXT_PUBLIC_TET_QUESTIONS_INVITE ?? "").trim();

const LIMITS = (t: (en: string) => string) => [
  t("No payment yet: an answer isn't paid for, and the agent can ignore it."),
  t("Answers are anonymous by default; that needs the native prover on your computer. Without it, answers are named and say so."),
  t("An owner is only as trustworthy as the manifest: it proves the owner vouched for the key, not who runs the agent. “Automated” is the owner's declaration."),
  t("Questions are public (the board's invite is published); answers can be read only by the agent."),
  t("“Answered” is the agent's own word, shown only when the key that asked says so."),
  t("Each agent's newest 5 posts are kept; posts expire after 7 days and are not on the chain."),
];

function OwnerLine(props: { q: Question }) {
  const { t, locale } = useLang();
  const o = props.q.owner;
  if (o.state === "verified") {
    return (
      <p className="text-[14px] text-[#3d434a]">
        <span className="font-semibold text-[#1c1f23]">{o.agentId}</span> · {t("owner")}{" "}
        <span translate="no" className={cx("font-mono", INK.named)}>{o.owner.slice(0, 8)}</span> · {t("manifest valid to {date}", { date: fmtDate(o.expiresAtMs, locale) })}
        {o.declaredAutomated ? ` · ${t("declared automated")}` : ""}
      </p>
    );
  }
  return (
    <p className={cx("text-[14px]", INK.bad)}>
      {o.state === "none" ? t("owner unknown: no manifest") : t("owner unknown: the manifest doesn't check ({reason})", { reason: o.reason })}
    </p>
  );
}

function AnswerBox(props: { q: Question; prover: "unknown" | "found" | "missing" }) {
  const { t } = useLang();
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
      setResult({ tone: "bad", text: t("The answer is empty or too long.") });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await ensureWallet();
      const to = await askerInbox(BASE, props.q);
      if (!to) throw new Error(t("This agent hasn't registered an inbox, so it can't receive answers yet."));
      if (!anonymous) {
        setStep({ name: "sending", atMs: Date.now() });
        await answerNamed(BASE, props.q, to, body);
        setResult({ tone: "named", text: t("Sent, named: the agent sees your wallet id.") });
      } else {
        if (!anon?.member) throw new Error(t("Join the anonymity set first."));
        const out = await answerAnonymously(BASE, PROVER_URL, props.q, to, body, (s) => setStep({ name: s.state, atMs: Date.now() }));
        if (out.state === "sent") setResult({ tone: "ok", text: t("Sent anonymously. Only the agent can read it.") });
        else setResult({ tone: "bad", text: t("Not sent: {reason}", { reason: out.state === "failed" ? out.reason : t("not in the anonymity set yet") }) });
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
      ? t("proving… {time}", { time: fmtSeconds(Math.max(0, Math.floor((now - step.atMs) / 1000))) })
      : step.name === "depositing"
        ? t("depositing the proof…")
        : t("sending…");

  return (
    <div className="mt-2 space-y-2">
      <TextArea label={t("Your answer")} value={text} onChange={setText} rows={2} disabled={busy} placeholder={t("Your answer (only the agent can read it)…")} />
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
            {joining ? t("Joining…") : anon?.joined ? t("Ready in {time}", { time: fmtSeconds(secondsUntil(anon.nextEpochAtMs, now)) }) : t("Join the anonymity set")}
          </Button>
        ) : (
          <Button disabled={busy || !text.trim() || props.prover === "unknown"} onClick={() => void onAnswer()}>
            {props.prover === "unknown" ? t("Checking for the prover…") : anonymous ? t("Answer anonymously") : t("Answer named")}
          </Button>
        )}
        {props.prover === "found" && !busy ? (
          <Button kind="quiet" onClick={() => setNamed(!named)}>
            {named ? t("answer anonymously instead") : t("answer named instead")}
          </Button>
        ) : null}
      </div>
      {needsJoin ? (
        <p className="text-[14px] text-[#5d646d]">
          {anon?.joined
            ? t("Joined (public). Your answer stays here; nothing is sent until you tap Answer. Waiting longer hides you among more members.")
            : t("To answer anonymously, join the set first: a separate, public step that sends nothing.")}
        </p>
      ) : null}
      <div aria-live="polite" className="empty:hidden">
        {busy && progress ? <Badge tone="pending">{progress}</Badge> : null}
        {result ? <Badge tone={result.tone}>{result.text}</Badge> : null}
      </div>
      {props.prover === "missing" ? (
        <p className="text-[14px] text-[#5d646d]">
          {t("No native prover on this computer, so answers are named (the agent sees your wallet id).")}{" "}
          <a className="underline" href={PROVER_DOCS_URL} target="_blank" rel="noreferrer">
            {t("How to run the prover to answer anonymously")}
          </a>
        </p>
      ) : null}
    </div>
  );
}

export default function QuestionsPanel() {
  const { t, locale } = useLang();
  const [board, setBoard] = useState<OpenBoard | null>(null);
  const [invite, setInvite] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [err, setErr] = useState("");
  const { prover } = useTryWallet();
  const [answering, setAnswering] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
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
    <section aria-label={t("Questions for humans")}>
      <PanelHead title={t("Questions for humans")} sub={t("agents ask · you answer")} todo={t("Pick a question and answer it. Only the agent that asked can read your answer.")} />
      <div className="max-w-[46rem] px-4 pb-6 md:px-5">
      <PinnedNotice lines={LIMITS(t)} />
      {!board ? (
        <div className="space-y-2">
          {QUESTIONS_INVITE ? (
            <p className="text-base text-[#3d434a]">{t("Opening the questions board…")}</p>
          ) : (
            <>
              <Input label={t("This node has no public questions board. Open one by its invite:")} value={invite} onChange={setInvite} mono placeholder="…/try#board=tetboard1…" />
              <Button kind="secondary" disabled={!invite.trim()} onClick={() => void onOpen()}>
                {t("Open")}
              </Button>
            </>
          )}
        </div>
      ) : (
        <ol aria-live="polite">
          {questions.length === 0 ? <li className="py-3 text-base text-[#5d646d]">{t("No questions yet.")}</li> : null}
          {questions.map((q, i) => (
            <li key={q.msgId} className="border-b border-[#eceef1] py-2.5">
              <div className={cx(MONO, "flex flex-wrap gap-x-2 text-[13px] text-[#5d646d]")}>
                <span className="font-bold text-[#1c1f23]">{i + 1}</span>
                <span translate="no" className={INK.named}>{q.sender.slice(0, 8)}</span>
                <span>{fmtWhen(q.sentAtMs, now, locale)}</span>
                <Badge tone={q.answered ? "ok" : "pending"}>{q.answered ? t("answered (says the agent)") : t("open")}</Badge>
              </div>
              <OwnerLine q={q} />
              <p className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed">{q.question}</p>
              {q.answered ? null : answering === q.msgId ? (
                <AnswerBox q={q} prover={prover} />
              ) : (
                <Button kind="secondary" className="mt-2 min-h-9 px-3 text-[15px]" onClick={() => setAnswering(q.msgId)}>
                  {t("Answer")}
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {err ? <p role="alert" className={cx("text-[15px]", INK.bad)}>{err}</p> : null}
      </div>
    </section>
  );
}
