/**
 * "Run it" on a feature card: the feature's real code, run in the visitor's tab on sample data made in
 * the tab with a fresh test key. Each run logs its steps as they happen and ends with its own Shows /
 * Does not show, which say what *this run* showed (often less than the feature: nothing here reaches
 * a node).
 *
 * Every check a run reports comes from a checker in `ctx.c` (page_key.ts REAL_CHECKERS on the page),
 * and what the run prints follows from what the checker returned. scripts/site_run_guard.mjs runs
 * every run with the real checkers and pins the lines, then again with each checker swapped for a
 * fake that accepts everything, and requires the output to change.
 *
 * Features with nothing in the page to run name why in NO_RUN; the guard requires every registered
 * feature to be in exactly one of the two.
 */
import type { SiteT } from "../i18n";
import { makeTestKey, RUN_CHAIN, shortKey, signEnvelope, type Checkers, type Envelope } from "./page_key";
import { addPermit, addRecord, checkFiles, checkNotebook, newNotebook } from "./page_notebook";
import { accept, issue, newSite, PAYLOAD_TYPE as SIGNIN_TYPE, challengeBytes, Refused } from "./signin_check.mjs";
import { problemLine } from "../../lib/machine_log.mjs";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "../../lib/ed25519_tet";

export type Tone = "step" | "ok" | "refused";
export type Ctx = { t: SiteT; log: (line: string, tone?: Tone) => (Promise<void>); c: Checkers };
export type Run = { shows: string[]; doesNot: string[]; run: (ctx: Ctx) => (Promise<void>) };

const enc = new TextEncoder();
const TEST_KEY_NOTE = "Test key created in this tab: {key}. It is gone when you close the tab.";

/** signin.py's example chain: the sign-in prototype signs for this binding and no other. */
async function signinChain() {
  return { chainId: "tet-example-sign-in", genesisHash: bytesToHex(sha256(enc.encode("tet sign-in prototype"))) };
}

/** A valid envelope with one half taken from another, also valid, envelope (CLAUDE.md, C4). */
function swapHalf(env: Envelope, from: Envelope, prefix: "tet-ed25519:" | "tet-mldsa44:"): Envelope {
  const other = from.signatures.find((s) => s.keyid.startsWith(prefix))!;
  return { ...env, signatures: env.signatures.map((s) => (s.keyid.startsWith(prefix) ? { ...s, sig: other.sig } : s)) };
}

const sentence = (t: SiteT, problems: { seq: number | null; why: string }[]) => problems.map(problemLine).join("; ");

