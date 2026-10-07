"use client";

/**
 * Try TET, part 4: verify anything (docs/DEMO_NODE.md). A file or text plus its `.sig.json`, and
 * optionally a manifest and a pin, in; a graded verdict out. Everything is checked in this tab;
 * nothing you drop here is uploaded. Rules in `lib/verify_anything.mjs`.
 */
import { useEffect, useState } from "react";
import Win95Button from "../os/components/Win95Button";
import Win95Field from "../os/components/Win95Field";
import Win95Panel from "../os/components/Win95Panel";
import { bevel, cx, surface } from "../os/components/tokens";
import { gradedVerdict } from "../lib/verify_anything.mjs";
import { mldsa44Verify } from "../lib/pqc";
import Notice, { Hint } from "./Notice";

type Step = { n: 1 | 2 | 3; status: "ok" | "failed" | "skipped"; text: string };
type Verdict = { level: 0 | 1 | 2 | 3; steps: Step[]; chainLabel: string };
type Chain = { chainId: string; genesisHash: string };

const STEP_TITLE = {
  1: "The bytes match and both signatures are valid",
  2: "The key belongs to an agent and its owner",
  3: "It's the key you pinned",
} as const;

const MARK = { ok: "✓", failed: "✗", skipped: "–" } as const;
const MARK_TONE = { ok: "text-[#1f5132]", failed: "text-[#8a1f1f]", skipped: "text-black/40" } as const;

async function readFileBytes(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}

function FileOrPaste(props: {
  label: string;
  text: string;
  onText: (t: string) => void;
  onFile: (f: File | null) => void;
  fileName: string | null;
  placeholder: string;
  rows?: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="font-bold">{props.label}</span>
        <label className="cursor-pointer underline">
          {props.fileName ? `file: ${props.fileName}` : "choose a file"}
          <input type="file" className="hidden" onChange={(e) => props.onFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {props.fileName ? (
        <p className="mt-1 text-[12px] text-black/60">
          Using the file.{" "}
          <button type="button" className="underline" onClick={() => props.onFile(null)}>
            Paste instead
          </button>
        </p>
      ) : (
        <textarea
          value={props.text}
          onChange={(e) => props.onText(e.target.value)}
          rows={props.rows ?? 3}
          placeholder={props.placeholder}
          className={cx(bevel.inset, surface.field, "mt-1 w-full px-2 py-1 font-mono text-[12px] outline-none")}
        />
      )}
    </div>
  );
}

export default function VerifyPanel(props: { baseUrl: string }) {
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

  return (
    <Win95Panel title="Verify anything" className="p-2 font-mono">
      <Notice
        items={[
          "A valid signature proves which key signed, not who holds it. Without a manifest or a pin, the verdict stops at step 1.",
          "The two keys (Ed25519, ML-DSA-44) are tied to each other only by the signatures in the sidecar; the wallet-level binding is Phase 1 work (SECURITY.md).",
          "A signature cannot prove when something was written: there is no timestamping.",
          "\"Automated\" in a manifest is the owner's declaration, not a proof; a manifest cannot be revoked before it expires.",
          "The chain is part of what was signed: a signature for another chain fails here unless you choose that chain.",
          "Everything is checked in this tab; nothing you add is uploaded.",
        ]}
      />
      <div className="mt-2">
        <Hint>Add the file (or paste the text) and its .sig.json, then Verify. A manifest and a pin are optional.</Hint>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Win95Panel variant="inset" className="p-2">
          <FileOrPaste
            label="1. The file or text"
            text={contentText}
            onText={setContentText}
            onFile={setContentFile}
            fileName={contentFile?.name ?? null}
            placeholder="Paste the exact text that was signed"
          />
          <FileOrPaste
            label="2. Its .sig.json"
            text={sigText}
            onText={setSigText}
            onFile={setSigFile}
            fileName={sigFile?.name ?? null}
            placeholder='{"payloadType": …, "payload": …, "signatures": […], "tet": {…}}'
          />
        </Win95Panel>
        <Win95Panel variant="inset" className="p-2">
          <FileOrPaste
            label="Owner's manifest (optional)"
            text={manText}
            onText={setManText}
            onFile={setManFile}
            fileName={manFile?.name ?? null}
            placeholder='{"kind": "tet_agent_manifest_v1", …}'
            rows={2}
          />
          <Win95Field
            className="mt-1"
            label="Pinned key (optional): ed25519 hex, tet-mldsa44 keyid, or pin.json"
            value={pin}
            onChange={setPin}
            mono
          />
          <div className="mt-2 text-[12px]">
            <label className="flex items-center gap-1">
              <input type="radio" checked={!useOther} onChange={() => setUseOther(false)} />
              This node&apos;s chain:{" "}
              <code>{nodeChain ? `${nodeChain.chainId} (${nodeChain.genesisHash.slice(0, 12)}…)` : "unknown"}</code>
            </label>
            <label className="mt-1 flex items-center gap-1">
              <input type="radio" checked={useOther} onChange={() => setUseOther(true)} />
              Another chain
            </label>
            {useOther ? (
              <div className="mt-1 grid gap-1">
                <Win95Field label="chain id" value={otherChainId} onChange={setOtherChainId} mono />
                <Win95Field label="genesis hash" value={otherGenesis} onChange={setOtherGenesis} mono />
              </div>
            ) : null}
          </div>
        </Win95Panel>
      </div>

      <Win95Button variant="primary" className="mt-2 px-3 py-0.5 text-sm" onClick={() => void onVerify()} disabled={busy}>
        Verify
      </Win95Button>
      {err ? <p className="mt-1 text-[12px] text-[#8a1f1f]">{err}</p> : null}

      {verdict ? (
        <div className={cx(bevel.inset, surface.field, "mt-2 p-2 text-[13px]")} aria-live="polite">
          <p className="text-[12px] text-black/60">Checked against chain {verdict.chainLabel}.</p>
          {verdict.steps.map((s) => (
            <div key={s.n} className="mt-1 flex gap-2">
              <span className={cx("w-4 shrink-0 font-bold", MARK_TONE[s.status])}>{MARK[s.status]}</span>
              <span>
                <b>
                  {s.n}. {STEP_TITLE[s.n]}
                </b>
                <br />
                <span className="break-words text-[12px]">{s.text}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

    </Win95Panel>
  );
}
