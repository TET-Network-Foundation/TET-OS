"use client";

/**
 * "How it works": the landing's content behind the home view's link (docs/LANDING_PLAN.md, #62):
 * how it works, what works today with what each piece proves and doesn't, uses, the planned
 * corners (labelled so), why, how TET differs, roadmap, FAQ and about. Plain text, thin rules.
 *
 * Money: the TET token is not featured here. The FAQ has the one sanctioned line
 * (try_money_guard.mjs).
 */
import { type ReactNode } from "react";
import { FOCUS, MONO, cx } from "./ui";
import { useLang } from "./i18n";
import { ABUSE_CONTACT } from "./TermsPanel";

export type LandingGo = (tool: string, hint?: string) => void;

const H = "mb-1.5 border-b border-[#e3e5e8] pb-1 text-[15px] font-semibold";
const LINK = cx(FOCUS, "rounded-sm underline underline-offset-2");

function Row(props: { name: ReactNode; does: ReactNode; proves: ReactNode }) {
  return (
    <li className="grid gap-x-3 border-b border-[#eceef1] py-1.5 md:grid-cols-[6.5rem_1fr]">
      <span className="font-semibold">{props.name}</span>
      <span>
        {props.does} <span className="text-[#5d646d]">{props.proves}</span>
      </span>
    </li>
  );
}

const PLANNED = "text-[13px] font-semibold uppercase tracking-wide text-[#6b4e00]";

