"use client";

/**
 * Try TET, part 4: verify anything (docs/DEMO_NODE.md). One action: Verify. A file or text plus its
 * `.sig.json` in; a graded verdict out, step by step. A manifest, a pin and another chain are
 * optional, behind one disclosure. Checked in this tab; nothing is uploaded. Rules in
 * `lib/verify_anything.mjs`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { gradedVerdict } from "../lib/verify_anything.mjs";
import { mldsa44Verify } from "../lib/pqc";
import { Badge, Button, FOCUS, FilePick, INK, Input, PanelHead, PinnedNotice, TextArea, cx } from "./ui";
import { useLang } from "./i18n";
import { checkStamp, type StampCheck } from "../lib/sign_anything";
import { fetchExplorerTx } from "./SignPanel";
import { parseQrFragment, qrNamesThese, type QrLink } from "../lib/tet_qr";

type Step = { n: 1 | 2 | 3; status: "ok" | "failed" | "skipped"; text: string };
type Verdict = { level: 0 | 1 | 2 | 3; steps: Step[]; chainLabel: string };
type Chain = { chainId: string; genesisHash: string };

const stepTitle = (t: (en: string) => string) => ({
  1: t("The bytes match, and both signatures are valid"),
  2: t("The key belongs to an agent, and its owner"),
  3: t("It is the key you pinned"),
});

const statusOf = (t: (en: string) => string) =>
  ({
    ok: { tone: "ok", text: t("proven") },
    failed: { tone: "bad", text: t("failed") },
    skipped: { tone: "neutral", text: t("not checked") },
  }) as const;

const LIMITS = (t: (en: string) => string) => [
  t("A valid signature proves which key signed, not who holds it. Without a manifest or a pin, the verdict stops at step 1."),
  t("The two keys (Ed25519, ML-DSA-44) are tied to each other only by the signatures in the sidecar; the wallet-level binding is Phase 1 work (SECURITY.md)."),
  t("A signature cannot prove when something was written: there is no timestamping."),
  t("“Automated” in a manifest is the owner's declaration, not a proof; a manifest cannot be revoked before it expires."),
  t("The chain is part of what was signed: a signature for another chain fails here unless you choose that chain."),
  t("Everything is checked in this tab; nothing you add is uploaded."),
];

async function readFileBytes(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}

/** A file picker, or paste instead. */
function FileOrPaste(props: {
  label: string;
  text: string;
  onText: (t: string) => void;
  file: File | null;
  onFile: (f: File | null) => void;
  placeholder: string;
}) {
  const { t } = useLang();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold text-[#3d434a]">{props.label}</span>
        {props.file ? (
          <button type="button" className={cx(FOCUS, "rounded text-[14px] text-[#5d646d] underline hover:text-[#1c1f23]")} onClick={() => props.onFile(null)}>
            {t("paste instead")}
          </button>
        ) : null}
      </div>
      {props.file ? (
        <div className="break-all rounded-md border border-[#c9ced4] bg-[#fafbfc] px-3 py-2 text-base">{props.file.name}</div>
      ) : (
        <>
          <FilePick
            onFile={props.onFile}
            className="block rounded-md border border-dashed border-[#c9ced4] bg-[#fafbfc] px-3 py-2 text-center text-[15px] text-[#3d434a] hover:border-[#8b9198]"
          >
            {t("Choose a file")}
          </FilePick>
          <TextArea label={props.label} value={props.text} onChange={props.onText} rows={2} placeholder={props.placeholder} />
        </>
      )}
    </div>
  );
}

