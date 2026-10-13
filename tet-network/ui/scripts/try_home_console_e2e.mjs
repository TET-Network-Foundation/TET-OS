// Home loads with zero console errors — against a fresh node, and against a stopped one.
// Not a CI step: it needs Chrome and running UIs.
//
//   TET_HOME_CHECK="fresh=http://127.0.0.1:3301,stopped=http://127.0.0.1:3302" node scripts/try_home_console_e2e.mjs
//
// Each origin is a `next start` of this build whose TET_CORE_ORIGIN points at the node in question
// (a node with an empty database; a port where nothing listens). For each, in ja and en:
//   1. open home and stay 10 s (long enough for any polling to fire);
//   2. open DM, then go back home and stay 10 s (a hidden DM panel must not poll from home).
// Fails on any console.error or uncaught exception. The browser's own network messages (a 502 from
// the proxy when the node is down) are listed separately: page code can't stop those, so they don't
// fail the check, but they are reported.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TARGETS = (process.env.TET_HOME_CHECK || "default=http://127.0.0.1:3200")
  .split(",")
  .map((x) => x.split("="))
  .map(([name, url]) => ({ name, url: url.replace(/\/+$/, "") }));
const STAY_MS = 10_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9600 + Math.floor(Math.random() * 150);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

let failed = 0;
try {
  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 1;
  const pending = new Map();
  let errors = [];
  let network = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview ?? "")).join(" ").slice(0, 300));
    }
    if (m.method === "Runtime.exceptionThrown") {
      errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      (m.params.entry.source === "network" ? network : errors).push(`${m.params.entry.source}: ${m.params.entry.text.slice(0, 160)} ${m.params.entry.url ?? ""}`.trim());
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`no answer to ${method} within 30 s`));
    }, 30_000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onclose = () => console.log("(the browser connection closed)");
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  for (const target of TARGETS) {
    for (const lang of ["ja", "en"]) {
      for (const scenario of ["home", "DM then home"]) {
        await send("Page.navigate", { url: "about:blank" });
        await sleep(300);
        errors = [];
        network = [];
        if (scenario === "home") {
          await send("Page.navigate", { url: `${target.url}/try?lang=${lang}` });
        } else {
          await send("Page.navigate", { url: `${target.url}/try?lang=${lang}&tab=mail` });
          await sleep(4000);
          errors = []; // only what happens once home is on screen counts here
          network = [];
          // Back home the way a visitor does: the logo / "TET" crumb.
          await evaluate(`(() => { const a=[...document.querySelectorAll('a,button')].find(x => x.offsetParent !== null && /^TET$/.test(x.textContent.trim())); if (a) a.click(); return !!a; })()`);
        }
        await sleep(STAY_MS);
        const onHome = await evaluate(`!!document.querySelector('main [role=search] input') && document.querySelector('main [role=search] input').offsetParent !== null`);
        const label = `${target.name.padEnd(8)} ${lang} ${scenario.padEnd(13)}`;
        if (!onHome) {
          failed++;
          console.log(`FAIL ${label} home isn't on screen`);
        } else if (errors.length) {
          failed++;
          console.log(`FAIL ${label} ${errors.length} console error(s):\n     ${errors.join("\n     ")}`);
        } else {
          console.log(`ok   ${label} 0 console errors${network.length ? ` (browser network messages: ${network.length}, e.g. ${network[0]})` : ""}`);
        }
      }
    }
  }
} finally {
  chrome.kill("SIGKILL");
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
