"use client";

/**
 * Try TET, part 2: Tmail as a chat. Conversations on the left, messages on the right (yours
 * right-aligned), the composer at the bottom with "burn after read" and "schedule". Publishing
 * messaging keys is one inline banner and only happens when the visitor taps it (it is public).
 *
 * The node keeps only what was sent *to* a wallet, encrypted to that wallet, so your own messages
 * show from this tab's memory: they are gone when the tab closes (the notice says so). Burn and
 * schedule carry Tmail's locked wording (`TMAIL_BURN_DISCLOSURE`, `TMAIL_TIME_LOCK_DISCLOSURE`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTmailEnvelopeV1, TMAIL_MAX_PLAINTEXT_CHARS } from "../lib/tmail";
import { decryptForReceiver } from "../lib/tmail_e2ee";
import { buildTmailBurnRevokeV1, TMAIL_BURN_DISCLOSURE } from "../lib/tmail_burn";
import { TMAIL_MAX_SCHEDULE_MINUTES, TMAIL_MIN_SCHEDULE_MINUTES, TMAIL_TIME_LOCK_DISCLOSURE } from "../lib/tmail_timelock";
import { getTmailKeySession } from "../lib/tmail_session";
import { b64ToBytes } from "../lib/encoding";
import { getTmailInbox, normalizeWalletId64, postTmailReadReceipt, postTmailSend } from "../lib/tet_core_http";
import { safetyNumber, trustedKeysFor, verifyEnvelopeSender } from "../lib/key_trust";
import { bytesToB64 } from "../lib/encoding";
import { Button, FOCUS, INK, Input, KeysBanner, MONO, PanelHead, PinnedNotice, TextArea, Toggle, cx, fmtWhen } from "./ui";
import { BASE, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

const POLL_MS = 8_000;
const ANON = "anonymous";

type Received = {
  id: string;
  from: string;
  at: number;
  text: string | null;
  anonymous: boolean;
  burn: boolean;
  /** Withheld by the node until this time (scheduled release). */
  lockedUntilMs: number | null;
  lockedNote: string;
};
type Sent = { id: string; to: string; at: number; text: string; burn: boolean; releaseAtMs: number | null };
type Bubble = { id: string; mine: boolean; at: number; text: string | null; burn: boolean; releaseAtMs: number | null; lockedNote?: string };

const limits = (t: (en: string) => string) => [
  t("Messages are end-to-end encrypted in this tab: only the two of you can read them, if your safety numbers match. The node still sees who writes to whom, and when."),
  t("Key exchange is Kyber round 3, not the final ML-KEM standard (FIPS 203)."),
  t("Your own messages show from this tab only: what you send is encrypted to the recipient, so the node can't give it back to you. Close the tab and they are gone from this view."),
  t("A conversation keeps its newest 5 messages; messages expire after 7 days."),
  t("Turning on your inbox is public: it shows this ID can receive messages."),
  t("A message proves which ID sent it, or for an anonymous one, that a member did. It doesn't prove who is behind that ID."),
];

