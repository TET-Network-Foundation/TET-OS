// Write robots.txt and the demo Caddyfile's AI-crawler block from deploy/ai-crawlers.txt.
//
//   node scripts/gen_ai_crawlers.mjs          write both
//   node scripts/gen_ai_crawlers.mjs --check  exit 1 if either differs from what the list makes
//
// robots.txt asks AI training crawlers not to crawl and allows everyone else (search crawlers).
// The Caddy block refuses those user agents with 403 (robots.txt itself stays readable to them).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LIST = `${ROOT}deploy/ai-crawlers.txt`;
const ROBOTS = `${ROOT}tet-network/ui/public/robots.txt`;
const CADDY = `${ROOT}deploy/demo/Caddyfile`;
const BEGIN = "\t# BEGIN ai-crawlers (generated from deploy/ai-crawlers.txt by gen_ai_crawlers.mjs; edit the list)";
const END = "\t# END ai-crawlers";

export function crawlers(text = readFileSync(LIST, "utf8")) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function robotsTxt(names) {
  return [
    "# Generated from deploy/ai-crawlers.txt by tet-network/ui/scripts/gen_ai_crawlers.mjs; edit the list.",
    "# AI training crawlers: please don't crawl this site. Search crawlers are welcome.",
    "# Members-only spaces are end-to-end encrypted; this file is a request, not a wall.",
    ...names.map((n) => `User-agent: ${n}`),
    "Disallow: /",
    "",
    "User-agent: *",
    "Allow: /",
    "",
  ].join("\n");
}

const escape = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function caddyBlock(names) {
  return [BEGIN, `\t@ai_crawler header_regexp User-Agent (?i)(${names.map(escape).join("|")})`, END].join("\n");
}

export function withCaddyBlock(caddyfile, names) {
  const i = caddyfile.indexOf(BEGIN);
  const j = caddyfile.indexOf(END);
  if (i < 0 || j < i) throw new Error("the Caddyfile has no ai-crawlers markers");
  return caddyfile.slice(0, i) + caddyBlock(names) + caddyfile.slice(j + END.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const names = crawlers();
  const wantRobots = robotsTxt(names);
  const wantCaddy = withCaddyBlock(readFileSync(CADDY, "utf8"), names);
  if (process.argv.includes("--check")) {
    let bad = 0;
    if (readFileSync(ROBOTS, "utf8") !== wantRobots) (bad++, console.log("robots.txt differs from deploy/ai-crawlers.txt"));
    if (readFileSync(CADDY, "utf8") !== wantCaddy) (bad++, console.log("the Caddyfile's ai-crawlers block differs from deploy/ai-crawlers.txt"));
    process.exit(bad ? 1 : 0);
  }
  writeFileSync(ROBOTS, wantRobots);
  writeFileSync(CADDY, wantCaddy);
  console.log(`wrote robots.txt and the Caddy block (${names.length} crawlers)`);
}
