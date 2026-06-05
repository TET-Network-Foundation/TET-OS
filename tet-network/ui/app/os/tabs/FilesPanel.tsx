"use client";

/**
 * Files tab — File Sharing Phase 0 (E2EE 1:1 file transfer), mirroring the Tmail Messages pattern.
 *
 *   A. Send  — pick/drop a file, look up the recipient's KEM keys, encrypt client-side,
 *              POST /files/upload (the node stores the blob + gossips the announce).
 *   B. Inbox — poll GET /files/inbox/:wallet (5s), decrypt filename/MIME with this wallet's KEM keys,
 *              download-and-decrypt the body on demand.
 *   C. Status — messaging-key registration (needed to receive) + storage limits + sent/received.
 *
 * All crypto runs in the browser; the node is a blind relay. Phase 0: ≤ 5 MB, single local node
 * (cross-node body fetch arrives in Step 4).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Win95Panel from "../components/Win95Panel";
import Win95Button from "../components/Win95Button";
import Win95Field from "../components/Win95Field";
import { bevel, surface, cx } from "../components/tokens";
import {
  getFilesInbox,
  getFilesFetch,
  getTmailKeys,
  normalizeWalletId64,
  postFilesUpload,
  putTmailKeys,
} from "../../lib/tet_core_http";
import { buildFileEnvelopeV1, MAX_FILE_BODY_BYTES, type FileEnvelopeV1 } from "../../lib/files";
import { buildTmailKeyRegistrationV1 } from "../../lib/tmail_keys";
import { decryptFileForReceiver, decryptFileMeta } from "../../lib/files_e2ee";
import { getTmailKeySession } from "../../lib/tmail_session";
import { b64ToBytes } from "../../lib/encoding";

const INBOX_POLL_MS = 5_000;
const INBOX_VISIBLE = 5;
/** AEAD adds a 16-byte tag, so the plaintext bound is the body cap minus the tag. */
const MAX_PLAINTEXT_BYTES = MAX_FILE_BODY_BYTES - 16;

type Contact = { label: string; address: string };

type InboxFile = {
  fileId: string;
  sender: string;
  createdAtMs: number;
  encryptedSize: number;
  filename: string;
  mimeType: string;
  envelope: FileEnvelopeV1;
};

type SendPhase = "idle" | "encrypting" | "uploading" | "done" | "error";