export const RUNS: Record<string, Run> = {
  "machine-notebook": {
    shows: ["The page's log checker read the three records this run signed and found them in order, all signed by one key."],
    doesNot: ["That the readings are true: this run made them up.", "Anything about a real machine: the key was made in this tab a moment ago."],
    async run({ t, log, c }) {
      const key = await makeTestKey();
      await log(t(TEST_KEY_NOTE, { key: shortKey(key.keyid) }));
      const nb = newNotebook(key, RUN_CHAIN);
      for (const [i, v] of [21, 22, 22].entries()) {
        const w = await addRecord(nb, { value: v, unit: "celsius" }, c);
        await log(t("Record {n} signed: {value} °C, linked to the record before it.", { n: i + 1, value: v }));
        if (!w.ok) return;
      }
      const r = await checkNotebook(nb, c);
      if (r.kind === "verdict" && r.valid) await log(t("Log checked: VALID. {n} records, in order, one key.", { n: r.records }), "ok");
      else await log(t("Log checked: INVALID. {why}", { why: r.kind === "verdict" ? sentence(t, r.problems) : r.error }), "refused");
    },
  },

  "machine-log-check": {
    shows: ["A record changed after it was signed is caught, and so is a record taken out."],
    doesNot: ["That the readings are true.", "That the log is complete and unchanged: its newest records may be missing, and whoever holds the key can rewrite any of it.", "Which record was the original, when two copies of a log disagree."],
    async run({ t, log, c }) {
      const key = await makeTestKey();
      await log(t(TEST_KEY_NOTE, { key: shortKey(key.keyid) }));
      const nb = newNotebook(key, RUN_CHAIN);
      for (const v of [21, 22, 23]) await addRecord(nb, { value: v, unit: "celsius" }, c);
      await log(t("Three records signed."));
      const first = await checkNotebook(nb, c);
      await log(first.kind === "verdict" && first.valid ? t("Log checked: VALID.") : t("Log checked: INVALID."), first.kind === "verdict" && first.valid ? "ok" : "refused");

      const changed = new Map(nb.files);
      const body = new TextDecoder().decode(changed.get("records/2.json")!).replace('"value":22', '"value":25');
      changed.set("records/2.json", enc.encode(body));
      changed.set("chain.txt", enc.encode(nb.hashes.map((h) => `${h}\n`).join("")));
      await log(t("Record 2's reading changed from 22 to 25, without signing it again."));
      const r2 = await checkFiles(changed, c);
      if (r2.kind === "verdict" && !r2.valid) await log(t("Log checked: INVALID. {why}", { why: sentence(t, r2.problems) }), "refused");
      else await log(t("Log checked: VALID. The change was not caught."), "ok");

      const removed = new Map(nb.files);
      removed.delete("records/2.json");
      removed.delete("records/2.json.sig.json");
      removed.set("chain.txt", enc.encode([nb.hashes[0], nb.hashes[2]].map((h) => `${h}\n`).join("")));
      await log(t("Record 2 taken out of the log."));
      const r3 = await checkFiles(removed, c);
      if (r3.kind === "verdict" && !r3.valid) await log(t("Log checked: INVALID. {why}", { why: sentence(t, r3.problems) }), "refused");
      else await log(t("Log checked: VALID. The gap was not caught."), "ok");
    },
  },

  "log-fingerprint": {
    shows: ["A record's fingerprint is the SHA-256 of its exact bytes: one changed digit gives a different fingerprint, and the checker notices."],
    doesNot: ["That a node holds the fingerprint: this run sends nothing to a node.", "When the record was written."],
    async run({ t, log, c }) {
      const key = await makeTestKey();
      await log(t(TEST_KEY_NOTE, { key: shortKey(key.keyid) }));
      const nb = newNotebook(key, RUN_CHAIN);
      await addRecord(nb, { value: 21, unit: "celsius" }, c);
      await log(t("Record 1 signed. Its fingerprint: {hash}", { hash: nb.hashes[0] }));
      await log(t("On a real node this fingerprint would be stamped. This page sends it nowhere."));
      const changed = new Map(nb.files);
      const body = new TextDecoder().decode(changed.get("records/1.json")!).replace('"value":21', '"value":27');
      changed.set("records/1.json", enc.encode(body));
      changed.set("chain.txt", enc.encode(`${nb.hashes[0]}\n`));
      await log(t("Changed copy's fingerprint: {hash}", { hash: bytesToHex(sha256(enc.encode(body))) }));
      const r = await checkFiles(changed, c);
      if (r.kind === "verdict" && !r.valid) await log(t("Log checked: INVALID. {why}", { why: sentence(t, r.problems) }), "refused");
      else await log(t("Log checked: VALID. The change was not caught."), "ok");
    },
  },

  "one-time-permits": {
    shows: ["A permit is accepted once. A second use, a use after it ran out, and a permit signed by another key are each refused, with the reason."],
    doesNot: ["That a copied key did not use the same permit in another log.", "That the log is complete and unchanged: its newest records may be missing, and whoever holds the key can rewrite any of it.", "That the action itself happened."],
    async run({ t, log, c }) {
      const key = await makeTestKey();
      await log(t(TEST_KEY_NOTE, { key: shortKey(key.keyid) }));
      const nb = newNotebook(key, RUN_CHAIN);
      const vent = await addPermit(nb, "open-vent", 3);
      await log(t("Permit created: open-vent, once, up to record 3."));
      const first = await addRecord(nb, { value: "open-vent", unit: "action" }, c, vent);
      await log(first.ok ? t("Record 1 used the permit: accepted.") : t("Record 1 refused: {why}", { why: first.why.join("; ") }), first.ok ? "ok" : "refused");
      const again = await addRecord(nb, { value: "open-vent", unit: "action" }, c, vent);
      await log(again.ok ? t("Second use accepted.") : t("Second use refused: {why}", { why: again.why.join("; ") }), again.ok ? "ok" : "refused");

      const water = await addPermit(nb, "water", 1);
      await log(t("Permit created: water, once, up to record 1."));
      const late = await addRecord(nb, { value: "water", unit: "action" }, c, water);
      await log(late.ok ? t("Use after it ran out accepted.") : t("Use after it ran out refused: {why}", { why: late.why.join("; ") }), late.ok ? "ok" : "refused");

      const other = newNotebook(await makeTestKey(), RUN_CHAIN);
      const foreign = await addPermit(other, "open-door", 9);
      for (const p of [`permits/${foreign}.json`, `permits/${foreign}.json.sig.json`]) nb.files.set(p, other.files.get(p)!);
      await log(t("A permit from a second test key copied into this log."));
      const stolen = await addRecord(nb, { value: "open-door", unit: "action" }, c, foreign);
      await log(stolen.ok ? t("Permit from another key accepted.") : t("Permit from another key refused: {why}", { why: stolen.why.join("; ") }), stolen.ok ? "ok" : "refused");
      for (const p of [`permits/${foreign}.json`, `permits/${foreign}.json.sig.json`]) nb.files.delete(p);

      const r = await checkNotebook(nb, c);
      if (r.kind === "verdict" && r.valid) await log(t("Log checked: VALID. {n} record, the permit used once.", { n: r.records }), "ok");
      else await log(t("Log checked: INVALID. {why}", { why: r.kind === "verdict" ? sentence(t, r.problems) : r.error }), "refused");
    },
  },

  "agent-permit-once": {
    shows: ["The agent writes its claim to the log before it acts. A second claim of the same permit is refused before anything happens."],
    doesNot: ["That the action happened: this run only counts it.", "What the agent was told: a claim records the permit, not the instruction."],
    async run({ t, log, c }) {
      const key = await makeTestKey();
      await log(t("Agent key created in this tab: {key}. It is not the owner's key.", { key: shortKey(key.keyid) }));
      const nb = newNotebook(key, RUN_CHAIN);
      const pid = await addPermit(nb, "send-weekly-report", 5);
      await log(t("The owner gives the agent a permit: send-weekly-report, once."));
      let done = 0;
      for (const n of [1, 2]) {
        await log(t("The agent is asked to send the weekly report (request {n}).", { n }));
        const claim = await addRecord(nb, { value: "send-weekly-report", unit: "action" }, c, pid);
        if (claim.ok) {
          done++;
          await log(t("Claim written to the log as record {seq}. The agent acts: report sent (counted, nothing is sent).", { seq: claim.seq }), "ok");
        } else await log(t("Claim refused, so the agent does nothing: {why}", { why: claim.why.join("; ") }), "refused");
      }
      await log(t("Actions taken: {n}.", { n: done }), done === 1 ? "ok" : "refused");
    },
  },

  "agent-signatures": {
    shows: ["Both halves of the agent's signature, Ed25519 and ML-DSA-44, are checked, each on its own: a wrong half is refused even when the other half is right."],
    doesNot: ["Who runs the agent: a signature shows a key, not an owner.", "That what the agent said is true."],
    async run({ t, log, c }) {
      const key = await makeTestKey();
      await log(t("Agent key created in this tab: {key}. It is not the owner's key.", { key: shortKey(key.keyid) }));
      const msg = enc.encode("status: all sensors read normal");
      const env = await signEnvelope(key, RUN_CHAIN, "text/plain", msg);
      await log(t("The agent signs a message: both halves, Ed25519 and ML-DSA-44."));
      const verify = async (label: string, e: Envelope, content: Uint8Array) => {
        const r = await c.verifyEnvelope({ envelope: e, content, chain: RUN_CHAIN, mldsa44Verify: c.mldsa44Verify });
        await log(r.ok ? t("{what}: valid.", { what: label }) : t("{what}: refused: {why}", { what: label, why: r.reason }), r.ok ? "ok" : "refused");
      };
      await verify(t("The message as signed"), env, msg);
      const other = await signEnvelope(key, RUN_CHAIN, "text/plain", enc.encode("status: door open"));
      await verify(t("The same message with the Ed25519 half from another message"), swapHalf(env, other, "tet-ed25519:"), msg);
      await verify(t("The same message with the ML-DSA-44 half from another message"), swapHalf(env, other, "tet-mldsa44:"), msg);
    },
  },

  "sign-in-with-tet": {
    shows: ["The site's checks, run in this tab: one answer is accepted once, for this site, before it expires. A replay, another site's question and a wrong signature half are each refused."],
    doesNot: ["Who holds the key: the site learns a key, not a person.", "That you meant to sign in: this run signs every question it is given."],
    async run({ t, log, c }) {
      const chain = await signinChain();
      const key = await makeTestKey();
      await log(t(TEST_KEY_NOTE, { key: shortKey(key.keyid) }));
      const site = newSite("example.test", chain);
      const answer = async (ch: object) => signEnvelope(key, chain, SIGNIN_TYPE, challengeBytes(ch));
      const send = async (label: string, env: Envelope) => {
        try {
          const k = await accept(site, env, c);
          await log(t("{what}: accepted, key {key}.", { what: label, key: shortKey(k) }), "ok");
        } catch (e) {
          if (!(e instanceof Refused)) throw e;
          await log(t("{what}: refused: {why}", { what: label, why: e.message }), "refused");
        }
      };
      const ch = issue(site);
      await log(t("example.test asks a question (a fresh nonce). The key signs its exact bytes."));
      const env = await answer(ch);
      await send(t("The answer"), env);
      await send(t("The same answer again"), env);
      const elsewhere = issue(newSite("other.example", chain));
      await send(t("An answer to other.example's question"), await answer(elsewhere));
      const ch2 = issue(site);
      const env2 = await answer(ch2);
      const env3 = await answer(issue(site));
      await send(t("An answer with the ML-DSA-44 half from another answer"), swapHalf(env2, env3, "tet-mldsa44:"));
      const late = issue(site);
      const lateEnv = await answer(late);
      for (let i = 0; i < 9; i++) issue(site);
      await log(t("example.test asks nine more questions before the next answer arrives."));
      await send(t("A late answer"), lateEnv);
    },
  },

  "tags-mark-genuine": {
    shows: ["This test key marked this exact text, and a copy with one letter changed does not match."],
    doesNot: ["When a node recorded the mark: this run sends nothing to a node.", "Who is behind the key.", "That the text is original or true."],
    async run({ t, log, c }) {
      const key = await makeTestKey();
      await log(t(TEST_KEY_NOTE, { key: shortKey(key.keyid) }));
      const text = "Blue mug, glaze lot A, made by hand.";
      const env = await signEnvelope(key, RUN_CHAIN, "text/plain", enc.encode(text));
      await log(t("Text marked: {text}", { text }));
      const check = async (label: string, copy: string) => {
        const r = await c.verifyEnvelope({ envelope: env, content: enc.encode(copy), chain: RUN_CHAIN, mldsa44Verify: c.mldsa44Verify });
        await log(r.ok ? t("{what}: matches.", { what: label }) : t("{what}: does not match: {why}", { what: label, why: r.reason }), r.ok ? "ok" : "refused");
      };
      await check(t("An exact copy"), text);
      await check(t("A copy with one letter changed"), text.replace("Blue", "Blur"));
    },
  },
};

