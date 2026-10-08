// Guard for the page's node proxy (app/tet-node-api/[...path]/route.ts): it never forwards the node's
// operator routes.
//
//   node --experimental-strip-types scripts/try_proxy_guard.mjs
//
// SECURITY: tet-core's /operator/* routes answer only on loopback (operator_hide.rs). In a local or
// single-host setup the proxy itself connects from loopback, so a forwarded request would look like
// the operator. The proxy's real handlers are called with fetch stubbed: no operator-path variant
// reaches the node (any method, case, encoding, leading empty segment), and an ordinary route still
// does. Control: a check that only matches the exact lowercase segment is caught.

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);

const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};
const route = await import("../app/tet-node-api/[...path]/route.ts");
const { isOperatorPath } = await import("../app/lib/proxy_paths.ts");

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

const VARIANTS = [["operator", "hidden"], ["operator", "hide"], ["OPERATOR", "unhide"], ["%6Fperator", "hidden"], ["", "operator", "hidden"], [" operator", "hidden"]];

await check("SECURITY: no operator-path variant is forwarded, by any method", async () => {
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    for (const path of VARIANTS) {
      calls.length = 0;
      const req = new Request(`http://ui.test/tet-node-api/${path.join("/")}`, { method, body: method === "GET" ? undefined : "{}" });
      const res = await route[method](req, { params: { path } });
      assert.equal(res.status, 404, `${method} /${path.join("/")} → ${res.status}`);
      assert.equal(calls.length, 0, `${method} /${path.join("/")} reached the node: ${calls.join(", ")}`);
    }
  }
});

await check("an ordinary route is still forwarded", async () => {
  calls.length = 0;
  const res = await route.GET(new Request("http://ui.test/tet-node-api/status"), { params: { path: ["status"] } });
  assert.equal(res.status, 200);
  assert.ok(calls.length >= 1 && calls[0].endsWith("/status"), calls.join(", "));
  assert.equal(isOperatorPath(["tmail", "operator"]), false, "only the first segment counts");
});

await check("control: an exact-lowercase-only check is caught", () => {
  const naive = (p) => (p ?? [])[0] === "operator";
  assert.ok(VARIANTS.some((v) => isOperatorPath(v) && !naive(v)), "the variants don't exercise anything beyond the naive check");
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
