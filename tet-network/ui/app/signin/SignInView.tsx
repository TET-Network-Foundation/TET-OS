"use client";

/**
 * The /signin page body, in the plain kit. Rules, each held by scripts/signin_demo_guard.mjs:
 * - one plain sentence says what the page is for; technical words live only behind "Show details";
 * - "Try with a sample" plays the bundled recording step by step and sends nothing;
 * - the result comes first (a colour, ACCEPTED / REFUSED, one short sentence), Shows / Does not show
 *   on every result;
 * - it talks to one host only, 127.0.0.1 (the prototype binds to the loopback address);
 * - "What a site sees" shows a key, a question and a verdict: never a name, never who;
 * - "Your records" reads this browser's storage through device_store and writes nothing. The whole
 *   page writes nothing: the language links use `?lang=`, which LangProvider reads and does not store.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getUi, hasRememberedKey } from "../lib/device_store";
import { translate, useLang } from "../try/i18n";
import { Details, PlainCard, PlainLead, PlainPage, PrimaryButton, ResultCard, SecondaryButton, ShowsBlock } from "../components/plain/Plain";
import {
  DEFAULT_PORT,
  DOES_NOT_SHOW,
  LEAD,
  LIMIT_LINE,
  PAYLOAD_TYPE,
  SAMPLE_LABEL,
  SCENARIOS,
  SHOWS,
  SIGNIN_HOST,
  STATUS_LINE,
  asPort,
  canonical,
  challengeUrl,
  deviceCommand,
  siteSees,
  verdict,
  type Scenario,
} from "./signin_text";

const pre = "mt-2 overflow-x-auto whitespace-pre rounded-lg bg-slate-100 p-3 font-mono text-[12.5px] leading-relaxed text-slate-900 dark:bg-slate-800 dark:text-slate-100";
const h2 = "text-xl font-semibold";
const quiet = "text-base leading-relaxed text-slate-700 dark:text-slate-300";
const link = "underline underline-offset-4 outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50";

type Probe = "idle" | "checking" | "none" | "unreadable" | "readable" | "badport";

/** Live mode: is the prototype at 127.0.0.1:port, and can this page read it? Asks /challenge only. */
async function probe(port: number): Promise<Exclude<Probe, "idle" | "checking" | "badport">> {
  const url = challengeUrl(port);
  const timed = () => {
    const c = new AbortController();
    setTimeout(() => c.abort(), 3000);
    return c.signal;
  };
  try {
    // An opaque request: it succeeds when anything answers, whether or not the page may read it.
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: timed() });
  } catch {
    return "none";
  }
  try {
    const r = await fetch(url, { cache: "no-store", signal: timed() });
    await r.json();
    return "readable";
  } catch {
    return "unreadable";
  }
}

function LiveCheck() {
  const { t } = useLang();
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [state, setState] = useState<Probe>("idle");
  const p = asPort(port);
  const run = async () => {
    if (p === null) return setState("badport");
    setState("checking");
    setState(await probe(p));
  };
  return (
    <PlainCard>
      <h2 id="live" className={h2}>
        {t("Second option: a server on this computer")}
      </h2>
      <p className={`mt-2 ${quiet}`}>{t("Live mode talks only to the prototype server on this computer, at 127.0.0.1. Start it with:")}</p>
      <pre className={pre}>python3 tools/sign-in/signin.py serve --domain example.test --port {p ?? DEFAULT_PORT}</pre>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-base">
          <span className="block">{t("Port on 127.0.0.1")}</span>
          <input
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="mt-1 min-h-12 w-32 rounded-xl border border-slate-300 bg-white px-3 font-mono text-base outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50 dark:border-slate-600 dark:bg-slate-900"
          />
        </label>
        <SecondaryButton onClick={run} disabled={state === "checking"}>
          {t("Check {host}:{port}", { host: SIGNIN_HOST, port: p ?? port })}
        </SecondaryButton>
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t("Checking asks the server for a challenge, which counts toward the expiry of the others.")}</p>
      <p role="status" className="mt-3 text-base font-medium">
        {state === "checking" && t("Checking…")}
        {state === "badport" && t("That isn't a port (1 to 65535).")}
        {state === "none" && t("Nothing answered at {host}:{port}. Try the sample above instead.", { host: SIGNIN_HOST, port: p ?? port })}
        {state === "unreadable" &&
          t("Something answered at {host}:{port}, but this page can't read the answer: signin.py sends no CORS headers, so the browser keeps its answers from other pages. Try the sample above instead.", { host: SIGNIN_HOST, port: p ?? port })}
        {state === "readable" && t("This page can read the server's answer, but signing in from this page isn't built: it would need a key in this tab. Try the sample above instead.")}
      </p>
      <p className={`mt-3 ${quiet}`}>
        {t("Why live mode can't finish here today: signin.py sends no CORS headers and doesn't answer the browser's check before a POST, and this page holds no key to sign with. Changing either is a separate step that needs review.")}
      </p>
    </PlainCard>
  );
}

