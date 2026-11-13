"use client";
/**
 * The home page, as one scrolling story: what TET is (with a real terminal capture), why, how it
 * differs from today's blockchains, what exists (with a real screenshot), measured numbers with their
 * sources, how it works, why it may matter later (our reasoning, with sources), where things stand,
 * the five sections, and a short FAQ. Concrete over decorative: no drawn illustrations here. Every string goes through t(); the Japanese is in app/site/text/home.ts.
 */
import { CardGrid, Figure, FeatureMini, Guess, Hero, Measured, SecondaryLink, SectionCard, SiteSection, Terminal } from "./kit";
import { SECTIONS } from "./features";
import { useSite } from "./i18n";
import { HowDiagram } from "./home/HowDiagram";

export const HOME_SENTENCE = "Keys for machines and agents: what each key may do, and how many times.";

/**
 * Why this may matter later: three reasons, each tied to something that exists, each with its source.
 * Our reasoning, not a promise; nothing here says when.
 */
const LATER = [
  {
    title: "Products will carry a record of where they came from",
    text: "The EU's ecodesign rules bring in a digital product passport: data about a product that travels with it. A record is only useful if you can tell who wrote it. A signed record says which key wrote each entry.",
    source: { label: "Regulation (EU) 2024/1781, on EUR-Lex", href: "https://eur-lex.europa.eu/eli/reg/2024/1781/oj" },
  },
  {
    title: "Software agents will act for people",
    text: "NIST has started an initiative on standards for AI agents, including how an agent is identified and what it is allowed to do. A key with written limits is one way to say what an agent may do and check it afterwards.",
    source: { label: "NIST, AI Agent Standards Initiative", href: "https://www.nist.gov/caisi/ai-agent-standards-initiative" },
  },
  {
    title: "Signatures are moving to post-quantum schemes",
    text: "NIST has published ML-DSA as a standard signature scheme designed to resist quantum computers. Records signed today may need to be checked for many years, so every TET signature already carries an ML-DSA-44 half next to Ed25519.",
    source: { label: "NIST FIPS 204 (ML-DSA)", href: "https://csrc.nist.gov/pubs/fips/204/final" },
  },
];

/** The FAQ: question as title, answer as text. */
const FAQ = [
  {
    title: "What is TET?",
    text: "Open-source code for keys that machines and agents hold. Each key can carry limits on what it may sign and how many times. Anyone can check a signed record against those limits.",
  },
  {
    title: "Is there a token?",
    text: "No. TET has no token. The chain records keys, permissions and fingerprints of records.",
  },
  {
    title: "Does it run now?",
    text: "Not for anyone over the internet: no public node runs today. Parts of it run on your own computer, as prototypes.",
  },
  {
    title: "Is it safe to use?",
    text: "Every signature is hybrid: Ed25519 together with ML-DSA-44, and both halves must check. Keys stay on your device. Everything is a prototype that no one outside has reviewed or audited, so do not rely on it for anything that matters.",
  },
  {
    title: "How do I try it?",
    text: "Open a Try it link under What exists today; those pages run in your browser. The five sections say what each part does and how far it has come.",
  },
];