function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export default function MailPanel(props: {
  demoContact: string;
  /** A DM someone started from a named post: open that conversation (`at` makes repeats count). */
  dmTarget?: { walletId: string; at: number } | null;
  /** This panel is the one on screen (it polls only then). */
  active: boolean;
}) {
  const { t, locale } = useLang();
  const { wallet, ensureWallet, ensureMessagingKeys, keys, checkKeys } = useTryWallet();
  const [unreachable, setUnreachable] = useState(false);
  const me = wallet?.walletId ?? "";
  const [received, setReceived] = useState<Received[]>([]);
  const [sent, setSent] = useState<Sent[]>([]);
  const [current, setCurrent] = useState<string>(props.demoContact || "self");
  const [forged, setForged] = useState(0);
  const [safety, setSafety] = useState<{ peer: string; number: string | null; error: string }>({ peer: "", number: null, error: "" });
  const [view, setView] = useState<"list" | "thread">("thread");
  const [newTo, setNewTo] = useState("");
  const [text, setText] = useState("");
  const [burn, setBurn] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [releaseAt, setReleaseAt] = useState(() => toLocalInput(Date.now() + 60 * 60_000));
  const [opened, setOpened] = useState<Record<string, "open" | "burned" | string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishErr, setPublishErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const endRef = useRef<HTMLDivElement | null>(null);

  // A DM started from a named post opens its conversation.
  useEffect(() => {
    const t = props.dmTarget;
    if (!t) return;
    const id = setTimeout(() => {
      setCurrent(me && t.walletId === me ? "self" : t.walletId);
      setView("thread");
      setNote(null);
    }, 0);
    return () => clearTimeout(id);
  }, [props.dmTarget, me]);

  // "self" stands for this tab's wallet before it exists.
  const peer = current === "self" ? me : current;

  // The safety number with the person in this conversation (from keys checked here).
  useEffect(() => {
    const ks = getTmailKeySession();
    const other = current === "self" || current === ANON || current === props.demoContact ? null : normalizeWalletId64(current);
    if (!me || !ks || !other) return;
    let live = true;
    void trustedKeysFor(BASE, other).then((k) => {
      if (!live) return;
      if (!k.ok) return setSafety({ peer: other, number: null, error: k.reason === "none" ? "" : t(k.message) });
      const mine = { walletId: me, x25519PubB64: bytesToB64(ks.x25519_pub), mlkemPubB64: bytesToB64(ks.mlkem_pub) };
      const theirs = { walletId: other, x25519PubB64: k.registration.x25519_pub_b64, mlkemPubB64: k.registration.mlkem_pub_b64 };
      setSafety({ peer: other, number: safetyNumber(mine, theirs), error: "" });
    });
    return () => {
      live = false;
    };
  }, [current, me, props.demoContact, t]);

  const refresh = useCallback(async () => {
    const ks = getTmailKeySession();
    if (!wallet || !ks) return;
    const r = await getTmailInbox(BASE, wallet.walletId, 50);
    if (!mounted.current) return;
    // A real failure: one plain message (an empty inbox is not a failure).
    setUnreachable(!r.ok);
    if (!r.ok) return;
    const out: Received[] = [];
    let forged = 0;
    for (const row of r.messages) {
      let plain: string | null = null;
      const locked = row.locked === true || !row.e2ee;
      // Who sent it, checked here: a message whose signature isn't its claimed sender's is not
      // shown at all (the node, or anyone in between, could have made it up).
      const sender = await verifyEnvelopeSender(row as never, BASE);
      if (sender === "forged") {
        forged++;
        continue;
      }
      if (!locked && row.e2ee) {
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
          plain = new TextDecoder().decode(pt);
        } catch {
          plain = null;
        }
      }
      out.push({
        id: row.msg_id,
        from: row.flags?.anonymous === true ? ANON : row.sender_wallet_id,
        at: row.sent_at_ms,
        text: plain,
        anonymous: row.flags?.anonymous === true,
        burn: row.flags?.burn_after_read === true,
        lockedUntilMs: locked ? (row.release_at_ms ?? null) : null,
        lockedNote: row.locked_note ?? TMAIL_TIME_LOCK_DISCLOSURE,
      });
    }
    if (mounted.current) {
      setReceived(out);
      setForged(forged);
    }
  }, [wallet]);

  useEffect(() => {
    mounted.current = true;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      mounted.current = false;
      clearInterval(tick);
    };
  }, []);

  // Only while this panel is the one on screen: home and other pages never fetch your inbox or keys.
  useEffect(() => {
    if (!wallet || !props.active) return;
    const first = setTimeout(() => void checkKeys().then(refresh).catch(() => {}), 0);
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [wallet, checkKeys, refresh, props.active]);

  const name = useCallback(
    (id: string) => (id === ANON ? t("anonymous senders") : id === "self" || (me && id === me) ? t("you (notes to self)") : id === props.demoContact ? t("demo inbox") : id.slice(0, 8)),
    [me, props.demoContact, t],
  );

  // Conversations, newest first; the demo inbox and notes-to-self are always there.
  const convos = useMemo(() => {
    const last = new Map<string, { at: number; preview: string; unread: boolean }>();
    const touch = (k: string, at: number, preview: string, unread: boolean) => {
      const prev = last.get(k);
      if (!prev || at >= prev.at) last.set(k, { at, preview, unread: unread || !!prev?.unread });
    };
    for (const m of received) touch(m.from === me ? "self" : m.from, m.at, m.lockedUntilMs ? t("scheduled message") : m.burn ? t("burn after read") : (m.text ?? "…"), m.from !== me);
    for (const m of sent) touch(m.to === me ? "self" : m.to, m.at, m.text, false);
    const keysList = [...last.keys()];
    if (props.demoContact && !last.has(props.demoContact)) keysList.push(props.demoContact);
    if (!last.has("self")) keysList.push("self");
    return keysList
      .map((k) => ({ key: k, ...(last.get(k) ?? { at: 0, preview: k === "self" ? t("Write to yourself to try it.") : t("Write to the person running this node."), unread: false }) }))
      .sort((a, b) => b.at - a.at);
  }, [received, sent, me, props.demoContact, t]);

  const thread: Bubble[] = useMemo(() => {
    const key = current === "self" ? me : current;
    const theirs = received
      .filter((m) => (current === ANON ? m.from === ANON : m.from === key && m.from !== ANON))
      .map((m) => ({ id: m.id, mine: false, at: m.at, text: m.text, burn: m.burn, releaseAtMs: m.lockedUntilMs, lockedNote: m.lockedUntilMs ? m.lockedNote : undefined }));
    const mine = current === ANON ? [] : sent.filter((m) => m.to === key).map((m) => ({ id: m.id, mine: true, at: m.at, text: m.text, burn: m.burn, releaseAtMs: m.releaseAtMs }));
    // Notes to self arrive in the inbox too: show each once, as yours.
    const sentIds = new Set(mine.map((m) => m.id));
    return [...mine, ...theirs.filter((m) => !sentIds.has(m.id))].sort((a, b) => a.at - b.at);
  }, [received, sent, current, me]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.length, current]);

  async function onPublish() {
    setPublishErr("");
    setPublishing(true);
    try {
      await ensureMessagingKeys();
      void refresh();
    } catch (e: unknown) {
      setPublishErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }

  async function onSend() {
    setNote(null);
    const body = text.trim();
    if (!body || current === ANON) return;
    setBusy(true);
    try {
      const myId = await ensureWallet();
      const to = current === "self" ? myId : normalizeWalletId64(current);
      if (!to) throw new Error(t("That isn't a 64-character ID."));
      let releaseAtMs: number | undefined;
      if (schedule) {
        releaseAtMs = new Date(releaseAt).getTime();
        const mins = (releaseAtMs - Date.now()) / 60_000;
        if (!(mins >= TMAIL_MIN_SCHEDULE_MINUTES && mins <= TMAIL_MAX_SCHEDULE_MINUTES)) throw new Error(t("Pick a release time between 1 minute and 30 days from now."));
      }
      // Only keys the recipient's own wallet signed (checked here, not trusted from the node).
      const k = await trustedKeysFor(BASE, to);
      if (!k.ok) {
        if (k.reason === "none") {
          throw new Error(to === myId ? t("Turn on your inbox first (the banner above), then you can write to yourself.") : t("That ID hasn't turned on its inbox yet, so it can't receive messages."));
        }
        throw new Error(t(k.message));
      }
      const env = await buildTmailEnvelopeV1({
        senderWalletId: myId,
        receiverWalletId: to,
        plaintextUtf8: body,
        receiverX25519Pub: k.x25519Pub,
        receiverMlkemPub: k.mlkemPub,
        baseUrl: BASE,
        burnAfterRead: burn,
        releaseAtMs,
      });
      const r = await postTmailSend(BASE, env);
      if (!r.ok) throw new Error(r.text || `not sent (HTTP ${r.status})`);
      setSent((s) => [...s, { id: r.msgId ?? env.msg_id, to, at: Date.now(), text: body, burn, releaseAtMs: releaseAtMs ?? null }]);
      setText("");
      void refresh();
    } catch (e: unknown) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onOpenBurn(id: string) {
    if (!me) return;
    setOpened((o) => ({ ...o, [id]: "open" }));
    try {
      const revoke = await buildTmailBurnRevokeV1({ msgId: id, readerWalletId: me, baseUrl: BASE });
      const r = await postTmailReadReceipt(BASE, revoke);
      setOpened((o) => ({ ...o, [id]: r.ok ? "burned" : `receipt not sent: ${r.text ?? `HTTP ${r.status}`}` }));
    } catch (e: unknown) {
      setOpened((o) => ({ ...o, [id]: `receipt not sent: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }

  function startConvo() {
    const id = normalizeWalletId64(newTo);
    if (!id) {
      setNote({ ok: false, text: t("That isn't a 64-character ID.") });
      return;
    }
    setNewTo("");
    setNote(null);
    setCurrent(id === me ? "self" : id);
    setView("thread");
  }

  return (
    <section className="flex flex-col md:min-h-[calc(100vh-3.25rem)]" aria-label={t("DM")}>
      <PanelHead
        title={t("DM")}
        sub={t("Tmail · end-to-end encrypted")}
        action={
          <Button kind="quiet" className="md:hidden" onClick={() => setView(view === "list" ? "thread" : "list")}>
            {view === "list" ? t("back to the conversation") : t("‹ conversations")}
          </Button>
        }
        todo={t("Pick a conversation, write a message and send it. To DM someone from a board, tap their id on a named post.")}
      />
      {unreachable ? <p className="border-b border-[#e3d6b3] bg-[#fdf8ea] px-4 py-2 text-[14px] text-[#6b4e00] md:px-5">{t("The node can't be reached right now. New messages will show when it's back.")}</p> : null}
      {keys !== "published" ? <KeysBanner what={t("To receive messages, turn on your inbox.")} onPublish={() => void onPublish()} busy={publishing} error={publishErr} /> : null}

      <div className="grid flex-1 md:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label={t("Conversations")} className={cx("border-[#e3e5e8] md:border-r", view === "thread" && "hidden md:block")}>
          <ul>
            {convos.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => {
                    setCurrent(c.key);
                    setView("thread");
                    setNote(null);
                  }}
                  aria-current={c.key === current ? "true" : undefined}
                  className={cx(FOCUS, "block w-full border-b border-[#eceef1] px-4 py-2.5 text-left", c.key === current ? "bg-[#f1f3f6]" : "hover:bg-[#fafbfc]")}
                >
                  <span className="flex items-baseline gap-2 text-[15px]">
                    <b className="font-semibold">{name(c.key)}</b>
                    {c.unread && c.key !== current ? <span aria-label={t("new")} className="inline-block size-2 rounded-full bg-[#1a237e]" /> : null}
                    <span className={cx(MONO, "ml-auto text-[12px] text-[#5d646d]")}>{c.at ? fmtWhen(c.at, now, locale) : ""}</span>
                  </span>
                  <span className="block truncate text-[14px] text-[#5d646d]">{c.preview}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-2 px-4 py-3">
            <Input ariaLabel={t("Write to an ID")} value={newTo} onChange={setNewTo} mono placeholder={t("New: 64-character ID…")} />
            <Button kind="secondary" className="min-h-9 px-3 text-[14px]" disabled={!newTo.trim()} onClick={startConvo}>
              {t("Start a conversation")}
            </Button>
          </div>
        </nav>

        <div className={cx("flex min-w-0 flex-col", view === "list" && "hidden md:flex")}>
          <div className="flex items-baseline gap-2 border-b border-[#eceef1] px-4 py-2 text-[15px]">
            <b className="font-semibold">{name(current)}</b>
            {peer && current !== ANON ? (
              <span translate="no" className={cx(MONO, "truncate text-[12.5px]", INK.named)}>
                {peer.slice(0, 16)}…
              </span>
            ) : null}
          </div>
          <div className="px-4">
            <PinnedNotice lines={limits(t)} />
            {safety.peer && safety.peer === normalizeWalletId64(current) ? (
              <details className="mt-2 text-[13.5px]">
                <summary className={cx(FOCUS, "cursor-pointer")}>
                  {safety.number ? (
                    <>
                      {t("Safety number")}: <span translate="no" className={MONO}>{safety.number}</span>
                    </>
                  ) : (
                    <span className={INK.bad}>{safety.error}</span>
                  )}
                </summary>
                <p className="mt-1 text-[#5d646d]">
                  {t("Compare this number with the other person, in person or on a call. If both of you see the same number, only the two of you can read your messages. If the numbers differ, someone in between may be reading along: don't send anything private.")}
                </p>
              </details>
            ) : null}
            {forged ? <p className={cx("mt-2 text-[13.5px]", INK.bad)}>{t("{n} messages weren't shown: their signature isn't their sender's.", { n: forged })}</p> : null}
          </div>
          <div className="flex flex-1 flex-col gap-1.5 px-4 pb-3" aria-live="polite">
            {thread.length === 0 ? <p className="text-[15px] text-[#5d646d]">{t("No messages yet.")}</p> : null}
            {thread.map((m) => {
              const state = opened[m.id];
              const hiddenBurn = !m.mine && m.burn && !state;
              return (
                <div
                  key={m.id}
                  className={cx(
                    "max-w-[86%] rounded-2xl px-3 py-1.5 text-[15.5px] leading-snug md:max-w-[78%]",
                    m.mine ? "self-end rounded-br-md bg-[#1a237e] text-white" : "self-start rounded-bl-md bg-[#f0f1f3] text-[#1c1f23]",
                  )}
                >
                  {m.releaseAtMs && !m.mine ? (
                    <span>
                      {t("Scheduled message, released {when}.", { when: fmtWhen(m.releaseAtMs, now, locale) })} <span className="text-[13.5px]">{t(m.lockedNote ?? "")}</span>{" "}
                      <span className="text-[13.5px]">{t("Who sent it is checked when it's released.")}</span>
                    </span>
                  ) : hiddenBurn ? (
                    <button type="button" onClick={() => void onOpenBurn(m.id)} className={cx(FOCUS, "rounded text-left underline")}>
                      {t("Burn after read: open it (this deletes it from cooperating nodes)")}
                    </button>
                  ) : (
                    <span className="whitespace-pre-wrap break-words">{m.text ?? t("Can't be opened in this tab.")}</span>
                  )}
                  <span className={cx(MONO, "mt-0.5 block text-[11.5px] opacity-75")}>
                    {fmtWhen(m.at, now, locale)}
                    {m.burn ? ` · ${t("burn after read")}` : ""}
                    {m.mine && m.releaseAtMs ? ` · ${t("scheduled")} · ${fmtWhen(m.releaseAtMs, now, locale)}` : ""}
                    {state === "burned" ? ` · ${t("burned on this node")}` : state && state !== "open" ? ` · ${state}` : ""}
                  </span>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <div className="sticky bottom-0 border-t border-[#e3e5e8] bg-white px-4 pb-3.5 pt-2.5">
            {current === ANON ? (
              <p className="text-[14px] text-[#5d646d]">{t("Anonymous senders can't be replied to: the message doesn't say who sent it.")}</p>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <TextArea
                    label={t("Message to {name}", { name: name(current) })}
                    value={text}
                    onChange={setText}
                    rows={text ? 3 : 1}
                    maxLength={TMAIL_MAX_PLAINTEXT_CHARS}
                    placeholder={t("Message {name}…", { name: name(current) })}
                    className="rounded-2xl"
                  />
                  <Button className="shrink-0 whitespace-nowrap" disabled={busy || !text.trim()} onClick={() => void onSend()}>
                    {busy ? t("Sending…") : t("Send")}
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Toggle on={burn} onChange={setBurn}>
                    {t("burn after read")}
                  </Toggle>
                  <Toggle on={schedule} onChange={setSchedule}>
                    {t("schedule")}
                  </Toggle>
                  {schedule ? (
                    <input
                      type="datetime-local"
                      aria-label={t("Release time")}
                      value={releaseAt}
                      onChange={(e) => setReleaseAt(e.target.value)}
                      className={cx(FOCUS, "min-h-8 rounded-md border border-[#c9ced4] px-2 text-[14px]")}
                    />
                  ) : null}
                </div>
                {burn ? <p className="mt-1.5 text-[13px] text-[#5d646d]">{t(TMAIL_BURN_DISCLOSURE)}</p> : null}
                {schedule ? <p className="mt-1.5 text-[13px] text-[#5d646d]">{t(TMAIL_TIME_LOCK_DISCLOSURE)}</p> : null}
                {note ? (
                  <p role="alert" className={cx("mt-1.5 text-[14.5px]", note.ok ? INK.ok : INK.bad)}>
                    {note.text}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
