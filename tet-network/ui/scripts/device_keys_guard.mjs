// Guard: keys on the device (docs/THREAT_MODEL.md rule 7).
//
//   node --experimental-strip-types scripts/device_keys_guard.mjs
//
// 1. A weak device password is refused before anything is stored: common ones, one repeated
//    character, runs like "abcdefgh", and short ones without three kinds of character. Reasonable
//    ones (a few words; 12+ characters; mixed short ones) are accepted.
// 2. Auto-lock: only an ID this device remembers, and only after 15 minutes without input.
// 3. The provider wires it: it listens for input and calls forget() when shouldAutoLock says so.
// Negative controls (run by hand, recorded in the commit): passphraseProblem always null → 1 FAILED;
// shouldAutoLock ignoring `lockable` → 2 FAILED.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
const ds = await import("../app/lib/device_store.ts");
const src = readFileSync(new URL("../app/try/wallet.tsx", import.meta.url), "utf8");
// shouldAutoLock is pure: evaluate it from the source, so this guard needn't load React.
const AUTO_LOCK_MS = Number(/AUTO_LOCK_MS = ([\d_ *]+);/.exec(src)[1].replace(/_/g, "").split("*").reduce((a, b) => a * Number(b), 1));
const body = /export function shouldAutoLock\(o: \{ lockable: boolean; idleMs: number \}\): boolean \{\n([\s\S]*?)\n\}/.exec(src)[1];
const shouldAutoLock = new Function("o", "AUTO_LOCK_MS", body);

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}
check("SECURITY: weak device passwords are refused; reasonable ones accepted", () => {
  for (const weak of ["short", "password123", "Password!", "aaaaaaaaaaaa", "abcdefghij", "12345678", "qwertyuiop", "aaaabbbb", "shortone", "tetnetwork2026"]) {
    assert.notEqual(ds.passphraseProblem(weak), null, `accepted: ${weak}`);
  }
  for (const ok of ["correct horse battery", "Tq9!vmZ2", "blue river 47 lantern", "sakura-tsuki-2026"]) {
    assert.equal(ds.passphraseProblem(ok), null, `refused: ${ok}`);
  }
});
check("auto-lock: only a remembered ID, only after 15 minutes idle", () => {
  assert.equal(AUTO_LOCK_MS, 15 * 60_000);
  assert.equal(shouldAutoLock({ lockable: true, idleMs: 15 * 60_000 }, AUTO_LOCK_MS), true);
  assert.equal(shouldAutoLock({ lockable: true, idleMs: 14 * 60_000 }, AUTO_LOCK_MS), false);
  assert.equal(shouldAutoLock({ lockable: false, idleMs: 60 * 60_000 }, AUTO_LOCK_MS), false, "an unsaved ID would be lost");
});
check("the provider listens for input and locks with forget()", () => {
  assert.match(src, /addEventListener\(e, seen/);
  assert.match(src, /if \(shouldAutoLock\(\{ lockable: lockable\.current, idleMs: Date\.now\(\) - last \}\)\) forget\(\);/);
  const cont = readFileSync(new URL("../app/try/ContinueBlock.tsx", import.meta.url), "utf8");
  assert.equal((cont.match(/noteRemembered\(\);/g) ?? []).length, 2, "noteRemembered after open and after remember");
});
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
