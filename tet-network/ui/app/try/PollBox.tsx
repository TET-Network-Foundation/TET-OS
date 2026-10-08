"use client";

/**
 * Anonymous polls in a thread (lib/poll.ts). A poll is shown as one only when it's a named post by
 * the thread's own author; anyone else's poll-shaped post stays plain text. Votes are anonymous
 * posts through the native prover; the tally counts only ballots this node verified.
 */
import { useCallback, useEffect, useState } from "react";
import { createPoll, encodePoll, pollOpen, tally, vote, type PollDef, type Tally } from "../lib/poll";
import { Badge, Button, FOCUS, cx } from "./ui";
import { BASE, PROVER_URL, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

export function PollBox(props: { def: PollDef; now: number }) {
  const { t } = useLang();
  const { def } = props;
  const { anon, prover, ensureWallet } = useTryWallet();
  const [counts, setCounts] = useState<Tally | null>(null);
  const [err, setErr] = useState("");
  const [state, setState] = useState<"idle" | "proving" | "sent" | "failed">("idle");
  const open = pollOpen(def, props.now);

  const refresh = useCallback(() => {
    void tally(BASE, def)
      .then(setCounts)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [def]);
  useEffect(() => refresh(), [refresh]);

  async function onVote(i: number) {
    setErr("");
    await ensureWallet();
    if (!anon?.member) {
      setErr(t("Join the anonymity set first."));
      return;
    }
    setState("proving");
    try {
      const out = await vote(BASE, PROVER_URL, def, i, () => {});
      if (out.state === "sent") {
        setState("sent");
        refresh();
      } else {
        setState("failed");
        setErr(out.state === "failed" ? out.reason : def.members ? t("You're not on this poll's member list.") : t("Not in the anonymity set yet."));
      }
    } catch (e: unknown) {
      setState("failed");
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const total = counts?.verified ?? 0;
  return (
    <div className="mt-1.5 max-w-[30rem] space-y-2 rounded-md border border-[#e3e5e8] p-3">
      <p className="text-[16px] font-semibold">{def.question}</p>
      <ol className="space-y-1.5">
        {def.options.map((o, i) => {
          const n = counts?.counts[i] ?? 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          return (
            <li key={i} className="flex items-center gap-2 text-[15px]">
              {open && prover === "found" && state !== "sent" ? (
                <button type="button" disabled={state === "proving"} onClick={() => void onVote(i)} className={cx(FOCUS, "rounded-md border border-[#c9ced4] px-2 py-0.5 text-[14px] hover:bg-[#fafbfc]")}>
                  {t("Vote")}
                </button>
              ) : null}
              <span className="min-w-0 flex-1">{o}</span>
              <span className="tabular-nums text-[#5d646d]">
                {n} · {pct}%
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-[13px] text-[#5d646d]">
        {open ? t("Open until 00:00 UTC.") : t("Closed.")} {def.members ? t("Members-only: {n} listed members can vote.", { n: def.members }) : t("Anyone in this node's anonymity set can vote.")}{" "}
        {t("{n} verified votes.", { n: total })}
        {counts?.unverified ? ` ${t("{n} not verified (not counted).", { n: counts.unverified })}` : ""}
        {counts?.capped ? ` ${t("Only the newest {n} ballots are counted.", { n: 1000 })}` : ""}
      </p>
      <p className="text-[13px] text-[#5d646d]">
        {def.members
          ? t("Your vote is hidden only among the {n} listed members. The poll's maker chose the list: if they control most of those IDs, they can work out how the others voted.", { n: def.members })
          : t("Your vote is hidden among this node's anonymity set.")}{" "}
        {t("One vote per member. Anyone who can read this thread sees votes as they arrive, so when few people vote, the timing can give a vote away. The node sees your IP address.")}
      </p>
      {open && prover !== "found" ? <p className="text-[13px] text-[#5d646d]">{t("Voting needs the native prover on this device.")}</p> : null}
      {state === "proving" ? (
        <Badge tone="pending">{t("proving…")}</Badge>
      ) : state === "sent" ? (
        <Badge tone="ok">{t("Your vote was sent.")}</Badge>
      ) : null}
      {err ? <p className="text-[13px] text-[#8a1f1f]">{err}</p> : null}
    </div>
  );
}

/** Make a poll in this thread (only its author sees this). Posts the poll as a named post. */
export function PollMaker(props: { post: (text: string) => Promise<void>; onDone: () => void }) {
  const { t } = useLang();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState("");
  const [membersOnly, setMembersOnly] = useState(false);
  const [members, setMembers] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onCreate() {
    setErr("");
    setBusy(true);
    try {
      const def = await createPoll(
        BASE,
        question,
        options.split("\n"),
        membersOnly ? members.split(/[\s,]+/).filter(Boolean) : null,
      );
      await props.post(encodePoll(def));
      props.onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = cx(FOCUS, "w-full rounded-md border border-[#c9ced4] bg-white px-2 py-1.5 text-[15px]");
  return (
    <div className="space-y-2 rounded-md border border-[#e3e5e8] p-3">
      <label className="block text-[14px]">
        {t("Question")}
        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} className={field} />
      </label>
      <label className="block text-[14px]">
        {t("Options, one per line (2 to 6)")}
        <textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={4} className={field} />
      </label>
      <label className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
        {t("Members-only: list the IDs that may vote")}
      </label>
      {membersOnly ? (
        <label className="block text-[14px]">
          {t("IDs, one per line, at least 3. Each must have joined the anonymity set on this node.")}
          <textarea value={members} onChange={(e) => setMembers(e.target.value)} rows={4} className={cx(field, "font-mono text-[13px]")} />
        </label>
      ) : null}
      <p className="text-[13px] text-[#5d646d]">{t("The poll is open until 00:00 UTC today. Its options and member list can't be changed after it's made.")}
        {membersOnly ? ` ${t("The member list is public: anyone can see which IDs may vote, not how they voted.")}` : ""}</p>
      <div className="flex gap-2">
        <Button kind="primary" disabled={busy || !question.trim()} onClick={() => void onCreate()}>
          {busy ? t("Making the poll…") : t("Make the poll")}
        </Button>
        <Button kind="secondary" onClick={props.onDone}>
          {t("Cancel")}
        </Button>
      </div>
      {err ? <p className="text-[13px] text-[#8a1f1f]">{err}</p> : null}
    </div>
  );
}
