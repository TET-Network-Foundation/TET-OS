"use client";

/**
 * Messages tab — Tmail Basic E2EE (Sovereign OS Messages).
 *
 *   A. Compose — look up the recipient's KEM keys, encrypt client-side, POST /tmail/send.
 *                Optional burn-after-read (spec §A.3) and scheduled release (§A.2) ride the
 *                signed `flags` / `release_at_ms`.
 *   B. Inbox   — poll GET /tmail/inbox/:wallet_id (5s), decrypt with this wallet's KEM secret keys.
 *                Renders exactly what the node returns: retention is the node's
 *                per-conversation rule (S7-0), not a client-side slice.
 *                Burn-after-read mail stays sealed until the reader opens it, which posts
 *                POST /tmail/read-receipt and destroys it network-wide (best-effort, §A.3.2 L3).
 *   C. Status  — show/auto-register this wallet's messaging keys (PUT /tmail/keys/:wallet_id).
 *
 * All crypto runs in the browser; the node only routes opaque ciphertext.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTmailAnonRoot,
  getTmailInbox,
  getTmailKeys,
  normalizeWalletId64,
  postTmailAnonSend,
  postTmailReadReceipt,
  postTmailSend,
  putTmailKeys,
} from "../lib/tet_core_http";
import {
  anonLabel,
  secondsUntil,
  TMAIL_ANON_DISCLOSURE,
  type AnonVerdict,
} from "../lib/tmail_anon";
import { buildTmailEnvelopeV1, TMAIL_MAX_PLAINTEXT_CHARS, type TmailInboxRowV1 } from "../lib/tmail";
import { buildTmailBurnRevokeV1, TMAIL_BURN_DISCLOSURE } from "../lib/tmail_burn";
import {
  formatReleaseAt,
  timeUntilRelease,
  TMAIL_MAX_SCHEDULE_MINUTES,
  TMAIL_MIN_SCHEDULE_MINUTES,
  TMAIL_TIME_LOCK_DISCLOSURE,
} from "../lib/tmail_timelock";
import { buildTmailKeyRegistrationV1 } from "../lib/tmail_keys";
import { decryptForReceiver } from "../lib/tmail_e2ee";
import { getTmailKeySession } from "../lib/tmail_session";
import { b64ToBytes } from "../lib/encoding";

const INBOX_POLL_MS = 5_000;

/** Sender-side anonymous state. `propagating` has a known end; `proving` does not. */
type AnonSendUi =
  | { state: "idle" }
  | { state: "not_registered" }
  | { state: "propagating"; eligibleAtMs: number }
  | { state: "proving"; jobId: string }
  | { state: "error"; reason: string };

type InboxItem = {
  msgId: string;
  sender: string;
  sentAtMs: number;
  /** Present only on anonymous messages. Absent or pending both mean NOT verified. */
  anonVerdict?: AnonVerdict;
  /** Signed `flags.burn_after_read` from the envelope — the node's authority, not a local guess. */
  burnAfterRead: boolean;
} & (
  | { state: "open"; text: string }
  // The node withheld the ciphertext: there is nothing to decrypt yet, and the client does not
  // pretend otherwise. `note` is the node's own R6 disclosure, shown as sent.
  | { state: "scheduled"; releaseAtMs: number; note: string }
);

