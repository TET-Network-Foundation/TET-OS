"use client";
/**
 * /tags: genuine tags for small makers. Two paths (I make things / I bought something), a tap in four
 * steps, what a tap tells a buyer and what it does not, the check you can try today (files and text,
 * in /try), and the status of each part. Every feature comes from app/site/features/tags.ts.
 */
import Link from "next/link";
import { CardGrid, FeatureCard, Figure, Hero, Notice, ShowsDoesNot, SiteSection } from "../../site/kit";
import { SECTION } from "../../site/features/tags";
import { useSite } from "../../site/i18n";

const LINK = "underline underline-offset-4 outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50 rounded-sm";

function Path(props: { title: string; steps: { text: string; href: string }[] }) {
  const { t } = useSite();
  return (
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-xl font-semibold">{t(props.title)}</h3>
      <ol className="flex list-decimal flex-col gap-2 pl-6 leading-relaxed text-slate-700 dark:text-slate-300">
        {props.steps.map((s) => (
          <li key={s.text}>
            <a href={s.href} className={LINK}>
              {t(s.text)}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function TagsView() {
  const { t, lang } = useSite();
  return (
    <>
      <Notice text="Nothing on this page runs for anyone yet. Two parts are built and run only on your own computer." />
      <Hero
        title={SECTION.title}
        sentence={SECTION.sentence}
        art={<Figure src="/site/tags/hero.svg" alt="A handmade cup with a small round chip tag tied to it, and a phone tapping the tag." />}
      />

      <SiteSection title="Two paths" lead="Each step links to the part that does it, with how far that part has come.">
        <CardGrid>
          <Path
            title="I make things"
            steps={[
              { text: "Mark a photo or a description of your work, and share its code.", href: "#tags-mark-genuine" },
              { text: "Register a chip tag under your ID.", href: "#tags-maker-register" },
              { text: "Check taps with your own checker, keeping the tag's key yourself.", href: "#tags-tap-check" },
            ]}
          />
          <Path
            title="I bought something"
            steps={[
              { text: "Check that a file or text is the one the maker marked.", href: "#tags-mark-genuine" },
              { text: "Tap the tag and read what the tap shows.", href: "#tags-scan-page" },
              { text: "Record yourself as the one who holds it now.", href: "#tags-owner-record" },
            ]}
          />
        </CardGrid>
      </SiteSection>

      <SiteSection title="What happens in a tap" lead="The tag holds a secret key that never leaves the chip. Each tap, it writes a fresh link with a number that only goes up.">
        <Figure
          src={`/site/tags/tap-${lang}.svg`}
          alt="A tap in four steps: tap the tag with a phone, the phone opens the tag's fresh link, a checker tests the key and the counter, and a page says what this shows and what it does not."
          caption="How a tap is meant to work. Today step 3 runs only on a computer, and the page in step 4 is planned."
        />
      </SiteSection>

      <SiteSection title="What a tap tells you, and what it does not" lead="A tap is about the chip, not the object it is on.">
        <div className="grid items-start gap-8 md:grid-cols-2">
          <ShowsDoesNot
            shows={["A chip that knew the tag's key made this link when it was tapped.", "The tap is newer than any the checker had seen for that tag."]}
            doesNot={[
              "Anything about the object the tag is on.",
              "Who made the object.",
              "Whether the tag was moved from another object.",
              "That a QR code or a copied link is genuine: only a fresh tap counts.",
            ]}
          />
          <Figure
            src="/site/tags/moved.svg"
            alt="A tag peeled off one bag and stuck on another. The chip still checks; the tap cannot tell that the bag changed."
            caption="A tag can be moved. The chip still checks on the new object."
          />
        </div>
      </SiteSection>

      <SiteSection
        id="who-holds-the-key"
        title="Who holds the tag's key"
        lead="In the design, the maker does, and TET never holds it. A buyer trusts the maker's checker to say a tap was valid. TET would make that statement signed, public and in order, so it can be checked later, but that does not remove the trust."
      >
        <p className="max-w-prose leading-relaxed text-slate-700 dark:text-slate-300">
          <a href="https://github.com/TET-Network-Foundation/TET-OS/blob/plan-genuine-tag/docs/plans/GENUINE_TAG.md" className={LINK}>
            {t("Read the design")}
          </a>
        </p>
      </SiteSection>

      <SiteSection
        id="tags-mark-genuine"
        title="The check you can try"
        lead="It checks files and text, not tags. A maker marks a photo or a description; a buyer checks their copy. One changed letter is enough to say it does not match."
      >
        <div className="flex flex-col gap-8">
          <FeatureCard id="tags-mark-genuine" />
          <div className="grid gap-6 sm:grid-cols-2">
            <Figure
              src={`/site/tags/check-sample-match-${lang}.png`}
              alt="Our check page on a phone: a sample file matches, and the page says it is exactly the one that was marked."
              caption="The copy matches."
            />
            <Figure
              src={`/site/tags/check-sample-changed-${lang}.png`}
              alt="Our check page on a phone: the sample with one letter changed does not match, shown in red."
              caption="One letter changed: it does not match."
            />
          </div>
          <p className="max-w-prose leading-relaxed text-slate-700 dark:text-slate-300">
            <Link href="/try" className={LINK}>
              {t("Check a code in /try")}
            </Link>
          </p>
        </div>
      </SiteSection>

      <SiteSection title="Each part, and how far it has come" lead="The tap check is built and tested on published examples. Registering tags, the tap page and owner records are designed, not built.">
        <CardGrid>
          <div id="tags-tap-check" className="grid scroll-mt-24">
            <FeatureCard id="tags-tap-check" />
          </div>
          <div id="tags-maker-register" className="grid scroll-mt-24">
            <FeatureCard id="tags-maker-register" />
          </div>
          <div id="tags-scan-page" className="grid scroll-mt-24">
            <FeatureCard id="tags-scan-page" />
          </div>
          <div id="tags-owner-record" className="grid scroll-mt-24">
            <FeatureCard id="tags-owner-record" />
          </div>
        </CardGrid>
      </SiteSection>
    </>
  );
}
