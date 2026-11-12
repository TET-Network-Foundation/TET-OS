"use client";

/**
 * The /signin page body. Three rules, each held by scripts/signin_demo_guard.mjs:
 * - it talks to one host only, 127.0.0.1 (the prototype binds to the loopback address);
 * - "What a site sees" shows a key id, a challenge and a verdict: never a name, never who;
 * - "Your records" reads this browser's storage through device_store and writes nothing. The whole
 *   page writes nothing: the language links use `?lang=`, which LangProvider reads and does not store.
 */
import { useEffect, useState } from "react";
import { getUi, hasRememberedKey } from "../lib/device_store";
import { translate, useLang } from "../try/i18n";
import { FOCUS, INK, MONO, cx } from "../try/ui";
import {
  DEFAULT_PORT,
  DOES_NOT_SHOW,
  LIMIT_LINE,
  SCENARIOS,
  SHOWS,
  SIGNIN_HOST,
  STATUS_LINE,
  WALKTHROUGH_LABEL,
  asPort,
  canonical,
  challengeUrl,
  deviceCommand,
  siteSees,
  type Scenario,
} from "./signin_text";

const card = "rounded-md border border-[#d5d9de] bg-white p-4 sm:p-5";
const h2 = "text-[17px] font-semibold text-[#1c1f23]";
const pre = cx(MONO, "overflow-x-auto whitespace-pre rounded bg-[#f1f3f5] p-3 text-[12.5px] leading-relaxed text-[#1c1f23]");
const link = cx(FOCUS, "underline underline-offset-2 text-[#1a237e]");

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
    <section className={card} aria-labelledby="live">
      <h2 id="live" className={h2}>
        {t("Live mode: this computer only")}
      </h2>
      <p className="mt-1 text-[14.5px] text-[#3c434b]">{t("Live mode talks only to the prototype server on this computer, at 127.0.0.1. Start it with:")}</p>
      <pre className={cx(pre, "mt-2")}>python3 tools/sign-in/signin.py serve --domain example.test --port {p ?? DEFAULT_PORT}</pre>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-[14px] text-[#3c434b]">
          <span className="block">{t("Port on 127.0.0.1")}</span>
          <input
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className={cx(FOCUS, MONO, "mt-1 min-h-10 w-28 rounded-md border border-[#c9ced4] bg-white px-2 text-[15px]")}
          />
        </label>
        <button type="button" onClick={run} disabled={state === "checking"} className={cx(FOCUS, "min-h-10 rounded-md bg-[#1a237e] px-4 text-[14.5px] font-medium text-white disabled:opacity-60")}>
          {t("Check {host}:{port}", { host: SIGNIN_HOST, port: p ?? port })}
        </button>
      </div>
      <p className="mt-2 text-[13px] text-[#5d646d]">{t("Checking asks the server for a challenge, which counts toward the expiry of the others.")}</p>
      <p role="status" className="mt-2 text-[14.5px]">
        {state === "checking" && <span className={INK.pending}>{t("Checking…")}</span>}
        {state === "badport" && <span className={INK.bad}>{t("That isn't a port (1 to 65535).")}</span>}
        {state === "none" && <span className={INK.neutral}>{t("Nothing answered at {host}:{port}. Showing the walkthrough.", { host: SIGNIN_HOST, port: p ?? port })}</span>}
        {state === "unreadable" && (
          <span className={INK.pending}>
            {t("Something answered at {host}:{port}, but this page can't read the answer: signin.py sends no CORS headers, so the browser keeps its answers from other pages. Showing the walkthrough.", { host: SIGNIN_HOST, port: p ?? port })}
          </span>
        )}
        {state === "readable" && <span className={INK.pending}>{t("This page can read the server's answer, but signing in from this page isn't built: it would need a key in this tab. Use the commands in the walkthrough.")}</span>}
      </p>
      <p className="mt-3 text-[13.5px] text-[#5d646d]">
        {t("Why live mode can't finish here today: signin.py sends no CORS headers and doesn't answer the browser's check before a POST, and this page holds no key to sign with. Changing either is a separate step that needs review.")}
      </p>
    </section>
  );
}

