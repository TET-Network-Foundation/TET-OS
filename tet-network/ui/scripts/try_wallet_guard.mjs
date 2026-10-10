/**
 * Guards for the Try TET disposable wallet (app/lib/disposable_wallet.mjs, app/try/page.tsx).
 * Plain Node: `node scripts/try_wallet_guard.mjs`. CI runs it in the ui job.
 *
 * 1. SECURITY REGRESSION GUARD: making a wallet touches no network and no storage. fetch,
 *    XMLHttpRequest, WebSocket, localStorage, sessionStorage, indexedDB and document.cookie are
 *    replaced with recorders before the module loads; generating words, deriving the id and building
 *    the download text must record nothing.
 *    Negative control: the module calls localStorage.setItem → FAILED.
 * 2. SECURITY REGRESSION GUARD: the page and its wallet code never name tet-core's server-side
 *    mnemonic routes or browser storage (a source check; the demo node also refuses those routes).
 *    Negative control: the page fetches /wallet/mnemonic/new → FAILED.
 * 3. The wallet id is the one tet-core derives: the "abandon … about" phrase must give the
 *    agent_wallet_id that tet-core asserts in `agent_payload_envelopes_match_the_rust_signer`.
 * 4. SECURITY REGRESSION GUARD: messaging keys are published only when the visitor acts (publishing
 *    is public): when this tab's wallet is made or opened (founder decision 2026-10-10: every
 *    named poster is reachable), or from a "Publish keys" tap. Every `ensureMessagingKeys()` call
 *    in app/try sits in an `onPublish` handler, and wallet.tsx calls `publishInbox` only inside
 *    `ensureWallet` and `openWithWords`, never from an effect, and only with a v2 registration.
 *    Controls: a call in an effect, in a send handler, or bare; publishInbox from an effect → FAILED.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

// ---- 1. no network, no storage --------------------------------------------------------------
const touched = [];
const recorder = (what) => (...args) => {
  touched.push(`${what}(${String(args[0] ?? "").slice(0, 60)})`);
  throw new Error(`${what} is not allowed here`);
};
const storage = (name) =>
  new Proxy({}, { get: (_t, prop) => (typeof prop === "string" ? recorder(`${name}.${prop}`) : undefined) });
globalThis.fetch = recorder("fetch");
globalThis.XMLHttpRequest = function () { recorder("XMLHttpRequest")(); };
globalThis.WebSocket = function () { recorder("WebSocket")(); };
Object.defineProperty(globalThis, "localStorage", { value: storage("localStorage"), configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: storage("sessionStorage"), configurable: true });
Object.defineProperty(globalThis, "indexedDB", { value: storage("indexedDB"), configurable: true });
globalThis.document = {
  get cookie() { touched.push("document.cookie(read)"); return ""; },
  set cookie(v) { touched.push(`document.cookie(write ${String(v).slice(0, 30)})`); },
};

const w = await import("../app/lib/disposable_wallet.mjs");
let a, b, id;
try {
  a = w.generateDisposableWords();
  b = w.generateDisposableWords();
  id = w.walletIdFromWords(a);
  w.wordsFileText(a, id);
} catch (e) {
  touched.push(`threw: ${e.message}`);
}
check("SECURITY: making a wallet touches no network and no storage", touched.length === 0, touched.join(", "));
check("12 valid words", a?.split(" ").length === 12 && w.wordsAreValid(a));
check("two wallets differ", a !== b);
check("wallet id is 64 hex", /^[0-9a-f]{64}$/.test(id ?? ""));

// ---- 2. source: no mnemonic routes, no storage --------------------------------------------------
// Every file of the try page (the wallet is made in app/try/wallet.tsx), plus its wallet modules.
const tryDir = resolve(here, "../app/try");
const files = [
  ...readdirSync(tryDir)
    .filter((n) => /\.tsx?$/.test(n))
    .map((n) => `../app/try/${n}`),
  "../app/lib/disposable_wallet.mjs",
  "../app/lib/try_session.ts",
];
const banned = ["/wallet/mnemonic", "localStorage", "sessionStorage", "indexedDB", "document.cookie"];
for (const f of files) {
  const src = readFileSync(resolve(here, f), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // comments may explain what is not done
    .join("\n");
  const hits = banned.filter((b) => src.includes(b));
  check(`SECURITY: ${f.replace("../", "")} names no mnemonic route or browser storage`, hits.length === 0, hits.join(", "));
}

// ---- 4. keys are published only on a tap ------------------------------------------------------------
/** The smallest `{…}` or `(…)` handler text around `at`: back to the nearest `onPublish`, or not. */
function publishProblems(sources) {
  const problems = [];
  for (const [f, src] of Object.entries(sources)) {
    if (f === "wallet.tsx") continue; // defines it
    for (const m of src.matchAll(/\bensureMessagingKeys\s*\(/g)) {
      // The call must be inside an `onPublish` prop or function: the nearest handler opener before
      // it, among `onPublish`, `useEffect`, `on[A-Z]\w*` and `function`, must be `onPublish`.
      const before = src.slice(0, m.index);
      const openers = [...before.matchAll(/\b(onPublish|useEffect|on[A-Z]\w*|function\s+\w+)\b/g)];
      const last = (openers.at(-1)?.[1] ?? "").replace(/^function\s+/, "");
      if (last !== "onPublish") problems.push(`${f}: ensureMessagingKeys() outside an onPublish handler (in ${last || "top level"})`);
    }
  }
  return problems;
}
const trySources = Object.fromEntries(
  readdirSync(tryDir)
    .filter((n) => /\.tsx?$/.test(n))
    .map((n) => [n, readFileSync(resolve(tryDir, n), "utf8")]),
);
const pubProblems = publishProblems(trySources);
const pubSites = Object.entries(trySources).filter(([f, s]) => f !== "wallet.tsx" && /\bensureMessagingKeys\s*\(/.test(s)).length;
check("SECURITY: messaging keys are published only from a Publish keys tap", pubProblems.length === 0 && pubSites >= 2, pubProblems.join("; ") || `${pubSites} panels`);
// wallet.tsx: publishInbox only where the wallet is made or opened.
function inboxProblems(src) {
  const problems = [];
  const calls = [...src.matchAll(/\bpublishInbox\(/g)];
  for (const m of calls) {
    const before = src.slice(0, m.index);
    const openers = [...before.matchAll(/\b(const (\w+) = useCallback|useEffect)\b/g)];
    const last = openers.at(-1);
    const where = last?.[2] ?? last?.[1] ?? "top level";
    if (where !== "ensureWallet" && where !== "openWithWords") problems.push(`publishInbox() in ${where}`);
  }
  if (calls.length !== 2) problems.push(`${calls.length} publishInbox calls (expected 2)`);
  if (!/registration\.v !== 2/.test(src)) problems.push("no v2 check");
  return problems;
}
const walletSrc = readFileSync(resolve(tryDir, "wallet.tsx"), "utf8");
const ip = inboxProblems(walletSrc);
check("SECURITY: wallet.tsx publishes the inbox only when the wallet is made or opened", ip.length === 0, ip.join("; "));
check(
  "negative control: publishInbox from an effect FAILS",
  inboxProblems(walletSrc.replace("void publishInbox(w.walletId);\n      return w;", "return w;").replace("const lockable = useRef(false);", "useEffect(() => { void publishInbox(\"x\"); }, []);\n  const lockable = useRef(false);")).length > 0,
);
const controls = {
  "effect.tsx": `useEffect(() => { void ensureMessagingKeys(); }, []);`,
  "send.tsx": `async function onSend() { await ensureWallet(); await ensureMessagingKeys(); }`,
  "named.tsx": `async function onPublishLater() { await ensureMessagingKeys(); }`,
  "bare.tsx": `const x = 1; void ensureMessagingKeys();`,
};
check(
  "control: a publish from an effect, a send handler or top level is caught",
  Object.entries(controls).every(([f, src]) => publishProblems({ [f]: src }).length === 1) &&
    publishProblems({ "ok.tsx": `<KeysBanner onPublish={() => { void ensureMessagingKeys().then(refresh); }} />` }).length === 0,
);

// ---- 3. the id tet-core derives -----------------------------------------------------------------
const fixture = JSON.parse(
  readFileSync(resolve(here, "../../../tet-core/src/testdata/agent_payload_envelopes.json"), "utf8"),
);
const c = fixture.cases[0];
check(
  "wallet id matches tet-core's derivation (agent_payload_envelopes.json)",
  w.walletIdFromWords(c.mnemonic) === c.agent_wallet_id,
  `${w.walletIdFromWords(c.mnemonic).slice(0, 16)}… vs ${c.agent_wallet_id.slice(0, 16)}…`,
);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
