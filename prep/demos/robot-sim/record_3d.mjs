// Records the 3D view of the demo page: demo-3d-<vehicle>.webm (90 s) and six stills
// stills/3d-<vehicle>-N-*.jpg, in a headless Chromium with its own fresh profile. Every request that
// is not to 127.0.0.1 is refused, so the page cannot reach anything else.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core TET_CLI=/path/to/tet-cli \
//     node prep/demos/robot-sim/record_3d.mjs [robot|drone]

//
// It uses a playwright-core already on the machine (and that one's cached Chromium); it installs
// nothing. WebGL in headless Chromium is drawn in software (no GPU is needed).
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
const vehicle = process.argv[2] || "robot";
if (!["robot", "drone"].includes(vehicle)) throw new Error("robot or drone");

const PORT = Number(process.env.ROBOTSIM_PORT || 8798);
const W = 1100, H = 900, LEN = 90;
const run = fs.mkdtempSync(path.join(os.tmpdir(), "robotsim-3d-"));
const stills = path.join(here, "stills");
fs.mkdirSync(stills, { recursive: true });

const server = spawn("python3", [path.join(here, "robotsim.py"), "--work", path.join(run, "work"), "--port", String(PORT), "--max-steps", "180", "--step", "0.5", "--vehicles", vehicle],
  { stdio: ["ignore", "pipe", "inherit"], env: process.env });
process.on("exit", () => server.kill("SIGINT"));
await new Promise((ok, no) => {
  server.stdout.on("data", (b) => String(b).includes("open http") && ok());
  server.on("exit", (c) => no(new Error(`server exited ${c}`)));
});

const ctx = await chromium.launchPersistentContext(path.join(run, "profile"), {
  headless: true, viewport: { width: W, height: H }, recordVideo: { dir: path.join(run, "video"), size: { width: W, height: H } },
});
await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort()));
const page = ctx.pages()[0] || (await ctx.newPage());
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
const at = async (s) => { const ms = s * 1000 - (Date.now() - t0); if (ms > 0) await page.waitForTimeout(ms); };
const shot = (n, name) => page.screenshot({ path: path.join(stills, `3d-${vehicle}-${n}-${name}.jpg`), type: "jpeg", quality: 85 });
const click = async (sel) => { await page.locator(sel).first().click({ timeout: 20000 }); };
const drag = async (dx, dy) => {
  const b = await page.locator("#c3").boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(x + (dx * i) / 20, y + (dy * i) / 20);
  await page.mouse.up();
};

const ready = (sel) => page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled; }, sel, { timeout: 90000 });
async function droneRun() {
  await at(10); await shot(1, "flight-live-and-checked");
  await at(12); await drag(-160, -40);
  await at(16); await click("#v-top");
  await at(19); await shot(2, "top-view-geofence");
  await at(21); await click("#v-follow");
  await ready('[data-b="alter_alt:climb"]');
  await at(24); await click('[data-b="alter_alt:climb"]');
  await at(27); await click("#log .row.refused[data-file]");
  await at(30); await shot(3, "lowered-altitude-red");
  await at(33); await click("#b-reset");
  await at(35); await click('[data-b="take_out:climb"]');
  await at(38); await click("#log .row.refused[data-file]");
  await at(41); await shot(4, "climb-taken-out-red");
  await at(44); await click("#b-reset");
  await at(46); await click('[data-s="geofence"]');
  await ready('[data-b="swap_exit:exit"]');
  await at(49); await click('[data-b="swap_exit:exit"]');
  await at(52); await click("#log .row.refused[data-file]");
  await at(55); await shot(5, "swapped-exit-red");
  await at(58); await click("#b-reset");
  await at(61); await click('[data-b="other_key:exit"]');
  await at(64); await click("#log .row.refused[data-file]");
  await at(67); await shot(6, "other-key-red");
  await at(71); await click("#b-reset");
  await at(73); await click("#v-2d");
  await at(78); await click("#v-2d");
  await at(80); await click("#v-follow");
  await at(82); await drag(220, 10);
}
async function robotRun() {
  await at(9); await shot(1, "live-and-checked");
  await at(11); await drag(-160, -30);
  await at(15); await click("#v-top");
  await at(19); await shot(2, "top-view");
  await at(21); await click("#v-follow");
  await page.waitForFunction(() => { const b = document.querySelector('#b-replay, [data-b="replay"]'); return b && !b.disabled; }, null, { timeout: 60000 });
  await at(26); await click('#b-alter, [data-b="alter"]');
  await at(30); await click("#log .row.refused[data-file]");
  await at(33); await shot(3, "altered-record-red-on-the-path");
  await at(37); await click("#b-reset");
  await at(40); await click('#b-replay, [data-b="replay"]');
  await at(44); await click("#log .row.refused[data-file]");
  await at(47); await shot(4, "permit-used-twice-red");
  await at(51); await click("#b-reset");
  await at(54); await click('#b-reorder, [data-b="reorder"]');
  await at(57); await click("#log .row.refused[data-file]");
  await at(60); await shot(5, "swapped-records-red");
  await at(64); await click("#b-reset");
  await at(66); await click("#v-2d");
  await at(70); await shot(6, "2d-without-webgl");
  await at(74); await click("#v-2d");
  await at(76); await click("#v-follow");
  await at(80); await drag(200, 10);
}
await page.goto(`http://127.0.0.1:${PORT}/`);
const kind = await page.evaluate(() => (document.getElementById("c3").hidden ? "2d" : "3d"));
await (vehicle === "drone" ? droneRun() : robotRun());
await at(LEN);
const video = page.video();
await ctx.close();
fs.copyFileSync(await video.path(), path.join(here, `demo-3d-${vehicle}.webm`));
server.kill("SIGINT");
await new Promise((ok) => { const t = setTimeout(() => { server.kill("SIGKILL"); ok(); }, 5000); server.on("exit", () => { clearTimeout(t); ok(); }); });
fs.rmSync(run, { recursive: true, force: true });
console.log(`demo-3d-${vehicle}.webm and 6 stills written; ${Math.round((Date.now() - t0) / 1000)} s; view ${kind}; page errors ${errors.length}`);
if (errors.length) { console.log(errors.join("\n")); process.exitCode = 1; }
process.exit();