/** Features with nothing in the page to run, and why. Shown on the card instead of the button. */
export const NO_RUN: Record<string, string> = {
  "sign-in-as-member": "Nothing to run: an idea, and no sign-in code uses the membership proof.",
  "key-on-device": "Nothing to run: an idea, and no code keeps a key in a phone's secure hardware.",
  "agents-control": "Nothing to run here yet: its code is in an open pull request, not on main.",
  "once-in-the-world": "Nothing to run: an idea with an open question, not built.",
  "agent-permit-demo": "Run it in the demo below this card.",
  "one-shot-tet": "Nothing to run for the idea itself. A model of it is further down this page.",
  "future-concept": "Nothing to run here yet: its code is in an open pull request, not on main.",
  "learning-model": "Run it in the model below this card.",
  "fn-dsa": "Nothing to run: TET has no FN-DSA code, and this page adds no new cryptography.",
  "permit-language": "Run it in the sketch below this card.",
  "services-booking": "Nothing to run here yet: its code is in an open pull request, not on main.",
  "services-delivery": "Nothing to run here yet: its code is in an open pull request, not on main.",
  "services-reviews": "Nothing to run here yet: its code is in an open pull request, not on main.",
  "tags-tap-check": "Nothing to run here yet: its code is in an open pull request, not on main.",
  "tags-maker-register": "Nothing to run: planned, not built.",
  "tags-scan-page": "Nothing to run: planned, not built.",
  "tags-owner-record": "Nothing to run: planned, not built.",
};
