"use client";
/**
 * "Run it": the console every run writes to, the panel on each feature card, and the three demos
 * (/machines: the scripted agent; /research: the one-shot model and the permit-language sketch).
 *
 * Everything runs in the tab: no request, no storage (React state only, gone when the tab closes).
 * Lines appear as each step finishes. With reduced motion asked for, they appear without the short
 * pause between steps; nothing animates either way.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ShowsDoesNot } from "../kit";
import { useSite } from "../i18n";
import { REAL_CHECKERS } from "./page_key";
import { NO_RUN, RUNS, type Tone } from "./runs";
import { AGENT_DEMO_DOES_NOT, AGENT_DEMO_SHOWS, INJECTION, runAgent } from "./agent_demo";
import { copyKey, cryptoRand, makeKey, ONE_SHOT_DOES_NOT, ONE_SHOT_SHOWS, show, sign, check, type Key, type Prepared } from "./one_shot_model";
import { parse, PERMIT_LANG_DOES_NOT, PERMIT_LANG_SHOWS, runRules, SAMPLE } from "./permit_lang";

const cx = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(" ");
const FOCUS = "outline-none focus-visible:ring-4 focus-visible:ring-teal-600/40";
const BUTTON = cx(
  "inline-flex w-fit rounded-md border border-slate-300 px-4 py-2 font-semibold text-slate-900 hover:border-teal-700 hover:text-teal-800 disabled:opacity-60 dark:border-slate-600 dark:text-slate-100 dark:hover:border-teal-400 dark:hover:text-teal-200",
  FOCUS,
);

type Line = { text: string; tone: Tone };
const MARK: Record<Tone, string> = { step: "·", ok: "✓", refused: "✗" };

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(m.matches);
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** A console and the function that writes to it, with the pause between steps (none for reduced motion). */
function useConsole() {
  const reduce = useReducedMotion();
  const [lines, setLines] = useState<Line[]>([]);
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  const log = async (text: string, tone: Tone = "step") => {
    setLines((l) => [...l, { text, tone }]);
    if (!reduceRef.current) await new Promise((r) => setTimeout(r, 160));
  };
  return { lines, log, clear: () => setLines([]) };
}

