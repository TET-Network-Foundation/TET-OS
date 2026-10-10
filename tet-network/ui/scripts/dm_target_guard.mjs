/**
 * SECURITY REGRESSION GUARD: a DM or ID card from a post goes to the post's verified signer key,
 * never to the short ID on screen (short IDs can be imitated by grinding a key with the same
 * opening characters).
 *
 * 1. `dmTargetFor`: a named post whose displayed ID starts like the signer's but whose signature key
 *    differs gives the signature key; an anonymous post, or one not checked, gives none.
 *    Negative control: an implementation that takes the displayed author → FAILED.
 * 2. Source: BoardPanel's ID card gets its ID only from `dmTargetFor`, and `readBoard` sets
 *    `verifiedSigner` only after `verifyEnvelopeSender` says "verified" and drops "forged" posts.
 *    Controls: the card given `label.author`; the signer set before the check → FAILED.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dmTargetFor } from "../app/lib/dm_target.ts";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

const signer = "1b2c3d4e" + "a".repeat(56);
const imitation = "1b2c3d4e" + "f".repeat(56); // same short ID on screen
function behaviour(impl) {
  const named = { label: { kind: "named", author: imitation }, verifiedSigner: signer };
  const anon = { label: { kind: "anonymous", author: null }, verifiedSigner: signer };
  const unchecked = { label: { kind: "named", author: signer } };
  const out = [];
  if (impl(named) !== signer) out.push(`same short ID, different key → ${impl(named)}`);
  if (impl(anon) !== null) out.push("an anonymous post got a DM target");
  if (impl(unchecked) !== null) out.push("an unchecked post got a DM target");
  if (impl({ label: { kind: "named" }, verifiedSigner: signer.slice(0, 8) }) !== null) out.push("a short prefix was accepted");
  return out;
}
const b = behaviour(dmTargetFor);
check("SECURITY: a DM goes to the verified signer key, not the shown ID", b.length === 0, b.join("; "));
const bad = (p) => (p.label.kind === "named" ? p.label.author ?? null : null);
check("negative control: taking the displayed author FAILS", behaviour(bad).length > 0);

const panel = readFileSync(resolve(here, "../app/try/BoardPanel.tsx"), "utf8");
const board = readFileSync(resolve(here, "../app/lib/try_board.ts"), "utf8");
function sourceProblems(panelSrc, boardSrc) {
  const p = [];
  const cards = [...panelSrc.matchAll(/<IdCard\s+walletId=\{([^}]+)\}/g)].map((m) => m[1].trim());
  if (cards.length === 0) p.push("no ID card");
  for (const c of cards) if (c !== "target") p.push(`IdCard given ${c}`);
  if (!/const target = dmTargetFor\(props\.post\)/.test(panelSrc)) p.push("target not from dmTargetFor");
  if (/onDm\?*\.?\(\s*(shown|props\.post\.label\.author|p\.label\.author)/.test(panelSrc)) p.push("onDm called with the shown ID");
  const check = boardSrc.indexOf("verifyEnvelopeSender(row");
  const set = boardSrc.indexOf("base.verifiedSigner =");
  if (check < 0 || set < check || !/if \(v === "verified"\) base\.verifiedSigner =/.test(boardSrc)) p.push("verifiedSigner not gated on a verified signature");
  if (!/if \(v === "forged"\) continue;/.test(boardSrc)) p.push("forged posts not dropped");
  return p;
}
const sp = sourceProblems(panel, board);
check("SECURITY: the ID card and DM use only the checked signer", sp.length === 0, sp.join("; "));
check("negative control: the card given label.author FAILS", sourceProblems(panel.replace("<IdCard walletId={target}", "<IdCard walletId={props.post.label.author}"), board).length > 0);
check(
  "negative control: the signer set without the check FAILS",
  sourceProblems(panel, board.replace('if (v === "verified") base.verifiedSigner =', "base.verifiedSigner =")).length > 0,
);

if (failed) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("\ndm target guard: all checks passed");
