"use client";

/**
 * Sealed prediction (lib/seal.ts): write a prediction, choose when it opens (1–30 days on this
 * node), seal it. Only the fingerprint is recorded; you get a card image to share (code, opening
 * date, chain height — never the text) and a private reveal link. Opening a reveal link checks the
 * text against the record: green "written at …, unchanged", or red.
 */
import { useEffect, useRef, useState } from "react";
import { findSignatures, publishRecord, registryRecords, signFileHash, type FoundSignature } from "../lib/proof_code";
import { cardLines, isOpen, newSeal, opensOn, parseReveal, revealFragment, sealFingerprint, SEAL_MAX_DAYS, SEAL_MIN_DAYS, type Sealed } from "../lib/seal";
import { expectedChainBinding } from "../lib/chain_binding";
import { mldsa44Verify } from "../lib/pqc";
import { Button, FOCUS, MONO, PanelHead, cx } from "./ui";
import { BASE, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

async function chainHeight(): Promise<number | null> {
  try {
    const r = await fetch(`${BASE}/explorer/blocks/recent?n=1`);
    const j = (await r.json()) as { blocks?: { height: number }[] };
    return j.blocks?.[0]?.height ?? null;
  } catch {
    return null;
  }
}

/** The card as a PNG data URL: dark, three lines, the code large. Only public text. */
function drawCard(lines: string[], link: string): string {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 630;
  const g = c.getContext("2d")!;
  g.fillStyle = "#14161a";
  g.fillRect(0, 0, 1200, 630);
  g.fillStyle = "#8fd3a8";
  g.font = "600 40px ui-monospace, Menlo, monospace";
  g.fillText("TET", 80, 110);
  g.fillStyle = "#c9d1d9";
  g.font = "34px ui-monospace, Menlo, monospace";
  g.fillText(lines[0], 80, 230);
  g.fillStyle = "#ffffff";
  g.font = "700 96px ui-monospace, Menlo, monospace";
  g.fillText(lines[1], 80, 380);
  g.fillStyle = "#8b949e";
  g.font = "28px ui-monospace, Menlo, monospace";
  g.fillText(link, 80, 520);
  return c.toDataURL("image/png");
}

function Reveal(props: { bytes: Uint8Array; sealed: Sealed }) {
  const { t, locale } = useLang();
  const [hit, setHit] = useState<FoundSignature | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    void (async () => {
      const chain = await expectedChainBinding(BASE);
      const found = await findSignatures({ query: sealFingerprint(props.bytes), chain, records: (q) => registryRecords(BASE, q), mldsa44Verify }).catch(() => []);
      // The earliest valid record is the seal (later ones can't hide it: the registry lists a file's first marks first).
      // Only a record of exactly these bytes counts (matched by its fingerprint, not by an ID that
      // happens to look the same), and only one whose signature checks.
      const ok = found.filter((f) => f.match === "file" && f.verified).sort((a, b) => a.publishedAtMs - b.publishedAtMs)[0];
      if (on) setHit(ok ?? null);
    })();
    return () => {
      on = false;
    };
  }, [props.bytes]);
  const early = !isOpen(props.sealed.opens, Date.now());
  return (
    <div className="space-y-3">
      <p className="text-[14px] text-[#5d646d]">{t("A sealed prediction, opened")}</p>
      <blockquote className="whitespace-pre-wrap rounded-md border border-[#c9ced4] p-4 text-[18px]">{props.sealed.text}</blockquote>
      {hit === undefined ? (
        <p className="text-[14px] text-[#5d646d]">{t("Checking it against the seal…")}</p>
      ) : hit ? (
        <p role="status" className="rounded-md border border-[#1f5132] bg-[#e8f5ec] px-3 py-2 text-[16px] font-semibold text-[#1f5132]">
          ✓ {t("Written by {when}, unchanged since.", { when: new Date(hit.publishedAtMs).toLocaleString(locale) })}
        </p>
      ) : (
        <p role="status" className="rounded-md border border-[#8a1f1f] bg-[#fbeaea] px-3 py-2 text-[16px] font-semibold text-[#8a1f1f]">
          ✗ {t("Doesn't match any seal on this node: this text was changed, or never sealed here.")}
        </p>
      )}
      {hit ? (
        <p className="text-[14px]">
          {t("Sealed by ID")} <span className={MONO}>{hit.signerEd25519.slice(0, 8)}</span> · {t("code")} <span className={MONO}>{hit.code}</span> · {t("opens {date}", { date: props.sealed.opens })}
        </p>
      ) : null}
      {early ? <p className="text-[14px] text-[#6b4e00]">{t("This was opened before its date ({date}).", { date: props.sealed.opens })}</p> : null}
      <p className="text-[14px] text-[#5d646d]">{t("This shows the text existed when this node recorded the seal, and hasn't changed since. It doesn't show the prediction was right, or that the author didn't seal many different predictions and open only the one that came true.")}</p>
    </div>
  );
}

