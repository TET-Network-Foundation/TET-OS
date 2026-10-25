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
 */
import { readFileSync } from "node:fs";
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
const files = ["../app/try/page.tsx", "../app/lib/disposable_wallet.mjs", "../app/lib/try_session.ts"];
const banned = ["/wallet/mnemonic", "localStorage", "sessionStorage", "indexedDB", "document.cookie"];
for (const f of files) {
  const src = readFileSync(resolve(here, f), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // comments may explain what is not done
    .join("\n");
  const hits = banned.filter((b) => src.includes(b));
  check(`SECURITY: ${f.replace("../", "")} names no mnemonic route or browser storage`, hits.length === 0, hits.join(", "));
}

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
