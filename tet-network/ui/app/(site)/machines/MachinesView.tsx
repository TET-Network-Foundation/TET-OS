"use client";
/**
 * /machines: a machine's own log, one-time permits, and agent signatures. Every feature comes from
 * app/site/features/machines.ts through <FeatureCard id>; every string has Japanese in
 * app/site/text/machines.ts. Illustrations are drawn for this page; screenshots are of our own pages.
 */
import { CardGrid, FeatureCard, Figure, Guess, Hero, Notice, SiteSection } from "../../site/kit";
import { SECTION } from "../../site/features/machines";
import { useSite } from "../../site/i18n";

export default function MachinesView() {
  const { t } = useSite();
  return (
    <>
      <Notice text="Nothing here runs on a server today. Every check on this page runs on your own computer." />
      <Hero
        title={SECTION.title}
        sentence={SECTION.sentence}
        art={<Figure src="/site/machines/hero.svg" alt="A small drone over a row of plants. It carries its own key and a ticket that allows one action, once." />}
      />

      <SiteSection
        id="log"
        title="A machine keeps its own log"
        lead="Each record is signed with the machine's own key and linked to the record before it. If a record is taken out, moved or changed, the check fails."
      >
        <div className="flex flex-col gap-8">
          <Figure src="/site/machines/notebook.svg" alt="A small sensor box writes records 1, 2 and 3. Each record carries a seal from the machine's key and is linked to the one before." wide />
          <CardGrid>
            <FeatureCard id="machine-notebook" />
            <FeatureCard id="machine-log-check" />
            <FeatureCard id="log-fingerprint" />
          </CardGrid>
          <div className="grid items-start gap-6 md:grid-cols-[3fr_2fr]">
            <Figure
              src="/site/machines/try-machine-log.png"
              alt="The page Check a machine's log, with a sample greenhouse sensor log that reads VALID."
              caption="Screenshot of our own page, /try?tab=machine-log, with a sample log."
            />
            <div className="mx-auto w-full max-w-[260px]">
              <Figure
                src="/site/machines/try-machine-log-phone-dark.png"
                alt="The same check on a phone, in dark mode: the sample log reads VALID, with its Shows and Does not show lists."
                caption="The same page on a phone, in dark mode."
              />
            </div>
          </div>
          <p className="max-w-3xl text-base leading-relaxed text-slate-700 dark:text-slate-300">
            {t("The machine's key is new and its own: it is never the owner's key. The log program is not for military or dual-use systems.")}
          </p>
        </div>
      </SiteSection>

      <SiteSection
        id="permits"
        title="Permission for one thing, once"
        lead="A permit names one action and the last record that may use it. The first use is accepted. A second use of the same permit is refused."
      >
        <div className="flex flex-col gap-8">
          <Figure src="/site/machines/permit.svg" alt="A robot arm with a ticket marked 1×. The first use of the ticket gets a tick; a second use of the same ticket gets a cross." wide />
          <CardGrid>
            <FeatureCard id="one-time-permits" />
            <FeatureCard id="agent-permit-once" />
            <FeatureCard id="once-in-the-world" />
          </CardGrid>
          <p className="max-w-3xl text-base leading-relaxed text-slate-700 dark:text-slate-300">
            {t("One-time means once per log, not once in the world. Someone who copies the key could start a second log and use the same permit there.")}
          </p>
        </div>
      </SiteSection>

      <SiteSection
        id="agents"
        title="Agents sign what they send"
        lead="A bot or a script gets its own key. What it sends carries its signature, and anyone can check that signature without asking us."
      >
        <div className="flex flex-col gap-8">
          <Figure src="/site/machines/agent.svg" alt="A program window with a small face holds a key. It sends a page with a seal, and a magnifier checks the seal with a tick." wide />
          <CardGrid>
            <FeatureCard id="agent-signatures" />
            <FeatureCard id="agents-control" />
          </CardGrid>
          <div className="mx-auto w-full max-w-md">
            <Figure
              src="/site/machines/agents-control.png"
              alt="The page Agent and machine control, with a sample machine whose log reads VALID and whose one-time permit open-vent is used."
              caption="Screenshot of our own page, /agents, with a sample machine."
            />
          </div>
        </div>
      </SiteSection>

      <SiteSection id="guess" title="Where we think this goes">
        <Guess title="Machines that keep their own notebooks">
          <div className="flex flex-col gap-3">
            <p>
              {t(
                "Looking about ten years out, our guess is this: many machines that work on their own, such as farm drones, robots in warehouses and sensors in buildings, would keep a signed log of what they did.",
              )}
            </p>
            <p>{t("After something goes wrong, anyone could read that log without having to trust the machine's maker: which key signed, in what order, and which permissions were used.")}</p>
            <p>{t("Permissions would be small: one action, once, then gone.")}</p>
            <p>{t("None of this is built beyond what the cards above say, and it may turn out quite differently.")}</p>
          </div>
        </Guess>
      </SiteSection>
    </>
  );
}
