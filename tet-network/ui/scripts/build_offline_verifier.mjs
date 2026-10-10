// Build "Verify without TET": one HTML file that works offline, and a one-file CLI.
//
//   node scripts/build_offline_verifier.mjs            # writes public/verify/
//   TET_PUBLISHER_WORDS=… node scripts/build_offline_verifier.mjs --mark   # also marks both files
//
// Both files inline, unchanged, app/lib/offline_verify.mjs (Level 1: "this key signed this hash")
// and the ML-DSA-44 WASM (public/pqc), with the WASM glue's network loader removed: nothing in
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
let glue = read("public/pqc/tet_pqc_wasm.js").toString("utf8");
glue = glue.replace(/^\/\* @ts-self-types.*\n/m, "");
glue = glue.replace(/async function __wbg_load\([\s\S]*?\n}\n/, "");
glue = glue.replace(/async function __wbg_init\([\s\S]*?\n}\n/, "");
glue = glue.replace(/^export \{[^}]*\};?\n?/m, "").replace(/^export /gm, "");
if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|import\.meta/.test(glue + verifierSrc)) {
  throw new Error("the inlined code still contains a network call or import.meta");
}
const wasmB64 = read("public/pqc/tet_pqc_wasm_bg.wasm").toString("base64");

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
$("go").onclick = async () => {
  if (!(await hasEd25519())) return show(["This browser has no built-in Ed25519. Use a current Chrome, Edge, Firefox or Safari, or the CLI."], false);
  const recordBytes = await bytesOf($("record"));
  if (!recordBytes) return show(["Choose the record file (.sig.json or .record.json)."], false);
  const file = await bytesOf($("file"));
  const chain = chainSel.value === "other" ? { chainId: $("cid").value.trim(), genesisHash: $("gh").value.trim().toLowerCase() } : JSON.parse(chainSel.value);
  const r = await verifyRecordOffline({ recordBytes, file, chain, mldsa44Verify });
  if (!r.ok) return show(["Does not verify: " + r.reason], false);
  show([
    "Verified offline: these two keys signed " + (r.signedSha256 ? "the SHA-256 " + r.signedSha256 : "this content") + ", for " + chain.chainId + ".",
    "Signer (Ed25519): " + r.signer + (r.signer === KNOWN.publisher ? "  — this is TET's publisher ID." : ""),
    "ML-DSA-44 key: " + r.mldsaKeyId,
    r.fileMatches === true ? "The file you gave matches exactly." : r.signedSha256 ? "No file given: compare this SHA-256 with your file's (any SHA-256 tool)." : "",
    "Proof code: " + r.proofCode,
    "This proves the keys signed it. It doesn't prove who holds the keys, that the content is true, or when it was signed.",
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
<h1>Verify without TET</h1>
<p><b>Even if TET disappears, this still works.</b> This one file checks a TET signature record on your own device. It sends nothing anywhere and asks no server; you can use it with the network switched off.</p>
<label for="record">The record (.sig.json or .record.json)</label>
<input id="record" type="file" accept=".json,application/json">
<label for="file">The file it marks (optional; it stays on your device)</label>
<input id="file" type="file">
<label for="chain">Chain the signature is bound to</label>
<select id="chain"></select>
<div id="other" hidden>
<label for="cid">Chain id</label><input id="cid">
<label for="gh">Genesis hash</label><input id="gh" size="70">
</div>
<button id="go" type="button">Verify</button>
<div id="out" role="status" aria-live="polite"></div>
<h2>What this checks</h2>
<p class="note">Level 1, offline, no chain needed: that the two keys in the record (Ed25519 and ML-DSA-44) signed this SHA-256 for this chain, and, if you give the file, that it hashes to exactly that. It doesn't prove who holds the keys, that the content is true, or when it was signed.</p>
<p class="note">Level 2, inclusion in a copy of the chain, comes next. Today TET relies on one block producer and one operator, so until blocks carry producer signatures, a chain copy can only be checked for being consistent with itself. More producers and outside checks are planned (roadmap Phases 3 and 9).</p>
<p class="note">Check that this file is genuine: its SHA-256 is published with TET's marks, and the source is in the TET-OS repository (tet-network/ui/scripts/build_offline_verifier.mjs).</p>
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