function Walkthrough(props: { s: Scenario; pick: (s: Scenario) => void }) {
  const { t, lang } = useLang();
  const { s } = props;
  return (
    <section className={card} aria-labelledby="walk">
      <h2 id="walk" className={h2}>
        {WALKTHROUGH_LABEL}
      </h2>
      <p lang="ja" className="text-[15px] font-semibold text-[#1c1f23]">
        {translate("ja", WALKTHROUGH_LABEL)}
      </p>
      {lang === "zh-HK" && (
        <p lang="zh-HK" className="text-[15px] font-semibold text-[#1c1f23]">
          {translate("zh-HK", WALKTHROUGH_LABEL)}
        </p>
      )}
      <p className="mt-2 text-[14.5px] text-[#3c434b]">{t("Recorded from a real run of signin.py on 127.0.0.1, with a throwaway key. Pick a case:")}</p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
        {SCENARIOS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="radio"
            aria-checked={x.id === s.id}
            onClick={() => props.pick(x)}
            className={cx(FOCUS, "min-h-9 rounded-md border px-3 text-[14px]", x.id === s.id ? "border-[#1a237e] bg-[#1a237e] text-white" : "border-[#c9ced4] bg-white text-[#1c1f23]")}
          >
            {x.id === "accepted" ? t("Answered once") : x.id === "replay" ? t("Posted again") : x.id === "domain" ? t("Wrong domain") : t("Too late")}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[14.5px]">{t(s.what)}</p>
      <ol className="mt-3 space-y-4">
        <li>
          <h3 className="text-[14.5px] font-semibold">{t("1. The site issues a challenge (GET /challenge):")}</h3>
          <pre className={cx(pre, "mt-1")}>{s.served}</pre>
          <p className="mt-2 text-[13.5px] text-[#3c434b]">{t("The device signs these exact bytes: the challenge with sorted keys and no spaces.")}</p>
          <pre className={cx(pre, "mt-1")}>{canonical(s.signed)}</pre>
        </li>
        <li>
          <h3 className="text-[14.5px] font-semibold">{t("2. The device signs it with tet-cli and posts the envelope:")}</h3>
          <pre className={cx(pre, "mt-1")}>{deviceCommand(s.signed)}</pre>
          <p className="mt-2 text-[13.5px] text-[#3c434b]">{t("The chain id is signin.py's example chain, which no node runs. The 12 words stay on the device.")}</p>
        </li>
        <li>
          <h3 className="text-[14.5px] font-semibold">{t("3. The server answers, in the prototype's words (HTTP {status}):", { status: s.status })}</h3>
          <pre className={cx(pre, "mt-1")}>{s.answer}</pre>
        </li>
      </ol>
    </section>
  );
}

// <site-sees> (signin_demo_guard: only siteSees() fields; no name, no "who")
function SiteSeesColumn(props: { s: Scenario }) {
  const { t } = useLang();
  const v = siteSees(props.s);
  const ok = v.verdict === "accepted";
  return (
    <section className={card} aria-labelledby="sees">
      <h2 id="sees" className={h2}>
        {t("What a site sees")}
      </h2>
      <p className="mt-1 text-[14.5px] text-[#3c434b]">{t("This key answered this challenge for this domain:")}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[14px]">
        <dt className="text-[#5d646d]">{t("key id")}</dt>
        <dd className={cx(MONO, "break-all text-[13px]")}>{v.keyId}</dd>
        <dt className="text-[#5d646d]">{t("domain")}</dt>
        <dd className={cx(MONO, "break-all text-[13px]")}>{v.domain}</dd>
        <dt className="text-[#5d646d]">{t("nonce")}</dt>
        <dd className={cx(MONO, "break-all text-[13px]")}>{v.nonce}</dd>
        <dt className="text-[#5d646d]">expires_seq</dt>
        <dd className={cx(MONO, "text-[13px]")}>{v.expiresSeq}</dd>
        <dt className="text-[#5d646d]">{t("verdict")}</dt>
        <dd className={cx(MONO, "break-words text-[13px] font-semibold", ok ? INK.ok : INK.bad)}>{v.verdict}</dd>
      </dl>
    </section>
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
    <section className={card} aria-labelledby="records">
      <h2 id="records" className={h2}>
        {t("Your records")}
      </h2>
      <p className="mt-1 text-[14.5px] font-semibold">{t("Stamps and signatures from /try in this browser: none.")}</p>
      <p className="mt-1 text-[14px] text-[#3c434b]">
        {t("/try doesn't keep them here. When you sign or stamp on /try, the result stays in that tab until you download its signature file; none of it is written to this browser's storage.")}
      </p>
      <p className="mt-3 text-[14px] text-[#3c434b]">{t("What /try does keep in this browser, read without changing anything:")}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px]">
        <li>{kept === null ? t("Reading…") : kept.lang ? t("Language choice: {lang}", { lang: kept.lang }) : t("Language choice: none saved")}</li>
        <li>{kept === null ? t("Reading…") : kept.visited ? t("Visited /try before: yes") : t("Visited /try before: not recorded")}</li>
        <li>{kept === null ? t("Reading…") : kept.idRemembered ? t("An ID remembered on this device, encrypted with your device password: yes") : t("An ID remembered on this device, encrypted with your device password: no")}</li>
      </ul>
      <p className="mt-3 text-[14px]">
        {t("To check a signature file you saved:")}{" "}
        <a className={link} href="/try?tab=verify">
          {t("the verify tab on /try")}
        </a>
        {" · "}
        <a className={link} href="/verify/tet-verify.html">
          {t("or offline, with tet-verify.html")}
        </a>
      </p>
    </section>
  );
}
// </your-records>

