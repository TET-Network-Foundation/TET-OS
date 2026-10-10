"use client";

/**
 * Shelter: a members-only space (docs/plans/SHELTER.md "Implementation v1"; lib/shelter.ts).
 *
 * - Not a member: a join code (QR + the ID in groups of 4) to show a member in person.
 * - A member: the house rule (the first time in this tab; remembered in memory only, since a stored
 *   "seen" flag would show this device was in Shelter), then the board, read with a signed request.
 *   Posts go out under the member's nickname by default, or anonymously (a proof against Shelter's
 *   own member set).
 * - Letting someone in: scan or type their code, confirm you met in person; their board key is then
 *   sealed to them. The moderator's version is "invite" (10), a member's "vouch" (3).
 * - The moderator also confirms bot cases and decides appeals; every decision is in the log.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { boardRecipient, openBoard, postAnonymousTo, postNamed, readBoard, type BoardPost, type OpenBoard } from "../lib/try_board";
import {
  APPEAL_DAYS,
  groupedId,
  joinCode,
  memberLabel,
  openSealedKey,
  parseJoinCode,
  sealKeyTo,
  shelterAnonTree,
  shelterInboxRows,
  shelterLog,
  shelterMe,
  shelterMembers,
  shelterOpen,
  submitRecord,
  type ShelterCase,
  type ShelterLogLine,
  type ShelterMe,
  type ShelterMember,
} from "../lib/shelter";
import { qrSvgPath } from "../lib/tet_qr";
import { Badge, Button, FOCUS, KeysBanner, MONO, PanelHead, cx, fmtDate, fmtWhen } from "./ui";
import { BASE, PROVER_URL, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

/** The house rule was shown in this tab (memory only). */
let RULE_SEEN = false;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Tab = "board" | "members" | "log" | "how";

