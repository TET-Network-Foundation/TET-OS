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
// 4. Vouching wording (TetSearch): nothing claims "AI cannot create keys", "AI cannot access" or
//    "humans only, guaranteed" (anyone, or any program, can make a key; a vouch limits who
//    publishes, not what they write), in English, Japanese or Chinese; and any page that describes
//    vouched publishing says "Keys without a human vouch can't publish." Controls: a claim, and a
//    vouch page without the line, are caught.
// 5. Who / when wording: nothing a visitor is shown says TET shows who signed or made something (a
//    person) or when (a date). A signature shows which key signed; the chain shows a record existed
//    before block N. In English, Japanese and Chinese, in every tracked file a visitor is shown (the
//    app, served HTML, the notice page, READMEs, the draft launch post), except the technical paper's
//    sources and built copies (PAPER_PENDING, named one by one: the paper is reworded in its own
//    release). Every match on a line is checked; a denial counts only inside the same clause.
//    Controls: each form is caught, denials and the "node sees who writes to whom" lines are not, and
//    a paper file is caught once it leaves PAPER_PENDING.
//    This is a first net, not a proof. Known gaps (left open on purpose; not caught here, so review for them):
//    - a denial earlier in the same clause hides a claim: "No account needed to check who signed it";
//    - Japanese without かを before the verb: 「誰が作ったか確かめられます」;
//    - "shows when it was signed", "check who actually signed", "proves who you are", "proves who
//      sent it" ("sent" is left out of the verbs on purpose, see WHO_WHEN), and Chinese such as
//      證明誰製作了這個;
//    - five alternatives have no case of their own, so removing one alone stays green:
//      "proofs? of when", いつ…誰が, 由誰(簽署|製作), 何時由誰, 是誰簽署;
//    - a date shown as a value (a signer-chosen or node-clock time) is not wording; no regex sees it;
//    - one old ja value (the EU card) is not caught on its own; cost is quadratic on adversarial lines.
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
// Guards whose controls quote the banned phrases on purpose aren't claims.
const NOT_CLAIMS = new Set([
  "tet-core/src/ai_filter.rs",
  "tet-network/ui/scripts/try_privacy_guard.mjs",
  "tet-network/ui/scripts/try_ai_wording_guard.mjs",
  "tet-network/ui/scripts/paper_guard.mjs",
  "tet-network/ui/scripts/notice_page_guard.mjs",
  "tet-network/ui/scripts/signin_demo_guard.mjs",
]);
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

