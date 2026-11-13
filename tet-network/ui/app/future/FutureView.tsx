"use client";

/**
 * "A guess at the 2030s": a concept page for one-shot keys. It follows docs/research/ONE_SHOT_TET.md
 * (status: idea) and claims nothing beyond it. Built from the plain kit (app/components/plain).
 *
 * The sample wallet lives only in this component's state (wallet_model.ts holds the rules): no
 * request, no storage, no real key, no real value. Reloading the page forgets it.
 *
 * Guarded by scripts/future_concept_guard.mjs: the lead sentence, the banner on every view (one
 * return, the banner outside any condition), the model line under the wallet, every figure as
 * "{n} sample units", the state only changed through wallet_model.ts, no request or storage, the
 * Shows / Does not show lists, the three links, and the wording.
 */
import { useState, type ReactNode } from "react";
import { Details, PlainCard, PlainLead, PlainPage, PrimaryButton, ResultCard, SecondaryButton, ShowsBlock } from "../components/plain/Plain";
import { LangSwitch, useLang } from "../try/i18n";
import s from "./future.module.css";
import { handOver, makeSampleWallets, sideTotals, type HandResult, type SampleWallets } from "./wallet_model";

export const BANNER_EN = "Concept. Nothing here moves value. No token exists. One-shot keys do not run on any machine today.";
export const BANNER_JA = "構想です。ここでは価値は何も動きません。トークンは存在しません。ワンショット鍵は、今日どの機械の上でも動いていません。";
export const BANNER_ZH = "概念示範。這裏沒有任何價值轉移。不存在任何代幣。一次性金鑰今天未有在任何機器上運行。";

const NOTE_URL = "https://github.com/TET-Network-Foundation/TET-OS/blob/main/docs/research/ONE_SHOT_TET.md";
const EPRINT_URL = "https://eprint.iacr.org/2025/486";
const ARXIV_URL = "https://arxiv.org/abs/2510.10899";

const H2 = "text-xl font-semibold sm:text-2xl";
const TEXT = "mt-2 text-base leading-relaxed text-slate-700 sm:text-lg dark:text-slate-300";
const LINK = "font-medium text-teal-800 underline underline-offset-4 dark:text-teal-300";

/** The banner. Rendered once, unconditionally, at the top of the page's only view; it stays in sight. */
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

/** One side of the sample: the visitor's keys, or the notes that arrived with the other person. */
function Side(props: { title: string; total: string; children: ReactNode }) {
  const { t } = useLang();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <h3 className="text-lg font-semibold">{props.title}</h3>
      <ul className="flex flex-col gap-2">{props.children}</ul>
      <p className="mt-auto border-t border-slate-200 pt-2 text-base dark:border-slate-700">
        <span className="font-semibold">{t("Total")}</span>: {props.total}
      </p>
    </div>
  );
}