export default function ShelterPanel(props: { active: boolean }) {
  const { t, locale } = useLang();
  const { wallet, ensureWallet, ensureMessagingKeys, keys, checkKeys, anon, refreshAnon, joinAnon, prover } = useTryWallet();
  const [publishing, setPublishing] = useState(false);
  const [publishErr, setPublishErr] = useState("");
  // The member who lets you in seals the board key to your messaging keys: publishing them is
  // public, so it's this explicit tap, never automatic.
  const onPublish = async () => {
    setPublishErr("");
    setPublishing(true);
    try {
      await ensureMessagingKeys();
    } catch (e) {
      setPublishErr(errText(e));
    } finally {
      setPublishing(false);
    }
  };
  useEffect(() => {
    if (props.active && wallet) void checkKeys();
  }, [props.active, wallet, checkKeys]);
  const [open, setOpen] = useState<boolean | null>(null);
  const [me, setMe] = useState<ShelterMe | null>(null);
  const [board, setBoard] = useState<OpenBoard | null>(null);
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [members, setMembers] = useState<ShelterMember[]>([]);
  const [log, setLog] = useState<{ log: ShelterLogLine[]; cases: ShelterCase[] } | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [rule, setRule] = useState(RULE_SEEN);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refreshMe = useCallback(async () => {
    if (!wallet) return;
    try {
      setMe(await shelterMe(BASE));
    } catch (e) {
      setErr(errText(e));
    }
  }, [wallet]);

  // Is Shelter open here? Then: who am I, while the panel is open (a new member waits to be let in).
  useEffect(() => {
    if (!props.active) return;
    let live = true;
    void shelterOpen(BASE).then((o) => live && setOpen(o));
    const tick = async () => {
      setNow(Date.now());
      if (wallet && (!me || !me.member)) await refreshMe();
    };
    const first = setTimeout(() => void tick(), 0);
    const id = setInterval(() => void tick(), 5_000);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [props.active, wallet, me, refreshMe]);

  // A member's board key: open it once.
  useEffect(() => {
    if (!me?.member || board || !me.sealed_key) return;
    let live = true;
    void openSealedKey(BASE, me.sealed_key, me.board)
      .then((b) => live && setBoard(b))
      .catch((e) => live && setErr(errText(e)));
    return () => {
      live = false;
    };
  }, [me, board]);

  const refreshBoard = useCallback(async () => {
    if (!board) return;
    try {
      const [p, m] = await Promise.all([readBoard(BASE, board, 100, () => shelterInboxRows(BASE, 100)), shelterMembers(BASE)]);
      setPosts(p);
      setMembers(m);
    } catch (e) {
      setErr(errText(e));
    }
  }, [board]);

  useEffect(() => {
    if (!props.active || !board) return;
    const first = setTimeout(() => void refreshBoard(), 0);
    const id = setInterval(() => void refreshBoard(), 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [props.active, board, refreshBoard]);

  useEffect(() => {
    if (props.active && board && tab === "log") void shelterLog(BASE).then(setLog).catch((e) => setErr(errText(e)));
  }, [props.active, board, tab]);

  async function run(f: () => Promise<void>) {
    setErr("");
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const head = <PanelHead title={t("Shelter")} todo={t("A members-only space. Joining needs an in-person vouch from a member.")} />;
  const wrap = (body: React.ReactNode) => (
    <section aria-label={t("Shelter")}>
      {head}
      <div className="max-w-[44rem] space-y-4 px-4 pb-8 pt-3 md:px-5">
        {body}
        {err ? (
          <p role="alert" className="text-[14px] text-[#9a1c1c]">
            {err}
          </p>
        ) : null}
      </div>
    </section>
  );

  if (open === false) return wrap(<p className="text-[15px]">{t("Shelter isn't open on this node.")}</p>);
  if (open === null) return wrap(<p className="text-[15px] text-[#5d646d]">{t("Checking…")}</p>);

  // ── Not a member (or no ID yet): the join code ─────────────────────────────────────────────────
  if (!wallet || !me || !me.member) {
    return wrap(
      <>
        <Intro />
        {!wallet ? (
          <>
            <p className="text-[15px]">{t("To join, a member who meets you in person scans your join code.")}</p>
            <Button disabled={busy} onClick={() => void run(async () => {
              await ensureWallet();
            })}>
              {t("Show my join code")}
            </Button>
          </>
        ) : (
          <>
            {keys !== "published" ? (
              <KeysBanner what={t("The member who lets you in hands you the board key through your inbox.")} onPublish={() => void onPublish()} busy={publishing} error={publishErr} />
            ) : null}
            <JoinCode walletId={wallet.walletId} />
          </>
        )}
      </>,
    );
  }

  // ── The house rule, first time in this tab ─────────────────────────────────────────────────────
  if (!rule) {
    return wrap(
      <HouseRule
        via={me.via ? memberLabel(members.find((m) => m.wallet === me.via), me.via) : t("the moderator")}
        onOk={() => {
          RULE_SEEN = true;
          setRule(true);
        }}
      />,
    );
  }

  // ── A member without the board key yet ─────────────────────────────────────────────────────────
  if (!board) {
    return wrap(
      me.moderator ? (
        <SetBoard
          busy={busy}
          onSet={(invite) =>
            run(async () => {
              const b = await openBoard(BASE, invite);
              if (b.boardWalletId !== me.board) throw new Error(t("That invite is for another board, not this node's Shelter board."));
              await sealKeyTo(BASE, wallet.walletId, b);
              setBoard(b);
              await refreshMe();
            })
          }
        />
      ) : (
        <p className="text-[15px]">{t("You're in. Waiting for the board key from the member who let you in.")}</p>
      ),
    );
  }

  const byWallet = new Map(members.map((m) => [m.wallet, m]));
  const moderatorId = members.find((m) => m.moderator)?.wallet ?? "";
  return wrap(
    <>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("Shelter")}>
        {(
          [
            ["board", t("Board")],
            ["members", t("Members")],
            ["log", t("Log")],
            ["how", t("How it works")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(FOCUS, "rounded-md border px-3 py-1.5 text-[15px]", tab === id ? "border-[#1c1f23] bg-[#1c1f23] text-white" : "border-[#c9ced4]")}
          >
            {label}
          </button>
        ))}
        <button type="button" className={cx(FOCUS, "ml-auto text-[13.5px] underline")} onClick={() => setRule(false)}>
          {t("House rule")}
        </button>
      </div>

      {tab === "board" ? (
        <>
          <Composer
            me={me}
            myId={wallet.walletId}
            now={now}
            board={board}
            anonMember={!!anon?.member}
            prover={prover}
            onJoinAnon={() => void run(async () => {
              await joinAnon();
              await refreshAnon();
            })}
            onPosted={() => void refreshBoard()}
            onError={setErr}
            onNickname={() => void refreshMe()}
          />
          <ul className="space-y-3">
            {posts.length === 0 ? <li className="text-[14px] text-[#5d646d]">{t("No posts yet.")}</li> : null}
            {posts.map((p) => (
              <li key={p.msgId} className="rounded-md border border-[#e3e6ea] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[13px] text-[#5d646d]">
                  {p.label.kind === "anonymous" ? (
                    <Badge tone={p.label.tone === "ok" ? "ok" : "pending"}>
                      {t("Anonymous member")}
                      {p.label.dailyId ? ` · ID ${p.label.dailyId}` : ""}
                    </Badge>
                  ) : (
                    <span className="font-semibold text-[#1c1f23]">{memberLabel(byWallet.get(p.label.author ?? ""), p.label.author ?? "")}</span>
                  )}
                  {p.label.author && p.label.author === moderatorId ? <Badge tone="named">{t("moderator")}</Badge> : null}
                  <span>{fmtWhen(p.sentAtMs, now, locale)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[15.5px]">{p.state === "open" ? p.text : t("(can't be opened with this key)")}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {tab === "members" ? (
        <Members
          me={me}
          myId={wallet.walletId}
          members={members}
          board={board}
          busy={busy}
          run={run}
          onChanged={() => void Promise.all([refreshBoard(), refreshMe()])}
        />
      ) : null}

      {tab === "log" ? <LogView me={me} now={now} log={log} byWallet={byWallet} busy={busy} run={run} onChanged={() => void shelterLog(BASE).then(setLog)} /> : null}

      {tab === "how" ? <How /> : null}
    </>,
  );
}

function Intro() {
  const { t } = useLang();
  return (
    <div className="space-y-2 rounded-md border border-[#e3e6ea] bg-[#fafbfc] p-4 text-[15px]">
      <p>{t("Members-only and end-to-end encrypted. Joining needs an in-person vouch. House rule: don't post AI-written text here.")}</p>
      <p className="text-[13.5px] text-[#5d646d]">{t("This node serves Shelter only to members and never passes its posts to other nodes.")}</p>
    </div>
  );
}

function JoinCode(props: { walletId: string }) {
  const { t } = useLang();
  const { size, d } = qrSvgPath(joinCode(props.walletId));
  return (
    <div className="space-y-3">
      <p className="text-[15px]">{t("Show this to a member, in person. They scan it (or type the code) to let you in.")}</p>
      <svg viewBox={`0 0 ${size} ${size}`} width="200" height="200" shape-rendering="crispEdges" className="bg-white" role="img" aria-label={t("Your join code")}>
        <path d={d} fill="#000" />
      </svg>
      <p translate="no" className={cx(MONO, "break-words text-[14px]")}>
        {groupedId(props.walletId)}
      </p>
      <p className="text-[13.5px] text-[#5d646d]">{t("Your membership belongs to this ID: save your passphrase so you can come back.")}</p>
      <p className="text-[14px] text-[#5d646d]">{t("Waiting for a member to let you in…")}</p>
    </div>
  );
}

function HouseRule(props: { via: string; onOk: () => void }) {
  const { t } = useLang();
  return (
    <div className="space-y-3 rounded-md border border-[#1c1f23] p-4">
      <h3 className="text-[18px] font-semibold">{t("Don't post AI-written text here.")}</h3>
      <p className="text-[15px]">{t("This is a promise between members, not a filter. TET can't tell who or what wrote a text.")}</p>
      <p className="text-[14px]">{t("What this proves: a vouched member wrote each post, and the space isn't open to outside AI crawlers.")}</p>
      <p className="text-[14px]">{t("What it doesn't prove: that no AI was used (a member can still paste AI-written text), or that members won't copy posts out.")}</p>
      <p className="text-[14px] text-[#5d646d]">{t("Who let you in: {who}", { who: props.via })}</p>
      <Button onClick={props.onOk}>{t("I'll keep the house rule")}</Button>
    </div>
  );
}

function SetBoard(props: { busy: boolean; onSet: (invite: string) => Promise<void> }) {
  const { t } = useLang();
  const [invite, setInvite] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-[15px]">{t("Set Shelter's board: paste its invite once. It's sealed to you; the node can't read it.")}</p>
      <textarea value={invite} onChange={(e) => setInvite(e.target.value)} rows={3} aria-label={t("The board's invite")} className={cx(FOCUS, "w-full rounded-md border border-[#c9ced4] p-3 text-[15px]")} />
      <Button disabled={props.busy || !invite.trim()} onClick={() => void props.onSet(invite.trim())}>
        {t("Set the board")}
      </Button>
    </div>
  );
}

function Composer(props: {
  me: Extract<ShelterMe, { member: true }>;
  myId: string;
  now: number;
  board: OpenBoard;
  anonMember: boolean;
  prover: "unknown" | "found" | "missing";
  onJoinAnon: () => void;
  onPosted: () => void;
  onError: (e: string) => void;
  onNickname: () => void;
}) {
  const { t } = useLang();
  const { me } = props;
  const [mode, setMode] = useState<"named" | "anonymous">("named");
  const [text, setText] = useState("");
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const tree = useRef<{ leaves: Uint8Array[]; rootHex: string } | null>(null);
  const suspended = me.suspended_until && me.suspended_until > props.now;
  const anonReady = me.in_anon_set && me.anon_set_size >= me.anon_min;

  async function post() {
    setBusy(true);
    props.onError("");
    try {
      if (mode === "named") {
        try {
          await postNamed(BASE, props.board, text);
        } catch (e) {
          // The node's flood guard (never shown as a limit): wait a moment, once, quietly.
          if (!/try again in a moment/.test(errText(e))) throw e;
          await sleep(3_000);
          await postNamed(BASE, props.board, text);
        }
      } else {
        tree.current ??= await shelterAnonTree(BASE);
        if (!tree.current) throw new Error(t("Anonymous posting needs at least {n} members in the anonymity set.", { n: me.anon_min }));
        const out = await postAnonymousTo(BASE, PROVER_URL, boardRecipient(props.board), text, (s) => {
          if (s.state === "proving") setStatus(t("Proving you're a member (about 30 s the first time today)…"));
          else if (s.state === "sending") setStatus(t("Sending…"));
        }, tree.current, true, true);
        if (out.state !== "sent") throw new Error(out.state === "failed" ? out.reason : t("Not sent."));
      }
      setText("");
      setStatus("");
      props.onPosted();
    } catch (e) {
      tree.current = null;
      setStatus("");
      props.onError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (suspended) return <p className="text-[15px]">{t("Your posting is suspended until {date}.", { date: fmtDate(me.suspended_until!) })}</p>;

  if (mode === "named" && !me.nickname) {
    return (
      <div className="space-y-2">
        <p className="text-[15px]">{t("Choose a nickname first. Members see it next to your posts, with your member number.")}</p>
        <div className="flex gap-2">
          <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={24} aria-label={t("Nickname")} className={cx(FOCUS, "min-w-0 flex-1 rounded-md border border-[#c9ced4] px-3 py-2 text-[16px]")} />
          <Button disabled={busy || !nick.trim()} onClick={() => void (async () => {
            setBusy(true);
            try {
              await submitRecord(BASE, { action: "nickname", subject: props.myId, text: nick.trim() });
              props.onNickname();
            } catch (e) {
              props.onError(errText(e));
            } finally {
              setBusy(false);
            }
          })()}>
            {t("Set nickname")}
          </Button>
        </div>
        <button type="button" className={cx(FOCUS, "text-[13.5px] underline")} onClick={() => setMode("anonymous")}>
          {t("Post anonymously instead")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Post as")}>
        {(["named", "anonymous"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cx(FOCUS, "rounded-md border px-3 py-1.5 text-[14px]", mode === m ? "border-[#1c1f23] bg-[#1c1f23] text-white" : "border-[#c9ced4]")}>
            {m === "named" ? t("As {nick}", { nick: me.nickname ?? "…" }) : t("Anonymously")}
          </button>
        ))}
      </div>
      {mode === "anonymous" ? (
        <div className="space-y-1 text-[13.5px] text-[#5d646d]">
          <p>{t("Anonymous here means other members can't tell which member wrote it. The node operator still sees which device sent it.")}</p>
          {!props.anonMember || !me.in_anon_set ? (
            <p>
              {t("Join the anonymity set to post anonymously here (it takes effect at the next epoch).")}{" "}
              <button type="button" className={cx(FOCUS, "underline")} onClick={props.onJoinAnon}>
                {t("Join the anonymity set")}
              </button>
            </p>
          ) : me.anon_set_size < me.anon_min ? (
            <p>{t("Anonymous posting needs at least {n} members in the anonymity set; there are {k}.", { n: me.anon_min, k: me.anon_set_size })}</p>
          ) : null}
          {props.prover === "missing" ? <p>{t("Anonymous posting needs the native prover on your own computer.")}</p> : null}
        </div>
      ) : null}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label={t("Write to members…")} placeholder={t("Write to members…")} className={cx(FOCUS, "w-full rounded-md border border-[#c9ced4] p-3 text-[16px]")} />
      <div className="flex items-center gap-3">
        <Button disabled={busy || !text.trim() || (mode === "anonymous" && (!anonReady || props.prover === "missing"))} onClick={() => void post()}>
          {t("Post")}
        </Button>
        {status ? <span className="text-[13.5px] text-[#5d646d]">{status}</span> : null}
      </div>
    </div>
  );
}

function LetIn(props: { me: Extract<ShelterMe, { member: true }>; board: OpenBoard; busy: boolean; run: (f: () => Promise<void>) => Promise<void>; onDone: () => void }) {
  const { t } = useLang();
  const [code, setCode] = useState("");
  const [met, setMet] = useState(false);
  const [done, setDone] = useState("");
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const id = parseJoinCode(code);
  const canScan = typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let live = true;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current || !live) return;
        video.current.srcObject = stream;
        await video.current.play();
        const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const det = new Detector({ formats: ["qr_code"] });
        while (live) {
          const found = await det.detect(video.current).catch(() => []);
          const hit = found.map((f) => f.rawValue).find((v) => parseJoinCode(v));
          if (hit) {
            setCode(hit);
            setScanning(false);
            break;
          }
          await sleep(300);
        }
      } catch {
        setScanning(false);
      }
    })();
    return () => {
      live = false;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [scanning]);

  const isMod = props.me.moderator;
  const left = props.me.vouches_left;
  return (
    <div className="space-y-2 rounded-md border border-[#e3e6ea] p-4">
      <h3 className="text-[16px] font-semibold">{isMod ? t("Invite someone") : t("Let someone in")}</h3>
      <p className="text-[13.5px] text-[#5d646d]">{isMod ? t("{n} invites left.", { n: left }) : t("{n} vouches left.", { n: left })}</p>
      {left === 0 ? (
        <p className="text-[14px]">{isMod ? t("No invites left.") : t("You have no vouches left, or someone you vouched for was confirmed as a bot.")}</p>
      ) : (
        <>
          {canScan ? (
            <Button onClick={() => setScanning((s) => !s)}>{scanning ? t("Stop scanning") : t("Scan their code")}</Button>
          ) : null}
          {scanning ? <video ref={video} className="w-full max-w-xs rounded-md" muted playsInline /> : null}
          <input value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("Their join code")} placeholder={t("Their join code")} className={cx(FOCUS, MONO, "w-full rounded-md border border-[#c9ced4] px-3 py-2 text-[14px]")} />
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" checked={met} onChange={(e) => setMet(e.target.checked)} className="mt-1" />
            <span>{t("I met this person in person.")}</span>
          </label>
          <Button
            disabled={props.busy || !id || !met}
            onClick={() =>
              void props.run(async () => {
                await submitRecord(BASE, { action: isMod ? "invite" : "vouch", subject: id!, metInPerson: true });
                await sealKeyTo(BASE, id!, props.board);
                setDone(t("{who} is in. Their board key is sealed to them.", { who: `${id!.slice(0, 8)}…` }));
                setCode("");
                setMet(false);
                props.onDone();
              })
            }
          >
            {t("Let them in")}
          </Button>
          {done ? <p className="text-[14px] text-[#1e6b35]">{done}</p> : null}
        </>
      )}
    </div>
  );
}

function Members(props: {
  me: Extract<ShelterMe, { member: true }>;
  myId: string;
  members: ShelterMember[];
  board: OpenBoard;
  busy: boolean;
  run: (f: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
}) {
  const { t } = useLang();
  const [caseFor, setCaseFor] = useState("");
  const [reason, setReason] = useState("");
  const [nick, setNick] = useState("");
  const [leaving, setLeaving] = useState(false);
  const byWallet = new Map(props.members.map((m) => [m.wallet, m]));
  return (
    <div className="space-y-4">
      <LetIn me={props.me} board={props.board} busy={props.busy} run={props.run} onDone={props.onChanged} />
      <p className="text-[14px] text-[#5d646d]">{t("{n} members", { n: props.members.length })}</p>
      <ul className="space-y-2">
        {props.members.map((m) => (
          <li key={m.wallet} className="rounded-md border border-[#e3e6ea] p-3 text-[15px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{memberLabel(m, m.wallet)}</span>
              {m.moderator ? <Badge tone="named">{t("moderator")}</Badge> : null}
              {m.via ? <span className="text-[13px] text-[#5d646d]">{t("let in by {who}", { who: memberLabel(byWallet.get(m.via), m.via) })}</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-[13.5px]">
              {m.via === props.myId || props.me.moderator ? (
                <button type="button" className={cx(FOCUS, "underline")} disabled={props.busy} onClick={() => void props.run(() => sealKeyTo(BASE, m.wallet, props.board))}>
                  {t("Hand over the key again")}
                </button>
              ) : null}
              {props.me.moderator && !m.moderator ? (
                <button type="button" className={cx(FOCUS, "underline")} onClick={() => setCaseFor(caseFor === m.wallet ? "" : m.wallet)}>
                  {t("Confirm as a bot…")}
                </button>
              ) : null}
            </div>
            {caseFor === m.wallet ? (
              <div className="mt-2 space-y-2">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={280} aria-label={t("What showed it (members see this)")} placeholder={t("What showed it (members see this)")} className={cx(FOCUS, "w-full rounded-md border border-[#c9ced4] p-2 text-[15px]")} />
                <Button disabled={props.busy || !reason.trim()} onClick={() => void props.run(async () => {
                  await submitRecord(BASE, { action: "case", subject: m.wallet, text: reason.trim() });
                  setCaseFor("");
                  setReason("");
                  props.onChanged();
                })}>
                  {t("Confirm case")}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-[#e3e6ea] pt-3">
        <div className="flex gap-2">
          <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={24} aria-label={t("Change nickname")} placeholder={t("Change nickname")} className={cx(FOCUS, "min-w-0 flex-1 rounded-md border border-[#c9ced4] px-3 py-2 text-[15px]")} />
          <Button disabled={props.busy || !nick.trim()} onClick={() => void props.run(async () => {
            await submitRecord(BASE, { action: "nickname", subject: props.myId, text: nick.trim() });
            setNick("");
            props.onChanged();
          })}>
            {t("Set nickname")}
          </Button>
        </div>
        {!props.me.moderator ? (
          <button type="button" className={cx(FOCUS, "text-[13.5px] text-[#9a1c1c] underline")} disabled={props.busy} onClick={() => {
            if (!leaving) return setLeaving(true);
            void props.run(async () => {
              await submitRecord(BASE, { action: "withdraw", subject: props.myId });
              props.onChanged();
            });
          }}>
            {leaving ? t("Leave? Your vouches stay used. Tap again to leave.") : t("Leave Shelter")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LogView(props: {
  me: Extract<ShelterMe, { member: true }>;
  now: number;
  log: { log: ShelterLogLine[]; cases: ShelterCase[] } | null;
  byWallet: Map<string, ShelterMember>;
  busy: boolean;
  run: (f: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
}) {
  const { t, locale } = useLang();
  const [deciding, setDeciding] = useState("");
  const [reason, setReason] = useState("");
  if (!props.log) return <p className="text-[14px] text-[#5d646d]">{t("Checking…")}</p>;
  const who = (w: string) => memberLabel(props.byWallet.get(w), w);
  const verb: Record<string, string> = {
    invite: t("invited"),
    vouch: t("vouched for"),
    withdraw: t("left"),
    case: t("confirmed a bot case against"),
    appeal: t("decided the appeal of a case"),
  };
  return (
    <div className="space-y-4">
      {props.log.cases.length ? (
        <div className="space-y-2">
          <h3 className="text-[16px] font-semibold">{t("Cases")}</h3>
          {props.log.cases.map((c) => {
            const open = !c.appeal && props.now < c.at_ms + APPEAL_DAYS * 86_400_000;
            return (
              <div key={c.id} className="rounded-md border border-[#e3e6ea] p-3 text-[14.5px]">
                <p>
                  {who(c.subject)} · {fmtDate(c.at_ms, locale)} · {c.reason}
                </p>
                <p className="text-[13.5px] text-[#5d646d]">
                  {c.appeal === "overturn" ? t("Appeal: overturned") : c.appeal === "keep" ? t("Appeal: kept") : open ? t("Appeal open until {date}", { date: fmtDate(c.at_ms + APPEAL_DAYS * 86_400_000, locale) }) : t("No appeal")}
                </p>
                {props.me.moderator && open ? (
                  deciding === c.id ? (
                    <div className="mt-2 space-y-2">
                      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={280} aria-label={t("Why (members see this)")} placeholder={t("Why (members see this)")} className={cx(FOCUS, "w-full rounded-md border border-[#c9ced4] p-2 text-[15px]")} />
                      <div className="flex gap-2">
                        {(["overturn", "keep"] as const).map((d) => (
                          <Button key={d} disabled={props.busy || !reason.trim()} onClick={() => void props.run(async () => {
                            await submitRecord(BASE, { action: "appeal", subject: c.id, decision: d, text: reason.trim() });
                            setDeciding("");
                            setReason("");
                            props.onChanged();
                          })}>
                            {d === "overturn" ? t("Overturn") : t("Keep")}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <button type="button" className={cx(FOCUS, "mt-1 text-[13.5px] underline")} onClick={() => setDeciding(c.id)}>
                      {t("Decide the appeal")}
                    </button>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <ul className="space-y-1 text-[14px]">
        {props.log.log.map((l) => (
          <li key={l.id}>
            <span className="text-[#5d646d]">{fmtDate(l.at_ms, locale)}</span> {who(l.by)} {verb[l.action] ?? l.action}{" "}
            {l.action === "appeal" ? (l.decision === "overturn" ? t("(overturned)") : t("(kept)")) : l.action === "withdraw" ? "" : who(l.subject)}
            {l.text ? ` — ${l.text}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function How() {
  const { t } = useLang();
  return (
    <ul className="list-disc space-y-2 pl-5 text-[15px]">
      <li>{t("Joining: a member vouches for you in person, by scanning your code. Each member can vouch for 3 people; the moderator invites up to 10.")}</li>
      <li>{t("If a key turns out to be run by a bot, it's removed, and whoever vouched for it can't vouch any more. A second case against the same member suspends their posting for 90 days.")}</li>
      <li>{t("Appeals: within 14 days. An overturned case restores everything it took.")}</li>
      <li>{t("Each member has a number, given in the order members were let in. A nickname can look like another; the number next to it can't be chosen or copied.")}</li>
      <li>{t("For now there is one moderator, who decides cases and appeals alone. That's weaker than two people agreeing; every decision is in the log, which all members can see.")}</li>
      <li>{t("Posts are end-to-end encrypted to members; this node serves Shelter only to members and never passes its posts to other nodes.")}</li>
      <li>{t("The node operator can't read posts, but sees which ID reads and posts, when, and from which address.")}</li>
      <li>{t("Members-only spaces are encrypted; public pages opt out of AI training crawlers that respect robots.txt.")}</li>
    </ul>
  );
}