export default function HowPanel(props: { go: LandingGo }) {
  const { t } = useLang();
  return (
    <section aria-label={t("How it works")} className="max-w-[46rem] space-y-6 px-4 py-4 text-[16px] leading-relaxed md:px-5 md:text-[15px]">
      {/* How it works (short; the full walk through one real block is queue item j). */}
      <div id="how-it-works" className="scroll-mt-16">
        <h2 className={H}>{t("How it works")}</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>{t("You hold a key: 12 words made in your browser. Nobody else has them, and nothing asks you to sign up.")}</li>
          <li>{t("What you publish is signed with that key twice: Ed25519 and quantum-resistant signatures (ML-DSA).")}</li>
          <li>{t("Nodes check every signature and keep an ordered chain of blocks. Anyone can re-check a signature, a stamp or a block themselves, with Verify or the Live list.")}</li>
        </ol>
      </div>

      {/* 3: what works today */}
      <div>
        <h2 className={H}>{t("What works today")}</h2>
        <ul>
          <Row
            name={<button type="button" className={LINK} onClick={() => props.go("sign")}>{t("sign")}</button>}
            does={t("Sign a file or text with your key; optionally stamp it on chain.")}
            proves={t("Proves this key signed these exact bytes (and, stamped, that they existed by a block). Not who holds the key.")}
          />
          <Row
            name={<button type="button" className={LINK} onClick={() => props.go("verify")}>{t("verify")}</button>}
            does={t("Check a .sig.json, an owner's manifest, a pin, a stamp.")}
            proves={t("Each step says what it proves; a valid signature alone doesn't say who holds the key.")}
          />
          <Row
            name={<button type="button" className={LINK} onClick={() => props.go("directory")}>{t("boards")}</button>}
            does={t("Threads, anonymous or named posts.")}
            proves={t("An anonymous post proves a member wrote it, not which one. It doesn't hide your IP from the node.")}
          />
          <Row
            name={<button type="button" className={LINK} onClick={() => props.go("mail")}>{t("DM")}</button>}
            does={t("End-to-end encrypted messages.")}
            proves={t("Proves which key sent it. The node still sees who writes to whom, and when.")}
          />
          <Row
            name={<button type="button" className={LINK} onClick={() => props.go("files")}>{t("files")}</button>}
            does={t("Encrypted files up to 100 MB, kept 7 days.")}
            proves={t("Only the recipient can open it. Doesn't prove the file is what its name says.")}
          />
          <Row
            name={<button type="button" className={LINK} onClick={() => props.go("live")}>{t("live")}</button>}
            does={t("This node's own blocks and messages as they arrive.")}
            proves={t("Real numbers from one node. Not the whole network's view.")}
          />
        </ul>
      </div>

      {/* 4: use it for */}
      <div>
        <h2 className={H}>{t("Use it for")}</h2>
        <ul>
          {(
            [
              ["data science", t("data science"), t("Sign a dataset's fingerprint, so anyone can check later that the file is the one you used."), "sign", t("Drop the dataset. The .sig.json lets anyone check later that a file is exactly this one.")],
              ["lab notes", t("lab notes"), t("Record date, aim, method and data files with one signature and a block."), null, null],
              ["writers and artists", t("writers and artists"), t("Show this key had this exact work at that block."), "sign", t("Drop the work, sign it, stamp it, and show it as a QR. Proves this key had this exact file at that block; not authorship by itself, or that nobody had it earlier.")],
              ["developers", t("developers"), t("Sign a release so users can check it came from your key."), "sign", t("Drop the release archive. Users check it with Verify.")],
              ["shops", t("shops"), t("A signed listing a buyer can scan."), null, null],
              ["schools", t("schools"), t("A members-only anonymous poll."), null, null],
            ] as const
          ).map(([field, label, line, tool, hint]) => (
            <li key={field} className="grid items-baseline gap-x-3 border-b border-[#eceef1] py-1.5 md:grid-cols-[9rem_1fr_auto]">
              <span className="font-semibold">{label}</span>
              <span>{line}</span>
              {tool ? (
                <button type="button" className={cx(LINK, "justify-self-start text-[14px]")} onClick={() => props.go(tool, hint ?? undefined)}>
                  {t("try this")}
                </button>
              ) : (
                <span className={PLANNED}>{t("planned")}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* 4b: play (planned) */}
      <div>
        <h2 className={H}>
          {t("Play")} <span className={PLANNED}>{t("planned")}</span>
        </h2>
        <ul>
          <Row name={t("sealed prediction")} does={t("Seal a prediction now (only its salted hash is posted); reveal the text later.")} proves={t("Proves the text was fixed when it was sealed. Doesn't prove it was a good guess, or that the same person didn't seal other predictions too.")} />
          <Row name={t("letter to future self")} does={t("Write a letter that is delivered to you later.")} proves={t("The node holds it, encrypted to you, until the date. Up to 30 days ahead on this node; if the node is gone, so is the letter.")} />
          <Row name={t("attendance")} does={t("Scan the venue's QR, which changes every 30 seconds.")} proves={t("Proves you scanned the venue QR. Not that you were there: someone could pass the code on within 30 seconds.")} />
          <Row name={t("recommendation")} does={t("A member recommends someone anonymously.")} proves={t("The recipient must opt in to receive them, and nothing is shown publicly unless the recipient chooses to. Proves a member wrote it, not which one.")} />
        </ul>
      </div>

      {/* 5: why */}
      <div>
        <h2 className={H}>{t("Why this will be needed")}</h2>
        <p>{t("Images, voices and documents can now be faked cheaply. A signature doesn't stop that, but it lets you check whether a file came from a key you trust.")}</p>
        <p className="mt-1.5">{t("Most signatures in use today could be broken by a large enough quantum computer. TET signs everything twice: with a classical key and with quantum-resistant signatures (ML-DSA). TET does not use a quantum computer.")}</p>
        <p className="mt-1.5 text-[#5d646d]">{t("Honest limit: the ML-DSA key isn't yet bound to your wallet id; that comes with the Phase 1 genesis. None of this is audited yet.")}</p>
      </div>

      {/* 6: how TET differs */}
      <div>
        <h2 className={H}>{t("How TET differs")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-[#c9ced4]">
                <th className="py-1 pr-3 font-semibold" />
                <th className="py-1 pr-3 font-semibold">{t("TET today")}</th>
                <th className="py-1 font-semibold">{t("most public chains")}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  [t("Signatures"), t("Ed25519 + ML-DSA-44 on every transaction (binding the ML-DSA key to the wallet id is planned, Phase 1)"), t("classical only")],
                  [t("Messaging and files"), t("built in, end-to-end encrypted"), t("usually not part of the chain")],
                  [t("Anonymous posting"), t("membership proof with hashes only (zero-knowledge)"), t("usually none, or a separate system")],
                  [t("Who makes blocks"), t("one producer today; more producers are planned"), t("many")],
                  [t("Audited"), t("no"), t("the large ones, yes")],
                  [t("Value"), t("testnet: a practice unit, no monetary value"), t("real value")],
                ] as const
              ).map(([a, b, c]) => (
                <tr key={a} className="border-b border-[#eceef1] align-top">
                  <th className="py-1 pr-3 font-semibold">{a}</th>
                  <td className="py-1 pr-3">{b}</td>
                  <td className="py-1 text-[#5d646d]">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7: roadmap */}
      <div>
        <h2 className={H}>{t("Roadmap")}</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("Now: v0.2 testnet. Two seed nodes, one block producer, coins with no value.")}</li>
          <li>{t("Target: the Phase 1 genesis in Q1 2027. It binds the ML-DSA key to the wallet, signs blocks and renames the chain. It's a target, not a date.")}</li>
          <li>
            <span className={PLANNED}>{t("planned")}</span> {t("TetSearch at search.stevenexus.org: searches only signed TET sites; only vouched people can publish; built to keep out mass AI generation.")} {t("Keys without a human vouch can't publish.")}
          </li>
          <li>
            {t("What's open is in")}{" "}
            <a className={LINK} href="https://github.com/TET-Network-Foundation/TET-OS/blob/main/SECURITY.md" target="_blank" rel="noreferrer">
              SECURITY.md
            </a>
            .
          </li>
        </ul>
      </div>

      {/* 8: shelter (planned) */}
      <div>
        <h2 className={H}>
          {t("Shelter")} <span className={PLANNED}>{t("planned")}</span>
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("A quiet corner for people who know each other.")}</li>
          <li>{t("Invite only: someone already inside vouches for you in person.")}</li>
          <li>{t("Joining needs a membership proof; posts aren't served on the public API, and AI crawlers are asked not to crawl (robots.txt).")}</li>
          <li>{t("Every post is signed, by name or anonymously.")}</li>
          <li className="font-semibold">{t("A post proves a member wrote it. It does not prove no AI was used.")}</li>
        </ul>
      </div>

      {/* FAQ: the one money line */}
      <div>
        <h2 className={H}>{t("FAQ")}</h2>
        <p>{t("Testnet TET is a practice unit. It has no monetary value and cannot be bought.")}</p>
        <p className="mt-1">{t("This is a testnet. Data may be reset.")}</p>
      </div>

      {/* 9: about */}
      <div>
        <h2 className={H}>{t("About")}</h2>
        <p>{t("Built and run by Steve, a student in Switzerland.")}</p>
        <p className="mt-1">
          <a className={cx(LINK, MONO, "text-[14px]")} href="mailto:tetsteve@proton.me">
            tetsteve@proton.me
          </a>
          {" · "}
          <a className={LINK} href="https://github.com/TET-Network-Foundation/TET-OS" target="_blank" rel="noreferrer">
            {t("source on GitHub")}
          </a>
          {" · "}
          <button type="button" className={LINK} onClick={() => props.go("terms")}>
            {t("Terms")}
          </button>
        </p>
        <p className="mt-1 text-[14px]">
          {t("Report content:")}{" "}
          <a className={cx(LINK, MONO)} href={`mailto:${ABUSE_CONTACT}`}>
            {ABUSE_CONTACT}
          </a>{" "}
          <span className="text-[#5d646d]">{t("reviewed within 48 hours.")}</span>
        </p>
      </div>
    </section>
  );
}
