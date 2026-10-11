// Guard: page integrity for the public pages (docs/THREAT_MODEL.md rule 6; next.config.ts).
//
//   node --experimental-strip-types scripts/page_integrity_guard.mjs
//
// 1. The public pages get the CSP: scripts and connections only from this origin (plus the
//    visitor's local prover), no framing, no plugins, no <base>, forms only to this origin.
// 2. SRI is on (experimental.sri): Next adds integrity hashes to the scripts its bundler can hash.
// 3. Zero third-party code: no page source loads a script, stylesheet or font from another origin.
// 4. Nothing the page runs evaluates a string as code (`new Function`, `eval`, a string given to
//    setTimeout/setInterval): script-src has no 'unsafe-eval', so the browser would refuse it at run
//    time, which no build or Node test notices. Control: a sample with `new Function` is caught.
// Negative control (run by hand, recorded in the commit): a CDN added to script-src → FAILED.

import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
const cfgMod = await import("../next.config.ts");
const cfg = cfgMod.default;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}
const directives = (csp) => Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

await check("SECURITY: the public pages get a CSP that admits no other origin's scripts", async () => {
  const rules = await cfg.headers();
  for (const page of ["/", "/try", "/whitepaper", "/verify/:path*"]) {
    const r = rules.find((x) => x.source === page);
    assert.ok(r, `no headers for ${page}`);
    const csp = r.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    const d = directives(csp);
    assert.deepEqual(d["script-src"], ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"], `${page}: script-src ${d["script-src"]}`);
    assert.deepEqual(d["default-src"], ["'self'"]);
    for (const k of ["object-src", "base-uri", "frame-ancestors"]) assert.deepEqual(d[k], ["'none'"], `${page}: ${k}`);
    assert.deepEqual(d["form-action"], ["'self'"]);
    const others = (d["connect-src"] ?? []).filter((s) => s !== "'self'" && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(s));
    assert.deepEqual(others, [], `${page}: connect-src reaches ${others}`);
  }
});

await check("SRI is on", () => {
  assert.equal(cfg.experimental?.sri?.algorithm, "sha256");
});

await check("SECURITY: no page source loads a script, stylesheet or font from another origin", () => {
  const bad = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|css)$/.test(f)) {
        const s = readFileSync(p, "utf8");
        const hits = [
          ...s.matchAll(/<script[^>]*\ssrc=["'{]\s*["'`]?(https?:)?\/\//gi),
          ...s.matchAll(/from\s+["']next\/script["']/g),
          ...s.matchAll(/<link[^>]*href=["'](https?:)?\/\/[^"']+["'][^>]*rel=["']stylesheet|rel=["']stylesheet["'][^>]*href=["'](https?:)?\/\//gi),
          ...s.matchAll(/@import\s+url\(\s*["']?(https?:)?\/\//gi),
          ...s.matchAll(/fonts\.googleapis|fonts\.gstatic|googletagmanager|cdn\.jsdelivr|unpkg\.com|cdnjs/gi),
        ];
        if (hits.length) bad.push(p.replace(/^.*?\/ui\//, ""));
      }
    }
  };
  walk(new URL("../app", import.meta.url).pathname);
  assert.deepEqual(bad, []);
});

const EVAL = /\bnew\s+Function\s*\(|(?<![.\w])eval\s*\(|\bset(?:Timeout|Interval)\s*\(\s*["'`]/;
const evalHits = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l) && EVAL.test(l));
await check("the page never evaluates a string as code (the CSP has no 'unsafe-eval')", () => {
  const bad = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|js)$/.test(f) && evalHits(readFileSync(p, "utf8")).length) bad.push(p.replace(/^.*?\/ui\//, ""));
    }
  };
  walk(new URL("../app", import.meta.url).pathname);
  assert.deepEqual(bad, []);
});
await check("control: `new Function` and `eval(` are caught; a comment or `.eval(` method isn't", () => {
  assert.equal(evalHits(`const f = new Function('return import("/x.js")');`).length, 1);
  assert.equal(evalHits(`const v = eval("1+1");`).length, 1);
  assert.equal(evalHits(`setTimeout("go()", 10);`).length, 1);
  assert.equal(evalHits(`// new Function(...) would be refused\nconst r = model.eval(x);`).length, 0);
});
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
