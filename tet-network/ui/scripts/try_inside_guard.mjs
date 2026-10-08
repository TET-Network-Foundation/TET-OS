// Guard for the "What's inside TET" page (InsidePanel.tsx).
//
//   node scripts/try_inside_guard.mjs
//
// 1. Every retention it shows comes from the node (GET /stats/inside, the values the stores apply:
//    tet-core's `inside_stats_report_the_retention_the_stores_apply` checks the route against the
//    config) or from the page's own listing rule — never a number typed into the page. Control.
// 2. It reads counts only from the node and the public boards, and says when they were counted.
//    Control.
// 3. It keeps the testnet line.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const SRC = readFileSync(new URL("../app/try/InsidePanel.tsx", import.meta.url), "utf8");

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

function retentionFromNode(src) {
  for (const f of ["s.retention.messages_and_posts_ms", "s.retention.files_ms", "s.retention.sites_after_last_edit_ms"]) {
    assert.ok(src.includes(f), `${f} isn't shown`);
  }
  assert.match(src, /Math\.min\(LISTING_TTL_MS, s\.retention\.messages_and_posts_ms\.default\)/, "the listing time isn't the shorter of the listing rule and post retention");
  // No duration typed in: no "7 days" / "30 days" / "24 hours" in a string, no day-sized ms literal.
  const strings = [...src.matchAll(/t\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  const typed = strings.filter((x) => /\d+\s*(?:days?|hours?|日|時間|小時)/i.test(x));
  assert.deepEqual(typed, [], "a duration is typed into the page");
  assert.doesNotMatch(src.replace(/3_600_000/g, ""), /\b(?:86_?400_?000|604_?800_?000|\d+\s*\*\s*24\s*\*\s*60)/, "a duration constant is typed into the page");
}
check("every retention shown comes from the node's settings", () => retentionFromNode(SRC));
check("control: a typed-in \"7 days\" is caught", () =>
  assert.throws(() => retentionFromNode(SRC.replace('t("No expiry on this node")', 't("Kept for 7 days")'))),
);
check("control: a constant in place of the node's value is caught", () =>
  assert.throws(() => retentionFromNode(SRC.replace("kept(s.retention.files_ms)", "spanText(7 * 24 * 60 * 60 * 1000, t)"))),
);

function countsHonest(src) {
  assert.match(src, /tetCoreUrl\(BASE, "\/stats\/inside"\)/);
  assert.match(src, /t\("Counted at \{time\}, on this node\.", \{ time: new Date\(s\.at_ms\)/, "the time of the counts isn't shown");
  assert.doesNotMatch(src, /Math\.random|counts:\s*\{\s*blocks:\s*\d/, "made-up counts");
}
check("counts come from the node, with the time they were counted", () => countsHonest(SRC));
check("control: a page without the count time is caught", () => assert.throws(() => countsHonest(SRC.replace("Counted at {time}, on this node.", "Counted."))));

check("the testnet line stays", () => assert.ok(SRC.includes('t("This is a testnet. Data may be reset.")')));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