/** Per-message burn state, once the reader has opened a burn-after-read message. */
type BurnState =
  | { state: "burning" }
  | { state: "burned" }
  | { state: "error"; reason: string };

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
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [scheduleMinutes, setScheduleMinutes] = useState(60);
  const [anonymous, setAnonymous] = useState(false);
  const [anonSend, setAnonSend] = useState<AnonSendUi>({ state: "idle" });
  const [anonMembers, setAnonMembers] = useState<number | null>(null);
  // Re-renders once a second so the propagating countdown actually counts.
  const [, setTick] = useState(0);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendNotice, setSendNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // --- Inbox ---
  const decryptedRef = useRef<Map<string, InboxItem>>(new Map());
  const skipRef = useRef<Set<string>>(new Set());
  const [items, setItems] = useState<InboxItem[]>([]);
  const [inboxErr, setInboxErr] = useState<string>("");
  // Burn-after-read messages stay sealed until the reader opens them: polling decrypts in the
  // background, and destroying a message the user never actually looked at would be a lie.
  const [opened, setOpened] = useState<Record<string, BurnState>>({});

  // --- Status ---
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(() =>
    myWalletId ? { state: "loading" } : { state: "no-session" },
  );
  const [registerBusy, setRegisterBusy] = useState(false);

  // Only ticks while a countdown is on screen; idle compose does no work.
  useEffect(() => {
    if (anonSend.state !== "propagating") return;
    const h = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(h);
  }, [anonSend.state]);

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
    async (row: TmailInboxRowV1): Promise<InboxItem | null> => {
      const session = getTmailKeySession();
      if (!session) return null;
      if (normalizeWalletId64(row.receiver_wallet_id) !== myWalletId) return null;
      const common = {
        msgId: row.msg_id,
        sender: row.sender_wallet_id,
        sentAtMs: row.sent_at_ms,
        burnAfterRead: row.flags?.burn_after_read === true,
        anonVerdict: row.flags?.anonymous === true ? (row.anon_verdict ?? { state: "pending" as const }) : undefined,
      };
      // No ciphertext means the node is still withholding it. Nothing to decrypt, and nothing to
      // guess at: show it as scheduled with the node's own wording.
      if (row.locked === true || !row.e2ee) {
        return {
          ...common,
          state: "scheduled",
          releaseAtMs: row.release_at_ms,
          note: row.locked_note ?? TMAIL_TIME_LOCK_DISCLOSURE,
        };
      }
      try {
        const plaintext = await decryptForReceiver(
          {
            client_ephemeral_pub: b64ToBytes(row.e2ee.client_ephemeral_pub_b64),
            mlkem_ciphertext: b64ToBytes(row.e2ee.mlkem_ciphertext_b64),
            nonce: b64ToBytes(row.e2ee.nonce_b64),
            ciphertext: b64ToBytes(row.e2ee.ciphertext_b64),
          },
          session.x25519_sk,
          session.mlkem_sk,
        );
        return { ...common, state: "open", text: new TextDecoder().decode(plaintext) };
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
        // A scheduled row is deliberately NOT treated as settled: once the node releases it, the
        // next poll carries the ciphertext and it must be decrypted then.
        const cached = decryptedRef.current.get(id);
        if ((cached && cached.state !== "scheduled") || skipRef.current.has(id)) continue;
        const decoded = await decryptEnvelope(env);
        if (cancelled || !mountedRef.current) return;
        if (decoded) {
          if (JSON.stringify(cached) !== JSON.stringify(decoded)) changed = true;
          decryptedRef.current.set(id, decoded);
        } else if (!cached) {
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
        burnAfterRead,
        releaseAtMs: scheduled ? Date.now() + scheduleMinutes * 60_000 : undefined,
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

  /**
   * Open a burn-after-read message: reveal the plaintext this session and post the read receipt,
   * which destroys the ciphertext on this node and announces the revoke to peers.
   *
   * The plaintext stays on screen afterwards. The reader has read it — blanking it would be
   * theatre, and §A.3.2 Layer 3 is explicit that this is a network burn, not local amnesia.
   */
  /**
   * Ask the node whether this wallet can send anonymously yet.
   *
   * The three answers stay distinct all the way to the screen: not registered is a different
   * problem from waiting, and waiting-for-the-boundary has a known end time while proving does not.
   */
  async function refreshAnonEligibility() {
    if (!myWalletId) return;
    const root = await getTmailAnonRoot(baseUrl);
    if (mountedRef.current && root.ok) setAnonMembers(root.members ?? null);
    const r = await postTmailAnonSend(baseUrl, myWalletId);
    if (!mountedRef.current) return;
    if (r.status === 409 || r.state === "not_registered") {
      setAnonSend({ state: "not_registered" });
    } else if (r.state === "registration_propagating" && r.eligibleAtMs) {
      setAnonSend({ state: "propagating", eligibleAtMs: r.eligibleAtMs });
    } else if (r.state === "proving" && r.jobId) {
      setAnonSend({ state: "proving", jobId: r.jobId });
    } else {
      setAnonSend({ state: "error", reason: r.text ?? `HTTP ${r.status}` });
    }
  }

  async function onOpenAndBurn(msgId: string) {
    setOpened((prev) => ({ ...prev, [msgId]: { state: "burning" } }));
    try {
      const revoke = await buildTmailBurnRevokeV1({
        msgId,
        readerWalletId: myWalletId,
        baseUrl,
      });
      const r = await postTmailReadReceipt(baseUrl, revoke);
      if (!mountedRef.current) return;
      if (r.ok) {
        setOpened((prev) => ({ ...prev, [msgId]: { state: "burned" } }));
      } else {
        setOpened((prev) => ({
          ...prev,
          [msgId]: { state: "error", reason: r.text ?? `HTTP ${r.status}` },
        }));
      }
    } catch (e: unknown) {
      if (mountedRef.current) {
        setOpened((prev) => ({
          ...prev,
          [msgId]: { state: "error", reason: e instanceof Error ? e.message : String(e) },
        }));
      }
    }
  }

  const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id);

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
        <label className="flex items-start gap-2 text-[11px] text-black/80">
          <input
            type="checkbox"
            checked={burnAfterRead}
            onChange={(e) => setBurnAfterRead(e.target.checked)}
            className="mt-[2px]"
          />
          <span>
            <span className="font-semibold">Burn after reading</span>
            <span className="block text-black/60">{TMAIL_BURN_DISCLOSURE}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[11px] text-black/80">
          <input
            type="checkbox"
            checked={scheduled}
            onChange={(e) => setScheduled(e.target.checked)}
            className="mt-[2px]"
          />
          <span className="flex-1">
            <span className="font-semibold">Schedule release</span>
            {scheduled ? (
              <span className="ml-2 inline-flex items-center gap-1">
                <input
                  type="number"
                  min={TMAIL_MIN_SCHEDULE_MINUTES}
                  max={TMAIL_MAX_SCHEDULE_MINUTES}
                  value={scheduleMinutes}
                  onChange={(e) =>
                    setScheduleMinutes(
                      Math.min(
                        TMAIL_MAX_SCHEDULE_MINUTES,
                        Math.max(TMAIL_MIN_SCHEDULE_MINUTES, Number(e.target.value) || 1),
                      ),
                    )
                  }
                  className={`${inset} w-20 bg-white px-1 py-0.5 text-xs outline-none`}
                />
                <span className="text-black/60">
                  minutes — opens {formatReleaseAt(Date.now() + scheduleMinutes * 60_000)}
                </span>
              </span>
            ) : null}
            <span className="block text-black/60">{TMAIL_TIME_LOCK_DISCLOSURE}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[11px] text-black/80">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => {
              setAnonymous(e.target.checked);
              if (e.target.checked) void refreshAnonEligibility();
              else setAnonSend({ state: "idle" });
            }}
            className="mt-[2px]"
          />
          <span className="flex-1">
            <span className="font-semibold">Send anonymously</span>
            {anonMembers !== null ? (
              <span className="ml-2 text-black/60">
                anonymity set on this node: {anonMembers}
              </span>
            ) : null}
            <span className="block text-black/60">{TMAIL_ANON_DISCLOSURE}</span>
            {anonymous && anonSend.state === "not_registered" ? (
              <span className="block text-[#8a1f1f]">
                This wallet has no anonymity-set registration on this node. Register first.
              </span>
            ) : null}
            {anonymous && anonSend.state === "propagating" ? (
              <span className="block text-[#1f3f7a]">
                Registration propagating — you can send in {secondsUntil(anonSend.eligibleAtMs)}s
                (next registry epoch). Sending is disabled until then.
              </span>
            ) : null}
            {anonymous && anonSend.state === "proving" ? (
              <span className="block text-[#1f3f7a]">
                Building your membership proof — this takes about 33 seconds.
              </span>
            ) : null}
            {anonymous && anonSend.state === "error" ? (
              <span className="block text-[#8a1f1f]">{anonSend.reason}</span>
            ) : null}
          </span>
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-black/60">
            {messageText.length}/{TMAIL_MAX_PLAINTEXT_CHARS}
          </span>
          <button
            type="button"
            disabled={
              sendBusy ||
              (anonymous &&
                anonSend.state !== "proving" &&
                anonSend.state !== "idle")
            }
            onClick={() => void onSend()}
            className={`${winBtn} bg-[#DAD8D2] px-4 py-1 text-sm ${sendBusy ? "opacity-60" : ""}`}
          >
            {sendBusy
              ? "Encrypting…"
              : anonymous && anonSend.state === "propagating"
                ? `Waiting ${secondsUntil(anonSend.eligibleAtMs)}s…`
                : anonymous
                  ? "Send Anonymously"
                  : scheduled
                ? "Send Scheduled"
                : burnAfterRead
                  ? "Send Burn-After-Read"
                  : "Send Encrypted Message"}
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
            {items.map((m) => {
              const burn = opened[m.msgId];
              const sealed = m.state === "open" && m.burnAfterRead && !burn;
              return (
                <div key={m.msgId} className={`${outset} bg-white p-2`}>
                  <div className="flex items-center justify-between text-[10px] font-mono text-black/60">
                    <span title={m.sender}>from {shortId(m.sender)}</span>
                    <span className="flex items-center gap-2">
                      {m.anonVerdict ? (
                        (() => {
                          // A label, never a boolean: there is no place in this UI where a missing
                          // verdict could be read optimistically as "verified".
                          const l = anonLabel(m.anonVerdict);
                          const tone =
                            l.tone === "ok"
                              ? "text-[#1f5132]"
                              : l.tone === "bad"
                                ? "text-[#8a1f1f]"
                                : "text-[#7a5c1f]";
                          return (
                            <span className={`font-semibold ${tone}`} title={l.detail}>
                              {l.text}
                            </span>
                          );
                        })()
                      ) : null}
                      {m.state === "scheduled" ? (
                        <span className="font-semibold text-[#1f3f7a]">SCHEDULED</span>
                      ) : null}
                      {m.burnAfterRead ? (
                        <span className="font-semibold text-[#8a1f1f]">BURN AFTER READING</span>
                      ) : null}
                      <span>{new Date(m.sentAtMs).toLocaleString()}</span>
                    </span>
                  </div>

                  {m.state === "scheduled" ? (
                    <div className="mt-1 space-y-1">
                      <div className="text-[11px] text-black/70">
                        Opens {formatReleaseAt(m.releaseAtMs)} — in{" "}
                        {timeUntilRelease(m.releaseAtMs)}. This node is not serving the encrypted
                        message yet.
                      </div>
                      <div className="text-[10px] text-black/55">{m.note}</div>
                    </div>
                  ) : sealed ? (
                    <div className="mt-1 space-y-1">
                      <div className="text-[11px] text-black/70">
                        Sealed. Opening this message destroys it on the network.
                      </div>
                      <div className="text-[10px] text-black/55">{TMAIL_BURN_DISCLOSURE}</div>
                      <button
                        type="button"
                        onClick={() => void onOpenAndBurn(m.msgId)}
                        className={`${winBtn} bg-[#DAD8D2] px-3 py-0.5 text-xs`}
                      >
                        Read once &amp; burn
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="mt-1 text-sm text-black whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {m.text}
                      </div>
                      {burn?.state === "burning" ? (
                        <div className="mt-1 text-[10px] text-black/60">Burning…</div>
                      ) : null}
                      {m.anonVerdict ? (
                        <div className="mt-1 text-[10px] text-black/55">
                          {anonLabel(m.anonVerdict).detail}
                          {m.anonVerdict.state !== "verified" ? (
                            <span className="block">
                              Do not treat this as a proven anonymous sender until it reads
                              VERIFIED.
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {burn?.state === "burned" ? (
                        <div className="mt-1 text-[10px] text-black/55">
                          <span className="font-semibold text-[#8a1f1f]">Burned. </span>
                          {TMAIL_BURN_DISCLOSURE}
                        </div>
                      ) : null}
                      {burn?.state === "error" ? (
                        <div className="mt-1 space-y-1">
                          <div className="text-[10px] text-[#8a1f1f]">
                            Burn failed: {burn.reason}. The message may still be on the network.
                          </div>
                          <button
                            type="button"
                            onClick={() => void onOpenAndBurn(m.msgId)}
                            className={`${winBtn} bg-[#DAD8D2] px-3 py-0.5 text-xs`}
                          >
                            Retry burn
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
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
