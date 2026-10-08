// Guard for what Try TET remembers on a device (app/lib/device_store.ts).
//
//   node --experimental-strip-types scripts/try_storage_guard.mjs
//
// SECURITY properties (decision 2026-10-08):
// 1. Plain storage holds only the listed UI keys. Control: a writer without the list is caught.
// 2. Remembering the key stores only ciphertext: no stored byte contains the words or the
//    passphrase. Control: a module that stores the words in plain text is caught.
// 3. A wrong passphrase opens nothing; the right one returns exactly the words.
// 4. The KDF can't be weakened: saving below the floor is refused, and a stored record whose
//    iteration count was lowered is refused on open.
// 5. Nothing else /try uses touches browser storage: only device_store.ts names it among the lib
//    modules the page imports (try_wallet_guard already forbids it in app/try itself).

import { register } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

const writes = [];
const mem = new Map();
const localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => {
    writes.push([k, String(v)]);
    mem.set(k, String(v));
  },
  removeItem: (k) => mem.delete(k),
};
globalThis.window = { localStorage };

const ds = await import("../app/lib/device_store.ts");

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

const WORDS = "abandon ability able about above absent absorb abstract absurd abuse access accident";
const PASS = "correct horse battery";

/** Property (1), run against a UI writer. */
function onlyListedKeys(setUi) {
  writes.length = 0;
  setUi("tet.ui.v1.lang", "ja");
  assert.throws(() => setUi("tet.ui.v1.mnemonic", WORDS), /not a UI key/);
  assert.ok(writes.every(([k]) => ds.UI_KEYS.includes(k)), `wrote ${writes.map(([k]) => k).join(", ")}`);
}

await check("SECURITY: plain storage holds only the listed UI keys", () => onlyListedKeys(ds.setUi));
await check("control: a writer without the list is caught", () => {
  const loose = (k, v) => localStorage.setItem(k, v);
  assert.throws(() => onlyListedKeys(loose));
});

/** Property (2): nothing stored contains the words (any of them) or the passphrase. */
function storesOnlyCiphertext() {
  for (const [k, v] of writes) {
    assert.ok(!v.includes(PASS), `${k} holds the passphrase`);
    for (const w of WORDS.split(" ")) assert.ok(!v.toLowerCase().includes(w), `${k} holds the word "${w}"`);
  }
}

await check("SECURITY: remembering the key stores only ciphertext", async () => {
  writes.length = 0;
  await ds.rememberKey(WORDS, PASS);
  assert.ok(writes.some(([k]) => k === ds.VAULT_KEY));
  storesOnlyCiphertext();
  const rec = JSON.parse(mem.get(ds.VAULT_KEY));
  assert.equal(rec.kdf, "PBKDF2-SHA-256");
  assert.ok(rec.iterations >= ds.KDF_ITERATIONS_MIN);
});

await check("control: a module that stores the words in plain text is caught", () => {
  writes.length = 0;
  localStorage.setItem(ds.VAULT_KEY, JSON.stringify({ words: WORDS }));
  assert.throws(() => storesOnlyCiphertext());
});

await check("SECURITY: the right passphrase opens exactly the words; a wrong one opens nothing", async () => {
  await ds.rememberKey(WORDS, PASS);
  assert.equal(await ds.openRememberedKey(PASS), WORDS);
  await assert.rejects(() => ds.openRememberedKey("correct horse battery!"), /Wrong passphrase/);
  await assert.rejects(() => ds.openRememberedKey(""), /Wrong passphrase/);
});

await check("SECURITY: the KDF can't be weakened on save or by editing the stored record", async () => {
  await assert.rejects(() => ds.rememberKey(WORDS, PASS, 1000), /too few/);
  await ds.rememberKey(WORDS, PASS);
  const rec = JSON.parse(mem.get(ds.VAULT_KEY));
  mem.set(ds.VAULT_KEY, JSON.stringify({ ...rec, iterations: 1 }));
  await assert.rejects(() => ds.openRememberedKey(PASS), /too few/);
  await assert.rejects(() => ds.rememberKey(WORDS, "short"), /at least 8/);
});

await check("forget this device removes the key and every UI key", async () => {
  await ds.rememberKey(WORDS, PASS);
  ds.setUi("tet.ui.v1.visited", "1");
  ds.forgetDevice();
  assert.equal(ds.hasRememberedKey(), false);
  assert.equal(ds.getUi("tet.ui.v1.visited"), null);
});

// ── 5. Only device_store names browser storage among /try's lib imports ──────────────────────────
const UI = new URL("../", import.meta.url);
const tryDir = new URL("app/try/", UI);
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function storageUsers(libFiles) {
  return libFiles.filter(([p, src]) => !p.endsWith("device_store.ts") && /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(code(src))).map(([p]) => p);
}
const libs = new Map();
for (const n of readdirSync(tryDir).filter((n) => /\.tsx?$/.test(n))) {
  for (const m of readFileSync(new URL(n, tryDir), "utf8").matchAll(/from "\.\.\/lib\/([a-z_./]+)"/g)) {
    for (const ext of [".ts", ".mjs", ".tsx", ""]) {
      const u = new URL(`app/lib/${m[1]}${ext}`, UI);
      if (existsSync(u) && !u.pathname.endsWith("/")) {
        libs.set(`app/lib/${m[1]}${ext}`, readFileSync(u, "utf8"));
        break;
      }
    }
  }
}
await check(`only device_store.ts touches browser storage among /try's ${libs.size} lib imports`, () => {
  assert.deepEqual(storageUsers([...libs]), []);
});
await check("control: another lib that touches storage is caught", () => {
  assert.deepEqual(storageUsers([["app/lib/x.ts", "localStorage.setItem('k', words)"]]), ["app/lib/x.ts"]);
  assert.deepEqual(storageUsers([["app/lib/y.mjs", "// nothing here persists: no localStorage"]]), [], "a comment counted as use");
});

// ── 6. Drafts are kept only for public boards (commit security review of #70) ───────────────────
/** The board composer must return before writing drafts unless the board is public. */
function draftsGatedOnPublic(src) {
  const writer = src.indexOf('setUi("tet.ui.v1.drafts"');
  assert.ok(writer > 0, "no drafts writer found");
  const gate = src.indexOf("if (!persistDrafts) return;");
  assert.ok(gate > 0 && gate < writer, "drafts are written without the public-board gate");
  assert.match(src, /const persistDrafts = props\.isPublic;/);
}
const boardSrc = readFileSync(new URL("app/try/BoardPanel.tsx", UI), "utf8");
await check("SECURITY: board drafts are kept on the device only for public boards", () => draftsGatedOnPublic(boardSrc));
await check("control: a composer without the gate is caught", () => {
  assert.throws(() => draftsGatedOnPublic(boardSrc.replace("if (!persistDrafts) return;", "")));
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
