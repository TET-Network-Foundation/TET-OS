"use client";

/**
 * Try TET: "Sign anything" — sign a file (or text) with the tab's wallet into the `.sig.json` Verify
 * checks, and optionally stamp it on chain through the file-fee path (`lib/sign_anything.ts`). The
 * notice says what each step proves and what it doesn't.
 */
import { useEffect, useRef, useState } from "react";
import { buildFileEnvelopeV1 } from "../lib/files";
import { settleFileFee } from "../lib/files_fee";
import { b64ToBytes } from "../lib/encoding";
import { getTmailKeys, postFilesUpload } from "../lib/tet_core_http";
import { checkStamp, signContent, sigJsonBytes, stampFileId, STAMP_RECEIPT_KIND, type SigEnvelope, type StampReceipt } from "../lib/sign_anything";
import { Button, FilePick, INK, KeysBanner, MONO, PanelHead, PinnedNotice, TextArea, cx } from "./ui";
import { BASE, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

/** What a stamp's upload may be (the demo's file cap); a .sig.json embeds the signed file. */
const NODE_MAX_BODY = 100 * 1024 * 1024;
const STAMP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchExplorerTx(hash: string) {
  const r = await fetch(`${BASE}/explorer/tx/${hash}`);
  if (r.status === 404) return { found: false };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default function SignPanel() {
  const { t } = useLang();
  const { wallet, ensureWallet, ensureMessagingKeys, keys, checkKeys } = useTryWallet();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [signed, setSigned] = useState<{ name: string; env: SigEnvelope; bytes: Uint8Array } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [stamp, setStamp] = useState<StampReceipt | null>(null);
  const [publishing, setPublishing] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  async function chainBinding() {
    const c = await (await fetch(`${BASE}/chain`)).json();
    return { chainId: String(c.chain_id), genesisHash: String(c.genesis_hash) };
  }

  async function onSign() {
    setErr("");
    setStamp(null);
    setBusy(t("Signing…"));
    try {
      await ensureWallet();
      const content = file ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(text);
      if (content.length === 0) throw new Error(t("Choose a file or write some text first."));
      const type = file ? file.type || "application/octet-stream" : "text/plain";
      const env = await signContent(content, type, await chainBinding());
      const bytes = sigJsonBytes(env);
      const name = `${file?.name ?? "text.txt"}.sig.json`;
      setSigned({ name, env, bytes });
      download(name, bytes, "application/json");
      void checkKeys();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onStamp() {
    if (!signed) return;
    setErr("");
    try {
      const me = await ensureWallet();
      const k = await getTmailKeys(BASE, me);
      if (!k.registration) throw new Error(t("Publish your keys first (the banner above): a stamp stores the .sig.json encrypted to you."));
      setBusy(t("Uploading the .sig.json…"));
      const fileId = stampFileId(signed.bytes);
      const built = await buildFileEnvelopeV1({
        senderWalletId: me,
        receiverWalletId: me,
        fileBytes: signed.bytes,
        filename: signed.name,
        mimeType: "application/json",
        receiverX25519Pub: b64ToBytes(k.registration.x25519_pub_b64),
        receiverMlkemPub: b64ToBytes(k.registration.mlkem_pub_b64),
        baseUrl: BASE,
        ttlMs: STAMP_TTL_MS,
        maxBodyBytes: NODE_MAX_BODY,
        fileId,
      });
      const up = await postFilesUpload(BASE, built.envelope, built.bodyCiphertext);
      if (!up.ok) throw new Error(up.text || `HTTP ${up.status}`);
      setBusy(t("Asking the demo's sponsor to pay the fee…"));
      const fee = await settleFileFee({ mode: "demo-sponsor", baseUrl: BASE, fileId, senderWalletId: me, storageWallet: up.storageWallet ?? "" });
      if (fee.state !== "sponsored" || !fee.txHash) throw new Error(t("Not stamped: {why}", { why: fee.text }));
      setBusy(t("Waiting for the fee to be mined…"));
      const chain = await chainBinding();
      for (let i = 0; i < 40 && live.current; i++) {
        const c = await checkStamp({ sigBytes: signed.bytes, receipt: { tx_hash: fee.txHash }, fetchTx: fetchExplorerTx });
        if (c.state === "anchored") {
          const receipt: StampReceipt = {
            kind: STAMP_RECEIPT_KIND,
            tx_hash: c.txHash,
            file_id: fileId,
            block_height: c.height,
            chain_id: chain.chainId,
            genesis_hash: chain.genesisHash,
          };
          setStamp(receipt);
          download(`${signed.name.replace(/\.sig\.json$/, "")}.stamp.json`, new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`), "application/json");
          return;
        }
        await new Promise((r) => setTimeout(r, 3_000));
      }
      throw new Error(t("The fee wasn't mined within two minutes. Its hash: {hash}", { hash: fee.txHash }));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <section aria-label={t("Sign")}>
      <PanelHead title={t("Sign")} sub={t("with this tab's wallet")} todo={t("Choose a file (or write text), sign it, and keep the .sig.json. Stamping it on chain is optional.")} />
      {signed && keys !== "published" ? (
        <KeysBanner
          what={t("To stamp, publish your messaging keys (the stamp stores the .sig.json encrypted to you).")}
          busy={publishing}
          onPublish={() => {
            setPublishing(true);
            void ensureMessagingKeys()
              .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
              .finally(() => setPublishing(false));
          }}
        />
      ) : null}
      <div className="max-w-[46rem] space-y-3 px-4 pb-6 md:px-5">
        <PinnedNotice
          lines={[
            t("A signature proves that this wallet's two keys (Ed25519 and ML-DSA-44) signed these exact bytes. Not who holds the wallet, and not when."),
            t("The .sig.json contains the file itself: share it only where you would share the file."),
            t("A stamp puts a fee transaction on chain whose id is the first 128 bits of the .sig.json's SHA-256. With the .sig.json and the receipt, anyone can check it existed by that block."),
            t("A stamp doesn't show who made the document (the demo's sponsor pays the fee), and it anchors a 128-bit prefix: two documents prepared in advance to share it (about 2^64 work) would share a stamp."),
            t("Stamping stores the .sig.json, encrypted to you, on the demo node for 7 days; that is the file the fee pays for. The stamp stays on chain."),
            t("This is a testnet: the chain can be reset, and a stamp lasts only as long as the chain."),
          ]}
        />
        <FilePick
          onFile={(f) => {
            setFile(f);
            setSigned(null);
            setStamp(null);
          }}
          className="flex min-h-16 items-center justify-center rounded-md border border-dashed border-[#c9ced4] bg-[#fafbfc] px-3 text-center text-base text-[#3d434a] hover:border-[#8b9198]"
        >
          <span className="break-all">{file ? file.name : t("Choose a file to sign")}</span>
        </FilePick>
        {file ? null : <TextArea label={t("Or text to sign")} value={text} onChange={setText} rows={3} placeholder={t("…or write the text to sign")} />}
        <Button disabled={!!busy || (!file && !text.trim())} onClick={() => void onSign()}>
          {busy && !signed ? busy : t("Sign and download the .sig.json")}
        </Button>
        {signed ? (
          <div className="space-y-2 border-t border-[#eceef1] pt-3 text-[15px]">
            <p>
              {t("Signed by")}{" "}
              <span translate="no" className={cx(MONO, INK.named)}>
                {wallet?.walletId.slice(0, 16)}…
              </span>{" "}
              · {signed.env.payloadType} · <span className={MONO}>{signed.name}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button kind="secondary" onClick={() => download(signed.name, signed.bytes, "application/json")}>
                {t("Download again")}
              </Button>
              {stamp ? null : (
                <Button disabled={!!busy} onClick={() => void onStamp()}>
                  {busy || t("Stamp it on chain (optional)")}
                </Button>
              )}
            </div>
            {stamp ? (
              <p className={INK.ok}>
                {t("Stamped at block {height}. The receipt (.stamp.json) is downloaded; keep it with the .sig.json.", { height: stamp.block_height.toLocaleString() })}
              </p>
            ) : null}
          </div>
        ) : null}
        {err ? (
          <p role="alert" className={cx("text-[15px]", INK.bad)}>
            {err}
          </p>
        ) : null}
      </div>
    </section>
  );
}
