// Records the demo page for one vehicle into demo-<vehicle>.webm (about 90 s) plus six stills
// (stills/<vehicle>-N-*.jpg), in a headless browser with its own fresh profile. Every request that is
// not to 127.0.0.1 is refused, so the page cannot reach anything else.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core TET_CLI=/path/to/tet-cli VEHICLE=drone \
//     node prep/demos/robot-sim/record_video.mjs          (VEHICLE: drone or robot)
//
// It uses a playwright-core that is already on the machine (and that one's cached Chromium and
// ffmpeg); it installs nothing.
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

const PORT = Number(process.env.ROBOTSIM_PORT || 8797);
const W = 1100, H = 900;
const VEHICLE = process.env.VEHICLE || "drone";
if (!["drone", "robot"].includes(VEHICLE)) throw new Error("VEHICLE is drone or robot");
const run = fs.mkdtempSync(path.join(os.tmpdir(), "robotsim-video-"));
const stills = path.join(here, "stills");
fs.mkdirSync(stills, { recursive: true });

const server = spawn("python3", [path.join(here, "robotsim.py"), "--work", path.join(run, "work"), "--port", String(PORT), "--max-steps", "150", "--step", "0.5", "--vehicles", VEHICLE],
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
const shot = (n, name) => page.screenshot({ path: path.join(stills, `${VEHICLE}-${n}-${name}.jpg`), type: "jpeg", quality: 85 });
const click = async (id) => { await page.locator(id).click({ timeout: 20000 }); };

await page.goto(`http://127.0.0.1:${PORT}/`);
const enabled = (sel) => page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled; }, sel, { timeout: 90000 });
if (VEHICLE === "drone") {
  await at(8); await shot(1, "live-and-checked");
  await enabled('[data-b="alter_alt:climb"]');
  await at(17); await shot(2, "exit-and-climb-in-the-log");
  await at(19); await click('[data-b="alter_alt:climb"]');
  await at(23); await shot(3, "lowered-altitude-refused");
  await at(27); await click("#b-reset");
  await at(30); await click('[data-b="take_out:climb"]');
  await at(36); await click("#b-reset");
  await at(40); await click('[data-s="geofence"]');
  await at(43); await click('[data-b="swap_exit:exit"]');
  await at(47); await shot(4, "swapped-exit-refused");
  await at(51); await click("#b-reset");
  await at(54); await click('[data-b="other_key:exit"]');
  await at(60); await shot(5, "other-key-refused");
  await at(64); await click("#b-reset");
} else {
  await at(9); await shot(1, "live-and-checked");
  await enabled('[data-b="replay"]');
  await at(18); await click('[data-b="alter"]');
  await at(22); await shot(2, "altered-value-refused");
  await at(27); await click("#b-reset");
  await at(31); await click('[data-b="replay"]');
  await at(35); await shot(3, "permit-used-twice-refused");
  await at(40); await click("#b-reset");
  await at(44); await click('[data-b="reorder"]');
  await at(48); await shot(4, "swapped-records-refused");
  await at(53); await click("#b-reset");
  await at(60); await shot(5, "after-reset-valid");
}
await at(68); await page.evaluate(() => window.scrollBy(0, 700));
await at(72); await shot(6, "what-this-does-not-show");
await at(80); await page.evaluate(() => window.scrollBy(0, -700));
await at(90);
const video = page.video();
await ctx.close();
fs.copyFileSync(await video.path(), path.join(here, `demo-${VEHICLE}.webm`));
server.kill("SIGINT");
fs.rmSync(run, { recursive: true, force: true });
console.log(`demo-${VEHICLE}.webm and 6 stills written; ${Math.round((Date.now() - t0) / 1000)} s`);
