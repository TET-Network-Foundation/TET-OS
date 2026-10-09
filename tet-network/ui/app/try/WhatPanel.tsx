"use client";

/**
 * "What is TET": one readable column of plain text. What it is, why it's needed now, what works
 * today (each with what it proves and doesn't), a comparison with Bitcoin and Ethereum (true claims
 * only; never "first"), where TET is weaker today, the roadmap (Phase 1 is the only dated phase, and
 * its date is a target), who builds it, and how to get involved. No cards. try_what_guard checks it.
 */
import { FOCUS, cx } from "./ui";
import { useLang } from "./i18n";

const REPO = "https://github.com/TET-Network-Foundation/TET-OS";

/** Bitcoin, Ethereum and TET side by side. True claims only; never "first". */
export const ROWS: [string, string, string, string][] = [
  ["Purpose", "Digital money", "A platform for smart contracts", "Checking who made something, and when"],
  ["Post-quantum signatures today", "No (proposals are under discussion)", "No (on the research roadmap)", "Partly: every transaction also carries an ML-DSA-44 signature, but the wallet ID is still the Ed25519 key until Phase 1"],
  ["Anonymous one-person-one-vote", "No", "Not built in (apps such as MACI add it)", "Built in: members-only polls, one vote per member"],
  ["Everyday interface", "Wallet apps from other projects", "Wallets and apps from other projects", "Built in: boards, signing and polls in the browser"],
  ["Energy", "Proof of work: high", "Proof of stake since 2022: low", "One block producer, no mining: low"],
];

/** Phases 2–10: a vision, without dates. */
export const VISION = [
  "An outside security audit",
  "More than one block producer",
  "Signature badges, proof codes and search by file",
  "Members-only polls and the Shelter corner",
  "The site builder",
  "TetSearch",
  "Nodes that run in the browser (libp2p over WebRTC)",
  "Open block production",
  "Developer tools for other apps",
];