export function FutureView() {
  const { t } = useLang();
  const [wallets, setWallets] = useState<SampleWallets | null>(null);
  const [last, setLast] = useState<HandResult | null>(null);

  function start() {
    setWallets(makeSampleWallets());
    setLast(null);
  }
  function hand(id: string) {
    if (wallets) {
      const r = handOver(wallets, id);
      setWallets(r.wallets);
      setLast(r);
    }
  }
  const totals = wallets ? sideTotals(wallets) : null;

  return (
    <>
      <Banner />
      <PlainPage>
        <nav className="flex flex-wrap items-center justify-between gap-3 text-base">
          <span className={s.logo}>TET</span>
          <span className="flex flex-wrap items-center gap-4">
            <a className={LINK} href="/try">
              {t("Back to Try TET")}
            </a>
            <LangSwitch />
          </span>
        </nav>

        <PlainLead
          status={t("Concept")}
          title={t("A guess at the 2030s")}
          lead={t("This page lets you try a sample wallet whose keys each work only once, so you can see what that idea would change and what it would not.")}
        />

        <PlainCard>
          <h2 className={H2}>{t("A sample wallet of one-time keys")}</h2>
          <p className={TEXT}>{t("Each key holds one note and can hand it over once. Handing it over uses the key up.")}</p>
          <div className="mt-5 flex flex-col gap-5">
            {wallets === null ? (
              <div>
                <PrimaryButton onClick={start}>{t("Try with a sample")}</PrimaryButton>
              </div>
            ) : null}
            {last ? (
              last.ok ? (
                <ResultCard
                  tone="ok"
                  label={t("Handed over")}
                  sentence={t("The note arrived with the other person, once. Your key is now used up.")}
                  detailsLabel={t("Show details")}
                  hideLabel={t("Hide details")}
                  details={
                    <p>
                      {t("Sample key {k}", { k: last.key })}: {t("{n} sample units", { n: last.units })}.{" "}
                      {t("Nothing left this page: no request was made and nothing was stored. Reload the page and the sample is gone.")}
                    </p>
                  }
                />
              ) : (
                <ResultCard
                  tone="bad"
                  label={t("Refused")}
                  sentence={t("That key is used up, so it cannot hand a second note. Nothing changed.")}
                  detailsLabel={t("Show details")}
                  hideLabel={t("Hide details")}
                  details={<p>{t("Here the refusal is only this page's rule. In the guess, a used one-shot key would have nothing left to sign with.")}</p>}
                />
              )
            ) : null}
            {wallets && totals ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Side title={t("You (sample)")} total={t("{n} sample units", { n: totals.mine })}>
                  {wallets.mine.map((k) => (
                    <li
                      key={k.id}
                      data-key={k.id}
                      data-used={k.used ? "yes" : "no"}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 dark:bg-slate-900"
                    >
                      <span className={k.used ? "text-slate-500 line-through dark:text-slate-400" : "font-medium"}>
                        {t("Sample key {k}", { k: k.id })} · {t("Holds")}: {k.used ? t("nothing") : t("{n} sample units", { n: k.units })}
                      </span>
                      {k.used ? (
                        <span className="flex items-center gap-2">
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">{t("Used")}</span>
                          <button type="button" className={`text-sm underline underline-offset-4 ${s.quiet}`} onClick={() => hand(k.id)}>
                            {t("Try to hand it again")}
                          </button>
                        </span>
                      ) : (
                        <SecondaryButton onClick={() => hand(k.id)}>{t("Hand this note over")}</SecondaryButton>
                      )}
                    </li>
                  ))}
                </Side>
                <Side title={t("Another person (sample)")} total={t("{n} sample units", { n: totals.theirs })}>
                  {wallets.theirs.length === 0 ? <li className="text-base text-slate-600 dark:text-slate-400">{t("Nothing has arrived yet.")}</li> : null}
                  {wallets.theirs.map((n) => (
                    <li key={n.from} data-from={n.from} className="rounded-lg bg-white p-3 font-medium dark:bg-slate-900">
                      {t("Note from sample key {k}", { k: n.from })} · {t("{n} sample units", { n: n.units })}
                    </li>
                  ))}
                </Side>
              </div>
            ) : null}
            {wallets ? (
              <div>
                <SecondaryButton onClick={start}>{t("Start again")}</SecondaryButton>
              </div>
            ) : null}
          </div>
          <p className="mt-5 rounded-xl border-l-4 border-teal-600 bg-teal-50 p-4 text-base leading-relaxed text-teal-950 sm:text-lg dark:border-teal-400 dark:bg-teal-950 dark:text-teal-50" id="future-model-line">
            {t("This is a model on an ordinary computer, so a copy could be used twice. A real one-shot key could not be copied. That difference is the whole idea.")}
          </p>
        </PlainCard>

        <PlainCard>
          <h2 className={H2}>{t("Handing a note over, without a ledger")}</h2>
          <p className={TEXT}>{t("The guess: a note is a one-shot key. Handing it over means signing one message that names the other person. After that you hold nothing to sign with, so no ledger has to record that you didn't hand it to two people.")}</p>
          <Details label={t("Show details")} hideLabel={t("Hide details")}>
            <p>{t("A one-shot signature is a quantum secret key that can sign exactly one message: signing uses the key up, and because a quantum state cannot be copied, there is no second copy to sign with. The idea is from Amos, Georgiou, Kiayias and Zhandry (STOC 2020).")}</p>
            <p className="mt-3">{t("Today TET's one-time permissions are detectable, not impossible: a second use is caught by whoever keeps the record (a node, a reader, a site). A one-shot key would make the second signature impossible to make, for the signer it limits.")}</p>
            <p className="mt-3">{t("What this would not replace: ordering (\"existed before block N\") still comes from a chain, and a one-shot key limits how often something is said, not whether it is true.")}</p>
            <p className="mt-3">{t("This page is a guess, not a plan. Nothing quantum runs in TET, and no part of TET is built or planned around one-shot keys. The decade is a guess too.")}</p>
          </Details>
        </PlainCard>

        <PlainCard>
          <h2 className={H2}>{t("A check that says what it shows")}</h2>
          <p className={`${TEXT} mb-4`}>{t("Checking a signature made with sample key A:")}</p>
          <ShowsBlock
            showsTitle={t("Shows")}
            doesNotTitle={t("Does not show")}
            shows={[
              t("Which key signed, and that the signature fits this exact message."),
              t("Only if the idea works as the research note describes: that this key could not sign a second time."),
            ]}
            doesNot={[
              t("Who holds the key, or held it."),
              t("Whether the message is true. The key limits how often something is said, not whether it is true."),
              t("When it was signed. That still needs a chain."),
              t("Which member of a group acted. Hiding one among many is a different tool's job."),
              t("That one-shot keys exist. No machine runs them today."),
            ]}
          />
        </PlainCard>

        <PlainCard>
          <h2 className={H2}>{t("Read more")}</h2>
          <ul className="mt-3 flex flex-col gap-2 text-base sm:text-lg">
            <li>
              <a href={NOTE_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                {t("One-shot TET: the research note this page follows (status: idea)")}
              </a>
            </li>
            <li>
              <a href={EPRINT_URL} target="_blank" rel="noopener noreferrer" className={LINK} translate="no">
                IACR ePrint 2025/486
              </a>
            </li>
            <li>
              <a href={ARXIV_URL} target="_blank" rel="noopener noreferrer" className={LINK} translate="no">
                arXiv 2510.10899
              </a>
            </li>
          </ul>
          <p className={TEXT}>{t("Two references the owner asked to be read with the idea. Neither was opened when the research note was written, and this page does not describe them.")}</p>
        </PlainCard>

        <p className="text-center text-sm text-slate-600 dark:text-slate-400">{t("A concept page. Every figure on it is a sample.")}</p>
      </PlainPage>
    </>
  );
}
