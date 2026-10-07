"use client";

/**
 * Try TET, part 2: Tmail on /try. One action: send an end-to-end encrypted message. The desktop's
 * Messages panel (burn-after-read, scheduled release, anonymous mode) stays at /os; this is the
 * plain path. Messaging keys are published on first use.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { buildTmailEnvelopeV1, TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import { decryptForReceiver } from "../lib/tmail_e2ee";
import { getTmailKeySession } from "../lib/tmail_session";
import { b64ToBytes } from "../lib/encoding";
import { getTmailInbox, getTmailKeys, normalizeWalletId64, postTmailSend } from "../lib/tet_core_http";
import { Badge, Button, Chips, INK, Input, PinnedNotice, TextArea, cx, fmtWhen } from "./ui";
import { BASE, useTryWallet } from "./wallet";

const POLL_MS = 8_000;

type Msg = { id: string; from: string; at: number; text: string | null; anonymous: boolean };

const LIMITS = [
  "Messages are end-to-end encrypted in this tab. The node still sees who writes to whom, and when.",
  "Key exchange is Kyber round 3, not the final ML-KEM standard (FIPS 203).",
  "A conversation keeps its newest 5 messages; messages expire after 7 days.",
  "Your messaging keys are published on first use, so others can write to you. Publishing is public.",
  "Burn-after-read and scheduled release are in the desktop (/os): they are best-effort, not enforced.",
];

export default function TmailPanel(props: { demoContact: string }) {
  const { wallet, ensureWallet, ensureMessagingKeys } = useTryWallet();
  const [to, setTo] = useState("self");
  const [other, setOther] = useState("");
  const [text, setText] = useState("");
  const [inbox, setInbox] = useState<Msg[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const ks = getTmailKeySession();
    if (!wallet || !ks) return;
    const r = await getTmailInbox(BASE, wallet.walletId, 50);
    if (!r.ok || !mounted.current) return;
    const out: Msg[] = [];
    for (const row of r.messages) {
      let text: string | null = null;
      if (row.e2ee) {
        try {
          const pt = await decryptForReceiver(
            {
              client_ephemeral_pub: b64ToBytes(row.e2ee.client_ephemeral_pub_b64),
              mlkem_ciphertext: b64ToBytes(row.e2ee.mlkem_ciphertext_b64),
              nonce: b64ToBytes(row.e2ee.nonce_b64),
              ciphertext: b64ToBytes(row.e2ee.ciphertext_b64),
            },
            ks.x25519_sk,
            ks.mlkem_sk,
          );
          text = new TextDecoder().decode(pt);
        } catch {
          text = null;
        }
      }
      out.push({ id: row.msg_id, from: row.sender_wallet_id, at: row.sent_at_ms, text, anonymous: row.flags?.anonymous === true });
    }
    if (mounted.current) setInbox(out);
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
    const first = setTimeout(() => void ensureMessagingKeys().then(refresh).catch(() => {}), 0);
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [wallet, ensureMessagingKeys, refresh]);

  async function onSend() {
    setNote(null);
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const me = await ensureWallet();
      await ensureMessagingKeys();
      const recipient = to === "self" ? me : to === "demo" ? props.demoContact : normalizeWalletId64(other);
      if (!recipient) throw new Error("The recipient must be a 64-character wallet id.");
      const keys = await getTmailKeys(BASE, recipient);
      if (!keys.ok) throw new Error(keys.text || `could not look up the recipient (HTTP ${keys.status})`);
      if (!keys.registration) throw new Error("That wallet has not published messaging keys yet, so it cannot receive.");
      const env = await buildTmailEnvelopeV1({
        senderWalletId: me,
        receiverWalletId: recipient,
        plaintextUtf8: body,
        receiverX25519Pub: b64ToBytes(keys.registration.x25519_pub_b64),
        receiverMlkemPub: b64ToBytes(keys.registration.mlkem_pub_b64),
        baseUrl: BASE,
      });
      const r = await postTmailSend(BASE, env);
      if (!r.ok) throw new Error(r.text || `not sent (HTTP ${r.status})`);
      setText("");
      setNote({ ok: true, text: "Sent, encrypted." });
      void refresh();
    } catch (e: unknown) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const options = [
    { label: "Yourself", value: "self" },
    ...(props.demoContact ? [{ label: "The demo inbox", value: "demo" }] : []),
    { label: "Another wallet", value: "other" },
  ];

  return (
    <section className="space-y-3">
      <PinnedNotice lines={LIMITS} />
      <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
        <Chips options={options} value={to} onChange={setTo} />
        {to === "other" ? <Input ariaLabel="Recipient wallet id" value={other} onChange={setOther} mono placeholder="64 hex characters, e.g. 3f9a…" /> : null}
        <TextArea label="Your message" value={text} onChange={setText} rows={3} maxLength={TMAIL_MAX_PLAINTEXT_CHARS} placeholder="Write a message…" />
        <Button className="w-full sm:w-auto" disabled={busy || !text.trim()} onClick={() => void onSend()}>
          {busy ? "Sending…" : "Send"}
        </Button>
        <p aria-live="polite" className={cx("text-[15px] empty:hidden", note?.ok ? INK.ok : INK.bad)}>{note?.text ?? ""}</p>
      </div>

      <div>
        <h2 className="mb-1 text-[15px] font-semibold text-neutral-600">Inbox</h2>
        {!wallet ? <p className="text-[15px] text-neutral-500">Send something first: that makes your wallet and its inbox.</p> : null}
        {wallet && inbox.length === 0 ? <p className="text-[15px] text-neutral-500">Nothing yet. Try messaging yourself.</p> : null}
        <ol className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white empty:hidden">
          {inbox.map((m) => (
            <li key={m.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2 text-[14px] text-neutral-500">
                {m.anonymous ? <Badge tone="pending">anonymous sender</Badge> : <span translate="no" className={cx("font-mono", INK.named)}>{m.from === wallet?.walletId ? "you" : m.from.slice(0, 8)}</span>}
                <span>{fmtWhen(m.at, now)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed">{m.text ?? <span className="text-neutral-400">Scheduled or not readable here.</span>}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
