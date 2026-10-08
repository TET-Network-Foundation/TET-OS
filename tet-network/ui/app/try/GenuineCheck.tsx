"use client";

/**
 * "Is this genuine?" in plain words: who marked it, when it was recorded, what it is — and a
 * "check your copy" that hashes the visitor's file or text in this tab and says, in green, that it
 * matches exactly, or, in red, that it doesn't (one changed byte is enough). Records come from this
 * node's public registry and every one is checked here (lib/proof_code.ts); a record whose
 * signature doesn't check is shown in red, never as genuine.
 */
import { useEffect, useState } from "react";
import { sha256 } from "@noble/hashes/sha2";
import { findSignatures, registryRecords, type FoundSignature } from "../lib/proof_code";
import { mldsa44Verify } from "../lib/pqc";
import { FOCUS, MONO, cx } from "./ui";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Does `copy` hash to exactly the marked fingerprint? Pure. */
export function sameAsMarked(markedSha256: string, copy: Uint8Array): boolean {
  return hex(sha256(copy)) === markedSha256.toLowerCase();
}

function CheckCopy(props: { fileSha256: string; sample?: { url: string } }) {
  const { t } = useLang();
  const [result, setResult] = useState<null | { ok: boolean; what: string }>(null);
  const [text, setText] = useState("");
  const check = (bytes: Uint8Array, what: string) => setResult({ ok: sameAsMarked(props.fileSha256, bytes), what });
  const sample = async (change: boolean) => {
    const bytes = new Uint8Array(await (await fetch(props.sample!.url)).arrayBuffer());
    if (change) bytes[0] ^= 0x20; // change one letter's case: one byte
    check(bytes, change ? t("the sample with one letter changed") : t("the sample file"));
  };
  return (
    <div className="mt-3 space-y-2 border-t border-[#eceef1] pt-3">
      <p className="font-semibold">{t("Check your copy")}</p>
      <input type="file" aria-label={t("Your copy of the file")} onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) check(new Uint8Array(await f.arrayBuffer()), f.name);
      }} className="block text-[14px]" />
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("…or paste the text")} aria-label={t("Your copy of the text")} className={cx(FOCUS, "min-w-0 flex-1 rounded-md border border-[#c9ced4] px-2 py-1 text-[14px]")} />
        <button type="button" disabled={!text} onClick={() => check(new TextEncoder().encode(text), t("the text you pasted"))} className={cx(FOCUS, "rounded-md border border-[#c9ced4] px-2.5 py-1 text-[14px]")}>
          {t("Check")}
        </button>
      </div>
      {props.sample ? (
        <p className="text-[14px]">
          <button type="button" className={cx(FOCUS, "rounded-sm underline underline-offset-2")} onClick={() => void sample(false)}>
            {t("check the sample file")}
          </button>
          {" · "}
          <button type="button" className={cx(FOCUS, "rounded-sm underline underline-offset-2")} onClick={() => void sample(true)}>
            {t("now change one letter and check again")}
          </button>
        </p>
      ) : null}
      {result ? (
        result.ok ? (
          <p role="status" className="rounded-md border border-[#1f5132] bg-[#e8f5ec] px-3 py-2 text-[15px] font-semibold text-[#1f5132]">
            ✓ {t("Matches: {what} is exactly the one that was marked.", { what: result.what })}
          </p>
        ) : (
          <p role="status" className="rounded-md border border-[#8a1f1f] bg-[#fbeaea] px-3 py-2 text-[15px] font-semibold text-[#8a1f1f]">
            ✗ {t("Doesn't match: {what} is not the one that was marked. Even one changed byte makes a different fingerprint.", { what: result.what })}
          </p>
        )
      ) : null}
    </div>
  );
}

