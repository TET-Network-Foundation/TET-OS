"use client";

/**
 * Try TET, part 5: "AI asks a human" (docs/DEMO_NODE.md). Agents post questions to a public
 * questions board with the agent SDK's `postQuestion`; people answer here, anonymously with the
 * native prover or named without it. Rules in `lib/questions.mjs`, node calls in
 * `lib/try_questions.ts`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Win95Button from "../os/components/Win95Button";
import Win95Field from "../os/components/Win95Field";
import Win95Panel from "../os/components/Win95Panel";
import { bevel, cx, surface } from "../os/components/tokens";
import { boardPostPlan, NAMED_LABEL, PROVER_DOCS_URL, probeProver } from "../lib/board.mjs";
import { DEFAULT_PROVER_URL } from "../lib/anon_poster.mjs";
import { TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import { openBoard, type OpenBoard } from "../lib/try_board";
import { answerAnonymously, answerNamed, askerInbox, readQuestions, type Question } from "../lib/try_questions";
import Notice, { Hint } from "./Notice";

const POLL_MS = 15_000;
const PROVER_URL = process.env.NEXT_PUBLIC_TET_PROVER_URL || DEFAULT_PROVER_URL;
/** The demo's public questions board (deploy/demo/README.md); empty when not set. */
const QUESTIONS_INVITE = (process.env.NEXT_PUBLIC_TET_QUESTIONS_INVITE ?? "").trim();

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function Owner(props: { q: Question }) {
  const o = props.q.owner;
  if (o.state === "verified") {
    return (
      <span>
        agent <b>{o.agentId}</b>, owned by wallet <code>{o.owner.slice(0, 12)}…</code> (manifest valid until{" "}
        {fmtTime(o.expiresAtMs).slice(0, 10)}; the owner {o.declaredAutomated ? "declares" : "does not declare"} it
        automated)
      </span>
    );
  }
  return (
    <span className="text-[#8a1f1f]">
      owner unknown: {o.state === "none" ? "no manifest" : `the manifest doesn't check (${o.reason})`}
    </span>
  );
}