type KeyStatus =
  | { state: "loading" }
  | { state: "registered"; registeredAtMs: number }
  | { state: "unregistered" }
  | { state: "no-session" }
  | { state: "error"; reason: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

/** "From Address Book ▾" picker — fills the recipient field from a saved contact (UX aid). */
function AddressBookPicker(props: { contacts: ReadonlyArray<Contact>; onPick: (addr: string) => void }) {
  const { contacts, onPick } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Win95Button onClick={() => setOpen((v) => !v)} className="px-2 py-0.5 text-xs">
        From Address Book ▾
      </Win95Button>
      {open ? (
        <div className={cx(bevel.outset, surface.panel, "absolute left-0 mt-1 z-50 min-w-[18rem] max-h-60 overflow-auto")}>
          {contacts.length === 0 ? (
            <div className="px-3 py-2 text-xs text-black/60">No contacts yet — add in Address Book tab</div>
          ) : (
            contacts.map((c, i) => (
              <button
                key={`${c.label}:${i}`}
                type="button"
                onClick={() => {
                  onPick(c.address);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-1 text-left text-sm hover:bg-[#000080] hover:text-white"
              >
                <span className="truncate">{c.label}</span>
                <span className="font-mono text-[11px] opacity-70">
                  {c.address.length === 64 ? `${c.address.slice(0, 8)}…${c.address.slice(-6)}` : c.address}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function FilesPanel(props: { baseUrl: string; myWalletId: string; contacts: ReadonlyArray<Contact> }) {
  const { baseUrl, contacts } = props;
  const myWalletId = normalizeWalletId64(props.myWalletId);

  // --- Send ---
  const [file, setFile] = useState<File | null>(null);
  const [recipient, setRecipient] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [sendNotice, setSendNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Inbox ---
  const decryptedRef = useRef<Map<string, InboxFile>>(new Map());
  const skipRef = useRef<Set<string>>(new Set());
  const [items, setItems] = useState<InboxFile[]>([]);
  const [showOlder, setShowOlder] = useState(false);
  const [inboxErr, setInboxErr] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // --- Status ---
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(() =>
    myWalletId ? { state: "loading" } : { state: "no-session" },
  );
  const [registerBusy, setRegisterBusy] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshKeyStatus = useCallback(async () => {
    if (!myWalletId) return;
    const r = await getTmailKeys(baseUrl, myWalletId);
    if (!mountedRef.current) return;
    if (r.ok && r.registration) {
      setKeyStatus({ state: "registered", registeredAtMs: r.registration.registered_at_ms });
    } else if (r.ok && r.registration === null) {
      setKeyStatus(getTmailKeySession() ? { state: "unregistered" } : { state: "no-session" });
    } else {
      setKeyStatus({ state: "error", reason: r.text ?? `HTTP ${r.status}` });
    }
  }, [baseUrl, myWalletId]);

  const decryptMeta = useCallback(
    async (env: FileEnvelopeV1): Promise<InboxFile | null> => {
      const session = getTmailKeySession();
      if (!session) return null;
      if (normalizeWalletId64(env.receiver_wallet_id) !== myWalletId) return null;
      try {
        const { filename, mimeType } = await decryptFileMeta(
          {
            client_ephemeral_pub: b64ToBytes(env.e2ee.client_ephemeral_pub_b64),
            mlkem_ciphertext: b64ToBytes(env.e2ee.mlkem_ciphertext_b64),
            filename_nonce: b64ToBytes(env.e2ee.filename_nonce_b64),
            mime_nonce: b64ToBytes(env.e2ee.mime_nonce_b64),
            filename_ciphertext: b64ToBytes(env.filename_encrypted_b64),
            mime_ciphertext: b64ToBytes(env.mime_type_encrypted_b64),
          },
          session.x25519_sk,
          session.mlkem_sk,
        );
        return {
          fileId: env.file_id,
          sender: env.sender_wallet_id,
          createdAtMs: env.created_at_ms,
          encryptedSize: env.file_size,
          filename,
          mimeType,
          envelope: env,
        };
      } catch {
        return null;
      }
    },
    [myWalletId],
  );

  // Inbox polling + decrypt + key probe. Panel remounts per wallet via its `key` prop.
  useEffect(() => {
    if (!myWalletId) return;
    let cancelled = false;

    const probeKeys = async () => {
      const r = await getTmailKeys(baseUrl, myWalletId);
      if (cancelled || !mountedRef.current) return;
      if (r.ok && r.registration) {
        setKeyStatus({ state: "registered", registeredAtMs: r.registration.registered_at_ms });
      } else if (r.ok && r.registration === null) {
        setKeyStatus(getTmailKeySession() ? { state: "unregistered" } : { state: "no-session" });
      } else {
        setKeyStatus({ state: "error", reason: r.text ?? `HTTP ${r.status}` });
      }
    };

    const tick = async () => {
      const res = await getFilesInbox(baseUrl, myWalletId, 50);
      if (cancelled || !mountedRef.current) return;
      if (!res.ok) {
        setInboxErr(res.text ?? `HTTP ${res.status}`);
        return;
      }
      setInboxErr("");
      const session = getTmailKeySession();
      if (!session) return;
      let changed = false;
      for (const env of res.files) {
        const id = env.file_id;
        if (decryptedRef.current.has(id) || skipRef.current.has(id)) continue;
        const decoded = await decryptMeta(env);
        if (cancelled || !mountedRef.current) return;
        if (decoded) {
          decryptedRef.current.set(id, decoded);
          changed = true;
        } else {
          skipRef.current.add(id);
        }
      }
      if (changed) {
        const next = [...decryptedRef.current.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
        setItems(next);
      }
    };

    void probeKeys();
    void tick();
    const h = window.setInterval(() => void tick(), INBOX_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(h);
    };
  }, [baseUrl, myWalletId, decryptMeta]);

  function pickFile(f: File | null) {
    setSendNotice(null);
    setSendPhase("idle");
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_PLAINTEXT_BYTES) {
      setFile(null);
      setSendNotice({ kind: "err", text: `File too large — Phase 0 limit is 5 MB (got ${formatBytes(f.size)}).` });
      return;
    }
    setFile(f);
  }

  async function onSend() {
    setSendNotice(null);
    const to = normalizeWalletId64(recipient);
    if (!myWalletId) {
      setSendNotice({ kind: "err", text: "Unlock your wallet first." });
      return;
    }
    if (!to) {
      setSendNotice({ kind: "err", text: "Recipient wallet ID must be 64 hex chars." });
      return;
    }
    if (to === myWalletId) {
      setSendNotice({ kind: "err", text: "Cannot send a file to yourself." });
      return;
    }
    if (!file) {
      setSendNotice({ kind: "err", text: "Choose a file first." });
      return;
    }
    if (file.size > MAX_PLAINTEXT_BYTES) {
      setSendNotice({ kind: "err", text: "File too large — Phase 0 limit is 5 MB." });
      return;
    }
    try {
      setSendPhase("encrypting");
      const keys = await getTmailKeys(baseUrl, to);
      if (!keys.ok && keys.status !== 404) {
        setSendPhase("error");
        setSendNotice({ kind: "err", text: keys.text ?? `Key lookup failed (HTTP ${keys.status}).` });
        return;
      }
      if (!keys.registration) {
        setSendPhase("error");
        setSendNotice({ kind: "err", text: "Recipient hasn't registered messaging keys yet." });
        return;
      }
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const built = await buildFileEnvelopeV1({
        senderWalletId: myWalletId,
        receiverWalletId: to,
        fileBytes,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        receiverX25519Pub: b64ToBytes(keys.registration.x25519_pub_b64),
        receiverMlkemPub: b64ToBytes(keys.registration.mlkem_pub_b64),
        baseUrl,
      });
      if (!mountedRef.current) return;
      setSendPhase("uploading");
      const up = await postFilesUpload(baseUrl, built.envelope, built.bodyCiphertext);
      if (!mountedRef.current) return;
      if (up.ok) {
        setSendPhase("done");
        setSentCount((n) => n + 1);
        setSendNotice({ kind: "ok", text: `Sent "${file.name}" (file_id: ${shortId(up.fileId ?? built.envelope.file_id)}).` });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        setSendPhase("error");
        setSendNotice({ kind: "err", text: up.text ?? `Upload failed (HTTP ${up.status}).` });
      }
    } catch (e: unknown) {
      if (mountedRef.current) {
        setSendPhase("error");
        setSendNotice({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  async function onDownload(item: InboxFile) {
    const session = getTmailKeySession();
    if (!session) {
      setInboxErr("Unlock your wallet to decrypt files.");
      return;
    }
    setDownloadingId(item.fileId);
    setInboxErr("");
    try {
      const res = await getFilesFetch(baseUrl, item.fileId);
      if (!res.ok || !res.bytes) {
        setInboxErr(
          res.status === 404
            ? "Encrypted body not on this node yet (Phase 0 fetches from the local node; cross-node arrives in Step 4)."
            : (res.text ?? `Fetch failed (HTTP ${res.status}).`),
        );
        return;
      }
      const env = item.envelope;
      const decrypted = await decryptFileForReceiver(
        {
          client_ephemeral_pub: b64ToBytes(env.e2ee.client_ephemeral_pub_b64),
          mlkem_ciphertext: b64ToBytes(env.e2ee.mlkem_ciphertext_b64),
          filename_nonce: b64ToBytes(env.e2ee.filename_nonce_b64),
          mime_nonce: b64ToBytes(env.e2ee.mime_nonce_b64),
          body_nonce: b64ToBytes(env.e2ee.body_nonce_b64),
          filename_ciphertext: b64ToBytes(env.filename_encrypted_b64),
          mime_ciphertext: b64ToBytes(env.mime_type_encrypted_b64),
          body_ciphertext: res.bytes,
        },
        session.x25519_sk,
        session.mlkem_sk,
      );
      if (!mountedRef.current) return;
      const blob = new Blob([decrypted.fileBytes.slice()], {
        type: decrypted.mimeType || item.mimeType || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = decrypted.filename || item.filename || `${item.fileId}.bin`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
    } catch (e: unknown) {
      if (mountedRef.current) {
        setInboxErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mountedRef.current) setDownloadingId(null);
    }
  }

  async function onRegister() {
    const ks = getTmailKeySession();
    if (!ks || !myWalletId) {
      setKeyStatus({ state: "no-session" });
      return;
    }
    setRegisterBusy(true);
    try {
      const reg = await buildTmailKeyRegistrationV1({ x25519_pub: ks.x25519_pub, mlkem_pub: ks.mlkem_pub, baseUrl });
      const r = await putTmailKeys(baseUrl, myWalletId, reg);
      if (!mountedRef.current) return;
      if (r.ok) {
        setKeyStatus({ state: "registered", registeredAtMs: r.registeredAtMs ?? reg.registered_at_ms });
      } else {
        setKeyStatus({ state: "error", reason: r.text ?? `register failed (HTTP ${r.status})` });
      }
    } catch (e: unknown) {
      if (mountedRef.current) setKeyStatus({ state: "error", reason: e instanceof Error ? e.message : String(e) });
    } finally {
      if (mountedRef.current) setRegisterBusy(false);
    }
  }

  const sendBusy = sendPhase === "encrypting" || sendPhase === "uploading";
  const visible = showOlder ? items : items.slice(0, INBOX_VISIBLE);
  const hidden = Math.max(0, items.length - INBOX_VISIBLE);

  const stepLabel = (step: "encrypting" | "uploading" | "done") => {
    const order: SendPhase[] = ["encrypting", "uploading", "done"];
    const cur = order.indexOf(sendPhase);
    const idx = order.indexOf(step);
    if (sendPhase === "idle" || sendPhase === "error") return "○";
    if (cur > idx || sendPhase === "done") return "✓";
    if (cur === idx) return "▸";
    return "○";
  };

  return (
    <Win95Panel variant="outset" className="p-3 space-y-3">
      <div className="text-sm font-semibold text-black">Files — End-to-End Encrypted (Phase 0)</div>

      {/* A. Send */}
      <Win95Panel variant="inset" className="p-2 space-y-2">
        <div className="text-xs font-semibold text-black">Send a File</div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0] ?? null;
            pickFile(f);
          }}
          className={cx(
            bevel.inset,
            "bg-white px-3 py-4 text-center cursor-pointer select-none",
            dragOver ? "outline outline-2 outline-[#000080]" : "",
          )}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-black break-all">{file.name}</div>
              <div className="text-[11px] font-mono text-black/60">
                {formatBytes(file.size)} · {file.type || "application/octet-stream"}
              </div>
              <div className="text-[10px] text-black/50">Click to choose a different file</div>
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="text-sm text-black/70">Drag &amp; drop a file here</div>
              <div className="text-[11px] text-black/50">or click to browse · max 5 MB</div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="w-20 text-sm shrink-0">To:</span>
          <Win95Field value={recipient} onChange={setRecipient} mono placeholder="64-hex wallet id" className="flex-1" />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0" />
          <AddressBookPicker contacts={contacts} onPick={setRecipient} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-mono text-black/60">
            <span title="encrypt">{stepLabel("encrypting")} Encrypt</span>
            {"  "}
            <span title="upload">{stepLabel("uploading")} Upload</span>
            {"  "}
            <span title="announce">{stepLabel("done")} Announce</span>
          </div>
          <Win95Button onClick={() => void onSend()} disabled={sendBusy} className="px-4 py-1 text-sm">
            {sendPhase === "encrypting" ? "Encrypting…" : sendPhase === "uploading" ? "Uploading…" : "Send Encrypted File"}
          </Win95Button>
        </div>
        {sendNotice ? (
          <div className={cx("text-xs break-words", sendNotice.kind === "ok" ? "text-[#1f5132]" : "text-[#8a1f1f]")}>
            {sendNotice.text}
          </div>
        ) : null}
      </Win95Panel>

      {/* B. Inbox */}
      <Win95Panel variant="inset" className="p-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-black">Inbox</span>
          <span className="text-[10px] font-mono text-black/55">auto-refresh 5s</span>
        </div>
        {inboxErr ? <div className="text-[11px] text-[#8a1f1f] break-words">{inboxErr}</div> : null}
        {keyStatus.state === "no-session" ? (
          <div className="text-[11px] text-black/60">
            Unlock a mnemonic/PIN wallet to derive messaging keys and receive encrypted files.
          </div>
        ) : items.length === 0 ? (
          <div className="text-[11px] text-black/60">No decryptable files yet.</div>
        ) : (
          <div className="space-y-2">
            {visible.map((f) => (
              <div key={f.fileId} className={cx(bevel.outset, "bg-white p-2")}>
                <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-black/60">
                  <span title={f.sender}>from {shortId(f.sender)}</span>
                  <span>{new Date(f.createdAtMs).toLocaleString()}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-black break-all">{f.filename}</div>
                    <div className="text-[11px] font-mono text-black/55">
                      {formatBytes(f.encryptedSize)} · {f.mimeType || "application/octet-stream"}
                    </div>
                  </div>
                  <Win95Button
                    onClick={() => void onDownload(f)}
                    disabled={downloadingId === f.fileId}
                    className="px-3 py-0.5 text-xs shrink-0"
                  >
                    {downloadingId === f.fileId ? "Decrypting…" : "Download"}
                  </Win95Button>
                </div>
              </div>
            ))}
            {!showOlder && hidden > 0 ? (
              <Win95Button onClick={() => setShowOlder(true)} className="px-3 py-0.5 text-xs">
                Show older ({hidden} hidden)
              </Win95Button>
            ) : null}
            {showOlder && hidden > 0 ? (
              <Win95Button onClick={() => setShowOlder(false)} className="px-3 py-0.5 text-xs">
                Show less
              </Win95Button>
            ) : null}
          </div>
        )}
      </Win95Panel>

      {/* C. Status */}
      <Win95Panel variant="inset" className="p-2 space-y-2">
        <div className="text-xs font-semibold text-black">Messaging Keys &amp; Storage</div>
        {keyStatus.state === "loading" ? (
          <div className="text-[11px] text-black/60">Checking registration…</div>
        ) : keyStatus.state === "registered" ? (
          <div className="text-[11px] text-[#1f5132]">
            Keys registered at: {new Date(keyStatus.registeredAtMs).toLocaleString()}
          </div>
        ) : keyStatus.state === "no-session" ? (
          <div className="text-[11px] text-black/60">
            Messaging keys are derived from your mnemonic. Unlock a mnemonic/PIN wallet to enable file receipt.
          </div>
        ) : keyStatus.state === "error" ? (
          <div className="space-y-1">
            <div className="text-[11px] text-[#8a1f1f]">Status check failed: {keyStatus.reason}</div>
            <Win95Button onClick={() => void refreshKeyStatus()} className="px-3 py-0.5 text-xs">
              Retry
            </Win95Button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-[11px] text-black/70">
              Your messaging keys aren&apos;t published yet — others can&apos;t send you files until you register.
            </div>
            <Win95Button onClick={() => void onRegister()} disabled={registerBusy} className="px-4 py-1 text-sm">
              {registerBusy ? "Registering…" : "Register your messaging keys"}
            </Win95Button>
          </div>
        )}
        <div className="text-[11px] font-mono text-black/60">
          Max 5 MB · 30-day retention · fee 1000 µTET (declared) · Sent {sentCount} · Received {items.length}
        </div>
      </Win95Panel>
    </Win95Panel>
  );
}
