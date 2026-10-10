// Build "Verify without TET": one HTML file that works offline, and a one-file CLI.
//
//   node scripts/build_offline_verifier.mjs            # writes public/verify/
//   TET_PUBLISHER_WORDS=… node scripts/build_offline_verifier.mjs --mark   # also marks both files
//
// Both files inline, unchanged, app/lib/offline_verify.mjs (Level 1: "this key signed this hash")
// and the ML-DSA-44 WASM (tet-agent-sdk/vendor, the committed signer), with the WASM glue's network loader removed: nothing in
// either file can make a request, and the HTML's Content-Security-Policy says `connect-src 'none'`
// and pins its one inline script by hash. Deterministic: the same sources give the same bytes, so
// the published SHA-256 can be re-derived from the repository.
//
// --mark signs each file's SHA-256 with TET's publisher ID (like scripts/paper_build.mjs) and saves
// the records in public/verify/marks/, to publish once the demo is open. Nothing is sent anywhere.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const UI = new URL("../", import.meta.url);
const OUT = new URL("public/verify/", UI);
const read = (p) => readFileSync(new URL(p, UI));
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");

// What the files know without asking anyone: the public testnet's chain binding and TET's
// publisher ID (both from the paper's marks, which are public by design).
const marks = JSON.parse(read("app/whitepaper/marks.json").toString("utf8"));
const KNOWN = {
  chains: [{ name: "TET public testnet", chainId: marks.chain.chainId, genesisHash: marks.chain.genesisHash }],
  publisher: marks.signer,
};

// The verifier module, as is, minus its `export` keywords (it becomes part of one script).
const verifierSrc = read("app/lib/offline_verify.mjs").toString("utf8").replace(/^export /gm, "");

// The WASM glue: initSync only. The async loader (the only code that could fetch) is cut out.
// From the one committed copy of the signer (tet-agent-sdk/vendor/), not public/pqc/: that is a
// gitignored build output, absent in CI and different across toolchains, so the files could not be
// rebuilt byte for byte from the repository.
let glue = read("../../tet-agent-sdk/vendor/tet_pqc_wasm.js").toString("utf8");
glue = glue.replace(/^\/\* @ts-self-types.*\n/m, "");
glue = glue.replace(/async function __wbg_load\([\s\S]*?\n}\n/, "");
glue = glue.replace(/async function __wbg_init\([\s\S]*?\n}\n/, "");
glue = glue.replace(/^export \{[^}]*\};?\n?/m, "").replace(/^export /gm, "");
if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|import\.meta/.test(glue + verifierSrc)) {
  throw new Error("the inlined code still contains a network call or import.meta");
}
const wasmB64 = read("../../tet-agent-sdk/vendor/tet_pqc_wasm_bg.wasm").toString("base64");

const core = `// ---- ML-DSA-44 (TET's own WASM, wasm-bindgen glue, network loader removed) ----
${glue}
const __wasmBytes = Uint8Array.from(atob(${JSON.stringify(wasmB64)}), (c) => c.charCodeAt(0));
initSync({ module: __wasmBytes });
async function mldsa44Verify(pubB64, sigB64, msg) {
  try { return mldsa44_verify_b64(pubB64, sigB64, msg) === true; } catch { return false; }
}
// ---- Level 1 verifier (app/lib/offline_verify.mjs, unchanged) ----
${verifierSrc}
const KNOWN = ${JSON.stringify(KNOWN)};
`;

