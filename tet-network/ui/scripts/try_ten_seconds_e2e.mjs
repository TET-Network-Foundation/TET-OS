// Is "prove it in 10 seconds" true? Times the headline flow in a real, throttled browser.
// Not a CI step: it needs Chrome, a running node and the UI.
//
//   TET_TRY_ORIGIN=http://127.0.0.1:3200 node scripts/try_ten_seconds_e2e.mjs
//
// For each profile, three runs of:
//   mark   — a file is picked → 本物として記録 is pressed → the proof code is on screen;
//   verify — the code is typed into the home search → submitted → the green result is on screen.
// Page loads are timed separately. Times are machine time only: a person's own reading and clicking
// comes on top, so the claim needs margin. The headline's "10 seconds" holds only if every run on
// the "laptop" profile has mark + verify under LIMIT_MS; otherwise this exits 1 with the real numbers.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3200").replace(/\/+$/, "");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** Machine time allowed for mark + verify, leaving ~3 s of the 10 for a person's clicks. */
const LIMIT_MS = 7000;
const PROFILES = [
  // A normal laptop: about half this machine's speed; Lighthouse's desktop network (40 ms, 10 Mbit/s).
  { name: "laptop", cpu: 2, rttMs: 40, downKbps: 10_000, upKbps: 10_000, decides: true },
  // The same laptop in Japan using the demo node in Germany (~250 ms round trip): deciding too.
  { name: "laptop JP→DE", cpu: 2, rttMs: 250, downKbps: 10_000, upKbps: 10_000, decides: true },
  // A slower, older laptop on a weaker connection: reported, not deciding.
  { name: "slower laptop", cpu: 4, rttMs: 80, downKbps: 5_000, upKbps: 2_000, decides: false },
];
const RUNS = 3;

const dir = mkdtempSync(join(tmpdir(), "tet10s-"));
const file = join(dir, "photo.jpg");
writeFileSync(file, randomBytes(5 * 1024 * 1024)); // a 5 MB "photo"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

