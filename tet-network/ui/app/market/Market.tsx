"use client";

/**
 * /market (prototype, local only): one app, three tabs, built from the parts TET already has.
 *
 * - Delivery: a sender, a courier shown only as "a verified courier", a receiver. The handover is one
 *   record signed by both the courier and the receiver; the tag on the parcel is checked against the
 *   one the sender signed; the courier's permit is one-time.
 * - Booking: the customer has a different key (a pseudonym) at each shop; a shop sees how many times
 *   that pseudonym did not come, at that shop only.
 * - Listing: the shop signs its listing; a review counts only from the key a receipt names, once.
 *
 * All signing and checking is market_checks.ts (Sign anything's envelope, verify_anything's verifier). The
 * keys are made in this tab and nothing is sent anywhere. Payment is always "outside TET". Every
 * result carries Shows / Does not show. scripts/market_guard.mjs pins the checks and the wording.
 */
import { useMemo, useState, type ReactNode } from "react";
import { LangProvider, LangSwitch, useLang, type Lang, type T } from "../try/i18n";
import { Badge, Button, Input, MONO, TextArea, cx } from "../try/ui";
import { MARKET_DICTS } from "./i18n_market";
import {
  bookingRecord,
  checkDelivery,
  checkListing,
  checkReview,
  courierPermit,
  DOES_NOT_SHOW,
  freshKey,
  handoverRecord,
  listingRecord,
  noShows,
  parcelRecord,
  PAYMENT,
  receiptRecord,
  SAMPLE,
  reviewRecord,
  SHOWS,
  signRecord,
  TYPE,
  visitRecord,
  type Booking,
  type Envelope,
  type Key,
} from "./market_checks";

type Kind = keyof typeof SHOWS;
type Vars = Record<string, string | number>;