const ui = `
const $ = (id) => document.getElementById(id);
// ---- languages: English, 日本語, 繁體中文（香港）. ?lang= in the link, else the choice saved on this
// device, else the browser's languages (the same order as the site, app/lib/pick_lang.ts). ----
const L = {
  ja: {
    title: "TET なしで検証",
    lead: "<b>TET がなくなっても、これは動きます。</b>この1つのファイルが、TET の署名記録をあなたの端末の上で確かめます。どこにも何も送らず、どのサーバーにも問い合わせません。ネットワークを切った状態でも使えます。",
    record: "記録（.sig.json または .record.json）",
    file: "印が付いたファイル（任意。あなたの端末から出ません）",
    chain: "署名が結びついているチェーン",
    cid: "チェーン ID",
    gh: "ジェネシスハッシュ",
    go: "検証する",
    lang: "言語",
    what: "これが確かめること",
    l1: "レベル1。オフラインで、チェーンは要りません: 記録にある2つの鍵（Ed25519 と ML-DSA-44）が、このチェーン向けにこの SHA-256 に署名したこと。ファイルを渡せば、そのハッシュがまさにそれと一致すること。鍵を誰が持っているか、内容が本当か、いつ署名されたかは証明しません。",
    l2: "レベル2（チェーンの写しに含まれていることの確認）は次の段階です。今の TET は1つのブロック生成者と1人の運営者に頼っているので、ブロックに生成者の署名が付くまでは、チェーンの写しはそれ自体の中で矛盾がないかしか確かめられません。生成者を増やすことと外部からの確認は計画中です（ロードマップの段階 3 と 9）。",
    genuine: "このファイルが本物か確かめるには: その SHA-256 は TET の印と一緒に公開されていて、ソースは TET-OS のリポジトリ（tet-network/ui/scripts/build_offline_verifier.mjs）にあります。",
    other: "別のチェーン…",
    noEd: "このブラウザには Ed25519 が組み込まれていません。最新の Chrome、Edge、Firefox、Safari か、CLI を使ってください。",
    chooseRecord: "記録ファイル（.sig.json または .record.json）を選んでください。",
    no: "検証できません: ",
    verified: (sha, cid) => \`オフラインで検証できました: この2つの鍵が \${sha ? "SHA-256 " + sha : "この内容"} に、\${cid} 向けに署名しています。\`,
    signer: "署名者（Ed25519）: ",
    publisher: "  — これは TET の発行者 ID です。",
    mldsa: "ML-DSA-44 の鍵: ",
    matches: "渡されたファイルは完全に一致しました。",
    noFile: "ファイルが渡されていません: この SHA-256 をあなたのファイルのもの（どの SHA-256 ツールでも）と比べてください。",
    code: "証明コード: ",
    limit: "鍵がこれに署名したことを証明します。鍵を誰が持っているか、内容が本当か、いつ署名されたかは証明しません。",
    reasons: [
      [/^the record is not JSON$/, () => "記録が JSON ではありません"],
      [/^the record is not a JSON object$/, () => "記録が JSON オブジェクトではありません"],
      [/^unsupported envelope version$/, () => "対応していない封筒の版です"],
      [/^unknown pre-image encoding (.*)$/, (m) => \`知らない署名前データの形式です \${m[1]}\`],
      [/^unexpected field (.*)$/, (m) => \`想定外の項目があります \${m[1]}\`],
      [/^payloadType is missing$/, () => "payloadType がありません"],
      [/^expected exactly 2 signatures, got (\d+)$/, (m) => \`署名はちょうど2つのはずが、\${m[1]} つでした\`],
      [/^missing or duplicated ed25519 signature$/, () => "ed25519 の署名がないか、重複しています"],
      [/^missing or duplicated ml-dsa-44 signature$/, () => "ml-dsa-44 の署名がないか、重複しています"],
      [/^the ed25519 key is not 64 lowercase hex$/, () => "ed25519 の鍵が小文字の16進64文字ではありません"],
      [/^ed25519 keyid does not match the key it names$/, () => "ed25519 の keyid が、示している鍵と一致しません"],
      [/^envelope is not valid base64$/, () => "封筒が正しい base64 ではありません"],
      [/^ml-dsa-44 keyid does not match the key it names$/, () => "ml-dsa-44 の keyid が、示している鍵と一致しません"],
      [/^ml-dsa key is not ML-DSA-44$/, () => "ml-dsa の鍵が ML-DSA-44 ではありません"],
      [/^ml-dsa signature is not ML-DSA-44$/, () => "ml-dsa の署名が ML-DSA-44 ではありません"],
      [/^a hash-only signature must carry exactly 32 bytes$/, () => "ハッシュだけの署名は、ちょうど32バイトでなければなりません"],
      [/^the file's SHA-256 differs from the one that was signed$/, () => "ファイルの SHA-256 が、署名されたものと違います"],
      [/^this record signs its content, not a hash: give the file too$/, () => "この記録はハッシュではなく内容そのものに署名しています: ファイルも渡してください"],
      [/^the content differs from what was signed \(signed (\d+) bytes, given (\d+)\)$/, (m) => \`内容が署名されたものと違います（署名は \${m[1]} バイト、渡されたのは \${m[2]} バイト）\`],
      [/^ed25519 signature does not verify \(on this chain binding\)$/, () => "ed25519 の署名が検証できません（このチェーンの結びつきで）"],
      [/^ml-dsa-44 signature does not verify \(on this chain binding\)$/, () => "ml-dsa-44 の署名が検証できません（このチェーンの結びつきで）"],
    ],
  },
  "zh-HK": {
    title: "不靠 TET 也能驗證",
    lead: "<b>即使 TET 消失，這個仍然可用。</b>這一個檔案在你自己的裝置上核對 TET 的簽名記錄。它不會傳送任何東西，也不會詢問任何伺服器；斷開網絡也能使用。",
    record: "記錄（.sig.json 或 .record.json）",
    file: "它標記的檔案（可選；檔案留在你的裝置上）",
    chain: "簽名所綁定的鏈",
    cid: "鏈 ID",
    gh: "創世雜湊值",
    go: "驗證",
    lang: "語言",
    what: "這會核對甚麼",
    l1: "第 1 級，離線，不需要鏈：記錄中的兩把金鑰（Ed25519 和 ML-DSA-44）為這條鏈簽署了這個 SHA-256；如果你提供檔案，也核對它的雜湊值正是那個值。這並不證明誰持有金鑰、內容是否真實，或何時簽署。",
    l2: "第 2 級（核對是否包含在鏈的副本中）是下一步。目前 TET 依賴一個區塊產生者和一個營運者，所以在區塊附上產生者簽名之前，鏈的副本只能核對自身是否一致。增加產生者和外部核對都在計劃中（路線圖第 3 和第 9 階段）。",
    genuine: "要確認這個檔案是真的：它的 SHA-256 與 TET 的標記一同公開，原始碼在 TET-OS 儲存庫（tet-network/ui/scripts/build_offline_verifier.mjs）。",
    other: "其他鏈…",
    noEd: "這個瀏覽器沒有內置 Ed25519。請使用最新版的 Chrome、Edge、Firefox 或 Safari，或者使用命令列工具。",
    chooseRecord: "請選擇記錄檔案（.sig.json 或 .record.json）。",
    no: "驗證不通過：",
    verified: (sha, cid) => \`已離線驗證：這兩把金鑰為 \${cid} 簽署了\${sha ? " SHA-256 " + sha : "這段內容"}。\`,
    signer: "簽署者（Ed25519）：",
    publisher: "  — 這是 TET 的發行者 ID。",
    mldsa: "ML-DSA-44 金鑰：",
    matches: "你提供的檔案完全吻合。",
    noFile: "沒有提供檔案：請把這個 SHA-256 與你檔案的 SHA-256（任何 SHA-256 工具都可）比較。",
    code: "證明碼：",
    limit: "這證明金鑰簽署了它。並不證明誰持有金鑰、內容是否真實，或何時簽署。",
    reasons: [
      [/^the record is not JSON$/, () => "記錄不是 JSON"],
      [/^the record is not a JSON object$/, () => "記錄不是 JSON 物件"],
      [/^unsupported envelope version$/, () => "不支援的封套版本"],
      [/^unknown pre-image encoding (.*)$/, (m) => \`未知的簽署前資料格式 \${m[1]}\`],
      [/^unexpected field (.*)$/, (m) => \`出現意料之外的欄位 \${m[1]}\`],
      [/^payloadType is missing$/, () => "缺少 payloadType"],
      [/^expected exactly 2 signatures, got (\d+)$/, (m) => \`應有正好 2 個簽名，實際有 \${m[1]} 個\`],
      [/^missing or duplicated ed25519 signature$/, () => "ed25519 簽名缺少或重複"],
      [/^missing or duplicated ml-dsa-44 signature$/, () => "ml-dsa-44 簽名缺少或重複"],
      [/^the ed25519 key is not 64 lowercase hex$/, () => "ed25519 金鑰不是 64 個小寫十六進制字元"],
      [/^ed25519 keyid does not match the key it names$/, () => "ed25519 的 keyid 與它指明的金鑰不符"],
      [/^envelope is not valid base64$/, () => "封套不是有效的 base64"],
      [/^ml-dsa-44 keyid does not match the key it names$/, () => "ml-dsa-44 的 keyid 與它指明的金鑰不符"],
      [/^ml-dsa key is not ML-DSA-44$/, () => "ml-dsa 金鑰不是 ML-DSA-44"],
      [/^ml-dsa signature is not ML-DSA-44$/, () => "ml-dsa 簽名不是 ML-DSA-44"],
      [/^a hash-only signature must carry exactly 32 bytes$/, () => "只簽雜湊值的簽名必須正好是 32 個位元組"],
      [/^the file's SHA-256 differs from the one that was signed$/, () => "檔案的 SHA-256 與被簽署的不同"],
      [/^this record signs its content, not a hash: give the file too$/, () => "這個記錄簽署的是內容本身，不是雜湊值：請一併提供檔案"],
      [/^the content differs from what was signed \(signed (\d+) bytes, given (\d+)\)$/, (m) => \`內容與被簽署的不同（簽署了 \${m[1]} 個位元組，提供了 \${m[2]} 個）\`],
      [/^ed25519 signature does not verify \(on this chain binding\)$/, () => "ed25519 簽名驗證不通過（以這條鏈的綁定）"],
      [/^ml-dsa-44 signature does not verify \(on this chain binding\)$/, () => "ml-dsa-44 簽名驗證不通過（以這條鏈的綁定）"],
    ],
  },
};
const pickLangOf = (q, stored, browser) => {
  const as = (v) => { const x = String(v ?? "").trim().toLowerCase(); return x === "en" ? "en" : x === "ja" ? "ja" : x === "zh-hk" ? "zh-HK" : null; };
  const fromBrowser = (ls) => { for (const r of ls) { const l = String(r).toLowerCase(); if (l === "ja" || l.startsWith("ja-")) return "ja"; if (l === "zh" || l.startsWith("zh-")) return "zh-HK"; if (l === "en" || l.startsWith("en-")) return "en"; } return null; };
  return as(q) ?? as(stored) ?? fromBrowser(browser) ?? "en";
};
let stored = null;
try { stored = localStorage.getItem("tet.verify.lang"); } catch {}
let lang = pickLangOf(new URLSearchParams(location.search).get("lang"), stored, navigator.languages ?? [navigator.language]);
const tr = () => L[lang] ?? null;
const reasonIn = (reason) => { const d = tr(); if (!d) return reason; for (const [re, f] of d.reasons) { const m = reason.match(re); if (m) return f(m); } return reason; };
function applyLang() {
  const d = tr();
  document.documentElement.lang = lang === "ja" ? "ja" : lang === "zh-HK" ? "zh-HK" : "en";
  for (const el of document.querySelectorAll("[data-t]")) {
    const k = el.dataset.t;
    if (!el.dataset.en) el.dataset.en = el.innerHTML;
    el.innerHTML = d && d[k] ? d[k] : el.dataset.en;
  }
  document.title = d ? d.title : "Verify without TET";
  const o = [...$("chain").options].find((x) => x.value === "other");
  if (o) o.text = d ? d.other : "Another chain…";
  $("lang").value = lang;
}
$("lang").onchange = () => { lang = $("lang").value; try { localStorage.setItem("tet.verify.lang", lang); } catch {} applyLang(); };

const chainSel = $("chain");
for (const c of KNOWN.chains) chainSel.add(new Option(\`\${c.name} (\${c.chainId})\`, JSON.stringify(c)));
chainSel.add(new Option("Another chain…", "other"));
chainSel.onchange = () => ($("other").hidden = chainSel.value !== "other");
const bytesOf = async (input) => (input.files[0] ? new Uint8Array(await input.files[0].arrayBuffer()) : null);
function show(lines, ok) {
  const out = $("out");
  out.replaceChildren(...lines.map((l) => Object.assign(document.createElement("p"), { textContent: l })));
  out.className = ok ? "ok" : "bad";
}
applyLang();
$("go").onclick = async () => {
  const d = tr();
  if (!(await hasEd25519())) return show([d ? d.noEd : "This browser has no built-in Ed25519. Use a current Chrome, Edge, Firefox or Safari, or the CLI."], false);
  const recordBytes = await bytesOf($("record"));
  if (!recordBytes) return show([d ? d.chooseRecord : "Choose the record file (.sig.json or .record.json)."], false);
  const file = await bytesOf($("file"));
  const chain = chainSel.value === "other" ? { chainId: $("cid").value.trim(), genesisHash: $("gh").value.trim().toLowerCase() } : JSON.parse(chainSel.value);
  const r = await verifyRecordOffline({ recordBytes, file, chain, mldsa44Verify });
  if (!r.ok) return show([(d ? d.no : "Does not verify: ") + reasonIn(r.reason)], false);
  show([
    d ? d.verified(r.signedSha256, chain.chainId) : "Verified offline: these two keys signed " + (r.signedSha256 ? "the SHA-256 " + r.signedSha256 : "this content") + ", for " + chain.chainId + ".",
    (d ? d.signer : "Signer (Ed25519): ") + r.signer + (r.signer === KNOWN.publisher ? (d ? d.publisher : "  — this is TET's publisher ID.") : ""),
    (d ? d.mldsa : "ML-DSA-44 key: ") + r.mldsaKeyId,
    r.fileMatches === true ? (d ? d.matches : "The file you gave matches exactly.") : r.signedSha256 ? (d ? d.noFile : "No file given: compare this SHA-256 with your file's (any SHA-256 tool).") : "",
    (d ? d.code : "Proof code: ") + r.proofCode,
    d ? d.limit : "This proves the keys signed it. It doesn't prove who holds the keys, that the content is true, or when it was signed.",
  ].filter(Boolean), true);
};
`;

