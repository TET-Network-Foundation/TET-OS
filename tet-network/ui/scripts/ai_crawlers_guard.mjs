// Guard: robots.txt and the demo Caddyfile's AI-crawler block come from the one list
// (deploy/ai-crawlers.txt), and the policy's shape holds.
//
//   node scripts/ai_crawlers_guard.mjs
//
// 1. Both generated files equal what the list makes (control: a list with one more name differs).
// 2. The founder's names are on the list; normal search crawlers are not (Googlebot, Bingbot …).
// 3. robots.txt allows everyone else (User-agent: * / Allow: /).
// 4. Caddy serves /robots.txt before it refuses AI crawlers, and refuses them before any other rule
//    but the ambiguous-path one. (Requests are checked live in deploy/tests/demo-node.test.sh.)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { crawlers, robotsTxt, withCaddyBlock } from "./gen_ai_crawlers.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const listText = readFileSync(`${ROOT}deploy/ai-crawlers.txt`, "utf8");
const robots = readFileSync(`${ROOT}tet-network/ui/public/robots.txt`, "utf8");
const caddy = readFileSync(`${ROOT}deploy/demo/Caddyfile`, "utf8");

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

const inSync = (names, r, c) => {
  assert.equal(r, robotsTxt(names), "robots.txt differs from deploy/ai-crawlers.txt (run gen_ai_crawlers.mjs)");
  assert.equal(c, withCaddyBlock(c, names), "the Caddy block differs from deploy/ai-crawlers.txt (run gen_ai_crawlers.mjs)");
};
const names = crawlers(listText);
check("robots.txt and the Caddy block are generated from the one list", () => inSync(names, robots, caddy));
check("control: a list with one more name is out of sync", () => assert.throws(() => inSync([...names, "NewBot"], robots, caddy)));

check("the founder's crawlers are listed; search crawlers are not", () => {
  for (const n of ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Applebot-Extended", "PerplexityBot", "Bytespider"]) {
    assert.ok(names.includes(n), `${n} is missing`);
  }
  for (const n of names) assert.doesNotMatch(n, /^(Googlebot|Bingbot|DuckDuckBot|Applebot|Slurp|Baiduspider|YandexBot)$/i, `${n} is a search crawler`);
});
check("robots.txt allows everyone else", () => assert.match(robots, /User-agent: \*\nAllow: \/\n/));
check("Caddy: ambiguous paths, then robots.txt, then the AI-crawler 403, then everything else", () => {
  const route = caddy.slice(caddy.indexOf("\troute {"));
  const at = (s) => {
    const i = route.indexOf(s);
    assert.ok(i >= 0, `${s} is not in the route block`);
    return i;
  };
  assert.ok(at("respond @ambiguous_path 400") < at("reverse_proxy /robots.txt ui:3000"));
  assert.ok(at("reverse_proxy /robots.txt ui:3000") < at("respond @ai_crawler 403"));
  assert.ok(at("respond @ai_crawler 403") < at("redir / /try 302"));
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