export function Console(props: { lines: Line[]; label: string }) {
  const { t } = useSite();
  if (!props.lines.length) return null;
  return (
    <ol
      aria-label={t(props.label)}
      aria-live="polite"
      className="flex flex-col gap-2 overflow-x-auto rounded-md bg-slate-100 p-4 font-mono text-sm leading-relaxed text-slate-900 dark:bg-slate-900 dark:text-slate-100"
    >
      {props.lines.map((l, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden="true" className={l.tone === "ok" ? "text-teal-800 dark:text-teal-300" : "text-slate-600 dark:text-slate-400"}>
            {MARK[l.tone]}
          </span>
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            <span className="sr-only">{l.tone === "ok" ? t("Passed:") : l.tone === "refused" ? t("Refused:") : ""} </span>
            {l.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Button(props: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  const { t } = useSite();
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} aria-pressed={props.pressed} className={BUTTON}>
      {t(props.label)}
    </button>
  );
}

/** A run's end: what it showed and what it did not. */
function RunEnd(props: { shows: string[]; doesNot: string[] }) {
  const { t } = useSite();
  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-semibold">{t("What this run showed")}</h4>
      <ShowsDoesNot shows={props.shows} doesNot={props.doesNot} />
    </div>
  );
}

function useRunner() {
  const con = useConsole();
  const [state, setState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const go = async (body: (log: typeof con.log) => (Promise<void>)) => {
    con.clear();
    setState("running");
    try {
      await body(con.log);
      setState("done");
    } catch (e) {
      await con.log(`${e instanceof Error ? e.message : String(e)}`, "refused");
      setState("failed");
    }
  };
  return { ...con, state, go };
}

/** On every feature card: the run, or why there is nothing to run. */
export function RunSlot(props: { id: string }) {
  const { t } = useSite();
  const run = RUNS[props.id];
  const r = useRunner();
  if (!run) {
    const why = NO_RUN[props.id];
    return why ? <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{t(why)}</p> : null;
  }
  return (
    <section className="flex flex-col gap-4 border-t border-slate-300 pt-4 dark:border-slate-700" aria-label={t("Run it")}>
      <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {t("Runs the real check in this tab, on sample data made here with a fresh test key. Nothing is sent or stored.")}
      </p>
      <Button label={r.state === "running" ? "Running…" : r.state === "idle" ? "Run it" : "Run it again"} disabled={r.state === "running"} onClick={() => r.go((log) => run.run({ t, log, c: REAL_CHECKERS }))} />
      <Console lines={r.lines} label="Run output" />
      {r.state === "done" || r.state === "failed" ? <RunEnd shows={run.shows} doesNot={run.doesNot} /> : null}
    </section>
  );
}

function Demo(props: { title: string; label: string; children: ReactNode }) {
  const { t } = useSite();
  return (
    <section className="flex flex-col gap-4 rounded-md border border-slate-300 p-6 dark:border-slate-700" aria-label={t(props.title)}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-semibold">{t(props.title)}</h3>
        <span className="inline-flex w-fit items-center rounded-full border border-slate-400 px-2 text-sm font-semibold text-slate-700 dark:border-slate-500 dark:text-slate-300">
          {t(props.label)}
        </span>
      </div>
      {props.children}
    </section>
  );
}

/** /machines: the scripted agent and the prompt injection. */
export function AgentDemo() {
  const { t } = useSite();
  const r = useRunner();
  const [permits, setPermits] = useState(true);
  return (
    <Demo title="An agent talked into sending ten emails" label="Prototype">
      <p className="max-w-prose leading-relaxed">{t("Scripted agent, not a language model. It does whatever the text in front of it says, and nothing leaves this page.")}</p>
      <div className="flex flex-col gap-2">
        <p className="font-semibold">{t("The text the agent reads:")}</p>
        <blockquote className="border-l-2 border-slate-400 pl-4 font-mono text-sm leading-relaxed [overflow-wrap:anywhere] dark:border-slate-500">{INJECTION}</blockquote>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("Permits")}>
        <Button label="With a one-time permit" pressed={permits} onClick={() => setPermits(true)} disabled={r.state === "running"} />
        <Button label="Without permits" pressed={!permits} onClick={() => setPermits(false)} disabled={r.state === "running"} />
      </div>
      <Button
        label={r.state === "running" ? "Running…" : "Run the agent"}
        disabled={r.state === "running"}
        onClick={() => r.go(async (log) => void (await runAgent({ permits, t, log, c: REAL_CHECKERS })))}
      />
      <Console lines={r.lines} label="Agent output" />
      {r.state === "done" ? <RunEnd shows={AGENT_DEMO_SHOWS} doesNot={AGENT_DEMO_DOES_NOT} /> : null}
    </Demo>
  );
}

/** /research: a one-shot key, simulated. */
export function OneShotDemo() {
  const { t } = useSite();
  const con = useConsole();
  const [keys, setKeys] = useState<{ key: Key; prepared: Prepared[] }[]>([]);
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  /** One step at a time: the buttons wait until the step's lines are written. */
  const step = (f: () => (Promise<unknown>)) => async () => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const fresh = async () => {
    con.clear();
    const k = makeKey(cryptoRand, "The key");
    setKeys([k]);
    setN(0);
    await con.log(t("A key of {q} simulated qubits, each prepared in one of four states.", { q: k.key.qubits.length }));
  };
  const doSign = async (i: number) => {
    const k = keys[i];
    const msg = t("message {n}", { n: n + 1 });
    setN(n + 1);
    const r = sign(k.key, msg, cryptoRand);
    setKeys([...keys]);
    if (!r.ok) return con.log(t("{key} cannot sign {msg}: {why}", { key: t(k.key.label), msg, why: t(r.why) }), "refused");
    await con.log(t("{key} signed {msg}: its qubits were measured, and that used it up.", { key: t(k.key.label), msg }), "ok");
    const v = check(k.prepared, r.sig);
    await con.log(v.ok ? t("The model's checker accepts the signature ({m} qubits checked).", { m: v.matched }) : t("The model's checker refuses it: {why}", { why: v.why }), v.ok ? "ok" : "refused");
  };
  const doCopy = async () => {
    const k = keys[0];
    setKeys([...keys, { key: copyKey(k.key, "The copy"), prepared: k.prepared }]);
    await con.log(t("Key copied. This works only because a simulation is numbers. Real qubits in an unknown state cannot be copied."));
  };
  return (
    <Demo title="A one-shot key, simulated" label="Idea, model only">
      <p className="max-w-prose leading-relaxed">
        {t("Nothing quantum runs here: these are numbers in your tab that imitate a few qubits. Signing measures them, and measuring uses them up.")}
      </p>
      {keys.length ? (
        <ul className="flex flex-col gap-2">
          {keys.map((k, i) => (
            <li key={i} className="flex flex-col gap-2">
              <span className="text-sm font-semibold">
                {t(k.key.label)}: {k.key.used ? t("measured") : t("not measured")}
              </span>
              <span className="font-mono text-sm [overflow-wrap:anywhere]" aria-label={t("Qubit states")}>
                {show(k.key, k.prepared).join(" ")}
              </span>
              <Button label="Sign" disabled={busy} onClick={() => void step(() => doSign(i))()} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button label={keys.length ? "Start again with a new key" : "Make a key"} disabled={busy} onClick={() => void step(fresh)()} />
        {keys.length === 1 && !keys[0].key.used ? <Button label="Copy the key" disabled={busy} onClick={() => void step(doCopy)()} /> : null}
      </div>
      <Console lines={con.lines} label="Model output" />
      <p className="max-w-prose leading-relaxed text-slate-700 dark:text-slate-300">
        {t("A real one-shot key would be qubits. The no-cloning theorem says an unknown quantum state cannot be copied, so the copy step above could not happen, and a key that has signed is gone for good. That is the idea; nobody has built it for TET, and the research note says what is open.")}
      </p>
      {con.lines.length ? <RunEnd shows={ONE_SHOT_SHOWS} doesNot={ONE_SHOT_DOES_NOT} /> : null}
    </Demo>
  );
}

/** /research: the permission-language sketch. */
export function PermitSketch() {
  const { t } = useSite();
  const r = useRunner();
  const [text, setText] = useState(SAMPLE);
  const parsed = parse(text);
  return (
    <Demo title="Permits written as sentences" label="Idea">
      <p className="max-w-prose leading-relaxed">
        {t('One rule per line: allow agent "name" to "action" once, before block N. Each line becomes a one-time permit, and the permit check runs on it here.')}
      </p>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">{t("Rules")}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          spellCheck={false}
          className={cx("w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-950", FOCUS)}
        />
      </label>
      {parsed.errors.length ? (
        <ul className="flex flex-col gap-2 text-sm">
          {parsed.errors.map((e, i) => (
            <li key={i}>{e.line ? t("Line {line}: {why}", { line: e.line, why: t(e.why, e.vars) }) : t(e.why, e.vars)}</li>
          ))}
        </ul>
      ) : null}
      <Button
        label={r.state === "running" ? "Running…" : "Run the rules"}
        disabled={r.state === "running" || !parsed.rules.length || parsed.errors.length > 0}
        onClick={() => r.go((log) => runRules({ rules: parsed.rules, t, log, c: REAL_CHECKERS }))}
      />
      <Console lines={r.lines} label="Run output" />
      {r.state === "done" ? <RunEnd shows={PERMIT_LANG_SHOWS} doesNot={PERMIT_LANG_DOES_NOT} /> : null}
    </Demo>
  );
}
