"use client";

/**
 * Messages tab — Tmail Basic E2EE (Sovereign OS Messages).
 *
 *   A. Compose — look up the recipient's KEM keys, encrypt client-side, POST /tmail/send.
 *   B. Inbox   — poll GET /tmail/inbox/:wallet_id (5s), decrypt with this wallet's KEM secret keys.
 *   C. Status  — show/auto-register this wallet's messaging keys (PUT /tmail/keys/:wallet_id).
 *
 * All crypto runs in the browser; the node only routes opaque ciphertext.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTmailInbox,
  getTmailKeys,
  normalizeWalletId64,
  postTmailSend,
  putTmailKeys,
} from "../lib/tet_core_http";
import { buildTmailEnvelopeV1, TMAIL_MAX_PLAINTEXT_CHARS, type TmailEnvelopeV1 } from "../lib/tmail";
import { buildTmailKeyRegistrationV1 } from "../lib/tmail_keys";
import { decryptForReceiver } from "../lib/tmail_e2ee";
import { getTmailKeySession } from "../lib/tmail_session";
import { b64ToBytes } from "../lib/encoding";

const INBOX_POLL_MS = 5_000;
const INBOX_VISIBLE = 5;

type DecryptedItem = {
  msgId: string;
  sender: string;
  sentAtMs: number;
  text: string;
};

type KeyStatus =
  | { state: "loading" }
  | { state: "registered"; registeredAtMs: number }
  | { state: "unregistered" }
  | { state: "no-session" }
  | { state: "error"; reason: string };

export default function MessagesPanel(props: {
  outset: string;
  inset: string;
  winBtn: string;
  baseUrl: string;
  myWalletId: string;
}) {
  const { outset, inset, winBtn, baseUrl } = props;
  const myWalletId = normalizeWalletId64(props.myWalletId);

  // --- Compose ---
  const [recipient, setRecipient] = useState("");
  const [messageText, setMessageText] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendNotice, setSendNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // --- Inbox ---
  const decryptedRef = useRef<Map<string, DecryptedItem>>(new Map());
  const skipRef = useRef<Set<string>>(new Set());
  const [items, setItems] = useState<DecryptedItem[]>([]);
  const [showOlder, setShowOlder] = useState(false);
  const [inboxErr, setInboxErr] = useState<string>("");

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

  const decryptEnvelope = useCallback(
    async (env: TmailEnvelopeV1): Promise<DecryptedItem | null> => {
      const session = getTmailKeySession();
      if (!session) return null;
      if (normalizeWalletId64(env.receiver_wallet_id) !== myWalletId) return null;
      try {
        const plaintext = await decryptForReceiver(
          {
            client_ephemeral_pub: b64ToBytes(env.e2ee.client_ephemeral_pub_b64),
            mlkem_ciphertext: b64ToBytes(env.e2ee.mlkem_ciphertext_b64),
            nonce: b64ToBytes(env.e2ee.nonce_b64),
            ciphertext: b64ToBytes(env.e2ee.ciphertext_b64),
          },
          session.x25519_sk,
          session.mlkem_sk,
        );
        return {
          msgId: env.msg_id,
          sender: env.sender_wallet_id,
          sentAtMs: env.sent_at_ms,
          text: new TextDecoder().decode(plaintext),
        };
      } catch {
        return null;
      }
    },
    [myWalletId],
  );

  // Inbox polling + decrypt + initial key-registration probe (this panel remounts per wallet via
  // its `key` prop, so a fresh mount re-probes).
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
      const res = await getTmailInbox(baseUrl, myWalletId, 50);
      if (cancelled || !mountedRef.current) return;
      if (!res.ok) {
        setInboxErr(res.text ?? `HTTP ${res.status}`);
        return;
      }
      setInboxErr("");
      const session = getTmailKeySession();
      if (!session) return;
      let changed = false;
      for (const env of res.messages) {
        const id = env.msg_id;
        if (decryptedRef.current.has(id) || skipRef.current.has(id)) continue;
        const decoded = await decryptEnvelope(env);
        if (cancelled || !mountedRef.current) return;
        if (decoded) {
          decryptedRef.current.set(id, decoded);
          changed = true;
        } else {
          skipRef.current.add(id);
        }
      }
      if (changed) {
        const next = [...decryptedRef.current.values()].sort((a, b) => b.sentAtMs - a.sentAtMs);
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
  }, [baseUrl, myWalletId, decryptEnvelope]);

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
      setSendNotice({ kind: "err", text: "Cannot send a message to yourself." });
      return;
    }
    const text = messageText;
    if (!text.trim()) {
      setSendNotice({ kind: "err", text: "Message is empty." });
      return;
    }
    if (text.length > TMAIL_MAX_PLAINTEXT_CHARS) {
      setSendNotice({ kind: "err", text: `Message too long (max ${TMAIL_MAX_PLAINTEXT_CHARS} chars).` });
      return;
    }
    setSendBusy(true);
    try {
      const keys = await getTmailKeys(baseUrl, to);
      if (!keys.ok && keys.status !== 404) {
        setSendNotice({ kind: "err", text: keys.text ?? `Key lookup failed (HTTP ${keys.status}).` });
        return;
      }
      if (!keys.registration) {
        setSendNotice({ kind: "err", text: "Recipient hasn't registered messaging keys yet." });
        return;
      }
      const env = await buildTmailEnvelopeV1({
        senderWalletId: myWalletId,
        receiverWalletId: to,
        plaintextUtf8: text,
        receiverX25519Pub: b64ToBytes(keys.registration.x25519_pub_b64),
        receiverMlkemPub: b64ToBytes(keys.registration.mlkem_pub_b64),
        baseUrl,
      });
      const sent = await postTmailSend(baseUrl, env);
      if (!mountedRef.current) return;
      if (sent.ok) {
        setSendNotice({ kind: "ok", text: `Sent (msg_id: ${sent.msgId ?? env.msg_id}).` });
        setMessageText("");
      } else {
        setSendNotice({ kind: "err", text: sent.text ?? `Send failed (HTTP ${sent.status}).` });
      }
    } catch (e: unknown) {
      if (mountedRef.current) {
        setSendNotice({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      if (mountedRef.current) setSendBusy(false);
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
      const reg = await buildTmailKeyRegistrationV1({
        x25519_pub: ks.x25519_pub,
        mlkem_pub: ks.mlkem_pub,
        baseUrl,
      });
      const r = await putTmailKeys(baseUrl, myWalletId, reg);
      if (!mountedRef.current) return;
      if (r.ok) {
        setKeyStatus({ state: "registered", registeredAtMs: r.registeredAtMs ?? reg.registered_at_ms });
      } else {
        setKeyStatus({ state: "error", reason: r.text ?? `register failed (HTTP ${r.status})` });
      }
    } catch (e: unknown) {
      if (mountedRef.current) {
        setKeyStatus({ state: "error", reason: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      if (mountedRef.current) setRegisterBusy(false);
    }
  }

  const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id);
  const visible = showOlder ? items : items.slice(0, INBOX_VISIBLE);
  const hidden = Math.max(0, items.length - INBOX_VISIBLE);

  return (
    <div className={`${outset} bg-[#DAD8D2] p-3 space-y-3`}>
      <div className="text-sm font-semibold text-black">Messages — End-to-End Encrypted (Tmail)</div>

      {/* A. Compose */}
      <div className={`${inset} bg-[#F9F9F6] p-2 space-y-2`}>
        <div className="text-xs font-semibold text-black">Compose</div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-sm">Recipient:</span>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="64-hex wallet id"
            className={`${inset} flex-1 bg-white px-2 py-1 text-xs font-mono outline-none`}
          />
        </div>
        <textarea
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          rows={4}
          maxLength={TMAIL_MAX_PLAINTEXT_CHARS}
          placeholder="Type your message — encrypted on this device before it leaves."
          className={`${inset} w-full bg-white px-2 py-1 text-sm outline-none resize-y`}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-black/60">
            {messageText.length}/{TMAIL_MAX_PLAINTEXT_CHARS}
          </span>
          <button
            type="button"
            disabled={sendBusy}
            onClick={() => void onSend()}
            className={`${winBtn} bg-[#DAD8D2] px-4 py-1 text-sm ${sendBusy ? "opacity-60" : ""}`}
          >
            {sendBusy ? "Encrypting…" : "Send Encrypted Message"}
          </button>
        </div>
        {sendNotice ? (
          <div
            className={`text-xs break-words ${sendNotice.kind === "ok" ? "text-[#1f5132]" : "text-[#8a1f1f]"}`}
          >
            {sendNotice.text}
          </div>
        ) : null}
      </div>

      {/* B. Inbox */}
      <div className={`${inset} bg-[#F9F9F6] p-2 space-y-2`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-black">Inbox</span>
          <span className="text-[10px] font-mono text-black/55">auto-refresh 5s</span>
        </div>
        {inboxErr ? <div className="text-[11px] text-[#8a1f1f]">Inbox unavailable: {inboxErr}</div> : null}
        {keyStatus.state === "no-session" ? (
          <div className="text-[11px] text-black/60">
            Unlock a mnemonic/PIN wallet to derive messaging keys and read encrypted mail.
          </div>
        ) : items.length === 0 ? (
          <div className="text-[11px] text-black/60">No decryptable messages yet.</div>
        ) : (
          <div className="space-y-2">
            {visible.map((m) => (
              <div key={m.msgId} className={`${outset} bg-white p-2`}>
                <div className="flex items-center justify-between text-[10px] font-mono text-black/60">
                  <span title={m.sender}>from {shortId(m.sender)}</span>
                  <span>{new Date(m.sentAtMs).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-sm text-black whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {m.text}
                </div>
              </div>
            ))}
            {!showOlder && hidden > 0 ? (
              <button
                type="button"
                onClick={() => setShowOlder(true)}
                className={`${winBtn} bg-[#DAD8D2] px-3 py-0.5 text-xs`}
              >
                Show older ({hidden} hidden)
              </button>
            ) : null}
            {showOlder && hidden > 0 ? (
              <button
                type="button"
                onClick={() => setShowOlder(false)}
                className={`${winBtn} bg-[#DAD8D2] px-3 py-0.5 text-xs`}
              >
                Show less
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* C. Status */}
      <div className={`${inset} bg-[#F9F9F6] p-2 space-y-2`}>
        <div className="text-xs font-semibold text-black">Messaging Keys</div>
        {keyStatus.state === "loading" ? (
          <div className="text-[11px] text-black/60">Checking registration…</div>
        ) : keyStatus.state === "registered" ? (
          <div className="text-[11px] text-[#1f5132]">
            Keys registered at: {new Date(keyStatus.registeredAtMs).toLocaleString()}
          </div>
        ) : keyStatus.state === "no-session" ? (
          <div className="text-[11px] text-black/60">
            Messaging keys are derived from your mnemonic. Unlock a mnemonic/PIN wallet to enable Tmail.
          </div>
        ) : keyStatus.state === "error" ? (
          <div className="space-y-1">
            <div className="text-[11px] text-[#8a1f1f]">Status check failed: {keyStatus.reason}</div>
            <button
              type="button"
              onClick={() => void refreshKeyStatus()}
              className={`${winBtn} bg-[#DAD8D2] px-3 py-0.5 text-xs`}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-[11px] text-black/70">
              Your messaging keys aren&apos;t published yet — others can&apos;t send you mail until you register.
            </div>
            <button
              type="button"
              disabled={registerBusy}
              onClick={() => void onRegister()}
              className={`${winBtn} bg-[#DAD8D2] px-4 py-1 text-sm ${registerBusy ? "opacity-60" : ""}`}
            >
              {registerBusy ? "Registering…" : "Register your messaging keys"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