// NOT_CLAIMS may hold only guard scripts, whose controls quote the banned phrases on purpose
// (owner, 2026-11-12): files matching tet-network/ui/scripts/*_guard.mjs, plus tet-core/src/ai_filter.rs,
// pinned by name because it predates the rule. Each entry must also be a committed file.
const NOT_CLAIMS_PINNED = new Set(["tet-core/src/ai_filter.rs"]);
const GUARD_SCRIPT = /^tet-network\/ui\/scripts\/[A-Za-z0-9_]+_guard\.mjs$/;
function notClaimsProblems(list, trackedFiles) {
  return [...list].flatMap((p) => [
    ...(NOT_CLAIMS_PINNED.has(p) || GUARD_SCRIPT.test(p) ? [] : [`${p}: not a scripts/*_guard.mjs file`]),
    ...(trackedFiles.includes(p) ? [] : [`${p}: not a committed file`]),
  ]);
}
await check("NOT_CLAIMS lists only committed scripts/*_guard.mjs files (and ai_filter.rs, pinned by name)", () => {
  const bad = notClaimsProblems(NOT_CLAIMS, tracked);
  assert.deepEqual(bad, [], bad.join("\n     "));
});
await check("control: a page, a non-guard script, or a missing file in NOT_CLAIMS is caught", () => {
  const extra = ["tet-network/ui/app/try/page.tsx", "tet-network/ui/scripts/build_manifest.mjs", "tet-network/ui/scripts/nothing_here_guard.mjs"];
  assert.deepEqual(notClaimsProblems(new Set([...NOT_CLAIMS, ...extra]), [...tracked, extra[0], extra[1]]), [
    "tet-network/ui/app/try/page.tsx: not a scripts/*_guard.mjs file",
    "tet-network/ui/scripts/build_manifest.mjs: not a scripts/*_guard.mjs file",
    "tet-network/ui/scripts/nothing_here_guard.mjs: not a committed file",
  ]);
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

// ── 4. Vouching wording ──────────────────────────────────────────────────────────────────────────
export const VOUCH_OVERCLAIM = new RegExp(
  [
    "AI (?:cannot|can't|can not|is unable to) (?:create|make|generate) (?:a )?keys?",
    "AI (?:cannot|can't|can not) access",
    "humans? only,? guaranteed",
    "guaranteed (?:to be )?humans? only",
    "AI(?:は|には)鍵を(?:作れ|作ることができ)(?:ない|ません)",
    "人間だけ(?:を|が)?保証",
    "AI\\s*(?:無法|不能)(?:建立|製造|產生)(?:鑰匙|金鑰)",
    "保證只有人類",
  ].join("|"),
  "i",
);
function vouchOverclaims(list) {
  const found = [];
  for (const [path, text] of list) {
    // Guards' own controls quote the banned phrases on purpose.
    if (NOT_CLAIMS.has(path)) continue;
    text.split("\n").forEach((line, i) => {
      const m = VOUCH_OVERCLAIM.exec(line);
      if (m && !DENIAL.test(line.slice(0, m.index))) found.push(`${path}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return found;
}
const VOUCH_LINE = "Keys without a human vouch can't publish.";
/** Page files that describe vouched publishing but don't carry the line. */
function vouchPagesMissingLine(list) {
  return list
    .filter(([p, text]) => /^tet-network\/ui\/app\/.*\.tsx$/.test(p) && /vouch[^.\n]{0,60}publish|publish[^.\n]{0,60}vouch/i.test(text))
    .filter(([, text]) => !text.includes(VOUCH_LINE))
    .map(([p]) => p);
}
await check("SECURITY: nothing claims AI can't make keys, or humans only, guaranteed", () => {
  const found = vouchOverclaims(files);
  assert.equal(found.length, 0, found.join("\n     "));
});
await check("control: a vouching overclaim is caught; a denial of one isn't", () => {
  for (const claim of ["AI cannot create keys here.", "TetSearch: humans only, guaranteed.", "AIは鍵を作れません。", "AI 無法建立鑰匙。"]) {
    assert.equal(vouchOverclaims([["x.tsx", claim]]).length, 1, claim);
  }
  assert.equal(vouchOverclaims([["x.md", 'Never say "AI cannot create keys": anyone can make a key.']]).length, 0);
});
await check("every page about vouched publishing says keys without a human vouch can't publish", () => {
  const missing = vouchPagesMissingLine(files);
  assert.equal(missing.length, 0, missing.join(", "));
});
await check("control: a vouch page without the line is caught", () => {
  const page = ["tet-network/ui/app/try/SearchPanel.tsx", "Only vouched people can publish to TetSearch."];
  assert.deepEqual(vouchPagesMissingLine([["tet-network/ui/app/try/X.tsx", "The owner vouched for the agent. Later you can publish it."]]), [], "a vouch and a publish in different sentences isn't a vouched-publishing claim");
  assert.deepEqual(vouchPagesMissingLine([page]), ["tet-network/ui/app/try/SearchPanel.tsx"]);
  assert.deepEqual(vouchPagesMissingLine([[page[0], page[1] + " " + VOUCH_LINE]]), []);
});

// ── 5. Who / when wording ───────────────────────────────────────────────────────────────────────
// A signature shows which key signed exactly these bytes; a record put on the chain also shows it
// existed before block N. Neither shows a person or a date. Wording rule: docs/WORDING_AUDIT.md.
const V = "(?:check|checks|checking|verify|verifies|verifying|prove|proves|proving|show|shows|showing|say|says|tell|tells|answer|answers|see|sees|confirm|confirms|learn|know|record|records|find out)";
// Not "sent": "shows who sent it" is the sender key on a checked envelope, said that way on purpose.
const DID = "(?:signed|made|wrote|created|authored|published)";
export const WHO_WHEN = new RegExp(
  [
    // "check who signed what", "the records say who signed", "see who really made it"
    `\\b${V}\\s+who\\s+(?:really\\s+)?${DID}\\b`,
    // "who made something, and when", "Who made this, and when?"
    `\\bwho\\s+${DID}\\s+(?:what|something|it|this|that)\\b[^.!?]{0,4}\\band\\s+when\\b`,
    // "who signed and when", "who and when"
    `\\bwho\\s+(?:${DID}\\s+)?(?:and|&)\\s+when\\b`,
    // "proofs of who, when and what"
    "\\bwho,\\s*when,?\\s+(?:and|&)\\s+what\\b",
    // "and when it signed", "prove when it was made", "proof of when you signed", "who signed, not only when"
    "\\band\\s+when\\s+(?:it|they|this|something)\\s+(?:was\\s+)?signed\\b",
    "\\bprove[sd]?\\s+when\\b|\\bproofs?\\s+of\\s+when\\b",
    "\\bwho\\s+signed,?\\s+not\\s+(?:only|just)\\s+when\\b",
    // ja: 誰が・いつ / いつ誰が (not 誰が誰にいつ, the node-sees line), 誰が署名・作った, いつ署名したか
    "誰が[・、]?\\s*いつ|いつ[、・]?\\s*誰が",
    // 誰が署名したか / 作ったか with a claim verb after it; a bare 「誰が作ったか。」 is a does-not item
    "誰が(?:何に)?(?:署名した|作った|作成した|書いた)かを(?:確かめ|確認|証明|示)",
    "示すのは誰が",
    "いつ署名したか",
    "署名した人と日時",
    // zh: 誰在何時 / 誰於何時 / 誰在甚麼時候 + 製作・簽署 (not 誰在何時寫給誰, the node-sees line), 由誰簽署
    "誰(?:在|於)?(?:何時|甚麼時候)(?:製作|簽|創作|造)",
    "由誰(?:簽署|製作)|何時由誰|是誰簽署|誰簽署了",
  ].join("|"),
  "gi",
);
// A denial comes just before the match, inside the same clause: a clause ends at . ! ? : ; , — and
// their Japanese and Chinese forms, so "No sign-up, check who signed it" is still a claim. Whole words
// only, so "node", "now" or "know" never count as "no".
const WW_DENIAL = /(?:\b(?:doesn't|does not|don't|do not|never|not|no|nothing|nobody|no one|can't|cannot|won't)\b|不會|不能|並不|沒有|無法|未能|不顯示)[^.!?:;,—。！？：；、，]{0,24}$/i;
// Japanese puts the negation after the verb: 「いつ署名したかは証明しません。」 The negation has to close
// the same clause the match is in, so 「…を、ネットに繋がらない場所でも確かめられます」 is still a claim.
const JA_DENIED_AFTER = /^[^。！？、，：；]*?(?:ません|ない)(?:から(?:です)?|ので)?(?:[。！？"」]|$)/;
// The technical paper's sources and its built copies still carry this wording; they change only in a
// new marked paper build (paper/v2.1), not here. Named one by one, so a new file is never exempt.
const PAPER_PENDING = new Set([
  "tet-network/ui/app/whitepaper/paper.ts",
  "tet-network/ui/app/whitepaper/paper_ja.ts",
  "tet-network/ui/app/whitepaper/paper_zh_hk.ts",
  "tet-network/ui/public/paper/tet-technical-paper.html",
  "tet-network/ui/public/paper/tet-technical-paper-v1.html",
  "tet-network/ui/public/paper/tet-technical-paper-v1.1.html",
]);
// What a visitor is shown: the app, the served HTML, the notice page, every README (GitHub shows them)
// and the draft launch post.
const SHOWN = /^(?:tet-network\/ui\/app\/|tet-network\/ui\/public\/.*\.html$|deploy\/notice\/|docs\/LAUNCH_CHECKLIST\.md$|(?:.*\/)?README\.md$)/;
function whoWhenClaims(list, pending = PAPER_PENDING) {
  const found = [];
  for (const [path, text] of list) {
    if (!SHOWN.test(path) || pending.has(path)) continue;
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(WHO_WHEN)) {
        if (WW_DENIAL.test(line.slice(0, m.index)) || JA_DENIED_AFTER.test(line.slice(m.index))) continue;
        found.push(`${path}:${i + 1}: ${line.trim().slice(0, 120)}`);
        break;
      }
    });
  }
  return found;
}
await check("nothing shown says TET shows who signed (a person) or when (a date)", () => {
  const found = whoWhenClaims(files);
  assert.equal(found.length, 0, found.join("\n     "));
});
await check("control: each who/when form is caught on a page; denials and the node-sees lines are not", () => {
  const page = "tet-network/ui/app/try/X.tsx";
  for (const claim of [
    // the strings this section replaced, word for word
    "AI makes faking easy, so being able to check who signed what, and when, matters more now.",
    "TET is a public network for checking who made something, and when.",
    "No record here carries an amount. The records say who signed what.",
    "A shared record of keys: what each key may do, how many times, and when it signed.",
    "誰が・いつ作ったかを確かめること",
    "AI で文章や画像や声を偽るのが簡単になった今、誰がいつ何に署名したかを、会社を信用しなくても確かめられることが大事になっています。",
    "TET は、誰が・いつ何かを作ったかを確かめるための公開ネットワークです。",
    "記録が示すのは誰が何に署名したかで、",
    "何回使えて、いつ署名したか。",
    "核實誰在何時製作了甚麼",
    "自行核實誰在何時簽署了甚麼",
    // one bare case per form
    "Who made this, and when?",
    "It records who signed and when.",
    "Who signed and when, on one page.",
    "Who and when, proven.",
    "Proofs of who, when and what.",
    "Prove when it was made.",
    "Who signed, not only when.",
    "See who really signed it.",
    "いつ誰が署名したかを確かめる。",
    "署名した人と日時",
    "誰簽署了甚麼",
    "何時由誰簽署",
    "誰在甚麼時候簽署了甚麼",
    // a "no" inside a word, or a denial in an earlier clause, is not a denial of this one
    "The node shows who signed what.",
    "Now you can check who signed what.",
    "No sign-up, no app — just check who signed what.",
    "There's no catch: TET shows who signed it.",
    "登録はいりません、誰がいつ作ったかを確かめられます。",
    "不能偽造：核實誰在何時簽署了甚麼",
    // a negation later in the sentence that does not close the clause
    "誰がいつ署名したかを、ネットに繋がらない場所でも確かめられます。",
    "誰がいつ作ったかを確かめる — 署名を変えられない仕組み",
    "誰が署名したかを確かめられます。",
    "誰が作ったかを証明します。",
    "Verify who published it.",
    // a second claim after a denial on the same line
    "It doesn't prove who signed it. It shows who made it.",
  ]) {
    assert.equal(whoWhenClaims([[page, claim]]).length, 1, claim);
  }
  for (const ok of [
    "Proves which key sent it. The node still sees who writes to whom, and when.",
    "誰が誰にいつ送ったかはノードに見えます。",
    "節點仍看得到誰在何時寫給誰。",
    "Who sent it is checked when it's released.",
    "It shows which key signed, and before which block. It does not show who you are, or a date.",
    "Checking which key signed something, and before which block",
    "It doesn't prove who signed it.",
    "It can't show who made it.",
    "誰がウォレットを持っているか、いつ署名したかは証明しません。",
    "沒有顯示誰在何時簽署了甚麼",
    "Anonymous posts can't be messaged: nothing in them says who wrote them.",
    "Before the page shows who sent something, it checks the envelope's signature.",
    "その物を誰が作ったか。",
    "いまの AI は、誰が作ったようにも見える文章を作れます。",
    "匿名投稿には送れません。誰が書いたかを示すものが何もないからです。",
  ]) {
    assert.equal(whoWhenClaims([[page, ok]]).length, 0, ok);
  }
  for (const shown of ["deploy/notice/index.html", "tet-network/ui/public/verify/tet-verify.html", "README.md", "tet-network/ui/README.md", "docs/LAUNCH_CHECKLIST.md"]) {
    assert.equal(whoWhenClaims([[shown, "Check who signed what."]]).length, 1, `${shown} is scanned`);
  }
  assert.equal(whoWhenClaims([["docs/x.md", "Check who signed what."]]).length, 0, "working docs are not pages");
  const paper = "tet-network/ui/app/whitepaper/paper.ts";
  assert.equal(whoWhenClaims([[paper, "Check who signed what."]]).length, 0, "the paper waits for its own build");
  assert.equal(whoWhenClaims([[paper, "Check who signed what."]], new Set()).length, 1, "a paper source is caught once it leaves PAPER_PENDING");
});
await check("PAPER_PENDING names only files that exist and still need the paper build", () => {
  for (const p of PAPER_PENDING) {
    const text = files.find(([f]) => f === p)?.[1];
    assert.ok(text, `${p} is not tracked; remove it from PAPER_PENDING`);
    assert.ok(whoWhenClaims([[p, text]], new Set()).length > 0, `${p} no longer has who/when wording; remove it from PAPER_PENDING`);
  }
});

// ── 2. Required statements, in every language ─────────────────────────────────────────────────
const REQUIRED = [
  ["the footer: the demo node sees your IP and doesn't log it; Tor or your own node", "Testnet. The demo node sees your IP address and doesn't write it to any log; it keeps it in memory only to limit requests. For IP privacy, use Tor or your own node. Run by one person; nothing here is audited."],
  ["the board: anonymous posting unlinks post from key, doesn't hide IP", "Posting anonymously unlinks the post from your ID: the proof shows a member wrote it, not which one. It doesn't hide your IP address from the node; for that, use Tor or your own node."],
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
  "BoardPanel.tsx": "Posting anonymously unlinks the post from your ID",
  "VerifyPanel.tsx": "A valid signature proves which key signed, not who holds it.",
  "SignPanel.tsx": "A signature proves that this wallet's two keys",
  "QrPanel.tsx": "The QR doesn't contain the signature",
  "FilesTryPanel.tsx": "A delivered file proves which ID sent it",
  "MailPanel.tsx": "A message proves which ID sent it",
  "DirectoryPanel.tsx": "A listing proves the board's own ID listed it.",
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