/** t() for /market: its own dictionaries (i18n_market.ts), keyed by the English text. */
export function marketT(lang: Lang): T {
  const dict = MARKET_DICTS[lang];
  return (en: string, vars?: Vars) => {
    const s = dict[en] ?? en;
    return vars ? s.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}

const short = (id: string) => `${id.slice(0, 8)}…`;

/** The banner at the top of the page. */
export function StatusBanner(props: { t: T }) {
  const { t } = props;
  return (
    <p role="status" className="rounded-md border border-[#e6d39a] bg-[#fdf8e7] px-3 py-2 text-[14px] text-[#6b4e00]">
      <strong>{t("prototype, local only")}</strong> · {t("Sample keys made in this tab. Nothing is sent anywhere, and nothing moves money.")}
    </p>
  );
}

/** Shows / Does not show for one tab, through t(). Under every result. */
export function ShowsBlock(props: { t: T; kind: Kind }) {
  const { t, kind } = props;
  return (
    <div className="grid gap-3 border-t border-[#eceef1] pt-2 sm:grid-cols-2">
      <div>
        <h4 className="mb-1 text-[14px] font-semibold">{t("Shows")}</h4>
        <ul className="list-disc space-y-0.5 pl-5 text-[14px] leading-relaxed text-[#3d434a]">
          {SHOWS[kind].map((s) => (
            <li key={s}>{t(s)}</li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-1 text-[14px] font-semibold">{t("Does not show")}</h4>
        <ul className="list-disc space-y-0.5 pl-5 text-[14px] leading-relaxed text-[#3d434a]">
          {DOES_NOT_SHOW[kind].map((s) => (
            <li key={s}>{t(s)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** One result: accepted or refused, the reason, and the two lists. */
export function ResultCard(props: { t: T; kind: Kind; title: string; ok: boolean; why?: string; vars?: { thing: string }; children?: ReactNode }) {
  const { t } = props;
  return (
    <section aria-label={props.title} className="space-y-2 rounded-md border border-[#e3e5e8] px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-[15.5px] font-semibold">{props.title}</h3>
        <Badge tone={props.ok ? "ok" : "bad"}>{props.ok ? t("ACCEPTED") : t("REFUSED")}</Badge>
      </div>
      {props.why ? <p className="text-[14.5px] text-[#8a1f1f]">{t(props.why, props.vars ? { thing: t(props.vars.thing) } : undefined)}</p> : null}
      {props.children}
      <ShowsBlock t={t} kind={props.kind} />
    </section>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-[14.5px]">
      <span className="text-[#5d646d]">{props.label}</span>
      <span>{props.children}</span>
    </div>
  );
}

function Payment(props: { t: T }) {
  return <Field label={props.t("Payment:")}>{props.t(PAYMENT)}</Field>;
}

// ── 1. Delivery ─────────────────────────────────────────────────────────────────────────────────

type DeliverySample = {
  sender: Key;
  receiver: Key;
  service: Key;
  tag: string;
  contents: string;
  parcel: Envelope;
  permit: Envelope;
  byCourier: Envelope;
  byReceiver: Envelope;
  used: Set<string>;
};
type Shown = { title: string; ok: boolean; why?: string; vars?: { thing: string } };

async function deliverySample(): Promise<DeliverySample> {
  const [sender, receiver, service, courier] = await Promise.all([freshKey(), freshKey(), freshKey(), freshKey()]);
  const tag = `TET-PARCEL-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8, "0")}`;
  const contents = SAMPLE.contents;
  const parcel = await signRecord(sender, TYPE.parcel, parcelRecord(tag, receiver.id, contents));
  const pr = courierPermit(tag, courier.id);
  const permit = await signRecord(service, TYPE.courierPermit, pr);
  const h = handoverRecord(tag, String(pr.permit_id), courier.id, receiver.id);
  const [byCourier, byReceiver] = await Promise.all([signRecord(courier, TYPE.handover, h), signRecord(receiver, TYPE.handover, h)]);
  return { sender, receiver, service, tag, contents, parcel, permit, byCourier, byReceiver, used: new Set() };
}

export function DeliveryRecord(props: { t: T; s: Pick<DeliverySample, "sender" | "receiver" | "tag" | "contents"> }) {
  const { t, s } = props;
  return (
    <div className="space-y-1 rounded-md bg-[#f6f7f8] px-3 py-2">
      <Field label={t("Parcel tag:")}>
        <span className={MONO}>{s.tag}</span>
      </Field>
      <Field label={t("Contents (as the sender wrote it):")}>{t(s.contents)}</Field>
      <Field label={t("Sender:")}>
        <span className={MONO}>{short(s.sender.id)}</span>
      </Field>
      <Field label={t("Courier:")}>{t("a verified courier")}</Field>
      <Field label={t("Receiver:")}>
        <span className={MONO}>{short(s.receiver.id)}</span>
      </Field>
      <Field label={t("Handover signed by:")}>{t("the courier and the receiver")}</Field>
      <Payment t={t} />
    </div>
  );
}

function DeliveryTab(props: { t: T }) {
  const { t } = props;
  const [s, setS] = useState<DeliverySample | null>(null);
  const [tagOnParcel, setTagOnParcel] = useState("");
  const [results, setResults] = useState<Shown[]>([]);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const n = await deliverySample();
      setS(n);
      setTagOnParcel(n.tag);
      setResults([]);
    } finally {
      setBusy(false);
    }
  };
  const handOver = async (title: string) => {
    if (!s) return;
    setBusy(true);
    try {
      const r = await checkDelivery({ parcel: s.parcel, tagOnParcel, permit: s.permit, courierService: s.service.id, handoverByCourier: s.byCourier, handoverByReceiver: s.byReceiver, used: s.used });
      setResults((old) => [{ title, ok: r.ok, why: r.ok ? undefined : r.why, vars: r.ok ? undefined : r.vars }, ...old]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-relaxed text-[#3d434a]">
        {t("A sender signs the parcel's tag. The courier service gives a courier a one-time permit for this one parcel. At the door, the courier and the receiver both sign the handover.")}
      </p>
      <Button onClick={start} disabled={busy}>
        {t("Try with a sample")}
      </Button>
      {s ? (
        <>
          <DeliveryRecord t={t} s={s} />
          <Input label={t("The tag on the parcel (change it to see the check fail)")} value={tagOnParcel} onChange={setTagOnParcel} mono />
          <div className="flex flex-wrap gap-2">
            <Button kind="secondary" onClick={() => handOver(t("Check the handover"))} disabled={busy}>
              {t("Check the handover")}
            </Button>
            <Button kind="secondary" onClick={() => handOver(t("Hand over again with the same permit"))} disabled={busy}>
              {t("Hand over again with the same permit")}
            </Button>
          </div>
        </>
      ) : null}
      {results.map((r, i) => (
        <ResultCard key={results.length - i} t={t} kind="delivery" title={r.title} ok={r.ok} why={r.why} vars={r.vars} />
      ))}
    </div>
  );
}

// ── 2. Booking ──────────────────────────────────────────────────────────────────────────────────

type Shop = { name: string; key: Key; pseudonym: Key; records: Booking[] };

async function bookingSample(): Promise<Shop[]> {
  const shops: Shop[] = [];
  for (const [name, history] of [
    [SAMPLE.shops[0], ["no-show", "came", "no-show"]],
    [SAMPLE.shops[1], ["came"]],
  ] as const) {
    const [key, pseudonym] = await Promise.all([freshKey(), freshKey()]);
    const records: Booking[] = [];
    for (const [i, outcome] of history.entries()) {
      const b = bookingRecord(key.id, pseudonym.id, `slot ${i + 1}`);
      records.push({ booking: await signRecord(pseudonym, TYPE.booking, b), visit: await signRecord(key, TYPE.visit, visitRecord(String(b.booking_id), outcome)) });
    }
    shops.push({ name, key, pseudonym, records });
  }
  return shops;
}

export function ShopView(props: { t: T; shop: Pick<Shop, "name" | "pseudonym">; count: { bookings: number; noShows: number } }) {
  const { t, shop, count } = props;
  return (
    <div className="space-y-1">
      <Field label={t("This customer's pseudonym here:")}>
        <span className={MONO}>{short(shop.pseudonym.id)}</span>
      </Field>
      <Field label={t("Bookings here:")}>{count.bookings}</Field>
      <Field label={t("Did not come, here:")}>{count.noShows}</Field>
      <Payment t={t} />
    </div>
  );
}

function BookingTab(props: { t: T }) {
  const { t } = props;
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [counts, setCounts] = useState<{ bookings: number; noShows: number }[]>([]);
  const [busy, setBusy] = useState(false);

  const recount = async (list: Shop[]) => setCounts(await Promise.all(list.map((s) => noShows(s.key.id, s.pseudonym.id, s.records))));
  const start = async () => {
    setBusy(true);
    try {
      const list = await bookingSample();
      setShops(list);
      await recount(list);
    } finally {
      setBusy(false);
    }
  };
  const book = async (i: number, outcome: "came" | "no-show") => {
    if (!shops) return;
    setBusy(true);
    try {
      const s = shops[i];
      const b = bookingRecord(s.key.id, s.pseudonym.id, `slot ${s.records.length + 1}`);
      const rec = { booking: await signRecord(s.pseudonym, TYPE.booking, b), visit: await signRecord(s.key, TYPE.visit, visitRecord(String(b.booking_id), outcome)) };
      const list = shops.map((x, j) => (j === i ? { ...x, records: [...x.records, rec] } : x));
      setShops(list);
      await recount(list);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-relaxed text-[#3d434a]">
        {t("The customer's device makes a different key for each shop, a pseudonym. A shop sees how many times that pseudonym booked and did not come, at that shop only.")}
      </p>
      <Button onClick={start} disabled={busy}>
        {t("Try with a sample")}
      </Button>
      {shops?.map((s, i) =>
        counts[i] ? (
          <ResultCard key={s.key.id} t={t} kind="booking" title={t("What {shop} sees", { shop: t(s.name) })} ok>
            <ShopView t={t} shop={s} count={counts[i]} />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button kind="quiet" onClick={() => book(i, "came")} disabled={busy}>
                {t("Book again: came")}
              </Button>
              <Button kind="quiet" onClick={() => book(i, "no-show")} disabled={busy}>
                {t("Book again: did not come")}
              </Button>
            </div>
          </ResultCard>
        ) : null,
      )}
      {shops ? <p className="text-[14px] text-[#5d646d]">{t("The two pseudonyms are different keys, so the two shops cannot match them to each other.")}</p> : null}
    </div>
  );
}

// ── 3. Listing ──────────────────────────────────────────────────────────────────────────────────

type ListingSample = { shop: Key; customer: Key; listing: Envelope; listingId: string; receipt: Envelope; used: Set<string> };

async function listingSample(): Promise<ListingSample> {
  const [shop, customer] = await Promise.all([freshKey(), freshKey()]);
  const listing = await signRecord(shop, TYPE.listing, listingRecord(SAMPLE.listingTitle, SAMPLE.listingText));
  const l = await checkListing(listing);
  if (!l.ok) throw new Error(l.why);
  const receipt = await signRecord(shop, TYPE.receipt, receiptRecord(l.listingId, customer.id));
  return { shop, customer, listing, listingId: l.listingId, receipt, used: new Set() };
}

export function ListingView(props: { t: T; title: string; text: string; shop: string }) {
  const { t } = props;
  return (
    <div className="space-y-1 rounded-md bg-[#f6f7f8] px-3 py-2">
      <p className="text-[16px] font-semibold">{t(props.title)}</p>
      <p className="text-[14.5px]">{t(props.text)}</p>
      <Field label={t("Signed by the shop's key:")}>
        <span className={MONO}>{short(props.shop)}</span>
      </Field>
      <Payment t={t} />
    </div>
  );
}

function ListingTab(props: { t: T }) {
  const { t } = props;
  const [s, setS] = useState<ListingSample | null>(null);
  const [as, setAs] = useState<"holder" | "stranger">("holder");
  const [stars, setStars] = useState("5");
  const [text, setText] = useState("");
  const [results, setResults] = useState<(Shown & { review?: string })[]>([]);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      setS(await listingSample());
      setResults([]);
      setText(t(SAMPLE.review));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!s) return;
    setBusy(true);
    try {
      // Someone without a receipt signs with their own key and has nothing to cite.
      const signer = as === "holder" ? s.customer : await freshKey();
      const rid = as === "holder" ? String(JSON.parse(atob(s.receipt.payload)).receipt_id) : "";
      const review = await signRecord(signer, TYPE.review, reviewRecord(s.listingId, rid, Number(stars), text.trim()));
      const r = await checkReview({ listing: s.listing, review, receipt: as === "holder" ? s.receipt : null, used: s.used });
      const title = as === "holder" ? t("A review from the customer with a receipt") : t("A review from someone without a receipt");
      setResults((old) => [{ title, ok: r.ok, why: r.ok ? undefined : r.why, vars: r.ok ? undefined : r.vars, review: r.ok ? `${"★".repeat(r.stars)} ${r.text}` : undefined }, ...old]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-relaxed text-[#3d434a]">
        {t("The shop signs its listing. A review counts only if it comes from a customer holding a receipt the shop signed, one review per receipt.")}
      </p>
      <Button onClick={start} disabled={busy}>
        {t("Try with a sample")}
      </Button>
      {s ? (
        <>
          <ResultCard t={t} kind="listing" title={t("The listing")} ok>
            <ListingView t={t} title={SAMPLE.listingTitle} text={SAMPLE.listingText} shop={s.shop.id} />
          </ResultCard>
          <div className="space-y-2 rounded-md border border-[#e3e5e8] px-4 py-3">
            <h3 className="text-[15.5px] font-semibold">{t("Write a review")}</h3>
            <div className="flex flex-wrap gap-4 text-[14.5px]">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={as === "holder"} onChange={() => setAs("holder")} />
                {t("as the customer with a receipt")}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={as === "stranger"} onChange={() => setAs("stranger")} />
                {t("as someone without a receipt")}
              </label>
            </div>
            <label className="block text-[14.5px]">
              <span className="mr-2">{t("Stars")}</span>
              <select value={stars} onChange={(e) => setStars(e.target.value)} className="min-h-9 rounded-md border border-[#c9ced4] bg-white px-2">
                {["5", "4", "3", "2", "1"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <TextArea label={t("Review")} value={text} onChange={setText} rows={2} maxLength={280} />
            <Button kind="secondary" onClick={submit} disabled={busy}>
              {t("Sign and check the review")}
            </Button>
          </div>
        </>
      ) : null}
      {results.map((r, i) => (
        <ResultCard key={results.length - i} t={t} kind="listing" title={r.title} ok={r.ok} why={r.why} vars={r.vars}>
          {r.review ? (
            <p className="text-[14.5px]">
              {r.review} <span className="text-[#5d646d]">· {t("a customer with a receipt")}</span>
            </p>
          ) : null}
        </ResultCard>
      ))}
    </div>
  );
}

// ── the page ────────────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "delivery", label: "Delivery" },
  { id: "booking", label: "Booking" },
  { id: "listing", label: "Listing" },
] as const;

function MarketInner() {
  const { lang } = useLang();
  const t = useMemo(() => marketT(lang), [lang]);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("delivery");
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 text-[#1c1f23]">
      <StatusBanner t={t} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold">{t("Market")}</h1>
          <p className="text-[15px] text-[#3d434a]">{t("Deliveries, bookings and listings, with signed records instead of trust in a platform.")}</p>
        </div>
        <LangSwitch />
      </header>
      <div role="tablist" aria-label={t("Market")} className="flex gap-1 border-b border-[#e3e5e8]">
        {TABS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={cx("min-h-11 px-3 text-[15px]", tab === x.id ? "border-b-2 border-[#1c1f23] font-semibold" : "text-[#5d646d]")}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "delivery" ? <DeliveryTab t={t} /> : tab === "booking" ? <BookingTab t={t} /> : <ListingTab t={t} />}
      </div>
    </main>
  );
}

export default function Market() {
  return (
    <LangProvider>
      <MarketInner />
    </LangProvider>
  );
}
