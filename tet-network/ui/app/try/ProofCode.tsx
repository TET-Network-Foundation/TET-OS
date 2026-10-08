"use client";

/**
 * Proof codes on /try (lib/proof_code.ts): the badge shown after signing (code, QR, link, the
 * hash-only record) and the search results for a code, a file hash or a signer key. A proof code
 * finds a published record; the record's signatures prove it. Never called a key.
 */
import { useEffect, useState } from "react";
import { findSignatures, loadRecords, type FoundSignature } from "../lib/proof_code";
import { openBoard, type OpenBoard } from "../lib/try_board";
import { mldsa44Verify } from "../lib/pqc";
import { qrSvgPath } from "../lib/tet_qr";
import { Badge, Button, MONO, cx } from "./ui";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

export const SIGNATURES_INVITE = (process.env.NEXT_PUBLIC_TET_SIGNATURES_INVITE ?? "").trim();

/** The signatures board, opened from its published invite (null while opening or if not set up). */
export function useSignaturesBoard(): { board: OpenBoard | null; error: string } {
  const [board, setBoard] = useState<OpenBoard | null>(null);
  const [error, setError] = useState(SIGNATURES_INVITE ? "" : "not set up");
  useEffect(() => {
    if (!SIGNATURES_INVITE) return;
    let on = true;
    void openBoard(BASE, SIGNATURES_INVITE)
      .then((b) => on && setBoard(b))
      .catch((e: unknown) => on && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      on = false;
    };
  }, []);
  return { board, error };
}

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
      <p className="text-[14px] text-[#5d646d]">{t("This node keeps the record for 7 days. Keep the .sig.json: with it and the file, anyone can check the signature in Verify.")}</p>
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

/** Search results for a proof code, a file SHA-256 or a signer key. */
export function SignatureResults(props: { query: string; board: OpenBoard | null; boardError: string }) {
  const { t } = useLang();
  const [hits, setHits] = useState<FoundSignature[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!props.board) return;
    let on = true;
    void (async () => {
      try {
        const c = await (await fetch(`${BASE}/chain`)).json();
        const chain = { chainId: String(c.chain_id), genesisHash: String(c.genesis_hash) };
        const board = props.board!;
        const found = await findSignatures({ query: props.query, chain, records: (prefix) => loadRecords(BASE, board, prefix), mldsa44Verify });
        if (on) setHits(found);
      } catch (e: unknown) {
        if (on) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      on = false;
    };
  }, [props.query, props.board]);

  if (!props.board) {
    return <p className="text-[14px] text-[#5d646d]">{props.boardError === "not set up" ? t("Proof codes aren't set up on this node.") : props.boardError ? t("The signatures board didn't open: {why}", { why: props.boardError }) : t("Opening the signatures board…")}</p>;
  }
  if (err) return <p className="text-[14px] text-[#8a1f1f]">{t("The lookup failed: {why}", { why: err })}</p>;
  if (!hits) return <p className="text-[14px] text-[#5d646d]">{t("Looking up signatures…")}</p>;
  if (hits.length === 0) return <p className="text-[14px] text-[#5d646d]">{t("No published signature matches. Records are kept 7 days on this node.")}</p>;
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
              {t("Signed by key")} <span className={MONO}>{h.signerEd25519.slice(0, 16)}…</span> · {t("published")} <span className={MONO}>{new Date(h.publishedAtMs).toLocaleString()}</span>
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
    </div>
  );
}
