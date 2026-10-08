"use client";

/**
 * Proof codes on /try (lib/proof_code.ts): the badge shown after signing (code, QR, link, the
 * hash-only record) and the search results for a code, a file hash or a signer key. A proof code
 * finds a published record; the record's signatures prove it. Never called a key.
 */
import { useEffect, useState } from "react";
import { findSignatures, registryRecords, type FoundSignature } from "../lib/proof_code";
import { mldsa44Verify } from "../lib/pqc";
import { qrSvgPath } from "../lib/tet_qr";
import { Badge, Button, MONO, cx } from "./ui";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

export function codeLink(code: string): string {
  return `${window.location.origin}/try#code=${code}`;
}

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The badge: a proof code with its QR and link, and the hash-only record to keep. */
export function ProofCodeBox(props: { code: string; recordBytes: Uint8Array; name: string }) {
  const { t } = useLang();
  const url = codeLink(props.code);
  const { size, d } = qrSvgPath(url);
  return (
    <div className="tet-print max-w-[24rem] space-y-2 rounded-md border border-[#e3e5e8] p-3">
      <p className="text-[13px] text-[#5d646d]">{t("Proof code")}</p>
      <p translate="no" className={cx(MONO, "text-[22px] font-semibold tracking-wide")}>
        {props.code}
      </p>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("QR code for this proof code")} className="block h-40 w-40 bg-white" shapeRendering="crispEdges">
        <rect width={size} height={size} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
      <p className="text-[14px]">{t("The code finds it; the signature proves it.")}</p>
      <p className="text-[14px] text-[#5d646d]">{t("Proves this key signed this file's SHA-256, and that it was published on this node at that time. Doesn't prove the work is original or that a person made it.")}</p>
      <p className="text-[14px] text-[#5d646d]">{t("Published in this node's public signature registry, at your request. Keep the .sig.json: with it and the file, anyone can check the signature in Verify.")}</p>
      <div className="flex flex-wrap gap-2">
        <Button kind="secondary" onClick={() => void navigator.clipboard?.writeText(url)}>
          {t("Copy the link")}
        </Button>
        <Button kind="secondary" onClick={() => download(`${props.name}.hash.sig.json`, props.recordBytes)}>
          {t("Download the record")}
        </Button>
        <Button kind="secondary" onClick={() => window.print()}>
          {t("Print")}
        </Button>
      </div>
    </div>
  );
}

/** Search results for a proof code, a file SHA-256 or a signer key, optionally between two dates. */
export function SignatureResults(props: { query: string; fromMs?: number; toMs?: number; byFile?: boolean; onSigner?: (key: string) => void }) {
  const { t } = useLang();
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

  if (err) return <p className="text-[14px] text-[#8a1f1f]">{t("The lookup failed: {why}", { why: err })}</p>;
  if (!hits) return <p className="text-[14px] text-[#5d646d]">{t("Looking up signatures…")}</p>;
  const exact = props.byFile ? <p className="text-[13px] text-[#5d646d]">{t("Exact files only: re-compressed or edited copies won't match.")}</p> : null;
  if (hits.length === 0)
    return (
      <div>
        <p className="text-[14px] text-[#5d646d]">{t("No published signature matches. Only signatures their signers chose to publish are listed.")}</p>
        {exact}
      </div>
    );
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {hits.map((h, i) => (
          <li key={i} className="border-b border-[#eceef1] pb-2 text-[14px]">
            <p className="flex flex-wrap items-center gap-2">
              <span translate="no" className={cx(MONO, "font-semibold")}>
                {h.code}
              </span>
              <Badge tone={h.verified ? "ok" : "bad"}>{h.verified ? t("signature valid") : t("signature invalid")}</Badge>
            </p>
            <p>
              {t("Signed by key")}{" "}
              {props.onSigner ? (
                <button type="button" title={t("Show this key's public signatures")} className={cx(MONO, "underline underline-offset-2")} onClick={() => props.onSigner!(h.signerEd25519)}>
                  {h.signerEd25519.slice(0, 16)}…
                </button>
              ) : (
                <span className={MONO}>{h.signerEd25519.slice(0, 16)}…</span>
              )} · {t("published")} <span className={MONO}>{new Date(h.publishedAtMs).toLocaleString()}</span>
            </p>
            <p className="break-all text-[#5d646d]">
              {t("File SHA-256")} <span className={MONO}>{h.fileSha256}</span>
            </p>
            {h.verified ? null : <p className="text-[#8a1f1f]">{h.reason}</p>}
            <button type="button" className="text-[13px] underline underline-offset-2" onClick={() => download(`${h.code}.hash.sig.json`, h.recordBytes)}>
              {t("Download the record")}
            </button>
          </li>
        ))}
      </ol>
      <p className="text-[13px] text-[#5d646d]">{t("The code finds it; the signature proves it.")} {t("To check a file against a record, put both into Verify.")}</p>
      {exact}
    </div>
  );
}
