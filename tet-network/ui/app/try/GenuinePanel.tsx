"use client";

/**
 * "Mark as genuine": TET's headline in one step. Pick a file or type text, press one button: the
 * fingerprint (SHA-256) is signed with your ID (made silently on first use) and published to this
 * node's public registry with your consent; you get a proof code, a QR and a share link. Anyone
 * types the code on the home page, or drops the file, and sees who, when and what — and whether
 * their copy matches exactly. The file itself never leaves this tab.
 *
 * Then, optionally, "Anchor on chain" (the hash-only stamp, lib/hash_stamp.ts): the record (never the
 * file) is stamped like a .sig.json, so a block holds 128 bits of its fingerprint and the proof
 * code shows "existed before block N". You get a .stamp.json receipt.
 */
import { useState } from "react";
import { signFileHash, publishRecord } from "../lib/proof_code";
import { anchorRecord, type AnchorStep } from "../lib/hash_stamp";
import { getTmailKeySession } from "../lib/tmail_session";
import type { StampReceipt } from "../lib/sign_anything";
import { expectedChainBinding } from "../lib/chain_binding";
import { qrSvgPath } from "../lib/tet_qr";
import { Button, FOCUS, KeysBanner, MONO, PanelHead, cx } from "./ui";
import { BASE, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GenuinePanel() {
  const { t } = useLang();
  const { ensureWallet, ensureMessagingKeys, keys } = useTryWallet();
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ code: string; record: Uint8Array; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<AnchorStep | "">("");
  const [anchor, setAnchor] = useState<StampReceipt | null>(null);
  const [anchorErr, setAnchorErr] = useState("");
  const [publishing, setPublishing] = useState(false);

  async function anchorIt() {
    if (!done) return;
    setAnchorErr("");
    try {
      const me = await ensureWallet();
      const ks = getTmailKeySession();
      if (!ks) throw new Error("no wallet in this tab");
      const chain = await expectedChainBinding(BASE);
      const receipt = await anchorRecord({ baseUrl: BASE, record: done.record, me, keys: { x25519_pub: ks.x25519_pub, mlkem_pub: ks.mlkem_pub }, chain, onStep: setStep });
      setAnchor(receipt);
      download(`${done.code}.stamp.json`, new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`));
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setAnchorErr(m.startsWith("timeout:") ? t("The fee wasn't on chain within two minutes. Try again in a while.") : t("Not anchored: {why}", { why: m }));
    } finally {
      setStep("");
    }
  }
  const stepText: Record<AnchorStep, string> = {
    upload: t("Storing the proof file, encrypted to you…"),
    fee: t("Asking the demo's sponsor to cover the fee…"),
    mined: t("Waiting for the fee to be mined…"),
    link: t("Linking the anchor to your proof code…"),
  };

  async function mark() {
    setErr("");
    setBusy(true);
    try {
      await ensureWallet();
      const bytes = mode === "file" ? new Uint8Array(await file!.arrayBuffer()) : new TextEncoder().encode(text);
      const chain = await expectedChainBinding(BASE);
      const rec = await signFileHash(bytes, chain);
      const code = await publishRecord(BASE, rec.bytes, chain);
      setDone({ code, record: rec.bytes, name: mode === "file" ? file!.name : "text" });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const link = done && typeof window !== "undefined" ? `${window.location.origin}/try#code=${done.code}` : "";
  const ready = mode === "file" ? !!file : !!text.trim();

  return (
    <section aria-label={t("Mark as genuine")}>
      <PanelHead title={t("Mark as genuine")} todo={t("Pick a file or write some text, then press the button. You get a code anyone can use to check it.")} />
      <div className="max-w-[40rem] space-y-4 px-4 pb-6 pt-3 md:px-5">
        {!done ? (
          <>
            <div className="flex gap-2" role="radiogroup" aria-label={t("What to mark")}>
              {(["file", "text"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cx(FOCUS, "rounded-md border px-3 py-1.5 text-[15px]", mode === m ? "border-[#1c1f23] bg-[#1c1f23] text-white" : "border-[#c9ced4]")}>
                  {m === "file" ? t("A file") : t("Some text")}
                </button>
              ))}
            </div>
            {mode === "file" ? (
              <label className="block rounded-md border border-dashed border-[#c9ced4] bg-[#fafbfc] p-4 text-center text-[15px]">
                {file ? file.name : t("Choose a file (it stays on your device)")}
                <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            ) : (
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label={t("Text to mark")} placeholder={t("Write or paste the text…")} className={cx(FOCUS, "w-full rounded-md border border-[#c9ced4] p-3 text-[16px]")} />
            )}
            <Button disabled={!ready || busy} onClick={() => void mark()}>
              {busy ? t("Marking…") : t("Mark as genuine")}
            </Button>
            <p className="text-[14px] text-[#5d646d]">{t("Only the fingerprint (SHA-256) of your file or text is recorded, never the content. It's published on this node with your ID, so anyone can look it up.")}</p>
            {err ? <p className="text-[14px] text-[#8a1f1f]">{err}</p> : null}
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-[17px] font-semibold text-[#1f5132]">✓ {t("Marked as genuine")}</p>
            <p className="text-[14px] text-[#5d646d]">{t("Your proof code")}</p>
            <p translate="no" className={cx(MONO, "text-[30px] font-bold tracking-wide")}>
              {done.code}
            </p>
            {(() => {
              const { size, d } = qrSvgPath(link);
              return (
                <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("QR code for this proof code")} className="block h-44 w-44 bg-white" shapeRendering="crispEdges">
                  <rect width={size} height={size} fill="#fff" />
                  <path d={d} fill="#000" />
                </svg>
              );
            })()}
            <p className="break-all text-[14px]">{link}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(link);
                  setCopied(true);
                }}
              >
                {copied ? t("Copied") : t("Copy the link")}
              </Button>
              <Button kind="secondary" onClick={() => download(`${done.code}.proof.json`, done.record)}>
                {t("Download the proof file")}
              </Button>
              <Button
                kind="quiet"
                onClick={() => {
                  setDone(null);
                  setFile(null);
                  setText("");
                  setCopied(false);
                  setAnchor(null);
                  setAnchorErr("");
                }}
              >
                {t("Mark something else")}
              </Button>
            </div>
            <p className="text-[14px]">{t("Anyone can check it: type the code into the search box on the TET home page, or open the link.")}</p>
            <p className="text-[14px] text-[#5d646d]">{t("This shows that your ID marked this exact file and when this node recorded it. It doesn't show who is behind the ID, or that the content is original or true.")}</p>
            <div className="space-y-2 border-t border-[#eceef1] pt-3">
              <p className="font-semibold">{t("Anchor on chain")}</p>
              {anchor ? (
                <>
                  <p role="status" className="text-[15px] font-semibold text-[#1f5132]">✓ {t("Anchored on chain at block {height}.", { height: anchor.block_height })}</p>
                  <Button kind="secondary" onClick={() => download(`${done.code}.stamp.json`, new TextEncoder().encode(`${JSON.stringify(anchor, null, 2)}\n`))}>
                    {t("Download the stamp receipt")}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-[14px]">{t("Optional: a block on the chain records 128 bits of this proof file's fingerprint, so its place in time doesn't rest on this node's clock. Nothing of your file leaves this tab: only the small proof file is stored, encrypted to you, for 7 days.")}</p>
                  {keys !== "published" ? (
                    <KeysBanner
                      what={t("To anchor, first turn on your inbox (the proof file is stored encrypted to you).")}
                      busy={publishing}
                      onPublish={() => {
                        setPublishing(true);
                        void ensureMessagingKeys()
                          .catch((e: unknown) => setAnchorErr(e instanceof Error ? e.message : String(e)))
                          .finally(() => setPublishing(false));
                      }}
                    />
                  ) : (
                    <Button disabled={!!step} onClick={() => void anchorIt()}>
                      {step ? stepText[step] : t("Anchor on chain")}
                    </Button>
                  )}
                </>
              )}
              <p className="text-[13.5px] text-[#5d646d]">{t("It shows the proof file existed before that block. Blocks don't carry a date yet, and today one node makes them all.")}</p>
              {anchorErr ? <p className="text-[14px] text-[#8a1f1f]">{anchorErr}</p> : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
