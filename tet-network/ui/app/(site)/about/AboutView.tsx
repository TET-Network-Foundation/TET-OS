"use client";
/** /about: who builds TET, the plain facts, and how to reach the person who does. No age, school, town or photo. */
import { Contact, Hero, SiteSection } from "../../site/kit";
import { useSite } from "../../site/i18n";

export default function AboutView() {
  const { t } = useSite();
  return (
    <>
      <Hero title="About" sentence="Who builds TET, and how to reach the person who does." />
      <SiteSection title="Who builds it">
        <div className="flex max-w-prose flex-col gap-4 leading-relaxed">
          <p>{t("TET is built by Steve (Kazuma Sengoku).")}</p>
          <p className="font-semibold">{t("Open source. No token. No company.")}</p>
        </div>
      </SiteSection>
      <SiteSection
        title="Looking for review"
        lead="Nothing here has been reviewed or audited by anyone outside. If you can read Rust, TypeScript or the cryptography, a careful look is the most useful help there is."
      />
      <SiteSection title="Contact">
        <Contact />
      </SiteSection>
    </>
  );
}
