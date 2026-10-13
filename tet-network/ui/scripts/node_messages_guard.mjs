// The node's plain refusals that the page shows (tet-core/src/tmail/envelope.rs, SentAtRefusal::
// message) are translated, word for word, in ja and zh-HK, and the page shows the message, not the
// JSON around it. Control: a node message the dictionaries don't have → FAILED.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plainNodeError } from "../app/lib/node_error.mjs";
const { JA } = await import("../app/try/i18n_ja.ts");
const { ZH_HK } = await import("../app/try/i18n_zh_hk.ts");

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split("\n")[0]}`);
  }
};
const src = readFileSync(new URL("../../../tet-core/src/tmail/envelope.rs", import.meta.url), "utf8");
const block = src.slice(src.indexOf("pub fn message(self)"), src.indexOf("pub fn check_sent_at"));
const messages = [...block.matchAll(/=> "([^"]+)"/g)].map((m) => m[1]);
const missing = (msgs) => msgs.flatMap((m) => [JA[m] ? null : `ja: ${m}`, ZH_HK[m] ? null : `zh-HK: ${m}`]).filter(Boolean);

check("the node's clock refusals are found", () => assert.ok(messages.length >= 2, `${messages.length}`));
check("each is translated in ja and zh-HK", () => assert.deepEqual(missing(messages), []));
check("control: a node message the dictionaries lack FAILS", () => assert.ok(missing([...messages, "a new refusal nobody translated"]).length > 0));
check("the page shows the message, not the JSON", () => {
  assert.equal(plainNodeError(JSON.stringify({ ok: false, error: messages[0], clock: true })), messages[0]);
  assert.equal(plainNodeError("plain text"), "plain text");
});
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
