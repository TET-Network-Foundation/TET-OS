"use client";
/**
 * /research: ideas being studied. None is built; the two models (app/site/run) run in the visitor's tab. Every feature comes from
 * app/site/features/research.ts through <FeatureCard>; the one-shot text follows
 * docs/research/ONE_SHOT_TET.md (and its fuller version on branch docs/one-shot-research) and says
 * nothing beyond it. The papers are linked, not described.
 */
import { CardGrid, FeatureCard, Figure, Hero, Notice, ShowsDoesNot, SiteSection } from "../../site/kit";
import { useSite } from "../../site/i18n";
import { OneShotDemo, PermitSketch } from "../../site/run/RunViews";

const LINK = "underline underline-offset-4 hover:text-teal-700 dark:hover:text-teal-300 outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50 rounded";

/** What the setup finding rests on, and what it does not (both from the note). */
const SETUP_SHOWS = [
  { text: "The paper's setup samples secret keys and builds the shared reference string from them (its Construction 52)." },
  { text: "The paper states its security only for an attacker who never sees those keys." },
  { text: "In the idealised oracle model there is no setup party, but the only known way to make that oracle real brings the secret keys back." },
  { text: "Of the sources read, only arXiv 2606.23612 says in words that its setup is trusted." },
];
const SETUP_DOES_NOT = [
  { text: "The paper never uses the word \"trusted\" for its setup. The finding follows from its construction." },
  { text: "That whoever holds the setup keys could sign twice is the note's own reading, still to be checked by someone who has read the proofs." },
  { text: "The proofs in the paper's Sections 3 to 6 and its appendices were not read line by line." },
  { text: "That no scheme with a transparent setup exists. The note searched; it did not survey the field, and a scheme it missed may exist." },
];

/** The papers the note lists, by their IDs. Links only; `text` repeats only what the note says. */
const PAPERS: { label: string; links: { label: string; href: string }[]; text?: string }[] = [
  {
    label: "Amos, Georgiou, Kiayias, Zhandry (STOC 2020)",
    links: [{ label: "IACR ePrint 2020/107", href: "https://eprint.iacr.org/2020/107" }],
    text: "Defines one-shot signatures. The note says its authors report a bug in its security proof. Only the abstract was read.",
  },
  {
    label: "Shmueli, Zhandry (CRYPTO 2025)",
    links: [
      { label: "IACR ePrint 2025/486", href: "https://eprint.iacr.org/2025/486" },
      { label: "arXiv 2507.12456", href: "https://arxiv.org/abs/2507.12456" },
    ],
    text: "The scheme the setup finding is about. The arXiv copy is the one that was read.",
  },
  {
    label: "Huang, Vaikuntanathan",
    links: [{ label: "arXiv 2510.10899", href: "https://arxiv.org/abs/2510.10899" }],
    text: "Its abstract page says it is subsumed by IACR ePrint 2026/1210.",
  },
  {
    label: "Huang, Shmueli, Vaikuntanathan, Zhandry",
    links: [
      { label: "IACR ePrint 2026/1210", href: "https://eprint.iacr.org/2026/1210" },
      { label: "arXiv 2511.04633", href: "https://arxiv.org/abs/2511.04633" },
    ],
    text: "Read through its abstract page and its arXiv predecessor, not its full text.",
  },
  {
    label: "Two works merged into IACR ePrint 2026/1210",
    links: [
      { label: "IACR ePrint 2025/1906", href: "https://eprint.iacr.org/2025/1906" },
      { label: "IACR ePrint 2025/2056", href: "https://eprint.iacr.org/2025/2056" },
    ],
  },
  {
    label: "Muraleedharan and others",
    links: [{ label: "arXiv 2606.23612", href: "https://arxiv.org/abs/2606.23612" }],
    text: "The note reads it as a circuit for the scheme without obfuscation, not an attack.",
  },
  { label: "Coladangelo, Sattath", links: [{ label: "arXiv 2002.11998", href: "https://arxiv.org/abs/2002.11998" }] },
  { label: "Coladangelo, Liu, Liu, Zhandry (CRYPTO 2021)", links: [{ label: "arXiv 2107.05692", href: "https://arxiv.org/abs/2107.05692" }] },
  { label: "Zhandry (ITCS 2024)", links: [{ label: "arXiv 2307.12120", href: "https://arxiv.org/abs/2307.12120" }] },
  { label: "Bostanci, Nehoran, Zhandry", links: [{ label: "arXiv 2411.00529", href: "https://arxiv.org/abs/2411.00529" }] },
];