export default function SealPanel() {
  const { t } = useLang();
  const { ensureWallet } = useTryWallet();
  const [text, setText] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ code: string; opens: string; card: string; shareLink: string; revealLink: string } | null>(null);
  const [reveal, setReveal] = useState<{ bytes: Uint8Array; sealed: Sealed } | null>(null);
  const [copied, setCopied] = useState("");
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const r = parseReveal(window.location.hash);
    if (r) setReveal(r);
  }, []);

  const opens = opensOn(Date.now(), days);
  async function seal() {
    setErr("");
    setBusy(true);
    try {
      await ensureWallet();
      const bytes = newSeal(text.trim(), opens);
      const chain = await expectedChainBinding(BASE);
      const rec = await signFileHash(bytes, chain);
      const code = await publishRecord(BASE, rec.bytes, chain);
      const height = await chainHeight();
      const shareLink = `${window.location.origin}/try#code=${code}`;
      const revealLink = `${window.location.origin}/try?tab=seal#${revealFragment(bytes)}`;
      setDone({ code, opens, card: drawCard(cardLines({ code, opens, height }), shareLink), shareLink, revealLink });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const copy = (what: string, s: string) => {
    void navigator.clipboard?.writeText(s);
    setCopied(what);
  };

  return (
    <section aria-label={t("Sealed prediction")}>
      <PanelHead title={t("Sealed prediction")} todo={t("Write a prediction and choose when it opens. Only its fingerprint is recorded now; the text stays hidden until you reveal it.")} />
      <div className="max-w-[40rem] space-y-4 px-4 pb-6 pt-3 md:px-5">
        {reveal ? (
          <Reveal bytes={reveal.bytes} sealed={reveal.sealed} />
        ) : !done ? (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} aria-label={t("Your prediction")} placeholder={t("e.g. It will snow in Tokyo on 1 December.")} className={cx(FOCUS, "w-full rounded-md border border-[#c9ced4] p-3 text-[17px]")} />
            <label className="block text-[15px]">
              {t("Opens in")}{" "}
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={cx(FOCUS, "rounded border border-[#c9ced4] px-1 py-1")}>
                {Array.from({ length: SEAL_MAX_DAYS - SEAL_MIN_DAYS + 1 }, (_, i) => i + SEAL_MIN_DAYS).map((d) => (
                  <option key={d} value={d}>
                    {t("in {n} days", { n: d })}
                  </option>
                ))}
              </select>{" "}
              → <span className={MONO}>{opens}</span> <span className="text-[13px] text-[#5d646d]">{t("(this node allows 1 to 30 days)")}</span>
            </label>
            <Button disabled={!text.trim() || busy} onClick={() => void seal()}>
              {busy ? t("Sealing…") : t("Seal it")}
            </Button>
            <p className="text-[14px] text-[#5d646d]">{t("Only a fingerprint of your prediction is recorded on this node, with your ID. Nobody can read it until you share the reveal link.")}</p>
            {err ? <p className="text-[14px] text-[#8a1f1f]">{err}</p> : null}
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-[17px] font-semibold text-[#1f5132]">✓ {t("Sealed. It opens on {date}.", { date: done.opens })}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={done.card} alt={t("The card: sealed, opening date, proof code")} className="w-full rounded-md border border-[#c9ced4]" />
            <div className="flex flex-wrap gap-2">
              <a href={done.card} download={`tet-seal-${done.code}.png`} className={cx(FOCUS, "rounded-md bg-[#1c1f23] px-3 py-2 text-[15px] font-semibold text-white")}>
                {t("Save the card")}
              </a>
              <a
                href={`https://x.com/intent/post?text=${encodeURIComponent(t("I sealed a prediction. It opens on {date}.", { date: done.opens }) + " #TET予言 " + done.shareLink)}`}
                target="_blank"
                rel="noreferrer"
                className={cx(FOCUS, "rounded-md border border-[#c9ced4] px-3 py-2 text-[15px]")}
              >
                {t("Share on X")}
              </a>
              <Button kind="secondary" onClick={() => copy("share", done.shareLink)}>
                {copied === "share" ? t("Copied") : t("Copy the share link")}
              </Button>
            </div>
            <div className="rounded-md border border-[#6b4e00] bg-[#fff6dc] p-3 text-[14px]">
              <p className="font-semibold">{t("Your reveal link: keep it private until {date}", { date: done.opens })}</p>
              <p className="mt-1">{t("Anyone with this link can read the prediction. On the day, share it: that is the reveal. Lose it and the prediction can't be opened.")}</p>
              <p className={cx(MONO, "mt-2 break-all text-[12px]")}>{done.revealLink}</p>
              <Button kind="secondary" onClick={() => copy("reveal", done.revealLink)}>
                {copied === "reveal" ? t("Copied") : t("Copy the reveal link")}
              </Button>
            </div>
            <p className="text-[14px] text-[#5d646d]">{t("This shows the text existed when this node recorded the seal, and hasn't changed since. It doesn't show the prediction was right, or that the author didn't seal many different predictions and open only the one that came true.")}</p>
            <p className="text-[14px] text-[#5d646d]">{t("Hashtag: #TET予言")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
