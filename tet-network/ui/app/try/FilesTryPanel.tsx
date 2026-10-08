"use client";

/**
 * Try TET, part 3: Files on /try. One action: send a file, encrypted in this tab. Its fee goes to
 * the demo's sponsor (`settleFileFee` in "demo-sponsor" mode, never the visitor's wallet); when the
 * sponsor declines, the file is still delivered and the page says why. Receiving needs messaging
 * keys, published from one inline banner when the visitor taps it (publishing is public).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { buildFileEnvelopeV1, type FileEnvelopeV1 } from "../lib/files";
import { decryptFileForReceiver, decryptFileMeta } from "../lib/files_e2ee";
import { settleFileFee } from "../lib/files_fee";
import { getTmailKeySession } from "../lib/tmail_session";
import { b64ToBytes } from "../lib/encoding";
import { getFilesFetch, getFilesInbox, getTmailKeys, normalizeWalletId64, postFilesUpload } from "../lib/tet_core_http";
import { Badge, Button, Chips, FilePick, INK, Input, KeysBanner, PanelHead, PinnedNotice, cx, fmtWhen } from "./ui";
import { BASE, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

const POLL_MS = 8_000;
/** The demo node's cap on the encrypted body (deploy/demo: TET_FILES_MAX_BODY_BYTES). */
const NODE_MAX_BODY = 100 * 1024 * 1024;
/** The largest file that fits: encryption adds a 16-byte tag. */
const MAX_BYTES = NODE_MAX_BODY - 16;
/** Kept 7 days (the demo node also caps it there). */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** What the picker offers: photos, PDFs and short videos. The node can't see what a file is. */
const ACCEPT = "image/*,application/pdf,video/*";
const KB = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

type Item = { env: FileEnvelopeV1; filename: string; mimeType: string };

const LIMITS = (t: (en: string) => string) => [
  t("Photos, PDFs and short videos, up to 100 MB each, kept 7 days. Encrypted in this tab before upload."),
  t("Why not more: the demo node stores every file itself, on its own disk, for everyone. There is no storage market yet that pays nodes to keep files, so this one keeps the limits small."),
  t("Files over 5 MB stay on the demo node only: other nodes accept up to 5 MB, so they neither relay nor keep a copy."),
  t("Each connection can upload up to 200 MB a day, and the demo keeps up to 10 GB in all; when it is full, uploads wait for older files to expire."),
  t("The 1,000 µTET fee is paid by the demo's sponsor, up to 5 files per connection and per ID a day. Past that the file still arrives; its fee shows as unpaid."),
  t("The node sees sender, recipient, size and time; not the contents or the file name. The page offers photos, PDFs and videos, but the node can't check what a file is."),
  t("A delivered file proves which ID sent it and that only the recipient can open it. It doesn't prove who is behind that ID, or that the file is what its name says."),
];

