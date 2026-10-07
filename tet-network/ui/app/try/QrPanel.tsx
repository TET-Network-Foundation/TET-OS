"use client";

/**
 * Try TET: TET QR — a printable label for a `.sig.json` (`lib/tet_qr.ts`). Scanning it opens Verify,
 * pre-filled. The QR names the `.sig.json` by its SHA-256 (a hybrid signature doesn't fit in a QR);
 * a QR is drawn only for a `.sig.json` whose signatures verify on its chain, and a stamp only once
 * its fee transaction is checked.
 */
import { useState } from "react";
import { b64ToBytes } from "../lib/encoding";
import { mldsa44Verify } from "../lib/pqc";
import { verifyEnvelope } from "../lib/verify_anything.mjs";
import { checkStamp } from "../lib/sign_anything";
import { qrLink, qrSvgPath, sigSha256, type QrLink } from "../lib/tet_qr";
import { Button, FilePick, INK, MONO, PanelHead, PinnedNotice, cx } from "./ui";
import { BASE } from "./wallet";
import { fetchExplorerTx } from "./SignPanel";
import { useLang } from "./i18n";

type Chain = { chainId: string; genesisHash: string };

/** The QR for a `.sig.json`, with its printed label and a Print button. */
export function SigQr(props: { link: QrLink; name: string; stampHeight?: number }) {
  const { t } = useLang();
  const url = qrLink(window.location.origin, props.link);
  const { size, d } = qrSvgPath(url);
  return (
    <div className="space-y-2">
      <figure className="tet-print max-w-[22rem] rounded-md border border-[#e3e5e8] bg-white p-3 text-[13px] leading-snug text-[#1c1f23]">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("QR code: opens Verify for {name}", { name: props.name })} className="block h-auto w-full" shapeRendering="crispEdges">
          <rect width={size} height={size} fill="#fff" />
          <path d={d} fill="#000" />
        </svg>
        <figcaption className="mt-2 space-y-1">
          <p className="break-all font-semibold">{props.name}</p>
          <p>
            {t("Signed by key")}{" "}
            <span translate="no" className={MONO}>
              {props.link.signerEd25519.slice(0, 16)}…
            </span>
          </p>
          {props.stampHeight ? <p>{t("Stamped on chain at block {height}.", { height: props.stampHeight.toLocaleString() })}</p> : null}
          <p>{t("Scan to check it at Try TET (Verify). You also need the .sig.json, with SHA-256:")}</p>
          <p translate="no" className={cx(MONO, "break-all text-[11px]")}>
            {props.link.sigSha256}
          </p>
        </figcaption>
      </figure>
      <div className="flex flex-wrap gap-2">
        <Button kind="secondary" onClick={() => window.print()}>
          {t("Print")}
        </Button>
        <Button kind="secondary" onClick={() => void navigator.clipboard?.writeText(url)}>
          {t("Copy the link")}
        </Button>
      </div>
    </div>
  );
}

/** The QR fields for a `.sig.json`, after checking its signatures on `chain`. */
export async function qrFieldsFor(sigBytes: Uint8Array, chain: Chain): Promise<QrLink> {
  let envelope: { payload?: unknown };
  try {
    envelope = JSON.parse(new TextDecoder().decode(sigBytes));
  } catch {
    throw new Error("The .sig.json is not valid JSON.");
  }
  const content = b64ToBytes(typeof envelope?.payload === "string" ? envelope.payload : "");
  const r = await verifyEnvelope({ envelope, content, chain, mldsa44Verify });
  if (!r.ok) throw new Error(r.reason);
  return { sigSha256: sigSha256(sigBytes), signerEd25519: r.edHex, chainId: chain.chainId, genesisHash: chain.genesisHash };
}

export default function QrPanel() {
  const { t } = useLang();
  const [sigFile, setSigFile] = useState<File | null>(null);
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [made, setMade] = useState<{ link: QrLink; name: string; stampHeight?: number } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onMake() {
    if (!sigFile) return;
    setErr("");
    setMade(null);
    setBusy(true);
    try {
      const c = await (await fetch(`${BASE}/chain`)).json();
      const chain = { chainId: String(c.chain_id), genesisHash: String(c.genesis_hash) };
      const sigBytes = new Uint8Array(await sigFile.arrayBuffer());
      let link: QrLink;
      try {
        link = await qrFieldsFor(sigBytes, chain);
      } catch (e: unknown) {
        throw new Error(t("No QR: this .sig.json doesn't verify on this node's chain ({why}).", { why: e instanceof Error ? e.message : String(e) }));
      }
      let stampHeight: number | undefined;
      if (stampFile) {
        let receipt: { tx_hash?: unknown };
        try {
          receipt = JSON.parse(await stampFile.text());
        } catch {
          throw new Error(t("The stamp receipt is not valid JSON."));
        }
        const s = await checkStamp({ sigBytes, receipt, fetchTx: fetchExplorerTx });
        if (s.state !== "anchored") throw new Error(t("Not anchored: {reason}", { reason: s.reason }));
        link = { ...link, stampTx: s.txHash };
        stampHeight = s.height;
      }
      setMade({ link, name: sigFile.name.replace(/\.sig\.json$/, ""), stampHeight });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const pick = "flex min-h-14 items-center justify-center rounded-md border border-dashed border-[#c9ced4] bg-[#fafbfc] px-3 text-center text-base text-[#3d434a] hover:border-[#8b9198]";
  return (
    <section aria-label={t("QR")}>
      <PanelHead title={t("QR")} sub={t("a printable label for a .sig.json")} todo={t("Choose a .sig.json (and its stamp receipt, if any) to make a QR. Scanning it opens Verify.")} />
      <div className="max-w-[46rem] space-y-3 px-4 pb-6 md:px-5">
        <PinnedNotice
          lines={[
            t("The QR doesn't contain the signature: a post-quantum signature is too big for a QR. It names the .sig.json by its SHA-256, so whoever checks also needs the .sig.json."),
            t("The link keeps everything after the #, which browsers don't send to a server. It holds the .sig.json's hash, the signer's key, the chain, and the stamp's transaction."),
            t("A QR is made only for a .sig.json that verifies on this node's chain, and includes a stamp only after checking it."),
          ]}
        />
        <FilePick onFile={(f) => (setSigFile(f), setMade(null))} className={pick}>
          <span className="break-all">{sigFile ? sigFile.name : t("Choose a .sig.json")}</span>
        </FilePick>
        <FilePick onFile={(f) => (setStampFile(f), setMade(null))} className={pick}>
          <span className="break-all">{stampFile ? stampFile.name : t("Its stamp receipt (.stamp.json), optional")}</span>
        </FilePick>
        <Button disabled={busy || !sigFile} onClick={() => void onMake()}>
          {busy ? t("Checking…") : t("Make the QR")}
        </Button>
        {made ? <SigQr {...made} /> : null}
        {err ? (
          <p role="alert" className={cx("text-[15px]", INK.bad)}>
            {err}
          </p>
        ) : null}
      </div>
    </section>
  );
}
