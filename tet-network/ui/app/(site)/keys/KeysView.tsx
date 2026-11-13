"use client";
/**
 * /keys: Sign in with TET (prototype, design not reviewed), where your key could live (an idea), and a
 * plain comparison with passwords and passkeys. Every feature goes through <FeatureCard id>; every
 * string through t(); every image is under /site/keys/.
 */
import { CardGrid, FeatureCard, Figure, Guess, Hero, Notice, SiteSection } from "../../site/kit";
import { SECTION } from "../../site/features/keys";
import { useSite } from "../../site/i18n";

/** One question per row; cells in the order Password, Passkey, Sign in with TET. */
const ROWS: { title: string; cells: { text: string }[] }[] = [
  {
    title: "Can a fake site trick you into handing it over?",
    cells: [
      { text: "Yes. You can type a password into a page that only looks like the real one." },
      { text: "No. Your phone or browser offers a passkey only to the site it was made for." },
      { text: "The design would check where the question came from. The prototype does not check this yet." },
    ],
  },
  {
    title: "What does the site keep?",
    cells: [
      { text: "Something to check your password against. If it leaks, your password can be guessed or reused." },
      { text: "A public key only. A leak gives nobody a way to sign in." },
      { text: "A public key only. In the design, two: one for each half of the signature." },
    ],
  },
  {
    title: "A different key for every site?",
    cells: [
      { text: "Only if you make up a new password for each site." },
      { text: "Yes, always." },
      { text: "In the design, yes, made from your 12 words. The prototype uses the one key you give it." },
    ],
  },
  {
    title: "Can you use it today?",
    cells: [
      { text: "Yes, everywhere." },
      { text: "Yes. It is built into phones, computers and browsers today." },
      { text: "No. It is a prototype that runs only on your own computer." },
    ],
  },
  {
    title: "Signatures and future quantum computers",
    cells: [
      { text: "A password is not a signature." },
      { text: "Most passkeys use one classical signature, which a large enough quantum computer could break." },
      { text: "Every answer carries two signatures: Ed25519, and ML-DSA-44, which is designed to resist quantum computers. Full quantum resistance of TET identities is not claimed yet." },
    ],
  },
  {
    title: "Can the same key sign other things?",
    cells: [
      { text: "No." },
      { text: "No. A passkey is made for signing in." },
      { text: "Yes: a TET key can also sign records. The design keeps sign-in signatures apart from records; the prototype only labels them, and that is not reviewed." },
    ],
  },
  {
    title: "If you lose it",
    cells: [
      { text: "Most sites can reset it, often by email." },
      { text: "Often kept in your phone or browser account, so a new device can get it back." },
      { text: "Nobody can recover your 12 words. A site that needs recovery keeps its own." },
    ],
  },
  {
    title: "Prove you belong to a group without saying who you are?",
    cells: [
      { text: "No." },
      { text: "Not what passkeys are for." },
      { text: "An idea in the design, using TET's existing membership proof. Not built for sign-in." },
    ],
  },
];

const COLUMNS = ["Password", "Passkey", "Sign in with TET"];

export default function KeysView() {
  const { t } = useSite();
  return (
    <>
      <Notice text="Nothing on this page runs for anyone today. Sign in with TET is a prototype that runs only on your own computer." />
      <Hero
        title="Your keys"
        sentence={SECTION.sentence}
        art={<Figure src="/site/keys/hero.svg" alt="A site asks a question, a key answers, and the site sees a key with a check mark, not a person." />}
      />

      <SiteSection
        id="sign-in"
        title="Sign in with TET"
        lead="A site asks your key a one-time question. Your key answers. The site checks the answer and learns a key, not your name."
      >
        <div className="flex flex-col gap-8">
          <Figure
            wide
            src="/site/keys/signin-steps.svg"
            alt="Three steps: the site asks a one-time question, your key answers with two signatures, the site checks the answer and sees a key, not a person."
            caption="1. The site asks a one-time question. 2. Your key answers it. 3. The site checks the answer, and refuses it if it is sent twice, meant for another site, or too late."
          />
          <CardGrid>
            <FeatureCard id="sign-in-with-tet" />
            <FeatureCard id="sign-in-as-member" />
          </CardGrid>
          <div className="grid gap-6 sm:grid-cols-2">
            <Figure
              src="/site/keys/signin-phone-light.png"
              alt="Screenshot of the sign-in walkthrough on a phone: the site asks a question, your key answers, and the site accepts the answer."
              caption="The sign-in walkthrough page on a phone. It replays a recording of a real run of the prototype; it signs nothing and sends nothing. The page is waiting for review and is not on this site yet."
            />
            <Figure
              src="/site/keys/signin-desktop-dark.png"
              alt="Screenshot of the same walkthrough on a computer, in dark mode, with what the accepted answer shows and does not show."
              caption="The same walkthrough on a computer, in dark mode. Under the answer: what it shows, and what it does not."
            />
          </div>
        </div>
      </SiteSection>

      <SiteSection
        id="where"
        title="Where your key lives"
        lead="Today the prototype makes your key from 12 words you give it. One idea is to keep the key in a phone's secure hardware instead, where it never leaves the phone."
      >
        <div className="flex flex-col gap-8">
          <CardGrid>
            <FeatureCard id="key-on-device" />
          </CardGrid>
          <Guess title="On a phone this could look like…">
            <div className="flex flex-col gap-6">
              <p>{t("Drawn to explain an idea. No code does this today. The phone is a generic phone with secure hardware, not any real model.")}</p>
              <div className="grid gap-6 sm:grid-cols-3">
                <Figure
                  src="/site/keys/phone-1-ask.svg"
                  alt="A generic phone showing a site's one-time question, with a button to answer and a button to refuse."
                  caption="1. A site asks a question. You see which site is asking, and choose to answer or not."
                />
                <Figure
                  src="/site/keys/phone-2-inside.svg"
                  alt="A generic phone with a secure chip inside; the key is locked in the chip, and an arrow leaving the phone is crossed out."
                  caption="2. You unlock with the phone's own lock. The key stays inside the phone's secure hardware; it is never copied out."
                />
                <Figure
                  src="/site/keys/phone-3-answer.svg"
                  alt="A generic phone sends an answer; below it, the site sees a key with a check mark, and a person crossed out."
                  caption="3. Only the answer leaves the phone. The site sees that this key answered, not your name."
                />
              </div>
            </div>
          </Guess>
        </div>
      </SiteSection>

      <SiteSection
        id="compare"
        title="Passwords, passkeys and TET"
        lead="Passkeys already do the hard parts of signing in well. They resist fake sites, use a new key for every site, and are built into the phones and browsers you have today. TET does not claim to do these better."
      >
        <div className="flex flex-col gap-4">
          {ROWS.map((row) => (
            <section key={row.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h3 className="text-lg font-semibold">{t(row.title)}</h3>
              <dl className="mt-3 grid gap-4 sm:grid-cols-3">
                {row.cells.map((c, i) => (
                  <div key={COLUMNS[i]} className="flex flex-col gap-1">
                    <dt className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t(COLUMNS[i])}</dt>
                    <dd className="text-base leading-relaxed text-slate-700 dark:text-slate-300">{t(c.text)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="max-w-3xl text-lg leading-relaxed text-slate-700 dark:text-slate-300">
            {t("Where the design differs: two signatures on every answer, one of them designed to resist quantum computers, and a key that can also sign records. What it does not do yet: run for anyone, work in a browser or on a phone, or protect against fake sites.")}
          </p>
        </div>
      </SiteSection>
    </>
  );
}