export default function WhatPanel(props: { go: (tool: string) => void }) {
  const { t } = useLang();
  const H = "mt-8 mb-2 text-[19px] font-semibold";
  const link = cx(FOCUS, "rounded-sm underline underline-offset-2");
  const item = (what: string, proves: string, not: string) => (
    <li className="mb-3">
      <p className="font-semibold">{what}</p>
      <p>
        <span className="text-[#1f5132]">{t("Proves:")}</span> {proves}
      </p>
      <p>
        <span className="text-[#8a1f1f]">{t("Doesn't prove:")}</span> {not}
      </p>
    </li>
  );
  return (
    <article className="px-4 pb-4 pt-2 text-[16px] leading-relaxed md:px-5">
      <h1 className="text-[26px] font-bold">{t("What is TET")}</h1>

      <h2 className={H}>{t("What it is")}</h2>
      <p>{t("TET is a public network for checking who made something, and when. Every transaction and message on it is signed twice: once with Ed25519, and once with ML-DSA-44, one of the quantum-resistant signatures (ML-DSA) standardised by NIST as FIPS 204.")}</p>
      <p className="mt-2">{t("Anyone can check a signature on their own device. You don't have to trust this website or this node to do it.")}</p>
      <p className="mt-2">{t("Today it runs as a testnet (v0.2): a public test version. Nothing on it has monetary value.")}</p>
      <p className="mt-2">{t("This demo shows only part of what TET can do.")}</p>

      <h2 className={H}>{t("Why it's needed now")}</h2>
      <p>{t("Text, pictures and voices can now be generated in seconds, so \"who made this, and when?\" is harder to answer than it used to be. A signature answers part of it: it shows which key signed exactly these bytes.")}</p>
      <p className="mt-2">{t("The signatures most systems use today (ECDSA, Ed25519) could be forged by a large enough quantum computer, if one is ever built. Signatures are meant to be checked for years, so TET adds a quantum-resistant signature from the start.")}</p>
      <p className="mt-2">{t("Today that protection is incomplete: your ID is still your Ed25519 key, and the ML-DSA-44 key isn't bound to it until the Phase 1 genesis.")}</p>

      <h2 className={H}>{t("What works today")}</h2>
      <ul>
        {item(
          t("Sign and verify a file"),
          t("this key signed exactly this file."),
          t("who holds the key, that the work is original, or that a person made it."),
        )}
        {item(
          t("Boards with anonymous posts"),
          t("a post came from a member of this node's anonymity set, at most one per board per day."),
          t("which member wrote it. The node still sees IP addresses."),
        )}
        {item(
          t("Encrypted messages and files"),
          t("only the receiver can read them (X25519 + Kyber round 3, not yet the final ML-KEM standard)."),
          t("who talks to whom: the node sees that."),
        )}
        {item(
          t("The live chain"),
          t("the blocks this node holds, shown raw, each linked to the one before."),
          t("who produced a block: blocks aren't signed by their producer yet."),
        )}
      </ul>

      <h2 className={H}>{t("How it compares with Bitcoin and Ethereum")}</h2>
      {/* Phones: one row at a time, so the TET column is never off-screen. */}
      <dl className="sm:hidden">
        {ROWS.map(([k, btc, eth, tet]) => (
          <div key={k} className="mb-3">
            <dt className="font-semibold">{t(k)}</dt>
            <dd className="m-0">Bitcoin: {t(btc)}</dd>
            <dd className="m-0">Ethereum: {t(eth)}</dd>
            <dd className="m-0 font-semibold">TET: {t(tet)}</dd>
          </div>
        ))}
      </dl>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[34rem] border-collapse text-left text-[15px]">
          <thead>
            <tr className="border-b border-[#c9ced4]">
              <th className="py-1.5 pr-3 font-semibold"></th>
              <th className="py-1.5 pr-3 font-semibold">Bitcoin</th>
              <th className="py-1.5 pr-3 font-semibold">Ethereum</th>
              <th className="py-1.5 font-semibold">TET</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([k, btc, eth, tet]) => (
              <tr key={k} className="border-b border-[#eceef1] align-top">
                <th scope="row" className="py-1.5 pr-3 font-semibold">
                  {t(k)}
                </th>
                <td className="py-1.5 pr-3">{t(btc)}</td>
                <td className="py-1.5 pr-3">{t(eth)}</td>
                <td className="py-1.5">{t(tet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2">{t("TET isn't the only network with post-quantum signatures: QRL and others already use them. What TET adds is the combination: quantum-resistant signatures (complete once Phase 1 binds them to your ID), anonymous one-person-one-vote and an everyday interface, in one network.")}</p>
      <p className="mt-2">{t("Messages, files and boards are not written to the chain. They stay on nodes for a limited time; the chain holds keys and proofs, not your content.")}</p>

      <h2 className={H}>{t("Where TET is weaker today")}</h2>
      <ul className="list-disc pl-5">
        <li>{t("It's a testnet only: nothing on it is meant to last or has value.")}</li>
        <li>{t("One block producer makes every block.")}</li>
        <li>{t("No security audit has been done.")}</li>
        <li>{t("Very few people use it.")}</li>
      </ul>

      <h2 className={H}>{t("Roadmap")}</h2>
      <ul className="list-disc pl-5">
        <li>{t("Phase 0 (now): testnet v0.2, this site.")}</li>
        <li>{t("Phase 1: genesis, the start of the real network. Target: Q1 2027. A target, not a promise; it moves if the work isn't ready.")}</li>
      </ul>
      <p className="mt-3 font-semibold">{t("After that: the vision. No dates; the order may change.")}</p>
      <ol className="list-decimal pl-5" start={2}>
        {VISION.map((v) => (
          <li key={v}>{t(v)}</li>
        ))}
      </ol>

      <h2 className={H}>{t("Who builds it")}</h2>
      <p>
        {t("One person builds TET, as open source. Every change is public:")}{" "}
        <a className={link} href={REPO} target="_blank" rel="noreferrer">
          {t("the source")}
        </a>
        {". "}
        {t("Questions and reports:")}{" "}
        <button type="button" className={link} onClick={() => props.go("about")}>
          {t("About")}
        </button>
        .
      </p>
      <h2 className={H}>{t("Get involved")}</h2>
      <ul className="list-disc pl-5">
        <li>
          {t("Anyone: questions, ideas and feedback in GitHub Discussions.")}{" "}
          <a className={link} href={`${REPO}/discussions`} target="_blank" rel="noreferrer">
            {t("Discussions")}
          </a>
        </li>
        <li>
          {t("Developers: open an issue or a pull request on GitHub.")}{" "}
          <a className={link} href={`${REPO}/issues`} target="_blank" rel="noreferrer">
            {t("Issues")}
          </a>
          {" · "}
          <a className={link} href={`${REPO}/pulls`} target="_blank" rel="noreferrer">
            {t("Pull requests")}
          </a>
        </li>
        <li>
          {t("Researchers, organizations, anything else:")}{" "}
          <a className={link} href="mailto:hello@stevenexus.org">
            hello@stevenexus.org
          </a>
        </li>
      </ul>
      <p className="mt-2">{t("TET is a volunteer open-source project. There are no paid roles or tokens to offer.")}</p>

      <p className="mt-6">
        <button type="button" className={link} onClick={() => props.go("how")}>
          {t("How the demo works")}
        </button>
      </p>
    </article>
  );
}