export default function ResearchView() {
  const { t } = useSite();
  return (
    <>
      <Notice text="None of these ideas is built. The two models on this page run in your browser and send nothing." />
      <Hero
        title="Research"
        sentence="Ideas we are studying, each with what it would change and what it would not."
      />

      <SiteSection
        title="Keys that sign once"
        lead="Today, when TET allows something only once, a second use can still be made, and whoever keeps the record refuses it. A one-shot key is meant to make a second signature impossible, but only if its setup can be trusted."
      >
        <div className="grid items-start gap-6 md:grid-cols-2">
          <Figure
            src="/site/research/once.svg"
            alt="Top: an ordinary key signs twice and a record book crosses out the second signature. Bottom: a one-shot key signs once and is used up, so there is no second signature."
            caption="Top: today, a second use is caught by whoever keeps the record. Bottom: a one-shot key cannot sign a second time."
          />
          <FeatureCard id="one-shot-tet" />
        </div>
      </SiteSection>

      <SiteSection title="The catch: a trusted setup" lead="The note read the papers and found a cost.">
        <div className="grid items-start gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-4 leading-relaxed">
            <p className="font-semibold">
              {t("In the standard model, the one-shot scheme of Shmueli and Zhandry (IACR ePrint 2025/486) needs a common reference string made by a trusted setup, and practical indistinguishability obfuscation does not exist. A trusted setup is the same kind of trust TET rejected Groth16 for.")}
            </p>
            <p>
              {t("A trusted setup means one party makes the shared starting data from secret keys. By the note's reading, whoever kept those keys could sign twice with one key, and nothing would show it afterwards.")}
            </p>
          </div>
          <Figure
            src="/site/research/setup.svg"
            alt="A setup box makes a shared string from a secret key. Everyone's keys use the string, but a copy of the secret key, kept aside, makes two signatures."
            caption="The setup's secret key, if anyone kept it, would undo the once."
          />
        </div>
        <div className="mt-6">
          <ShowsDoesNot shows={SETUP_SHOWS.map((s) => s.text)} doesNot={SETUP_DOES_NOT.map((s) => s.text)} />
        </div>
      </SiteSection>

      <SiteSection title="Try the idea on a sample key set" lead="A concept page lets you hand over messages signed by sample keys that each work once. It is a model, not a key.">
        <div className="grid items-start gap-6 md:grid-cols-2">
          <FeatureCard id="future-concept" />
          <div className="flex flex-col gap-6">
            <Figure
              src="/site/research/future-desktop.png"
              alt="The sample key set after two hand-overs: two keys are struck through and marked Used, and the other sample person holds two signed messages."
              caption="The /future concept page, light theme. Screenshot from its pull request."
            />
            <Figure
              src="/site/research/future-phone-dark.png"
              alt="The same sample key set on a phone, dark theme, after one signed message was handed over."
              caption="The same page on a phone, dark theme."
            />
          </div>
        </div>
      </SiteSection>

      <SiteSection title="Signatures" lead="Every TET signature today is two signatures made together, Ed25519 and ML-DSA-44. A second post-quantum one is an idea, waiting for the FIPS 206 standard.">
        <CardGrid>
          <FeatureCard id="fn-dsa" />
        </CardGrid>
      </SiteSection>

      <SiteSection title="A learning model" lead="A few simulated qubits, to show what a one-shot key would change and why a simulation cannot be one.">
        <div className="flex flex-col gap-8">
          <FeatureCard id="learning-model" />
          <OneShotDemo />
        </div>
      </SiteSection>

      <SiteSection title="Permits written as sentences" lead="A sketch: a line of text becomes a one-time permit, and the permit check runs on it.">
        <div className="flex flex-col gap-8">
          <FeatureCard id="permit-language" />
          <PermitSketch />
        </div>
      </SiteSection>

      <SiteSection title="Papers" lead="Links only. The research note says how much of each one was read.">
        <ul className="flex flex-col gap-4">
          {PAPERS.map((p) => (
            <li key={p.label} className="rounded-2xl border border-slate-200 p-6 dark:border-slate-700">
              <p className="font-semibold">{t(p.label)}</p>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {p.links.map((l) => (
                  <a key={l.href} href={l.href} className={LINK}>
                    {t(l.label)}
                  </a>
                ))}
              </p>
              {p.text ? <p className="mt-2 text-slate-700 dark:text-slate-300">{t(p.text)}</p> : null}
            </li>
          ))}
        </ul>
      </SiteSection>
    </>
  );
}
