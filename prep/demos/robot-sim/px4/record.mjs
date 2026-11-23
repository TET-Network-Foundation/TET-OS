// Records the PX4 replay page: a 90-second video and six stills, in a headless Chromium with a fresh
// profile. Every request that is not to 127.0.0.1 is refused. It installs nothing: it uses a
// playwright-core already on the machine and that one's cached full Chromium (three.js r187 needs WebGL2,
// which the headless shell's software GL refused here; the full Chromium draws it with SwiftShader).
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core TET_CLI=/path/to/tet-cli \
//     [PX4DEMO_ULOG=PX4_LOG.ulg] node prep/demos/robot-sim/px4/record.mjs OUT_DIR [contact.json]
//
// With PX4DEMO_ULOG (a log PX4 SITL wrote while flying fly_px4.py's mission) the files are named
// px4-real-*, the camera follows that mission, and the page shows PX4's log; without it, the stand-in.
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
const out = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("give an output folder");
fs.mkdirSync(out, { recursive: true });
const PORT = Number(process.env.PX4DEMO_PORT || 8799);
const W = 1280, H = 900, LEN = 90;
const run = fs.mkdtempSync(path.join(os.tmpdir(), "px4demo-rec-"));
const work = path.join(run, "work");
fs.mkdirSync(work);
if (process.argv[3]) fs.copyFileSync(process.argv[3], path.join(work, "contact.json"));

const ULOG = process.env.PX4DEMO_ULOG || "";
const PREFIX = ULOG ? "px4-real" : "px4";
const server = spawn("python3", ["-u", path.join(here, "demo.py"), "--work", work, "--port", String(PORT)].concat(ULOG ? ["--ulog", path.resolve(ULOG)] : []),
  { stdio: ["ignore", "pipe", "inherit"], env: process.env });
process.on("exit", () => server.kill("SIGINT"));
await new Promise((ok, no) => {
  server.stdout.on("data", (b) => String(b).includes("http://127.0.0.1") && ok());
  server.on("exit", (c) => no(new Error(`server exited ${c}`)));
});

const ctx = await chromium.launchPersistentContext(path.join(run, "profile"), {
  headless: true, channel: "chromium", args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  viewport: { width: W, height: H }, recordVideo: { dir: path.join(run, "video"), size: { width: W, height: H } },
});
await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort()));
const page = ctx.pages()[0] || (await ctx.newPage());
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`http://127.0.0.1:${PORT}/`);
const t0 = Date.now();
const at = async (s) => { const ms = s * 1000 - (Date.now() - t0); if (ms > 0) await page.waitForTimeout(ms); };
const shot = (n, name) => page.screenshot({ path: path.join(out, `${PREFIX}-${n}-${name}.jpg`), type: "jpeg", quality: 85 });
// camera views: [overview start, peak close-up, top view of the fence exit, 3D view of the refused chunks]
const V = ULOG
  ? { over: (s) => [-150 + s * 4, 140, 150 - s * 3, -20, 50, -10], peak: [-30, 150, 40, 40, 120, -40],
      top: [-27, 260, 40, -27, 0, -20], chunks: [-190, 110, 110, -40, 60, -20], home: [-150, 140, 150, -20, 50, -10] }
  : { over: (s) => [-190 + s * 6, 150, 190 - s * 4, 0, 40, 0], peak: [-60, 135, 20, 59, 115, -85],
      top: [-40, 330, -20, -40, 0, -60], chunks: [-170, 80, 120, -60, 40, -60], home: [-190, 150, 190, 0, 40, 0] };
const cam = (x, y, z, tx, ty, tz) => page.evaluate(([x, y, z, tx, ty, tz]) => { demo.camera.position.set(x, y, z); demo.controls.target.set(tx, ty, tz); }, [x, y, z, tx, ty, tz]);
// a tamper or a reset re-checks the whole copy (about 3 s on PX4's 45 MB log): wait for its verdict
const verdict = (v) => page.waitForFunction((v) => document.getElementById("verdict").textContent === v, v, { timeout: 30000 });
const frac = (f) => page.evaluate((f) => demo.frac(f), f);
const peakFrac = () => page.evaluate(() => { const t = demo.track; let k = 0; t.forEach((p, i) => { if (p.alt > t[k].alt) k = i; }); return k / (t.length - 1); });
const exitFrac = () => page.evaluate(() => { const t = demo.track; const k = t.findIndex((p) => p.y < -75); return k / (t.length - 1); });
await page.waitForFunction(() => window.demo && demo.track.length > 0, null, { timeout: 60000 });

await at(2); await page.click("#play");
for (let s = 3; s <= 20; s++) { await at(s); await cam(...V.over(s)); }
await at(21); await page.click("#play").catch(() => {});
const pk = await peakFrac();
await frac(pk); await cam(...V.peak);
await at(23); await shot(1, "flight-checked-peak-above-ceiling");
await at(28); await page.click("#t-near"); await verdict("INVALID");
await at(31); await shot(2, "near-miss-altitude-lowered-refused");
await at(38); await page.click("#t-reset"); await verdict("VALID");
const ex = await exitFrac();
await frac(ex); await cam(...V.top);
await at(41); await shot(3, "top-view-geofence-exit-checked");
await at(46); await page.click("#t-fence"); await verdict("INVALID");
await at(49); await shot(4, "geofence-exit-moved-inside-refused");
await at(55); await cam(...V.chunks);
await at(57); await shot(5, "refused-chunks-in-3d");
await at(62); await page.click("#t-reset"); await verdict("VALID");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await at(65); await shot(6, "what-this-does-not-show-and-contact");
await at(70); await page.evaluate(() => window.scrollTo(0, 0));
await frac(0); await cam(...V.home); await page.click("#play");
await at(LEN);
const video = page.video();
await ctx.close();
fs.copyFileSync(await video.path(), path.join(out, ULOG ? "px4-real-90s.webm" : "demo-px4-90s.webm"));
server.kill("SIGINT");
fs.rmSync(run, { recursive: true, force: true });
if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exit(1); }
console.log(`wrote ${out}: ${PREFIX} video and six stills; recorded ${((Date.now() - t0) / 1000).toFixed(0)} s`);
