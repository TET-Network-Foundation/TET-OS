// Guard for what Try TET says about privacy.
//
//   node --experimental-strip-types scripts/try_privacy_guard.mjs
//
// 1. Nothing in the repository claims more than the system does: no "untraceable", "IP hidden",
//    "completely anonymous" or the like, in English, Japanese or Chinese, in any tracked text file.
//    The proof unlinks a post from a key; the node still sees the IP address.
//    Control: a file with such a claim is caught.
// 2. The page says what is true, in every language: the demo node sees your IP address and doesn't
//    log it; anonymous posting unlinks the post from your key and doesn't hide your IP; for IP
//    privacy, Tor or your own node. Control: a dictionary missing the line is caught.
// 3. Each feature keeps its "proves / doesn't prove" line. Control: a panel without it is caught.
//
// "Doesn't log it" is made true for Caddy by its log filter (deploy/demo/Caddyfile rule 5, checked
// with a real Caddy and a control in deploy/tests/demo-node.test.sh); tet-core logs no client address.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = new URL("../../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── 1. Forbidden claims ─────────────────────────────────────────────────────────────────────────
export const OVERCLAIM = new RegExp(
  [
    "untraceab",
    "untrackab",
    "IP[- ]hidden",
    "hides? (?:your|the) IP",
    "IP (?:is|stays) hidden",
    "(?:completely|fully|totally|perfectly) anonymous",
    "(?:no one|nobody) can (?:trace|see who)",
    "追跡(?:不可能|できない|されない)",
    "IP.{0,8}(?:を隠します|が隠れ(?:ます|る)|は隠され|を秘匿(?:します|する)|隠蔽)",
    "完全(?:に)?匿名",
    "無法追蹤|不可追蹤|追蹤不到",
    "隱藏.{0,4}IP|IP.{0,4}隱藏",
    "完全匿名",
  ].join("|"),
  "i",
);
// A content filter's blocklist names the phrase; it doesn't claim it. And this file defines the list.
const NOT_CLAIMS = new Set(["tet-core/src/ai_filter.rs", "tet-network/ui/scripts/try_privacy_guard.mjs"]);
// Statements that *deny* a claim are fine ("doesn't hide your IP"): only the claim itself counts. The
// denial must be in the same sentence, so "No signup. Your posts are untraceable." is still a claim.
const DENIAL = /(?:doesn't|does not|don't|never|not|no|ません|しない|ではありません|不會|不能|並不)[^.!?。！？]{0,24}$/i;

function overclaims(files) {
  const found = [];
  for (const [path, text] of files) {
    if (NOT_CLAIMS.has(path)) continue;
    text.split("\n").forEach((line, i) => {
      const m = OVERCLAIM.exec(line);
      if (m && !DENIAL.test(line.slice(0, m.index))) found.push(`${path}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return found;
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter((p) => p && /\.(?:tsx?|mjs|js|md|rs|json|html|txt|yml|yaml)$/.test(p) && !/package-lock\.json$|\/public\/pqc\//.test(p));
const files = tracked.map((p) => {
  try {
    return [p, read(p)];
  } catch {
    return [p, ""];
  }
});

await check("SECURITY: no file claims untraceable, IP-hidden or complete anonymity", () => {
  const found = overclaims(files);
  assert.equal(found.length, 0, found.join("\n     "));
});

await check("control: an overclaim is caught; a denial of one isn't", () => {
  for (const claim of ["Your posts are untraceable.", "Your IP stays hidden.", "投稿は追跡できない。", "完全匿名で投稿できます。", "IPアドレスを隠します。", "你的 IP 會被隱藏。", "No signup. Your posts are untraceable."]) {
    assert.equal(overclaims([["x.tsx", claim]]).length, 1, claim);
  }
  assert.equal(overclaims([["x.tsx", "It doesn't hide your IP address from the node."]]).length, 0);
  assert.equal(overclaims([["x.tsx", "IPを隠したいときはTorか自分のノードを使ってください。"]]).length, 0);
  assert.equal(overclaims([["x.yml", '# no "untraceable" claim anywhere']]).length, 0);
});

// ── 2. Required statements, in every language ─────────────────────────────────────────────────
const REQUIRED = [
  ["the footer: the demo node sees your IP and doesn't log it; Tor or your own node", "Testnet. The demo node sees your IP address and doesn't write it to any log; it keeps it in memory only to limit requests. For IP privacy, use Tor or your own node. Run by one person; nothing here is audited."],
  ["the board: anonymous posting unlinks post from key, doesn't hide IP", "Posting anonymously unlinks the post from your key: the proof shows a member wrote it, not which one. It doesn't hide your IP address from the node; for that, use Tor or your own node."],
];
const dicts = {
  ja: read("tet-network/ui/app/try/i18n_ja.ts"),
  "zh-HK": read("tet-network/ui/app/try/i18n_zh_hk.ts"),
};
const source = ["page.tsx", "BoardPanel.tsx"].map((f) => read(`tet-network/ui/app/try/${f}`)).join("\n");

function saysItEverywhere(en, src, ds) {
  assert.ok(src.includes(JSON.stringify(en)), `the page doesn't say: ${en.slice(0, 60)}…`);
  for (const [lang, d] of Object.entries(ds)) assert.ok(d.includes(JSON.stringify(en)), `${lang} has no translation of: ${en.slice(0, 60)}…`);
}

for (const [name, en] of REQUIRED) {
  await check(`the page says it in every language: ${name}`, () => saysItEverywhere(en, source, dicts));
}

await check("control: a dictionary missing the line is caught", () => {
  const [, en] = REQUIRED[0];
  assert.throws(() => saysItEverywhere(en, source, { ...dicts, ja: dicts.ja.replace(JSON.stringify(en), '"x"') }));
});

// ── 3. Every feature keeps its "proves / doesn't prove" line ───────────────────────────────────
const PROVES = {
  "BoardPanel.tsx": "Posting anonymously unlinks the post from your key",
  "VerifyPanel.tsx": "A valid signature proves which key signed, not who holds it.",
  "SignPanel.tsx": "A signature proves that this wallet's two keys",
  "QrPanel.tsx": "The QR doesn't contain the signature",
  "FilesTryPanel.tsx": "A delivered file proves the sender's key signed it",
  "MailPanel.tsx": "A message proves which key sent it",
  "DirectoryPanel.tsx": "A listing proves the board's own key listed it.",
  "QuestionsPanel.tsx": "it proves the owner vouched for the key, not who runs the agent.",
  "LivePanel.tsx": "Never what it said, who wrote it, or an IP address.",
};
function keepsProvesLines(read1) {
  for (const [panel, line] of Object.entries(PROVES)) assert.ok(read1(panel).includes(line), `${panel} lost its proves line`);
}
await check("each feature keeps its proves / doesn't-prove line", () => keepsProvesLines((f) => read(`tet-network/ui/app/try/${f}`)));
await check("control: a panel without its line is caught", () => {
  assert.throws(() => keepsProvesLines((f) => (f === "MailPanel.tsx" ? "" : read(`tet-network/ui/app/try/${f}`))));
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
