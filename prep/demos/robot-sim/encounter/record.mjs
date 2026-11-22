// Records the encounter page: a 60-second video and six stills, in a headless Chromium with a fresh
// profile. The page is opened from the file system; every request that is not a file is refused.
// It installs nothing: it uses a playwright-core already on the machine and that one's cached Chromium.
// Run demo.py first (it writes data.js).
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node prep/demos/robot-sim/encounter/record.mjs OUT_DIR
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pwPath = process.env.PLAYWRIGHT_CORE;
if (!pwPath) throw new Error("set PLAYWRIGHT_CORE to a playwright-core folder");
const { chromium } = createRequire(import.meta.url)(pwPath);
if (!process.argv[2]) throw new Error("give an output folder");
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const W = 1440, H = 960, LEN = 60;
const run = fs.mkdtempSync(path.join(os.tmpdir(), "encounter-rec-"));
const ctx = await chromium.launchPersistentContext(path.join(run, "profile"), {
  headless: true, viewport: { width: W, height: H }, recordVideo: { dir: path.join(run, "video"), size: { width: W, height: H } },
});
await ctx.route("**/*", (r) => (r.request().url().startsWith("file:") ? r.continue() : r.abort()));
const page = ctx.pages()[0] || (await ctx.newPage());
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(pathToFileURL(path.join(here, "page.html")).href);
await page.waitForFunction(() => window.demo, null, { timeout: 20000 });
const t0 = Date.now();
const at = async (s) => { const ms = s * 1000 - (Date.now() - t0); if (ms > 0) await page.waitForTimeout(ms); };
const shot = (n, name) => page.screenshot({ path: path.join(out, `encounter-${n}-${name}.jpg`), type: "jpeg", quality: 85 });
const show = (k) => page.evaluate((k) => demo.show(k), k);
const seek = (t) => page.evaluate((t) => demo.seek(t), t);

await at(1); await page.evaluate(() => demo.play());   // 60 s of flight in about 24 s
await at(26); await seek(27); await shot(1, "both-logs-agree");
await at(28); await show("removed");
await at(30); await shot(2, "removed-from-A-shown-by-B");
await at(34); await show("altitude");
await at(36); await shot(3, "altitude-edited-refused-by-counter-signature");
await at(40); await show("replay");
await at(42); await shot(4, "recorded-twice-refused");
await at(45); await show("forged");
await at(47); await shot(5, "forged-with-third-key-refused");
await at(50); await show("removed-one-log");
await at(52); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await at(54); await shot(6, "one-log-only-and-what-this-does-not-show");
await at(58); await page.evaluate(() => window.scrollTo(0, 0)); await show("honest");
await at(LEN);
const video = page.video();
await ctx.close();
fs.copyFileSync(await video.path(), path.join(out, "demo-encounter-60s.webm"));
fs.rmSync(run, { recursive: true, force: true });
if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exit(1); }
console.log(`wrote ${out}: demo-encounter-60s.webm and six stills; recorded ${((Date.now() - t0) / 1000).toFixed(0)} s`);
