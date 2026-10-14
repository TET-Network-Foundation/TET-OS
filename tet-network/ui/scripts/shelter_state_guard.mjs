// Guard: the Shelter tab says "not open" only when the node says Shelter is off. A busy node (429,
// 503), a node that doesn't answer and an answer that isn't JSON are temporary and say so; an error
// from a 429 reads "this node is busy", not "HTTP 429". Runs the page's own module
// (`app/lib/shelter_state.ts`) and reads ShelterPanel.tsx.
//
//   node --experimental-strip-types scripts/shelter_state_guard.mjs
//
// Controls: the old check (`r.ok && on === true`, else closed) → FAILED (a 429 reads as closed);
// a panel that shows "isn't open" for any state but "closed" → FAILED.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
const { shelterState, isBusyError } = await import("../app/lib/shelter_state.ts");

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

const answer = (status, body) => async () => new Response(body, { status, headers: { "content-type": "application/json" } });
const CASES = [
  ["on", answer(200, '{"ok":true,"on":true}'), "open"],
  ["off", answer(200, '{"ok":true,"on":false}'), "closed"],
  ["429 from the node", answer(429, "this node is busy; try again in a moment"), "busy"],
  ["429 from the gate", answer(429, "rate limit exceeded for this address"), "busy"],
  ["503", answer(503, ""), "busy"],
  ["500", answer(500, ""), "unreachable"],
  ["not JSON", answer(200, "<html>"), "unreachable"],
  ["no answer", async () => { throw new TypeError("fetch failed"); }, "unreachable"],
];

async function statesOf(fn) {
  const out = {};
  for (const [name, f, want] of CASES) out[name] = { got: await fn("http://node", f), want };
  return out;
}
function assertStates(states) {
  for (const [name, { got, want }] of Object.entries(states)) assert.equal(got, want, `${name}: got ${got}, want ${want}`);
}

await check("each answer from /shelter/status maps to its state", async () => assertStates(await statesOf(shelterState)));

await check("control: the old open-or-closed check reads a 429 as closed", async () => {
  const old = async (base, f) => {
    try {
      const r = await f(`${base}/shelter/status`);
      return r.ok && (await r.json())?.on === true ? "open" : "closed";
    } catch {
      return "closed";
    }
  };
  const states = await statesOf(old);
  assert.throws(() => assertStates(states), /got closed, want (busy|unreachable)/);
});

await check("a refusal for load reads as busy; other errors don't", () => {
  for (const m of ["HTTP 429", "rate limit exceeded for this address", "this node is busy; try again in a moment"]) assert.ok(isBusyError(m), m);
  for (const m of ["not a member", "HTTP 403", "HTTP 4290", "bad signature"]) assert.ok(!isBusyError(m), m);
});

const panel = readFileSync(new URL("../app/try/ShelterPanel.tsx", import.meta.url), "utf8");
function notOpenOnlyWhenClosed(src) {
  const lines = src.split("\n").filter((l) => l.includes(`t("Shelter isn't open on this node.")`));
  assert.ok(lines.length >= 1, "the closed message is still there");
  for (const l of lines) assert.match(l, /open === "closed"/, `"isn't open" shown outside the closed state: ${l.trim()}`);
  assert.match(src, /isBusyError\(err\)/, "the panel's error line translates a busy refusal");
}
await check("the panel shows \"isn't open\" only for the closed state", () => notOpenOnlyWhenClosed(panel));
await check("control: \"isn't open\" for any other state is caught", () => {
  const bad = panel.replace(`open === "closed"`, `open !== "open"`);
  assert.throws(() => notOpenOnlyWhenClosed(bad));
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