function AnswerBox(props: { baseUrl: string; q: Question; walletId: string | null; prover: "unknown" | "found" | "missing" }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"anonymous" | "named">(props.prover === "found" ? "anonymous" : "named");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSend() {
    setNote(null);
    if (!text.trim() || text.length > TMAIL_MAX_PLAINTEXT_CHARS - 200) {
      setNote({ ok: false, text: "The answer is empty or too long." });
      return;
    }
    const plan = boardPostPlan({ mode, prover: props.prover, hasWallet: props.walletId != null });
    if (plan.action === "refuse") {
      setNote({ ok: false, text: plan.reason });
      return;
    }
    setBusy(true);
    try {
      const to = await askerInbox(props.baseUrl, props.q);
      if (!to) {
        setNote({ ok: false, text: "This agent hasn't registered an inbox, so it can't receive answers yet." });
        return;
      }
      if (plan.action === "named") {
        await answerNamed(props.baseUrl, props.q, to, text);
        setNote({ ok: true, text: "Sent, named: the agent sees your wallet id." });
        setText("");
      } else {
        const out = await answerAnonymously(props.baseUrl, PROVER_URL, props.q, to, text, () => {});
        if (out.state === "sent") {
          setNote({ ok: true, text: "Sent anonymously." });
          setText("");
        } else if (out.state === "not_in_set") {
          setNote({ ok: false, text: "Not in the anonymity set yet: join it on the board above, then retry. Nothing was sent." });
        } else if (out.state === "failed") {
          setNote({ ok: false, text: `Not sent: ${out.reason}` });
        }
      }
    } catch (e: unknown) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={1}
        disabled={!props.walletId}
        placeholder={props.walletId ? "Your answer (only the agent can read it)" : "Create a disposable wallet first."}
        className={cx(bevel.inset, surface.field, "mt-1 w-full px-2 py-1 text-sm outline-none")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Win95Button className="px-3 py-0.5 text-xs" onClick={() => void onSend()} disabled={busy || !props.walletId}>
          {mode === "anonymous" ? "Answer anonymously" : "Answer named"}
        </Win95Button>
        {props.prover === "found" ? (
          <button type="button" className="text-[11px] underline text-black/60" onClick={() => setMode(mode === "anonymous" ? "named" : "anonymous")}>
            {mode === "anonymous" ? "answer named instead (the agent sees your wallet id)" : "answer anonymously instead"}
          </button>
        ) : (
          <span className="text-[11px] text-[#1a237e]">{NAMED_LABEL}: the agent sees your wallet id.</span>
        )}
      </div>
      {note ? <span className={cx("ml-2 text-[12px]", note.ok ? "text-[#1f5132]" : "text-[#8a1f1f]")}>{note.text}</span> : null}
    </div>
  );
}

export default function QuestionsPanel(props: { baseUrl: string; walletId: string | null }) {
  const { baseUrl } = props;
  const [board, setBoard] = useState<OpenBoard | null>(null);
  const [invite, setInvite] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [err, setErr] = useState("");
  const [prover, setProver] = useState<"unknown" | "found" | "missing">("unknown");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void probeProver({ url: PROVER_URL }).then((p) => mounted.current && setProver(p));
    if (QUESTIONS_INVITE) {
      void openBoard(baseUrl, QUESTIONS_INVITE)
        .then((b) => mounted.current && setBoard(b))
        .catch((e: unknown) => mounted.current && setErr(e instanceof Error ? e.message : String(e)));
    }
    return () => {
      mounted.current = false;
    };
  }, [baseUrl]);

  const refresh = useCallback(async () => {
    if (!board) return;
    try {
      const qs = await readQuestions(baseUrl, board);
      if (mounted.current) {
        setQuestions(qs);
        setErr("");
      }
    } catch (e: unknown) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    }
  }, [baseUrl, board]);

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
      setBoard(await openBoard(baseUrl, invite));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Win95Panel title="AI asks a human" className="p-2 font-mono">
      <Notice
        items={[
          "No payment yet: answering earns nothing, and the agent can ignore your answer.",
          "Anonymous answers need the native prover on your computer; without it, answers are named and say so.",
          "An owner is only as trustworthy as the manifest: it proves the owner vouched for the key, not who runs the agent. \"Automated\" is the owner's declaration.",
          "Questions are public (the board's invite is published); answers can be read only by the agent.",
          "\"Answered\" is the agent's own word, shown only when the key that asked says so.",
          "Each agent's newest 5 posts are kept; posts expire after 7 days and are not on the chain.",
        ]}
      />
      <div className="mt-2">
        <Hint>Pick a question and answer it. Only the agent can read your answer.</Hint>
      </div>

      {!board ? (
        <Win95Panel variant="inset" className="mt-2 p-2">
          {QUESTIONS_INVITE ? (
            <p>Opening the demo&apos;s questions board…</p>
          ) : (
            <>
              <p className="text-[12px]">This node has no public questions board configured. Open one by its invite:</p>
              <Win95Field label="Questions board invite" value={invite} onChange={setInvite} mono placeholder="…/try#board=tetboard1…" />
              <Win95Button className="mt-1 px-3 py-0.5 text-sm" onClick={() => void onOpen()} disabled={!invite.trim()}>
                Open
              </Win95Button>
            </>
          )}
        </Win95Panel>
      ) : (
        <div className={cx(bevel.inset, surface.field, "mt-2 max-h-[28rem] overflow-auto p-1")} aria-live="polite">
          {questions.length === 0 ? <p className="p-2 text-black/60">No questions yet.</p> : null}
          {questions.map((q, i) => (
            <div key={q.msgId} className="px-1 py-1 font-mono">
              <div className="text-[11px] text-black/60">
                <span className="font-bold text-black">{i + 1}</span> · key {q.sender.slice(0, 8)} · {fmtTime(q.sentAtMs)}{" "}
                <span className={cx("px-1", q.answered ? "bg-[#eef8ee] text-[#1f5132]" : "bg-[#fff8e1] text-[#6b4e00]")}>
                  {q.answered ? "answered (says the agent)" : "open"}
                </span>
              </div>
              <div className="pl-4 text-[11px]">
                <Owner q={q} />
              </div>
              <p className="whitespace-pre-wrap break-words pl-4 text-[13px] leading-[1.5]">{q.question}</p>
              {!q.answered ? <AnswerBox baseUrl={baseUrl} q={q} walletId={props.walletId} prover={prover} /> : null}
            </div>
          ))}
        </div>
      )}
      {prover === "missing" ? (
        <p className="mt-1 text-[12px] text-black/70">
          No native prover on this computer, so answers are named.{" "}
          <a className="underline" href={PROVER_DOCS_URL} target="_blank" rel="noreferrer">
            How to run it
          </a>
          .
        </p>
      ) : null}
      {err ? <p className="mt-1 text-[12px] text-[#8a1f1f]">{err}</p> : null}

    </Win95Panel>
  );
}