/** A step of the sample, revealed in turn. */
function Step(props: { title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1">
      <h3 className="text-lg font-semibold">{props.title}</h3>
      {props.children}
    </li>
  );
}

// <sample> (signin_demo_guard: plays the bundled recording only; nothing here sends anything)
const STEP_MS = 900;
function SamplePlayer(props: { s: Scenario; step: number }) {
  const { t } = useLang();
  const { s, step } = props;
  const v = verdict(s);
  const fold = { label: t("Show details"), hideLabel: t("Hide details") };
  return (
    <ol aria-live="polite" className="mt-6 flex flex-col gap-6">
      {step >= 1 && (
        <Step title={t("1. The site asks a question")}>
          <p className={quiet}>{t("example.test sends your device a one-time question to sign.")}</p>
          <Details {...fold}>
            <p>{t("What the server sent (GET /challenge); the nonce makes the question one-time:")}</p>
            <pre className={pre}>{s.served}</pre>
          </Details>
        </Step>
      )}
      {step >= 2 && (
        <Step title={t("2. Your key answers")}>
          <p className={quiet}>
            {t(s.what)} {t("The 12 words never leave your device.")}
          </p>
          <Details {...fold}>
            <p>{t("The exact bytes signed: the challenge as canonical JSON, with sorted keys and no spaces.")}</p>
            <pre className={pre}>{canonical(s.signed)}</pre>
            <p className="mt-3">
              {t("The commands the device ran, with tet-cli. The answer is an AgentSigEnvelopeV1 envelope with payload type {type}; the chain is signin.py's example chain, which no node runs.", { type: PAYLOAD_TYPE })}
            </p>
            <pre className={pre}>{deviceCommand(s.signed)}</pre>
          </Details>
        </Step>
      )}
      {step >= 3 && (
        <Step title={t("3. The site's verdict")}>
          <ResultCard
            tone={v.tone}
            label={v.label}
            sentence={t(v.sentence)}
            detailsLabel={fold.label}
            hideLabel={fold.hideLabel}
            details={
              <>
                <p>{t("The server's answer, in the prototype's words (HTTP {status}):", { status: s.status })}</p>
                <pre className={pre}>{s.answer}</pre>
              </>
            }
          >
            <ShowsBlock showsTitle={t("Shows")} doesNotTitle={t("Does not show")} shows={SHOWS.map((x) => t(x))} doesNot={DOES_NOT_SHOW.map((x) => t(x))} />
          </ResultCard>
        </Step>
      )}
    </ol>
  );
}

function TrySample(props: { s: Scenario; step: number; play: (s: Scenario) => void; live: () => void }) {
  const { t } = useLang();
  const { s, step, play } = props;
  return (
    <PlainCard>
      <div className="flex flex-wrap gap-3">
        <PrimaryButton onClick={() => play(SCENARIOS[0])}>{t("Try with a sample")}</PrimaryButton>
        <SecondaryButton onClick={props.live}>{t("Or check a server on this computer")}</SecondaryButton>
      </div>
      <p className={`mt-3 ${quiet}`}>{t(SAMPLE_LABEL)}</p>
      {step >= 3 && (
        <div className="mt-5">
          <p className="text-base font-medium">{t("Try another case:")}</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group">
            {SCENARIOS.map((x) => (
              <SecondaryButton key={x.id} onClick={() => play(x)}>
                {(x.id === s.id ? "✓ " : "") +
                  (x.id === "accepted" ? t("Answer once") : x.id === "replay" ? t("Send the same answer again") : x.id === "domain" ? t("Answer for another site") : t("Answer too late"))}
              </SecondaryButton>
            ))}
          </div>
        </div>
      )}
      <SamplePlayer s={s} step={step} />
      <p className="mt-6 border-l-4 border-rose-700 pl-3 text-base font-semibold dark:border-rose-400">{t(LIMIT_LINE)}</p>
    </PlainCard>
  );
}
// </sample>

