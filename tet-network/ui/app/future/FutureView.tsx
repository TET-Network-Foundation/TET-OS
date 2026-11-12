"use client";

/**
 * "A guess at the 2030s": a concept page in the plain style of the early-2000s web. It follows
 * docs/research/ONE_SHOT_TET.md (status: idea) and claims nothing beyond it. Static: no request,
 * no storage, nothing that pretends anything moved. The send button only opens an explanation.
 *
 * Guarded by scripts/future_concept_guard.mjs: the banner is rendered outside any condition (here
 * and inside the explanation), every figure reads "{n} sample units", the send button only opens
 * the explanation, the three links are present, and the wording stays inside the note.
 */
import { useState } from "react";
import { LangSwitch, useLang } from "../try/i18n";
import s from "./future.module.css";

export const BANNER_EN = "Concept. Nothing here moves value. No token exists. One-shot keys do not run on any machine today.";
export const BANNER_JA = "構想です。ここでは価値は何も動きません。トークンは存在しません。ワンショット鍵は、今日どの機械の上でも動いていません。";
export const BANNER_ZH = "概念示範。這裏沒有任何價值轉移。不存在任何代幣。一次性金鑰今天未有在任何機器上運行。";

const NOTE_URL = "https://github.com/TET-Network-Foundation/TET-OS/blob/main/docs/research/ONE_SHOT_TET.md";
const EPRINT_URL = "https://eprint.iacr.org/2025/486";
const ARXIV_URL = "https://arxiv.org/abs/2510.10899";

/** Sample keys. Fixed: nothing on this page changes them. */
const SAMPLE_KEYS = [
  { id: "A", used: false, units: 100 },
  { id: "B", used: false, units: 40 },
  { id: "C", used: true, units: 0 },
] as const;
const SAMPLE_TOTAL = SAMPLE_KEYS.reduce((a, k) => a + k.units, 0);

/** The banner. Shown at the top of every view and again inside the explanation. */
function Banner() {
  const { lang } = useLang();
  return (
    <div className={s.banner} role="note">
      <p lang="en">{BANNER_EN}</p>
      <p lang="ja">{BANNER_JA}</p>
      {lang === "zh-HK" && <p lang="zh-HK">{BANNER_ZH}</p>}
    </div>
  );
}

/** What "Send" would do. Opened by the send button; it sends nothing and changes nothing. */
function Explanation(props: { onClose: () => void }) {
  const { t } = useLang();
  return (
    <div className={s.explain} role="region" aria-label={t("What \"Send\" would do")} id="future-explanation">
      <Banner />
      <h3>{t("What \"Send\" would do")}</h3>
      <p>
        <b>{t("Nothing was sent. This page made no request and changed nothing; the wallet above is the same as before.")}</b>
      </p>
      <p>{t("In the guess, you would sign one message naming the other person with sample key A, and signing would use the key up. The other person would then hold the note; you would hold no copy to sign with again.")}</p>
      <p>{t("Today no machine can hold such a key. The research note linked below says what has to be checked before this idea leaves \"idea\".")}</p>
      <button type="button" className={s.button} onClick={props.onClose}>
        {t("Close")}
      </button>
    </div>
  );
}

