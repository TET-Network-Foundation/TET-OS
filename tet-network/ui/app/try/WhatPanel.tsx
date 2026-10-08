"use client";

/**
 * "What is TET": one readable column of plain text. What it is, why it's needed now, what works
 * today (each with what it proves and doesn't), how it differs from other chains (true claims only),
 * the roadmap (genesis is a target, labelled so), and who builds it. No cards.
 */
import { FOCUS, cx } from "./ui";
import { useLang } from "./i18n";

const REPO = "https://github.com/TET-Network-Foundation/TET-OS";

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

      <h2 className={H}>{t("Why it's needed now")}</h2>
      <p>{t("Text, pictures and voices can now be generated in seconds, so \"who made this, and when?\" is harder to answer than it used to be. A signature answers part of it: it shows which key signed exactly these bytes.")}</p>
      <p className="mt-2">{t("The signatures most systems use today (ECDSA, Ed25519) could be forged by a large enough quantum computer, if one is ever built. Signatures are meant to be checked for years, so TET adds a quantum-resistant signature from the start.")}</p>

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

      <h2 className={H}>{t("How it differs from other chains")}</h2>
      <ul className="list-disc pl-5">
        <li>{t("Every transaction carries two signatures, Ed25519 and ML-DSA-44. Most widely used chains sign with one classical signature (ECDSA or Ed25519).")}</li>
        <li>{t("Anonymous posts use a zero-knowledge proof built only from hashes (SHA-256).")}</li>
        <li>{t("Messages, files and boards are not written to the chain. They stay on nodes for a limited time; the chain holds keys and proofs, not your content.")}</li>
        <li>{t("It is small and early: one person runs the testnet, nothing is audited, and nothing is for sale.")}</li>
      </ul>

      <h2 className={H}>{t("Roadmap")}</h2>
      <ul className="list-disc pl-5">
        <li>{t("Now: testnet v0.2, this site.")}</li>
        <li>{t("Next: blocks signed by their producer, members-only features that work across nodes, and an outside security audit.")}</li>
        <li>{t("Genesis, the start of the real network: target Q1 2027. This is a target, not a promise; it moves if the work isn't ready.")}</li>
      </ul>

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
      <p className="mt-6">
        <button type="button" className={link} onClick={() => props.go("how")}>
          {t("How the demo works")}
        </button>
      </p>
    </article>
  );
}