function StatusBanner() {
  const { lang } = useLang();
  return (
    <div role="note" className="border-b-2 border-[#6b4e00] bg-[#fff6dc] px-4 py-3 text-[15px] font-semibold text-[#3d2c00]">
      <div className="mx-auto max-w-[1100px]">
        <p>{STATUS_LINE}</p>
        <p lang="ja">{translate("ja", STATUS_LINE)}</p>
        {lang === "zh-HK" && <p lang="zh-HK">{translate("zh-HK", STATUS_LINE)}</p>}
      </div>
    </div>
  );
}

export function SignInView() {
  const { t, lang } = useLang();
  const [s, setS] = useState<Scenario>(SCENARIOS[0]);
  return (
    <div className="min-h-screen bg-[#f7f7f5] text-[#1c1f23]">
      <StatusBanner />
      <main className="mx-auto max-w-[1100px] space-y-5 px-4 py-6">
        <header>
          <nav className="mb-2 flex flex-wrap gap-3 text-[13.5px]" aria-label={t("Language")}>
            {(
              [
                ["en", "English"],
                ["ja", "日本語"],
                ["zh-HK", "繁體中文（香港）"],
              ] as const
            ).map(([id, label]) => (
              <a key={id} href={`?lang=${id}`} aria-current={lang === id ? "true" : undefined} className={cx(link, lang === id && "font-semibold no-underline")}>
                {label}
              </a>
            ))}
          </nav>
          <h1 className="text-[26px] font-semibold">{t("Sign in with TET")}</h1>
          <p className="mt-1 max-w-[70ch] text-[15px] text-[#3c434b]">
            {t("A site sends a challenge; your device signs it with your key; the site checks the signature. This page shows the local prototype in tools/sign-in.")}
          </p>
        </header>
        <LiveCheck />
        <Walkthrough s={s} pick={setS} />
        <div className="grid gap-5 md:grid-cols-2">
          <SiteSeesColumn s={s} />
          <YourRecordsColumn />
        </div>
        <section className={card} aria-labelledby="limits">
          <h2 id="limits" className={h2}>
            {t("Shows")}
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[14.5px]">
            {SHOWS.map((x) => (
              <li key={x}>{t(x)}</li>
            ))}
          </ul>
          <h2 className={cx(h2, "mt-4")}>{t("Does not show")}</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[14.5px]">
            {DOES_NOT_SHOW.map((x) => (
              <li key={x}>{t(x)}</li>
            ))}
          </ul>
          <p className="mt-4 border-l-4 border-[#8a1f1f] pl-3 text-[15px] font-semibold">{t(LIMIT_LINE)}</p>
        </section>
      </main>
    </div>
  );
}