/** Results for a proof code, a file fingerprint or an ID: who, when, what, and "check your copy". */
export default function GenuineCheck(props: { query: string; fromMs?: number; toMs?: number; byFile?: boolean; sample?: { url: string }; onId?: (id: string) => void }) {
  const { t, locale } = useLang();
  const [hits, setHits] = useState<FoundSignature[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    setHits(null);
    setErr("");
    void (async () => {
      try {
        const c = await (await fetch(`${BASE}/chain`)).json();
        const chain = { chainId: String(c.chain_id), genesisHash: String(c.genesis_hash) };
        const found = await findSignatures({ query: props.query, chain, fromMs: props.fromMs, toMs: props.toMs, records: (q) => registryRecords(BASE, q), mldsa44Verify });
        if (on) setHits(found);
      } catch (e: unknown) {
        if (on) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      on = false;
    };
  }, [props.query, props.fromMs, props.toMs]);

  const exact = <p className="text-[13px] text-[#5d646d]">{t("Exact files only: re-compressed or edited copies won't match.")}</p>;
  if (err) return <p className="text-[14px] text-[#8a1f1f]">{t("The lookup failed: {why}", { why: err })}</p>;
  if (!hits) return <p className="text-[14px] text-[#5d646d]">{t("Looking it up…")}</p>;
  if (hits.length === 0)
    return (
      <div className="space-y-1">
        <p className="text-[15px]">{props.byFile ? t("Nobody has marked this exact file as genuine on this node.") : t("Nothing found. Only things their owners chose to publish are listed.")}</p>
        {props.byFile ? exact : null}
      </div>
    );
  return (
    <div className="space-y-3">
      {hits.map((h, i) => (
        <article key={i} className={cx("rounded-md border p-3 text-[15px]", h.verified ? "border-[#c9ced4]" : "border-[#8a1f1f]")}>
          {h.verified ? (
            <p className="text-[17px] font-semibold text-[#1f5132]">✓ {props.byFile ? t("Your file was marked as genuine") : t("Marked as genuine")}</p>
          ) : (
            <p className="text-[17px] font-semibold text-[#8a1f1f]">✗ {t("This record doesn't check out. Don't trust it.")}</p>
          )}
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-[#5d646d]">{t("Who")}</dt>
            <dd className="m-0">
              {t("ID")}{" "}
              {props.onId ? (
                <button type="button" title={t("Everything this ID has marked")} className={cx(FOCUS, MONO, "rounded-sm underline underline-offset-2")} onClick={() => props.onId!(h.signerEd25519)}>
                  {h.signerEd25519.slice(0, 8)}
                </button>
              ) : (
                <span className={MONO}>{h.signerEd25519.slice(0, 8)}</span>
              )}
            </dd>
            <dt className="text-[#5d646d]">{t("When")}</dt>
            <dd className="m-0">{t("recorded on this node at {when}", { when: new Date(h.publishedAtMs).toLocaleString(locale) })}</dd>
            <dt className="text-[#5d646d]">{t("What")}</dt>
            <dd className={cx(MONO, "m-0 break-all text-[13px]")}>{t("fingerprint (SHA-256)")} {h.fileSha256}</dd>
            <dt className="text-[#5d646d]">{t("Code")}</dt>
            <dd className={cx(MONO, "m-0")}>{h.code}</dd>
          </dl>
          {h.verified ? <p className="mt-2 text-[13.5px] text-[#5d646d]">{t("This shows that this ID marked this exact file and when this node recorded it. It doesn't show who is behind the ID, or that the content is original or true.")}</p> : <p className="mt-1 text-[13.5px]">{h.reason}</p>}
          {h.verified ? <CheckCopy fileSha256={h.fileSha256} sample={props.sample} /> : null}
          <p className="mt-2 text-[13px]">
            <button type="button" className={cx(FOCUS, "rounded-sm underline underline-offset-2 text-[#5d646d]")} onClick={() => download(`${h.code}.proof.json`, h.recordBytes)}>
              {t("Download the proof file")}
            </button>
          </p>
        </article>
      ))}
      {exact}
    </div>
  );
}
