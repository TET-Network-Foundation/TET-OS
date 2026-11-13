"use client";
/** The home page: one sentence and a card for each of the five sections. */
import { CardGrid, Figure, Hero, SectionCard, SiteSection } from "./kit";
import { SECTIONS } from "./features";

export const HOME_SENTENCE = "Keys for machines and agents: what each key may do, and how many times.";

export default function Home() {
  return (
    <>
      <Hero title="TET" sentence={HOME_SENTENCE} art={<Figure src="/site/home/hero.svg" alt="A key with a counter beside a small machine and a person: each key may do one named thing a set number of times." />} />
      <SiteSection title="Five places to start" lead="Each card says what is built and what is not. A label on every feature tells you how far it has come.">
        <CardGrid>
          {SECTIONS.map((_, i) => (
            <SectionCard key={i} index={i} />
          ))}
        </CardGrid>
      </SiteSection>
    </>
  );
}
