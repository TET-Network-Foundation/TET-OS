// Every page, rendered in Japanese and Hong Kong Chinese, has no English prose left.
//
//   TET_UI=http://127.0.0.1:3400 CHROME=google-chrome node scripts/lang_render_guard.mjs
//
// Opens each /try view (`?tab=`), a proof-code lookup, the technical paper page and the offline
// verifier in a headless browser with `?lang=ja` and `?lang=zh-HK`, waits for it to settle, and
// reads what a visitor sees: visible text plus `title`, `aria-label`, `placeholder` and `alt`.
// Skipped: elements marked `translate="no"` (IDs, codes, names), `code`/`pre`, and the language
// names in the switch. Allowlisted tokens: TET, proof codes, hex IDs, algorithm and product names,
// URLs, emails, file names, numbers. Two or more English words in a row left over = FAIL.
//
// Known, listed exception: the technical paper's Hong Kong Chinese translation isn't written yet,
// so in zh-HK /whitepaper shows the English text inside `[data-pending-translation]` (with a Chinese
// note above it). That block is reported, not failed, and only on that route.
//
// Negative control: an English sentence injected into a rendered page must FAIL.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UI = (process.env.TET_UI || "http://127.0.0.1:3400").replace(/\/+$/, "");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TABS = ["home", "how", "what", "inside", "new", "directory", "questions", "verify", "sign", "genuine", "seal", "qr", "files", "site", "mail", "live", "about", "terms"];
const ONLY = process.env.TET_LANG_ONLY;
const ROUTES0 = [
  ...TABS.map((t) => ({ path: `/try?tab=${t}`, name: `try:${t}` })),
  { path: "/try?tab=verify#code=TET-AAAA-AAAA", name: "try:verify-code" },
  { path: "/whitepaper", name: "whitepaper" },
  { path: "/verify/tet-verify.html", name: "offline-verifier" },
];
const ROUTES = ONLY ? ROUTES0.filter((r) => r.name === ONLY) : ROUTES0;
const LANGS = ["ja", "zh-HK"];
const SETTLE_MS = Number(process.env.TET_LANG_SETTLE_MS || 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tokens that may stay in Latin script in every language.
const ALLOW = [
  /https?:\/\/\S+/g,
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,
  /\bTET-[0-9A-Z]{4}-[0-9A-Z]{4}\b/g,
  /\b[0-9a-f]{7,}\b/gi,
  /\b[\w-]+\.(?:sig\.json|json|html|pdf|mjs|ts|tsx|rs|md|txt|png|svg)\b/gi,
  /\b(?:v?\d+(?:\.\d+)*)\b/g,
  /\b(?:RISC Zero|Kyber-768|Kyber|Round 3|ML-DSA-44|ML-DSA|ML-KEM|Ed25519|X25519|SHA-256|AES-256-GCM|PBKDF2(?:-SHA-256)?|ChaCha20-Poly1305|FIPS \d+|BIP39|zkVM|libp2p|Next\.js|WebAssembly|WebCrypto|GitHub|Discord|Google Chrome|Hetzner|Let's Encrypt)\b/g,
  /\b(?:TET|ID|IDs|DM|DMs|QR|PDF|URL|HTML|JSON|IP|AI|API|CSP|SRI|UTC|P2P|E2EE|OK|RAM|CPU|TLS|HTTPS?|HSTS|PAE|ZK|TAM1|PIN|Tor|Shelter|TETtalk|TetSearch|English|Tmail|Files|v0\.2)\b/g,
];
/** English prose left in `text`: runs of 2+ Latin words after the allowlist. */
export function englishLeft(text) {
  let s = ` ${text} `;
  for (const re of ALLOW) s = s.replace(re, " ");
  const runs = s.match(/(?:\b[A-Za-z][A-Za-z'’-]+\b[\s,.:;!?()"“”]*){2,}/g) ?? [];
  return runs.map((r) => r.trim()).filter((r) => r.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length >= 2);
}

// What a visitor sees, read in the page.
const READ = `(() => {
  const skip = (el) => !!el.closest('[translate="no"], code, pre, script, style, noscript, option, [aria-hidden="true"], [data-pending-translation]');
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && (r.width > 0 || r.height > 0); };
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode()); ) {
    const el = n.parentElement;
    if (!el || skip(el) || !visible(el)) continue;
    const t = n.textContent.replace(/\\s+/g, " ").trim();
    if (t) out.push(t);
  }
  for (const el of document.querySelectorAll("[title],[aria-label],[placeholder],img[alt]")) {
    if (skip(el)) continue;
    for (const a of ["title", "aria-label", "placeholder", "alt"]) { const v = el.getAttribute(a); if (v && v.trim()) out.push(v.trim()); }
  }
  out.push(document.title);
  const pending = [...document.querySelectorAll("[data-pending-translation]")].length;
  return { texts: out, pending };
})()`;

const port = 9750 + Math.floor(Math.random() * 150);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-lang-"))}`, "--no-first-run", "--no-sandbox", "--lang=en-US", "about:blank"], { stdio: "ignore" });
let failed = 0;
try {
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error("Chrome didn't start");
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const id = nextId++;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;
  await send("Page.enable");
  await send("Runtime.enable");

  const open = async (path, lang) => {
    const [p, hash] = path.split("#");
    const url = `${UI}${p}${p.includes("?") ? "&" : "?"}lang=${encodeURIComponent(lang)}${hash ? `#${hash}` : ""}`;
    await send("Page.navigate", { url: "about:blank" });
    await send("Page.navigate", { url });
    await sleep(SETTLE_MS);
    return evaluate(READ);
  };

  const report = [];
  for (const lang of LANGS) {
    for (const r of ROUTES) {
      const got = await open(r.path, lang);
      if (!got) {
        report.push(`FAIL ${lang} ${r.name}: the page didn't render`);
        failed++;
        continue;
      }
      if (process.env.TET_LANG_DEBUG) console.log(`debug ${lang} ${r.name}: ${got.texts.length} texts; ${got.texts.slice(0, 6).join(" | ").slice(0, 300)}`);
      const left = [...new Set(got.texts.flatMap(englishLeft))];
      if (got.pending && !(r.name === "whitepaper" && lang === "zh-HK")) {
        report.push(`FAIL ${lang} ${r.name}: a pending-translation block outside the listed exception`);
        failed++;
      }
      if (left.length) {
        failed++;
        report.push(`FAIL ${lang} ${r.name}: ${left.length} English\n${left.slice(0, 40).map((x) => `       · ${x}`).join("\n")}`);
      } else {
        report.push(`ok   ${lang} ${r.name}${got.pending ? " (listed exception: the paper's zh-HK translation is pending)" : ""}`);
      }
    }
  }
  console.log(report.join("\n"));

  // Negative control: one injected English sentence on a page that passed.
  await open("/try?tab=home", "ja");
  // Into the page's main content (the shell fills the viewport, so a node after it isn't laid out).
  await evaluate(`(document.querySelector("main") ?? document.body).prepend(Object.assign(document.createElement("p"), { textContent: "This sentence was left in English by mistake." }))`);
  const after = await evaluate(READ);
  if (process.env.TET_LANG_DEBUG) console.log("debug control:", JSON.stringify(await evaluate(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.includes("left in English")); if (!p) return "not found"; const r = p.getBoundingClientRect(); return { w: r.width, h: r.height, d: getComputedStyle(p).display, skip: !!p.closest('[translate="no"], [aria-hidden="true"]'), parent: p.parentElement.tagName }; })()`)), after?.texts?.length);
  const injected = (after?.texts ?? []).flatMap(englishLeft);
  const caught = injected.some((x) => x.includes("sentence was left in"));
  console.log(`${caught ? "ok  " : "FAIL"} control: an injected English sentence is caught`);
  if (!caught) failed++;
  ws.close();
} finally {
  chrome.kill();
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