let failed = false;
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
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
      if (m.error) reject(new Error(`${method}: ${m.error.message}`));
      else resolve(m);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const step = (s) => process.env.TET_DEBUG && console.log(`  · ${s}`);
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (pred, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(`(() => { try { return !!(${pred}); } catch { return false; } })()`)) return;
      await sleep(25);
    }
    const page = String(await evaluate("document.querySelector('main')?.innerText ?? document.body.innerText")).slice(0, 700).replace(/\n+/g, " | ");
    throw new Error(`timed out waiting for ${what}. The page shows: ${page}`);
  };
  const clickText = (re) =>
    evaluate(`(() => { const b=[...document.querySelectorAll('button,a,label')].filter(x=>x.offsetParent!==null).find(x=>${re}.test(x.textContent.trim())); if(!b) return false; b.click(); return true; })()`);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Network.enable");

  const results = [];
  for (const p of PROFILES) {
    await send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
    await send("Network.emulateNetworkConditions", {
      offline: false,
      latency: p.rttMs,
      downloadThroughput: (p.downKbps * 1000) / 8,
      uploadThroughput: (p.upKbps * 1000) / 8,
    });
    for (let run = 1; run <= RUNS; run++) {
      // ── mark ──
      await send("Page.navigate", { url: "about:blank" });
      let t = Date.now();
      await send("Page.navigate", { url: `${ORIGIN}/try?lang=ja&tab=genuine` });
      // Interactive, not just painted: the server-rendered input exists before React hydrates it,
      // and a change event before hydration is lost (no person picks a file that fast).
      await until(`[...document.querySelectorAll('main section')].some(x => x.offsetParent !== null && (i => i && Object.keys(i).some(k => k.startsWith('__reactProps')))(x.querySelector('input[type=file]')))`, 60000, "the mark page, interactive");
      const loadMark = Date.now() - t;
      // The first paint shows a copy of the panel that the full page then replaces (~0.7 s on this
      // profile): wait until the panel on screen has stayed the same for 1 s. Not counted — a person
      // needs longer than that to open the file dialog.
      await evaluate(`void (window.__t10 = null)`);
      for (let stable = 0; stable < 1000; ) {
        const same = await evaluate(`(() => { const i=[...document.querySelectorAll('main section')].find(x => x.offsetParent !== null)?.querySelector('input[type=file]'); const same = !!i && i === window.__t10; window.__t10 = i; return same; })()`);
        stable = same ? stable + 100 : 0;
        await sleep(100);
      }
      step("mark page loaded");
      const doc = (await send("DOM.getDocument", { depth: 0 })).result.root.nodeId;
      // Hidden panels stay mounted: tag the file input of the panel on screen.
      await evaluate(`(() => { const s=[...document.querySelectorAll('main section')].find(x => x.offsetParent !== null); s.querySelector('input[type=file]').setAttribute('data-t10', '1'); })()`);
      const input = (await send("DOM.querySelector", { nodeId: doc, selector: "[data-t10]" })).result.nodeId;
      t = Date.now(); // the file is picked
      step(`file input node ${input}`);
      await send("DOM.setFileInputFiles", { nodeId: input, files: [file] });
      // A real pick fires "change"; setFileInputFiles alone doesn't reach React's handler here.
      await evaluate(`document.querySelector('[data-t10]').dispatchEvent(new Event('change', { bubbles: true }))`);
      step("file set");
      await until(`/photo\\.jpg/.test(document.querySelector('main').innerText) && [...document.querySelectorAll('main button')].some(b => /^本物として記録$/.test(b.textContent.trim()) && !b.disabled)`, 30000, "the file and the mark button");
      await clickText(/^本物として記録$/);
      await until(`/TET-[0-9A-Z]{4}-[0-9A-Z]{4}/.test(document.querySelector('main').innerText)`, 120000, "the proof code");
      const mark = Date.now() - t;
      const code = await evaluate(`document.querySelector('main').innerText.match(/TET-[0-9A-Z]{4}-[0-9A-Z]{4}/)[0]`);

      // ── verify ──
      await send("Page.navigate", { url: "about:blank" });
      t = Date.now();
      await send("Page.navigate", { url: `${ORIGIN}/try?lang=ja` });
      await until(`(i => i && Object.keys(i).some(k => k.startsWith('__reactProps')))(document.querySelector('main [role=search] input'))`, 60000, "home, interactive");
      const loadHome = Date.now() - t;
      await evaluate(`(() => { const i=document.querySelector('main [role=search] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, ${JSON.stringify(code)}); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      t = Date.now(); // the search is submitted
      await evaluate(`document.querySelector('main [role=search]').requestSubmit ? document.querySelector('main [role=search]').requestSubmit() : document.querySelector('main [role=search] button').click()`);
      await until(`/本物として記録されています/.test(document.querySelector('main').innerText) && document.querySelector('main').innerText.includes(${JSON.stringify(code)})`, 60000, "the verify result");
      const verify = Date.now() - t;
      results.push({ profile: p.name, decides: p.decides, run, mark, verify, total: mark + verify, loadMark, loadHome });
      console.log(`${p.name.padEnd(14)} run ${run}: mark ${(mark / 1000).toFixed(1)} s · verify ${(verify / 1000).toFixed(1)} s · total ${((mark + verify) / 1000).toFixed(1)} s   (page loads: mark ${(loadMark / 1000).toFixed(1)} s, home ${(loadHome / 1000).toFixed(1)} s)`);
    }
  }
  const deciding = results.filter((r) => r.decides);
  const worst = Math.max(...deciding.map((r) => r.total));
  console.log(`\nlaptop profiles, worst mark + verify: ${(worst / 1000).toFixed(1)} s (limit ${LIMIT_MS / 1000} s of machine time)`);
  if (worst > LIMIT_MS) {
    failed = true;
    console.log(`FAIL: "10 seconds" is not supported on the laptop profile: report ${(worst / 1000).toFixed(1)} s instead.`);
  } else {
    console.log("ok: \"10 seconds\" holds on the laptop profiles, with time left for a person's clicks.");
  }
} finally {
  chrome.kill("SIGKILL");
}
process.exit(failed ? 1 : 0);
