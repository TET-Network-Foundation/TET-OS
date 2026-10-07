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

type Step = { n: 1 | 2 | 3; status: "ok" | "failed" | "skipped"; text: string };
type Verdict = { level: 0 | 1 | 2 | 3; steps: Step[]; chainLabel: string };
type Chain = { chainId: string; genesisHash: string };

const STEP_TITLE = {
  1: "The bytes match, and both signatures are valid",
  2: "The key belongs to an agent, and its owner",
  3: "It is the key you pinned",
} as const;

const STATUS = {
  ok: { tone: "ok", text: "proven" },
  failed: { tone: "bad", text: "failed" },
  skipped: { tone: "neutral", text: "not checked" },
} as const;

const LIMITS = [
  "A valid signature proves which key signed, not who holds it. Without a manifest or a pin, the verdict stops at step 1.",
  "The two keys (Ed25519, ML-DSA-44) are tied to each other only by the signatures in the sidecar; the wallet-level binding is Phase 1 work (SECURITY.md).",
  "A signature cannot prove when something was written: there is no timestamping.",
  "“Automated” in a manifest is the owner's declaration, not a proof; a manifest cannot be revoked before it expires.",
  "The chain is part of what was signed: a signature for another chain fails here unless you choose that chain.",
  "Everything is checked in this tab; nothing you add is uploaded.",
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
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold text-[#3d434a]">{props.label}</span>
        {props.file ? (
          <button type="button" className={cx(FOCUS, "rounded text-[14px] text-[#5d646d] underline hover:text-[#1c1f23]")} onClick={() => props.onFile(null)}>
            paste instead
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
            Choose a file
          </FilePick>
          <TextArea label={props.label} value={props.text} onChange={props.onText} rows={2} placeholder={props.placeholder} />
        </>
      )}
    </div>
  );
}

export default function VerifyPanel(props: { baseUrl: string }) {
  const [showMore, setShowMore] = useState(false);
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
      if (!chain || !chain.chainId || !chain.genesisHash) throw new Error("No chain to check against.");
      const content = contentFile ? await readFileBytes(contentFile) : new TextEncoder().encode(contentText);
      const sigRaw = sigFile ? await sigFile.text() : sigText;
      if (!sigRaw.trim()) throw new Error("Add the .sig.json.");
      let envelope: unknown;
      try {
        envelope = JSON.parse(sigRaw);
      } catch {
        throw new Error("The .sig.json is not valid JSON.");
      }
      const manRaw = manFile ? await manFile.text() : manText;
      let manifest: unknown = undefined;
      if (manRaw.trim()) {
        try {
          manifest = JSON.parse(manRaw);
        } catch {
          throw new Error("The manifest is not valid JSON.");
        }
      }
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
    <section aria-label="Verify">
      <PanelHead title="Verify" sub="checked in this tab" todo="Add a file (or text) and its .sig.json, then press Verify." />
      <div className="max-w-[46rem] space-y-3 px-4 pb-6 md:px-5">
      <PinnedNotice lines={LIMITS} />
      <div className="space-y-3">
        <FileOrPaste label="1. The file or text" text={contentText} onText={setContentText} file={contentFile} onFile={setContentFile} placeholder="…or paste the exact text that was signed" />
        <FileOrPaste label="2. Its .sig.json" text={sigText} onText={setSigText} file={sigFile} onFile={setSigFile} placeholder='…or paste {"payloadType": …, "signatures": […], "tet": {…}}' />
        <button type="button" aria-expanded={showMore} className={cx(FOCUS, "rounded text-[15px] text-[#3d434a] underline hover:text-[#1c1f23]")} onClick={() => setShowMore(!showMore)}>
          {showMore ? "Hide the optional checks" : "Add an owner's manifest, a pinned key, or another chain (optional)"}
        </button>
        {showMore ? (
          <div className="space-y-3 rounded-md bg-[#fafbfc] p-3">
            <FileOrPaste label="Owner's manifest" text={manText} onText={setManText} file={manFile} onFile={setManFile} placeholder='…or paste {"kind": "tet_agent_manifest_v1", …}' />
            {slot("Pinned key", <Input ariaLabel="Pinned key" value={pin} onChange={setPin} mono placeholder="ed25519 hex, tet-mldsa44 key id, or pin.json…" />)}
            {slot(
              "Chain",
              <div className="space-y-1 text-[15px]">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!useOther} onChange={() => setUseOther(false)} />
                  This node&apos;s: <span className="font-mono text-[14px]">{nodeChain ? nodeChain.chainId : "unknown"}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={useOther} onChange={() => setUseOther(true)} />
                  Another chain
                </label>
                {useOther ? (
                  <div className="grid gap-2">
                    <Input ariaLabel="Chain id" value={otherChainId} onChange={setOtherChainId} mono placeholder="e.g. tet-testnet-1…" />
                    <Input ariaLabel="Genesis hash" value={otherGenesis} onChange={setOtherGenesis} mono placeholder="0x… (64 hex characters)" />
                  </div>
                ) : null}
              </div>,
            )}
          </div>
        ) : null}
        <Button className="w-full sm:w-auto" disabled={busy} onClick={() => void onVerify()}>
          {busy ? "Checking…" : "Verify"}
        </Button>
        {err ? <p role="alert" className={cx("text-[15px]", INK.bad)}>{err}</p> : null}
      </div>

      {verdict ? (
        <ol className="border-t border-[#eceef1]" aria-live="polite">
          {verdict.steps.map((st) => (
            <li key={st.n} className="border-b border-[#eceef1] py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[14px] font-semibold text-[#5d646d]">{st.n}</span>
                <span className="text-base font-semibold">{STEP_TITLE[st.n]}</span>
                <Badge tone={STATUS[st.status].tone}>{STATUS[st.status].text}</Badge>
              </div>
              <p className={cx("mt-1 break-words text-[15px] leading-relaxed", st.status === "skipped" ? "text-[#5d646d]" : "text-[#1c1f23]")}>{st.text}</p>
            </li>
          ))}
          <li className="py-2.5 text-[14px] text-[#5d646d]">Checked against chain {verdict.chainLabel}.</li>
        </ol>
      ) : null}
      </div>
    </section>
  );
}