const script = `${core}\n${ui}`;
const scriptHash = createHash("sha256").update(script).digest("base64");
const csp = [
  "default-src 'none'",
  `script-src 'sha256-${scriptHash}' 'wasm-unsafe-eval'`,
  "style-src 'unsafe-inline'",
  "connect-src 'none'",
  "img-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Verify without TET</title>
<style>
:root { color-scheme: light dark; --ink: #1c1f23; --muted: #5d646d; --ok: #1e6b35; --bad: #9a1c1c; --bg: #fff; --line: #c9ced4; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8eaed; --muted: #a3a9b1; --ok: #7bd389; --bad: #ff8a80; --bg: #15171a; --line: #3a3f45; } }
body { margin: 0 auto; max-width: 44rem; padding: 16px; font: 16px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
h1 { font-size: 1.4rem; } label { display: block; margin: 1rem 0 .25rem; font-weight: 600; }
input, select, button { font: inherit; max-width: 100%; } button { margin-top: 1rem; padding: .5rem 1rem; }
#out p { margin: .3rem 0; word-break: break-all; } .ok { color: var(--ok); } .bad { color: var(--bad); }
.note { color: var(--muted); font-size: .9rem; }
</style>
</head>
<body>
<p style="float:right"><label for="lang" data-t="lang" style="display:inline;font-weight:400;margin:0 .4rem 0 0">Language</label><select id="lang"><option value="en">English</option><option value="ja">日本語</option><option value="zh-HK">繁體中文（香港）</option></select></p>
<h1 data-t="title">Verify without TET</h1>
<p data-t="lead"><b>Even if TET disappears, this still works.</b> This one file checks a TET signature record on your own device. It sends nothing anywhere and asks no server; you can use it with the network switched off.</p>
<label for="record" data-t="record">The record (.sig.json or .record.json)</label>
<input id="record" type="file" accept=".json,application/json">
<label for="file" data-t="file">The file it marks (optional; it stays on your device)</label>
<input id="file" type="file">
<label for="chain" data-t="chain">Chain the signature is bound to</label>
<select id="chain"></select>
<div id="other" hidden>
<label for="cid" data-t="cid">Chain id</label><input id="cid">
<label for="gh" data-t="gh">Genesis hash</label><input id="gh" size="70">
</div>
<button id="go" type="button" data-t="go">Verify</button>
<div id="out" role="status" aria-live="polite"></div>
<h2 data-t="what">What this checks</h2>
<p class="note" data-t="l1">Level 1, offline, no chain needed: that the two keys in the record (Ed25519 and ML-DSA-44) signed this SHA-256 for this chain, and, if you give the file, that it hashes to exactly that. It doesn't prove who holds the keys, that the content is true, or when it was signed.</p>
<p class="note" data-t="l2">Level 2, inclusion in a copy of the chain, comes next. Today TET relies on one block producer and one operator, so until blocks carry producer signatures, a chain copy can only be checked for being consistent with itself. More producers and outside checks are planned (roadmap Phases 3 and 9).</p>
<p class="note" data-t="genuine">Check that this file is genuine: its SHA-256 is published with TET's marks, and the source is in the TET-OS repository (tet-network/ui/scripts/build_offline_verifier.mjs).</p>
<script type="module">${script}</script>
</body>
</html>
`;

const cli = `#!/usr/bin/env node
// Verify without TET, CLI. Level 1, offline: node tet-verify.mjs <record.json> [file] [--chain <chainId> <genesisHash>]
// Built by tet-network/ui/scripts/build_offline_verifier.mjs; makes no network request.
import { readFileSync } from "node:fs";
${core}
const args = process.argv.slice(2);
const ci = args.indexOf("--chain");
const chain = ci >= 0 ? { chainId: args[ci + 1], genesisHash: String(args[ci + 2] ?? "").toLowerCase() } : KNOWN.chains[0];
const pos = ci >= 0 ? args.slice(0, ci) : args;
if (!pos[0]) {
  console.log("usage: node tet-verify.mjs <record.json> [file] [--chain <chainId> <genesisHash>]");
  process.exit(2);
}
const r = await verifyRecordOffline({ recordBytes: new Uint8Array(readFileSync(pos[0])), file: pos[1] ? new Uint8Array(readFileSync(pos[1])) : null, chain, mldsa44Verify });
if (!r.ok) {
  console.log("DOES NOT VERIFY: " + r.reason);
  process.exit(1);
}
console.log("VERIFIED (offline, Level 1) on " + chain.chainId);
console.log("signer ed25519  " + r.signer + (r.signer === KNOWN.publisher ? "  (TET's publisher ID)" : ""));
console.log("ml-dsa-44 key   " + r.mldsaKeyId);
if (r.signedSha256) console.log("signed sha256   " + r.signedSha256);
console.log("file matches    " + (r.fileMatches === null ? "(no file given)" : r.fileMatches));
console.log("proof code      " + r.proofCode);
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("tet-verify.html", OUT), html);
writeFileSync(new URL("tet-verify.mjs", OUT), cli);
const sums = { "tet-verify.html": sha256hex(html), "tet-verify.mjs": sha256hex(cli) };
writeFileSync(new URL("SHA256SUMS", OUT), Object.entries(sums).map(([f, h]) => `${h}  ${f}`).join("\n") + "\n");
console.log(Object.entries(sums).map(([f, h]) => `${h}  ${f}`).join("\n"));

if (process.argv.includes("--mark")) {
  const wordsPath = process.env.TET_PUBLISHER_WORDS || join(homedir(), ".tet", "tet-publisher.words");
  if (!existsSync(wordsPath)) throw new Error(`No publisher key at ${wordsPath}.`);
  const { register } = await import("node:module");
  register("./lib/ts_hooks.mjs", import.meta.url);
  process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= marks.chain.chainId;
  process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
  const pc = await import("../app/lib/proof_code.ts");
  const { signContent, sigJsonBytes } = await import("../app/lib/sign_anything.ts");
  const trySession = await import("../app/lib/try_session.ts");
  await trySession.activateTryWallet(readFileSync(wordsPath, "utf8").trim());
  const MARKS = new URL("marks/", OUT);
  mkdirSync(MARKS, { recursive: true });
  const out = {};
  for (const [name, text] of [["tet-verify.html", html], ["tet-verify.mjs", cli]]) {
    const rec = await pc.signFileHash(new Uint8Array(Buffer.from(text)), marks.chain);
    const consent = await signContent(createHash("sha256").update(rec.bytes).digest(), pc.CONSENT_PAYLOAD_TYPE, marks.chain);
    writeFileSync(new URL(`${name}.record.json`, MARKS), rec.bytes);
    writeFileSync(new URL(`${name}.consent.json`, MARKS), sigJsonBytes(consent));
    out[name] = { code: pc.proofCode(rec.bytes), sha256: sums[name] };
  }
  writeFileSync(new URL("marks.json", OUT), JSON.stringify({ ...out, signer: marks.signer, chain: marks.chain, published: false }, null, 2) + "\n");
  console.log(JSON.stringify(out));
  process.exit(0);
}