export function FutureView() {
  const { t } = useLang();
  const [explain, setExplain] = useState(false);
  return (
    <div className={s.page}>
      <Banner />
      <div className={s.wrap}>
        <table className={s.head} role="presentation">
          <tbody>
            <tr>
              <td>
                <span className={s.logo}>TET</span> <span className={s.sub}>{t("A guess at the 2030s")}</span>
              </td>
              <td className={s.right}>
                <a href="/try">{t("Back to Try TET")}</a>
                <span className={s.lang}>
                  <LangSwitch />
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <h1>{t("A guess at the 2030s")}</h1>
        <p>{t("This page is a guess, not a plan. Nothing quantum runs in TET, and no part of TET is built or planned around one-shot keys. The page imagines three everyday things as they might look if one-shot signatures ever became practical. The decade is a guess too.")}</p>
        <p className={s.small}>{t("A one-shot signature is a quantum secret key that can sign exactly one message: signing uses the key up, and because a quantum state cannot be copied, there is no second copy to sign with. The idea is from Amos, Georgiou, Kiayias and Zhandry (STOC 2020).")}</p>

        <div className={s.box}>
          <h2>{t("A wallet of one-time keys")}</h2>
          <p>{t("Each key can sign once. Signing uses it up; there is no copy left to sign with again.")}</p>
          <table className={s.grid}>
            <thead>
              <tr>
                <th>{t("Key")}</th>
                <th>{t("State")}</th>
                <th>{t("Holds")}</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_KEYS.map((k) => (
                <tr key={k.id}>
                  <td>{t("Sample key {k}", { k: k.id })}</td>
                  <td>{k.used ? t("used: signed once, nothing left to sign with") : t("unused: can sign once")}</td>
                  <td>{k.used ? t("nothing") : t("{n} sample units", { n: k.units })}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2}>
                  <b>{t("Total")}</b>
                </td>
                <td>
                  <b>{t("{n} sample units", { n: SAMPLE_TOTAL })}</b>
                </td>
              </tr>
            </tbody>
          </table>
          <p className={s.small}>{t("Today TET's one-time permissions are detectable, not impossible: a second use is caught by whoever keeps the record (a node, a reader, a site). A one-shot key would make the second signature impossible to make, for the signer it limits.")}</p>
        </div>

        <div className={s.box}>
          <h2>{t("Handing a note to another person, without a ledger")}</h2>
          <p>{t("The guess: a note is a one-shot key. Handing it over means signing one message that names the other person. After that you hold nothing to sign with, so no ledger has to record that you didn't hand it to two people.")}</p>
          <table className={s.grid}>
            <tbody>
              <tr>
                <th>{t("Note")}</th>
                <td>
                  {t("Sample note from sample key A")} ({t("{n} sample units", { n: SAMPLE_KEYS[0].units })})
                </td>
              </tr>
              <tr>
                <th>{t("To")}</th>
                <td>{t("Another person (sample)")}</td>
              </tr>
            </tbody>
          </table>
          <p>
            <button type="button" id="future-send" className={s.button} aria-controls="future-explanation" onClick={() => setExplain(true)}>
              {t("Send")}
            </button>{" "}
            <span className={s.small}>{t("Opens an explanation. Nothing is sent.")}</span>
          </p>
          {explain && <Explanation onClose={() => setExplain(false)} />}
          <p className={s.small}>{t("What this would not replace: ordering (\"existed before block N\") still comes from a chain, and a one-shot key limits how often something is said, not whether it is true.")}</p>
        </div>

        <div className={s.box}>
          <h2>{t("A check that says what it shows")}</h2>
          <p>{t("Checking a signature made with sample key A:")}</p>
          <table className={s.grid}>
            <thead>
              <tr>
                <th>{t("Shows")}</th>
                <th>{t("Does not show")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <ul>
                    <li>{t("Which key signed, and that the signature matches this one message.")}</li>
                    <li>{t("That the key was a one-shot key: if the idea works as described, it cannot have signed anything else.")}</li>
                  </ul>
                </td>
                <td>
                  <ul>
                    <li>{t("Who holds the key, or who held it.")}</li>
                    <li>{t("Whether what the message says is true. A one-shot key limits how often something is said, not whether it is true.")}</li>
                    <li>{t("When it was signed. \"Existed before block N\" still comes from a chain.")}</li>
                    <li>{t("Which member acted, among many. A one-shot key limits a signer; it does not hide one among many. That is a different tool's job.")}</li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={s.box}>
          <h2>{t("Read more")}</h2>
          <ul>
            <li>
              <a href={NOTE_URL} target="_blank" rel="noopener noreferrer">
                {t("One-shot TET: the research note this page follows (status: idea)")}
              </a>
            </li>
            <li>
              <a href={EPRINT_URL} target="_blank" rel="noopener noreferrer" translate="no">
                IACR ePrint 2025/486
              </a>
            </li>
            <li>
              <a href={ARXIV_URL} target="_blank" rel="noopener noreferrer" translate="no">
                arXiv 2510.10899
              </a>
            </li>
          </ul>
          <p className={s.small}>{t("Two references the owner asked to be read with the idea. Neither was opened when the research note was written, and this page does not describe them.")}</p>
        </div>
        <hr />
        <p className={s.small}>{t("A concept page. Every figure on it is a sample.")}</p>
      </div>
    </div>
  );
}