export default function VerifyPanel(props: { baseUrl: string }) {
  const { t } = useLang();
  /** Opened from a TET QR (the `#tetqr=` fragment): the .sig.json it names and its stamp, if any. */
  const [qr] = useState<QrLink | null>(() => (typeof window === "undefined" ? null : parseQrFragment(window.location.hash)));
  const [showMore, setShowMore] = useState(!!qr?.stampTx);
  const [nodeChain, setNodeChain] = useState<Chain | null>(null);
  const [useOther, setUseOther] = useState(false);
  const [otherChainId, setOtherChainId] = useState("");
  const [otherGenesis, setOtherGenesis] = useState("");
  const [contentText, setContentText] = useState("");
  const [contentFile, setContentFile] = useState<File | null>(null);
  const [sigText, setSigText] = useState("");
  const [sigFile, setSigFile] = useState<File | null>(null);
  const [manText, setManText] = useState("");
  const [manFile, setManFile] = useState<File | null>(null);
  const [pin, setPin] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [stampText, setStampText] = useState(qr?.stampTx ? JSON.stringify({ tx_hash: qr.stampTx }) : "");
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [stamp, setStamp] = useState<StampCheck | null>(null);
  const [qrMatch, setQrMatch] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch(`${props.baseUrl}/chain`);
        const j = r.ok ? await r.json() : null;
        if (live && j?.chain_id && j?.genesis_hash) setNodeChain({ chainId: j.chain_id, genesisHash: j.genesis_hash });
      } catch {
        /* shown as "unknown" below */
      }
    })();
    return () => {
      live = false;
    };
  }, [props.baseUrl]);

  async function onVerify() {
    setErr("");
    setVerdict(null);
    setBusy(true);
    try {
      const chain: Chain | null = useOther
        ? { chainId: otherChainId.trim(), genesisHash: otherGenesis.trim().toLowerCase() }
        : nodeChain;
      if (!chain || !chain.chainId || !chain.genesisHash) throw new Error(t("No chain to check against."));
      const content = contentFile ? await readFileBytes(contentFile) : new TextEncoder().encode(contentText);
      const sigRaw = sigFile ? await sigFile.text() : sigText;
      if (!sigRaw.trim()) throw new Error(t("Add the .sig.json."));
      let envelope: unknown;
      try {
        envelope = JSON.parse(sigRaw);
      } catch {
        throw new Error(t("The .sig.json is not valid JSON."));
      }
      const manRaw = manFile ? await manFile.text() : manText;
      let manifest: unknown = undefined;
      if (manRaw.trim()) {
        try {
          manifest = JSON.parse(manRaw);
        } catch {
          throw new Error(t("The manifest is not valid JSON."));
        }
      }
      setQrMatch(qr ? qrNamesThese(qr, sigFile ? new Uint8Array(await sigFile.arrayBuffer()) : new TextEncoder().encode(sigRaw)) : null);
      const r = await gradedVerdict({
        content,
        envelope,
        manifest,
        pin,
        chain,
        nowMs: Date.now(),
        mldsa44Verify,
      });
      setVerdict({ ...r, chainLabel: `${chain.chainId} (${chain.genesisHash.slice(0, 12)}…)` });
      // A stamp receipt, if given: checked against the exact .sig.json bytes and this node's chain.
      const stampRaw = stampFile ? await stampFile.text() : stampText;
      if (stampRaw.trim()) {
        let receipt: { tx_hash?: unknown };
        try {
          receipt = JSON.parse(stampRaw);
        } catch {
          throw new Error(t("The stamp receipt is not valid JSON."));
        }
        const sigBytes = sigFile ? new Uint8Array(await sigFile.arrayBuffer()) : new TextEncoder().encode(sigText);
        setStamp(await checkStamp({ sigBytes, receipt, fetchTx: fetchExplorerTx }));
      } else {
        setStamp(null);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const slot = (label: ReactNode, node: ReactNode) => (
    <div className="space-y-1">
      <span className="text-[15px] font-semibold text-[#3d434a]">{label}</span>
      {node}
    </div>
  );

  return (
    <section aria-label={t("Verify")}>
      <PanelHead title={t("Verify")} sub={t("checked in this tab")} todo={t("Add a file (or text) and its .sig.json, then press Verify.")} />
      <div className="max-w-[46rem] space-y-3 px-4 pb-6 md:px-5">
      <PinnedNotice lines={LIMITS(t)} />
      {qr ? (
        <div className="rounded-md border border-[#c9d6e6] bg-[#f3f7fc] px-3 py-2.5 text-[15px] leading-relaxed">
          <p className="font-semibold">{t("Opened from a TET QR")}</p>
          <p>
            {t("Add the .sig.json it names (SHA-256 below) and the file. The QR says the signer is key {key}; that is proven only when the .sig.json is checked.", { key: `${qr.signerEd25519.slice(0, 16)}…` })}
          </p>
          <p translate="no" className="break-all font-mono text-[12px] text-[#5d646d]">
            {qr.sigSha256}
          </p>
          {qr.stampTx ? <p>{t("Its stamp receipt is filled in below.")}</p> : null}
          {nodeChain && (qr.chainId !== nodeChain.chainId || qr.genesisHash !== nodeChain.genesisHash) ? (
            // The QR's author chose its chain, so the page never switches to it: checking another
            // chain is the reader's choice (the "another chain" option), made knowingly.
            <p role="alert" className={INK.bad}>
              {t("The QR names chain {qrChain}, not this node's chain {nodeChain}. Verify checks against this node's chain; a signature for another chain fails here.", {
                qrChain: `${qr.chainId} (${qr.genesisHash.slice(0, 12)}…)`,
                nodeChain: `${nodeChain.chainId} (${nodeChain.genesisHash.slice(0, 12)}…)`,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-3">
        <FileOrPaste label={t("1. The file or text")} text={contentText} onText={setContentText} file={contentFile} onFile={setContentFile} placeholder={t("…or paste the exact text that was signed")} />
        <FileOrPaste label={t("2. Its .sig.json")} text={sigText} onText={setSigText} file={sigFile} onFile={setSigFile} placeholder={t("…or paste the .sig.json")} />
        <button type="button" aria-expanded={showMore} className={cx(FOCUS, "rounded text-[15px] text-[#3d434a] underline hover:text-[#1c1f23]")} onClick={() => setShowMore(!showMore)}>
          {showMore ? t("Hide the optional checks") : t("Add an owner's manifest, a pinned key, or another chain (optional)")}
        </button>
        {showMore ? (
          <div className="space-y-3 rounded-md bg-[#fafbfc] p-3">
            <FileOrPaste label={t("Stamp receipt (.stamp.json)")} text={stampText} onText={setStampText} file={stampFile} onFile={setStampFile} placeholder={t("…or paste the stamp receipt")} />
            <FileOrPaste label={t("Owner's manifest")} text={manText} onText={setManText} file={manFile} onFile={setManFile} placeholder={t("…or paste the manifest JSON")} />
            {slot("Pinned key", <Input ariaLabel={t("Pinned key")} value={pin} onChange={setPin} mono placeholder={t("ed25519 hex, tet-mldsa44 key id, or pin.json…")} />)}
            {slot(
              t("Chain"),
              <div className="space-y-1 text-[15px]">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!useOther} onChange={() => setUseOther(false)} />
                  {t("This node's:")} <span className="font-mono text-[14px]">{nodeChain ? nodeChain.chainId : t("unknown")}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={useOther} onChange={() => setUseOther(true)} />
                  {t("Another chain")}
                </label>
                {useOther ? (
                  <div className="grid gap-2">
                    <Input ariaLabel={t("Chain id")} value={otherChainId} onChange={setOtherChainId} mono placeholder={t("e.g. tet-testnet-1…")} />
                    <Input ariaLabel={t("Genesis hash")} value={otherGenesis} onChange={setOtherGenesis} mono placeholder={t("0x… (64 hex characters)")} />
                  </div>
                ) : null}
              </div>,
            )}
          </div>
        ) : null}
        <Button className="w-full sm:w-auto" disabled={busy} onClick={() => void onVerify()}>
          {busy ? t("Checking…") : t("Verify")}
        </Button>
        {err ? <p role="alert" className={cx("text-[15px]", INK.bad)}>{err}</p> : null}
      </div>

      {verdict ? (
        <ol className="border-t border-[#eceef1]" aria-live="polite">
          {verdict.steps.map((st) => (
            <li key={st.n} className="border-b border-[#eceef1] py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[14px] font-semibold text-[#5d646d]">{st.n}</span>
                <span className="text-base font-semibold">{stepTitle(t)[st.n]}</span>
                <Badge tone={statusOf(t)[st.status].tone}>{statusOf(t)[st.status].text}</Badge>
              </div>
              <p className={cx("mt-1 break-words text-[15px] leading-relaxed", st.status === "skipped" ? "text-[#5d646d]" : "text-[#1c1f23]")}>{st.text}</p>
            </li>
          ))}
          {qr && qrMatch !== null ? (
            <li className="border-b border-[#eceef1] py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[14px] font-semibold text-[#5d646d]">+</span>
                <span className="text-base font-semibold">{t("The .sig.json is the one the QR names")}</span>
                <Badge tone={qrMatch ? "ok" : "bad"}>{qrMatch ? t("proven") : t("failed")}</Badge>
              </div>
              <p className="mt-1 break-words text-[15px] leading-relaxed text-[#1c1f23]">
                {qrMatch ? t("Its SHA-256 is the one in the QR.") : t("Its SHA-256 differs from the QR's: this is another .sig.json, or a copy that was changed (even re-indented).")}
              </p>
            </li>
          ) : null}
          {stamp ? (
            <li className="border-b border-[#eceef1] py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[14px] font-semibold text-[#5d646d]">+</span>
                <span className="text-base font-semibold">{t("The .sig.json was stamped on chain")}</span>
                <Badge tone={stamp.state === "anchored" ? "ok" : "bad"}>{stamp.state === "anchored" ? t("proven") : t("failed")}</Badge>
              </div>
              <p className="mt-1 break-words text-[15px] leading-relaxed text-[#1c1f23]">
                {stamp.state === "anchored"
                  ? t("Its fee transaction is in block {height} of this node's chain, so this exact .sig.json existed by then. It doesn't show who made it.", { height: stamp.height.toLocaleString() })
                  : t("Not anchored: {reason}", { reason: stamp.reason })}
              </p>
            </li>
          ) : null}
          <li className="py-2.5 text-[14px] text-[#5d646d]">{t("Checked against chain {chain}.", { chain: verdict.chainLabel })}</li>
        </ol>
      ) : null}
      <div className="mt-6">
        <h3 className="mb-1 text-[15px] font-semibold">{t("What this is for")}</h3>
        <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-[#3d434a]">
          <li>{t("Existence proof: show that a file is exactly the one a key signed. Not when it was signed: there is no timestamping yet.")}</li>
          <li>{t("Release signing: check that a download is, byte for byte, the build its maintainer's key signed.")}</li>
          <li>{t("Bot output: check that a message or report came from a particular agent's key and, with its manifest, which owner vouched for that agent.")}</li>
          <li>{t("Lab result: check that a result file is the one the lab's key signed, unchanged.")}</li>
        </ul>
      </div>
      </div>
    </section>
  );
}