export default function FilesTryPanel(props: { demoContact: string }) {
  const { t, locale } = useLang();
  const { wallet, ensureWallet, ensureMessagingKeys, keys, checkKeys } = useTryWallet();
  const [publishing, setPublishing] = useState(false);
  const [publishErr, setPublishErr] = useState("");
  const [to, setTo] = useState("self");
  const [other, setOther] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const ks = getTmailKeySession();
    if (!wallet || !ks) return;
    const r = await getFilesInbox(BASE, wallet.walletId, 50);
    if (!r.ok || !mounted.current) return;
    const out: Item[] = [];
    for (const env of r.files) {
      try {
        const meta = await decryptFileMeta(
          {
            client_ephemeral_pub: b64ToBytes(env.e2ee.client_ephemeral_pub_b64),
            mlkem_ciphertext: b64ToBytes(env.e2ee.mlkem_ciphertext_b64),
            filename_nonce: b64ToBytes(env.e2ee.filename_nonce_b64),
            mime_nonce: b64ToBytes(env.e2ee.mime_nonce_b64),
            filename_ciphertext: b64ToBytes(env.filename_encrypted_b64),
            mime_ciphertext: b64ToBytes(env.mime_type_encrypted_b64),
          },
          ks.x25519_sk,
          ks.mlkem_sk,
        );
        out.push({ env, filename: meta.filename, mimeType: meta.mimeType });
      } catch {
        /* not for these keys */
      }
    }
    if (mounted.current) setItems(out);
  }, [wallet]);

  useEffect(() => {
    mounted.current = true;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      mounted.current = false;
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    if (!wallet) return;
    const first = setTimeout(() => void checkKeys().then(refresh).catch(() => {}), 0);
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [wallet, checkKeys, refresh]);

  async function onSend() {
    if (!file) return;
    setNote(null);
    try {
      if (file.size > MAX_BYTES) throw new Error(t("The file is larger than 100 MB."));
      setBusy(t("Encrypting…"));
      const me = await ensureWallet();
      const recipient = to === "self" ? me : to === "demo" ? props.demoContact : normalizeWalletId64(other);
      if (!recipient) throw new Error(t("The recipient must be a 64-character ID."));
      const keys = await getTmailKeys(BASE, recipient);
      if (!keys.ok) throw new Error(keys.text || `could not look up the recipient (HTTP ${keys.status})`);
      if (!keys.registration) {
        throw new Error(recipient === me ? t("Turn on your inbox first (the banner above), then you can send files to yourself.") : t("That ID hasn't turned on its inbox yet, so it can't receive messages."));
      }
      const built = await buildFileEnvelopeV1({
        senderWalletId: me,
        receiverWalletId: recipient,
        fileBytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        ttlMs: TTL_MS,
        maxBodyBytes: NODE_MAX_BODY,
        receiverX25519Pub: b64ToBytes(keys.registration.x25519_pub_b64),
        receiverMlkemPub: b64ToBytes(keys.registration.mlkem_pub_b64),
        baseUrl: BASE,
      });
      // Ask first: in public mode the node keeps a daily upload budget per address, and a refused
      // upload is cut off mid-way, so the page checks what's left before sending.
      const bud = await fetch(`${BASE}/files/upload-budget`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const left = typeof bud?.remaining_bytes === "number" ? (bud.remaining_bytes as number) : null;
      if (left !== null && built.bodyCiphertext.length + 64 * 1024 > left) {
        throw new Error(t("Daily upload limit for this connection: {left}\u00a0MB left today.", { left: KB.format(left / 1024 / 1024) }));
      }
      setBusy(t("Uploading…"));
      const up = await postFilesUpload(BASE, built.envelope, built.bodyCiphertext);
      if (!up.ok) throw new Error(up.text || `not sent (HTTP ${up.status})`);
      setBusy(t("Settling the fee…"));
      const fee = await settleFileFee({
        mode: "demo-sponsor",
        baseUrl: BASE,
        fileId: up.fileId ?? built.envelope.file_id,
        senderWalletId: me,
        storageWallet: up.storageWallet ?? "",
      });
      setNote({ ok: true, text: fee.state === "sponsored" ? `${t("Sent “{name}”.", { name: file.name })} ${fee.text}` : fee.text });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      void refresh();
    } catch (e: unknown) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  }

  async function onDownload(it: Item) {
    const ks = getTmailKeySession();
    if (!ks) return;
    try {
      const blob = await getFilesFetch(BASE, it.env.file_id);
      if (!blob.ok || !blob.bytes) throw new Error(blob.text || "not available yet; try again shortly");
      const d = await decryptFileForReceiver(
        {
          client_ephemeral_pub: b64ToBytes(it.env.e2ee.client_ephemeral_pub_b64),
          mlkem_ciphertext: b64ToBytes(it.env.e2ee.mlkem_ciphertext_b64),
          filename_nonce: b64ToBytes(it.env.e2ee.filename_nonce_b64),
          mime_nonce: b64ToBytes(it.env.e2ee.mime_nonce_b64),
          body_nonce: b64ToBytes(it.env.e2ee.body_nonce_b64),
          filename_ciphertext: b64ToBytes(it.env.filename_encrypted_b64),
          mime_ciphertext: b64ToBytes(it.env.mime_type_encrypted_b64),
          body_ciphertext: blob.bytes,
        },
        ks.x25519_sk,
        ks.mlkem_sk,
      );
      const url = URL.createObjectURL(new Blob([d.fileBytes.slice()], { type: d.mimeType || "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = d.filename || `${it.env.file_id}.bin`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  const options = [
    { label: t("Yourself"), value: "self" },
    ...(props.demoContact ? [{ label: t("The demo inbox"), value: "demo" }] : []),
    { label: t("Another ID"), value: "other" },
  ];

  return (
    <section aria-label={t("Files")}>
      <PanelHead title={t("Files")} sub={t("encrypted · up to 100 MB · 7 days")} todo={t("Choose a file and who gets it, then send it.")} />
      {keys !== "published" ? (
        <KeysBanner
          what={t("To receive files, turn on your inbox.")}
          busy={publishing}
          error={publishErr}
          onPublish={() => {
            setPublishErr("");
            setPublishing(true);
            void ensureMessagingKeys()
              .then(refresh)
              .catch((e: unknown) => setPublishErr(e instanceof Error ? e.message : String(e)))
              .finally(() => setPublishing(false));
          }}
        />
      ) : null}
      <div className="max-w-[46rem] space-y-3 px-4 pb-6 md:px-5">
      <PinnedNotice lines={LIMITS(t)} />
      <div className="space-y-2">
        <Chips options={options} value={to} onChange={setTo} />
        {to === "other" ? <Input ariaLabel={t("Recipient's ID")} value={other} onChange={setOther} mono placeholder={t("64 hex characters, e.g. 3f9a…")} /> : null}
        <FilePick
          ref={inputRef}
          onFile={setFile}
          accept={ACCEPT}
          className="flex min-h-20 items-center justify-center rounded-md border border-dashed border-[#c9ced4] bg-[#fafbfc] px-3 text-center text-base text-[#3d434a] hover:border-[#8b9198]"
        >
          <span className="break-all">{file ? `${file.name} · ${KB.format(file.size / 1024)} KB` : t("Choose a photo, PDF or short video (up to 100 MB)")}</span>
        </FilePick>
        <Button className="w-full sm:w-auto" disabled={!file || !!busy} onClick={() => void onSend()}>
          {busy || t("Send the file")}
        </Button>
        <p aria-live="polite" className={cx("text-[15px] empty:hidden", note?.ok ? INK.ok : INK.bad)}>{note?.text ?? ""}</p>
      </div>

      <div>
        <h3 className="mb-1 text-[15px] font-semibold">{t("Received")}</h3>
        {!wallet ? <p className="text-[15px] text-[#5d646d]">{t("Send something first: that makes your ID and its inbox.")}</p> : null}
        {wallet && items.length === 0 ? <p className="text-[15px] text-[#5d646d]">{t("Nothing yet. Try sending yourself a file.")}</p> : null}
        <ol className="border-t border-[#eceef1] empty:hidden">
          {items.map((it) => (
            <li key={it.env.file_id} className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] py-2.5">
              <span className="min-w-0 flex-1 break-all text-base">{it.filename}</span>
              <span className="text-[14px] text-[#5d646d]">
                {KB.format(it.env.file_size / 1024)} KB · {t("from")}{" "}
                <span translate="no" className={cx("font-mono", INK.named)}>{it.env.sender_wallet_id === wallet?.walletId ? t("you") : it.env.sender_wallet_id.slice(0, 8)}</span> ·{" "}
                {fmtWhen(it.env.created_at_ms, now, locale)}
              </span>
              <Badge tone="neutral">{t("encrypted")}</Badge>
              <Button kind="secondary" className="min-h-9 px-3 text-[15px]" onClick={() => void onDownload(it)}>
                {t("Download")}
              </Button>
            </li>
          ))}
        </ol>
      </div>
      </div>
    </section>
  );
}
