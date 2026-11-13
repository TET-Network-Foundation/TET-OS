"use client";
/**
 * /services: bookings, deliveries and a market where only buyers can review. All three are the
 * /market prototype (branch ui/market); every claim here is the one /market makes, never more.
 */
import { FeatureCard, Figure, Hero, Notice, SiteSection } from "../../site/kit";
import { SECTION } from "../../site/features/services";
import { useSite } from "../../site/i18n";
import type { ReactNode } from "react";

type Benefit = { title: string; text: string };

const BOOKING: Benefit[] = [
  { title: "Shops cannot compare notes", text: "Each shop gets a different key from you, so two shops cannot match their records to each other." },
  { title: "A key, not your name", text: "A booking names a key, a shop and a time. Your name and number are not in it." },
  { title: "Shops still see no-shows", text: "A shop can count how often this pseudonym booked and did not come, from its own signed records." },
];
const DELIVERY: Benefit[] = [
  { title: "Both sides sign", text: "The handover is signed by the courier and by the receiver, not taken on one side's word." },
  { title: "The right parcel", text: "The tag on the parcel must be the one the sender signed. Any other tag fails the check." },
  { title: "One permit, one handover", text: "A second handover with the same permit is refused by the record keeper that saw the first." },
];
const REVIEWS: Benefit[] = [
  { title: "Reviews come with a receipt", text: "A review without a receipt the shop signed does not count." },
  { title: "One receipt, one review", text: "The same receipt cannot carry a second review." },
  { title: "Listings stay as signed", text: "The shop's key signed the listing. Any change after that fails the check." },
];

function Benefits(props: { items: Benefit[] }) {
  const { t } = useSite();
  return (
    <ul className="flex flex-col gap-4">
      {props.items.map((b) => (
        <li key={b.title} className="rounded-2xl bg-teal-50 p-5 dark:bg-teal-950">
          <p className="text-lg font-semibold">{t(b.title)}</p>
          <p className="mt-1 text-base leading-relaxed text-slate-700 dark:text-slate-300">{t(b.text)}</p>
        </li>
      ))}
    </ul>
  );
}

/** One service: its diagram and three benefits side by side, the settling-up line, then its feature card. */
function Service(props: { diagram: ReactNode; items: Benefit[]; card: ReactNode }) {
  const { t } = useSite();
  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-6 md:grid-cols-2">
        {props.diagram}
        <Benefits items={props.items} />
      </div>
      <p className="text-lg font-medium">{t("Settling up happens outside TET (cash, bank, …).")}</p>
      {props.card}
    </div>
  );
}

function SettleUp() {
  const { t } = useSite();
  return (
    <p className="max-w-3xl text-lg leading-relaxed text-slate-700 dark:text-slate-300">
      {t("No record here carries an amount. The records say who signed what, and settling up happens outside TET (cash, bank, …).")}
    </p>
  );
}

export default function Services() {
  return (
    <>
      <Notice text="Nothing on this page runs for anyone today. All three services are one prototype, /market, that runs only on your own computer, with sample keys." />
      <Hero
        title={SECTION.title}
        sentence={SECTION.sentence}
        art={<Figure src="/site/services/hero.svg" alt="A calendar, a parcel and a review, each joined to one check mark: each rests on a signed record." />}
      />
      <SiteSection
        title="Settling up stays outside TET"
      >
        <SettleUp />
      </SiteSection>
      <SiteSection
        id="booking"
        title="Booking"
        lead="Your device makes a different key for each shop you book with. Two shops cannot match those keys to each other."
      >
        <Service
          items={BOOKING}
          diagram={
            <Figure
              src="/site/services/booking.svg"
              alt="A phone holds two different keys, one for each of two shops. Each shop keeps its own record for its key; the two keys cannot be matched."
              caption="1 Your device makes a different key for each shop. 2 Each shop keeps its own signed record for that key: came, or did not come. 3 The two keys cannot be matched to each other."
            />
          }
          card={<FeatureCard id="services-booking" />}
        />
      </SiteSection>
      <SiteSection
        id="delivery"
        title="Delivery"
        lead="A parcel's journey ends with one record that both the courier and the receiver signed, for the parcel the sender signed."
      >
        <Service
          items={DELIVERY}
          diagram={
            <Figure
              src="/site/services/delivery.svg"
              alt="A parcel with a signed tag, a permit marked 1× from the courier service, a van, and at the door a handover with two signatures."
              caption="1 The sender signs the parcel's tag. 2 The courier service gives one courier a permit that works once, for this parcel. 3 At the door, the courier and the receiver both sign the handover."
            />
          }
          card={<FeatureCard id="services-delivery" />}
        />
      </SiteSection>
      <SiteSection
        id="market"
        title="Market"
        lead="A review counts only when it comes with a receipt the shop signed. One receipt carries one review."
      >
        <Service
          items={REVIEWS}
          diagram={
            <Figure
              src="/site/services/reviews.svg"
              alt="A shop with a signed listing, a signed receipt, a review with the receipt that is accepted, and a review without one that is refused."
              caption="1 The shop signs its listing. 2 The shop signs a receipt naming the buyer's key. 3 A review with that receipt counts; one without a receipt does not."
            />
          }
          card={<FeatureCard id="services-reviews" />}
        />
      </SiteSection>
      <SiteSection
        id="prototype"
        title="See the prototype"
        lead="/market is the prototype behind all three. The keys are samples made in your browser tab, and nothing is sent anywhere."
      >
        <Figure
          src="/site/services/market-delivery-en.png"
          alt="The /market page, Delivery tab, after a sample: the parcel tag, a verified courier, the receiver's key, and Settled: outside TET (cash, bank, …)."
          caption="The /market prototype, Delivery tab, with a sample. A screenshot of our own page, in English."
        />
      </SiteSection>
    </>
  );
}
