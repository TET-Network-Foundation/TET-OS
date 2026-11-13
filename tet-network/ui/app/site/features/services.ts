/** The services section: its card on the home page, and every feature it names (with a status). */
import type { Evidence, Feature, Section } from "../types";

export const SECTION: Section = {
  href: "/services",
  title: "Everyday services",
  sentence: "Bookings, deliveries and reviews that rest on signed records instead of trust in one platform.",
};

/** All three run on /market, a prototype on branch ui/market (no PR yet). Its own Shows / Does not show are the basis. */
const MARKET: Evidence[] = [{ branch: "ui/market", what: "/market prototype" }];
const TRY = { href: "/market", label: "Try it on /market" };

export const FEATURES: Feature[] = [
  {
    id: "services-booking",
    title: "Booking with a different name at each shop",
    summary:
      "Your device makes a different key for each shop: a pseudonym. A shop sees how many times that pseudonym booked and did not come, at that shop only.",
    status: "prototype",
    evidence: MARKET,
    shows: ["How many times this pseudonym booked at this shop and did not come, by this shop's own signed records."],
    doesNot: [
      "Who the person booking is.",
      "Their record at any other shop: there they use another pseudonym.",
      "That they did not start over: a person can drop a pseudonym with no-shows and start a new one, which looks like someone new.",
      "That the shop marked \"did not come\" fairly: these are the shop's own records.",
      "How anyone settles up: that happens outside TET.",
    ],
    link: TRY,
  },
  {
    id: "services-delivery",
    title: "Delivery handover records",
    summary:
      "The sender signs the parcel's tag. The courier service gives a courier a one-time permit for this one parcel. At the door, the courier and the receiver both sign the handover.",
    status: "prototype",
    evidence: MARKET,
    shows: [
      "The sender's key signed this parcel record, with this tag and this receiver.",
      "The tag on the parcel is the one the sender signed.",
      "A courier the courier service gave a one-time permit to, and the receiver's key, both signed this handover.",
      "This permit was used once, here.",
    ],
    doesNot: [
      "Who the courier is: the page says only \"a verified courier\". The courier service knows which courier it gave the permit to.",
      "What is inside the parcel: the contents line is what the sender wrote.",
      "Who holds each key.",
      "That nobody with a copy of the courier's key used the permit somewhere else: only this record keeper's list is checked.",
      "How anyone settles up: that happens outside TET.",
    ],
    link: TRY,
  },
  {
    id: "services-reviews",
    title: "A market where only buyers can review",
    summary:
      "The shop signs its listing. A review counts only if it comes with a receipt the shop signed, from the key that receipt names, one review per receipt.",
    status: "prototype",
    evidence: MARKET,
    shows: [
      "The shop's key signed this listing, and it has not changed since.",
      "Each review shown cites a receipt this shop's key signed, and is signed by the key that receipt names.",
      "Each receipt carries one review at most.",
    ],
    doesNot: [
      "That the buyer settled up: that happens outside TET, and the receipt says only that the shop issued it.",
      "That the shop did not give receipts to friends.",
      "That a review is true, or who wrote it.",
    ],
    link: TRY,
  },
];
