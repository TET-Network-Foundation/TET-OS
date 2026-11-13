"use client";
/**
 * The home page, as one scrolling story: what TET is, why, how it differs from today's blockchains,
 * what exists, how it works (an animated diagram), a labelled guess, where things stand, the five
 * sections, and a short FAQ. Every string goes through t(); the Japanese is in app/site/text/home.ts.
 */
import { CardGrid, Figure, FeatureMini, Guess, Hero, SecondaryLink, SectionCard, SiteSection } from "./kit";
import { SECTIONS } from "./features";
import { useSite } from "./i18n";
import { HowDiagram } from "./home/HowDiagram";

export const HOME_SENTENCE = "Keys for machines and agents: what each key may do, and how many times.";

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
        art={<Figure src="/site/home/hero.svg" alt="A key with three use marks, one used and two left, linked to a small machine." caption="A key may do one named thing a set number of times." />}
      />

      <SiteSection
        title="Why this matters"
        lead="AI can now make text, pictures and code that look like anyone's. That makes two questions harder: which key made this, and did it exist before a given moment? TET answers only those two; it does not say whether the thing is true or good."
      >
        <Figure src="/site/home/why.svg" alt="Many pages that look alike; one, set apart, carries a key mark." caption="Copies can look the same. A signature says which key made one of them." />
      </SiteSection>

      <SiteSection
        title="How TET differs from today's blockchains"
        lead="Blockchains already do some things well: many independent nodes agree on one order, and some have run in public for years. TET has neither yet. It aims at a narrower question."
      >
        <div className="flex flex-col gap-6">
          <div className="w-full overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
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
          <Figure src="/site/home/compare.svg" alt="Left, many nodes joined in a ring around one shared record; right, one key with its use marks." caption="Left: many nodes agree on one order. Right: one key and how many times it may act." />
        </div>
      </SiteSection>

      <SiteSection
        id="today"
        title="What exists today"
        lead="Four pieces of TET that exist as code. Each card gives its status, one thing it shows and one it does not."
      >
        <CardGrid>
          <FeatureMini id="tags-mark-genuine" />
          <FeatureMini id="machine-log-check" />
          <FeatureMini id="one-time-permits" />
          <FeatureMini id="tags-tap-check" />
        </CardGrid>
      </SiteSection>

      <SiteSection id="how" title="How it works" lead="Follow one action from a key to a check anyone can run.">
        <HowDiagram />
      </SiteSection>

      <SiteSection title="Where we think this goes">
        <div className="flex flex-col gap-6">
          <Guess title="In ten years">
            <p>
              {t(
                "We guess that many machines and agents will act for people, each with a key that carries written limits. A site or a person could then check what an agent was allowed to do before trusting what it did. This is a guess, and it may be wrong.",
              )}
            </p>
          </Guess>
          <Figure src="/site/home/future.svg" alt="Several machines, each with its own key, joined to one check in the middle." caption="Many machines, each with its own key; one way to check them all." />
          <SecondaryLink href="/research" label="Read the research" />
        </div>
      </SiteSection>

      <SiteSection
        title="Where things stand"
        lead="No public node runs today, so nothing here works for anyone over the internet. The test network is being rebuilt. There are no users yet."
      >
        <Figure src="/site/home/status.svg" alt="A public node drawn in dashed outline, not running, with a wrench; beside it, a laptop with a tick." caption="The public node is down and being rebuilt. The prototypes run on your own computer." />
      </SiteSection>

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
            <details key={q.title} className="group rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <summary className="cursor-pointer font-semibold marker:text-teal-700 dark:marker:text-teal-300">{t(q.title)}</summary>
              <p className="mt-2 max-w-prose leading-relaxed text-slate-700 dark:text-slate-300">{t(q.text)}</p>
            </details>
          ))}
        </div>
      </SiteSection>
    </>
  );
}
