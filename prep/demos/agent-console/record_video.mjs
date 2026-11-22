// Records demo.webm (about 60 s) and six stills (1100 px wide) of the agent console.
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core TET_CLI=/path/to/tet-cli \
//     node prep/demos/agent-console/record_video.mjs
// A headless Chromium with a fresh profile; every request not to 127.0.0.1 is refused. Installs nothing.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pwPath = process.env.PLAYWRIGHT_CORE;
if (!pwPath) throw new Error("set PLAYWRIGHT_CORE to a playwright-core folder");
const { chromium } = createRequire(import.meta.url)(pwPath);

const PORT = Number(process.env.CONSOLE_PORT || 8796);
const W = 1100, H = 820;
const run = fs.mkdtempSync(path.join(os.tmpdir(), "agent-console-video-"));
const stills = path.join(here, "stills");
fs.mkdirSync(stills, { recursive: true });

const server = spawn("python3", [path.join(here, "console.py"), "--work", path.join(run, "work"), "--port", String(PORT)],
  { stdio: ["ignore", "pipe", "inherit"], env: process.env });
await new Promise((ok, no) => {
  server.stdout.on("data", (b) => String(b).includes("open http") && ok());
  server.on("exit", (c) => no(new Error(`server exited ${c}`)));
});

const ctx = await chromium.launchPersistentContext(path.join(run, "profile"), {
  headless: true, viewport: { width: W, height: H }, recordVideo: { dir: path.join(run, "video"), size: { width: W, height: H } },
});
await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort()));
const page = ctx.pages()[0] || (await ctx.newPage());
const t0 = Date.now();
const at = async (s) => { const ms = s * 1000 - (Date.now() - t0); if (ms > 0) await page.waitForTimeout(ms); };
const shot = (n, name) => page.screenshot({ path: path.join(stills, `${n}-${name}.jpg`), type: "jpeg", quality: 85 });
const show = (sel) => page.locator(sel).scrollIntoViewIfNeeded();
const verdict = (text) => page.waitForFunction((t) => (document.querySelector("#c-out .verdict") || {}).textContent?.includes(t), text, { timeout: 30000 });

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForSelector("#agents tr");
await at(5); await shot(1, "my-agents");
await at(7); await show("#h2");
await page.selectOption("#g-agent", "reporter");
await page.selectOption("#g-action", "send-report");
await page.fill("#g-count", "3");
await at(10); await page.locator("#grant button[type=submit]").click();
await page.waitForSelector("#g-out:not([hidden])");
await show("#g-permit"); await at(14); await shot(2, "permit-signed-by-the-device");
await at(17); await show("#h1");
await page.getByRole("button", { name: "Use send-report once" }).click();
await at(21); await show("#h3");
await page.selectOption("#c-log", "rover"); await page.selectOption("#c-key", "rover");
await page.locator("#b-check").click(); await verdict("Checks out");
await at(25); await shot(3, "outside-check-passes");
await at(28); await page.locator("#b-overuse").click(); await verdict("Refused");
await show("#c-out"); await at(32); await shot(4, "permit-used-once-too-often-refused");
await at(35); await page.locator("#b-alter").click(); await verdict("Refused");
await at(39); await page.locator("#b-swapkey").click(); await verdict("Refused");
await show("#c-out"); await at(43); await shot(5, "another-key-refused");
await at(46); await page.locator("#l-ja").click(); await show("#h1");
await at(50); await shot(6, "japanese");
await at(53); await show("#h4");
await at(58); await page.locator("#l-en").click();
await at(61);
const video = page.video();
await ctx.close();
fs.copyFileSync(await video.path(), path.join(here, "demo.webm"));
server.kill("SIGINT");
fs.rmSync(run, { recursive: true, force: true });
console.log(`demo.webm and 6 stills written; ${Math.round((Date.now() - t0) / 1000)} s`);