export default function Home() {
  const { t } = useSite();
  /** The comparison table: one row per question, blockchains in the middle, TET on the right. */
  const rows = [
    {
      label: t("Purpose"),
      chain: t("A shared record of accounts and transfers that many independent nodes agree on."),
      tet: t("A shared record of keys: what each key may do, how many times, and when it signed."),
    },
    { label: t("Token"), chain: t("Most have one. It rewards the nodes that keep the record."), tet: t("TET has none.") },
    {
      label: t("Signatures"),
      chain: t("Usually one elliptic-curve scheme, such as ECDSA or Ed25519."),
      tet: t("Two on every record: Ed25519 and ML-DSA-44, a scheme designed to resist quantum computers. Both must check."),
    },
    {
      label: t("What a result says"),
      chain: t("This transaction is in block N, in the order the nodes agreed."),
      tet: t("This key signed this, under this permission, and it existed before block N. Not that it is true."),
    },
  ];
  return (
    <>
      <Hero
        title={HOME_SENTENCE}
        sentence="TET gives each machine or agent its own key, limits what that key may sign, and lets anyone check the result."
        action={{ href: "#how", label: "See how it works" }}
      />

      <SiteSection title="What a check looks like">
        <Terminal lead="This is a real run of TET's command-line tool. It checks a machine's signed record, then a copy where one reading was changed. The original passes; the edited copy is refused." />
      </SiteSection>

      <SiteSection
        title="Why this matters"
        lead="AI can now make text, pictures and code that look like anyone's. That makes two questions harder: which key made this, and did it exist before a given moment? TET answers only those two; it does not say whether the thing is true or good."
      />

      <SiteSection
        title="How TET differs from today's blockchains"
        lead="Blockchains already do some things well: many independent nodes agree on one order, and some have run in public for years. TET has neither yet. It aims at a narrower question."
      >
        <div className="flex flex-col gap-6">
          <div className="w-full overflow-x-auto rounded-md border border-slate-300 dark:border-slate-700">
            <table className="w-full text-left text-sm leading-relaxed">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th scope="col" className="p-4 font-semibold">
                    <span className="sr-only">{t("Question")}</span>
                  </th>
                  <th scope="col" className="p-4 font-semibold">
                    {t("Most blockchains")}
                  </th>
                  <th scope="col" className="p-4 font-semibold text-teal-800 dark:text-teal-200">
                    {t("TET")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-slate-200 align-top dark:border-slate-700">
                    <th scope="row" className="p-4 font-semibold">
                      {r.label}
                    </th>
                    <td className="p-4 text-slate-700 dark:text-slate-300">{r.chain}</td>
                    <td className="p-4">{r.tet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SiteSection>

      <SiteSection
        id="today"
        title="What exists today"
        lead="Four pieces of TET that exist as code. Each card gives its status, one thing it shows and one it does not."
      >
        <div className="flex flex-col gap-8">
          <CardGrid>
            <FeatureMini id="tags-mark-genuine" />
            <FeatureMini id="machine-log-check" />
            <FeatureMini id="one-time-permits" />
            <FeatureMini id="tags-tap-check" />
          </CardGrid>
          <Figure
            src="/site/machines/try-machine-log.png"
            alt="The page Check a machine's log, with a sample greenhouse sensor log that reads VALID."
            caption="Screenshot of our own page, /try?tab=machine-log, with a sample log."
          />
        </div>
      </SiteSection>

      <SiteSection
        id="measured"
        title="Measured"
        lead="A few numbers, each measured and each with where it comes from. A zero-knowledge receipt is the proof TET's anonymous features attach; it is large, and making one takes time."
      >
        <div className="grid gap-8 sm:grid-cols-2">
          <Measured id="ci-tests" />
          <Measured id="receipt-size" />
          <Measured id="prove-time" />
          <Measured id="signed-bytes" />
        </div>
      </SiteSection>

      <SiteSection id="how" title="How it works" lead="Follow one action from a key to a check anyone can run.">
        <HowDiagram />
      </SiteSection>

      <SiteSection
        id="later"
        title="Why this matters later"
        lead="Three reasons we think keys with limits will be needed. They are our reasoning, not a promise, and each links to what it rests on."
      >
        <div className="flex flex-col gap-8">
          <ol className="flex flex-col">
            {LATER.map((r) => (
              <li key={r.title} className="flex flex-col gap-2 border-t border-slate-300 py-6 dark:border-slate-700">
                <h3 className="text-xl font-semibold">{t(r.title)}</h3>
                <p className="max-w-prose leading-relaxed">{t(r.text)}</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {t("Source")}:{" "}
                  <a href={r.source.href} className="underline underline-offset-4">
                    {t(r.source.label)}
                  </a>
                </p>
              </li>
            ))}
          </ol>
          <Guess title="Our reasoning, not a promise">
            <p>{t("We guess that many machines and agents will act for people, each with a key that carries written limits. A site or a person could then check what an agent was allowed to do before trusting what it did. This is a guess, and it may be wrong.")}</p>
          </Guess>
          <SecondaryLink href="/research" label="Read the research" />
        </div>
      </SiteSection>

      <SiteSection
        title="Where things stand"
        lead="No public node runs today, so nothing here works for anyone over the internet. The test network is being rebuilt. There are no users yet."
      />

      <SiteSection title="Five sections" lead="Each card says what is built and what is not.">
        <CardGrid>
          {SECTIONS.map((_, i) => (
            <SectionCard key={i} index={i} />
          ))}
        </CardGrid>
      </SiteSection>

      <SiteSection title="Questions">
        <div className="flex flex-col gap-2">
          {FAQ.map((q) => (
            <details key={q.title} className="group rounded-md border border-slate-300 p-4 dark:border-slate-700">
              <summary className="cursor-pointer font-semibold marker:text-teal-700 dark:marker:text-teal-300">{t(q.title)}</summary>
              <p className="mt-2 max-w-prose leading-relaxed text-slate-700 dark:text-slate-300">{t(q.text)}</p>
            </details>
          ))}
        </div>
      </SiteSection>
    </>
  );
}