// <site-sees> (signin_demo_guard: only siteSees() fields; no name, no "who")
function SiteSeesColumn(props: { s: Scenario }) {
  const { t } = useLang();
  const v = siteSees(props.s);
  return (
    <PlainCard>
      <h2 id="sees" className={h2}>
        {t("What a site sees")}
      </h2>
      <p className={`mt-2 ${quiet}`}>{t("This key answered this question for this site:")}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
        <dt className="text-slate-600 dark:text-slate-400">{t("key")}</dt>
        <dd className="break-all font-mono text-sm">{v.keyId}</dd>
        <dt className="text-slate-600 dark:text-slate-400">{t("site")}</dt>
        <dd className="break-all font-mono text-sm">{v.domain}</dd>
        <dt className="text-slate-600 dark:text-slate-400">{t("result")}</dt>
        <dd translate="no" className="font-mono text-sm font-bold">
          {v.verdict === "accepted" ? "ACCEPTED" : "REFUSED"}
        </dd>
      </dl>
      <Details label={t("Show details")} hideLabel={t("Hide details")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt>{t("nonce (the question's one-time code)")}</dt>
          <dd className="break-all font-mono text-sm">{v.nonce}</dd>
          <dt>expires_seq</dt>
          <dd className="font-mono text-sm">{v.expiresSeq}</dd>
          <dt>{t("verdict, in the prototype's words")}</dt>
          <dd className="break-words font-mono text-sm">{v.verdict}</dd>
        </dl>
      </Details>
    </PlainCard>
  );
}
// </site-sees>

// <your-records> (signin_demo_guard: reads only; no writes, no removal)
type Kept = { lang: string | null; visited: boolean; idRemembered: boolean };
function readKept(): Kept {
  return { lang: getUi("tet.ui.v1.lang"), visited: getUi("tet.ui.v1.visited") !== null, idRemembered: hasRememberedKey() };
}

function YourRecordsColumn() {
  const { t } = useLang();
  const [kept, setKept] = useState<Kept | null>(null);
  useEffect(() => {
    const t0 = setTimeout(() => setKept(readKept()), 0);
    return () => clearTimeout(t0);
  }, []);
  return (
    <PlainCard>
      <h2 id="records" className={h2}>
        {t("Your records")}
      </h2>
      <p className="mt-2 text-base font-semibold">{t("This page saves nothing in your browser.")}</p>
      <p className={`mt-1 ${quiet}`}>{t("Stamps and signatures you make on /try aren't saved here either: they stay in that tab until you download them.")}</p>
      <p className={`mt-3 ${quiet}`}>{t("What /try does keep in this browser, read without changing anything:")}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-base">
        <li>{kept === null ? t("Reading…") : kept.lang ? t("Language choice: {lang}", { lang: kept.lang }) : t("Language choice: none saved")}</li>
        <li>{kept === null ? t("Reading…") : kept.visited ? t("Visited /try before: yes") : t("Visited /try before: not recorded")}</li>
        <li>{kept === null ? t("Reading…") : kept.idRemembered ? t("An ID remembered on this device, encrypted with your device password: yes") : t("An ID remembered on this device, encrypted with your device password: no")}</li>
      </ul>
      <p className="mt-3 text-base">
        {t("To check a signature file you saved:")}{" "}
        <a className={link} href="/try?tab=verify">
          {t("the verify tab on /try")}
        </a>
        {" · "}
        <a className={link} href="/verify/tet-verify.html">
          {t("or offline, with tet-verify.html")}
        </a>
      </p>
    </PlainCard>
  );
}
// </your-records>

/** The status line, in English and Japanese always (and Hong Kong Chinese when chosen). */
function StatusLine() {
  const { lang } = useLang();
  return (
    <span role="note" className="flex flex-col font-semibold">
      <span>{STATUS_LINE}</span>
      <span lang="ja">{translate("ja", STATUS_LINE)}</span>
      {lang === "zh-HK" && <span lang="zh-HK">{translate("zh-HK", STATUS_LINE)}</span>}
    </span>
  );
}

export function SignInView() {
  const { t, lang } = useLang();
  const [s, setS] = useState<Scenario>(SCENARIOS[0]);
  const [step, setStep] = useState(0);
  const [live, setLive] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const play = (x: Scenario) => {
    timers.current.forEach(clearTimeout);
    setS(x);
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return setStep(3);
    setStep(1);
    timers.current = [setTimeout(() => setStep(2), STEP_MS), setTimeout(() => setStep(3), 2 * STEP_MS)];
  };
  return (
    <PlainPage>
      <PlainLead status={<StatusLine />} title={t("Sign in with TET")} lead={t(LEAD)} />
      <nav className="flex flex-wrap gap-4 text-base" aria-label={t("Language")}>
        {(
          [
            ["en", "English"],
            ["ja", "日本語"],
            ["zh-HK", "繁體中文（香港）"],
          ] as const
        ).map(([id, label]) => (
          <a key={id} href={`?lang=${id}`} aria-current={lang === id ? "true" : undefined} className={`${link} ${lang === id ? "font-semibold no-underline" : ""}`}>
            {label}
          </a>
        ))}
      </nav>
      <TrySample s={s} step={step} play={play} live={() => setLive(!live)} />
      {live && <LiveCheck />}
      {step >= 3 && <SiteSeesColumn s={s} />}
      <YourRecordsColumn />
    </PlainPage>
  );
}
