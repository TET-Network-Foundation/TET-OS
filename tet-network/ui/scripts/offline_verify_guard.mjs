// Guard for "Verify without TET" (app/lib/offline_verify.mjs; public/verify/).
//
//   node --experimental-strip-types scripts/offline_verify_guard.mjs
//
// 1. The offline verifier agrees with the page's verifier (verify_anything.mjs verifyEnvelope) on a
//    valid record and on every tampered variant (payload, either signature, key id, chain, file,
//    extra field): both accept the valid one and both refuse each variant.
// 2. Its proof code equals proof_code.ts's.
// 3. The published files are what the build makes from the current sources (rebuilt here; no diff).
// 4. Neither file can reach the network: no fetch/XMLHttpRequest/WebSocket/import.meta in them; the
//    HTML's CSP says connect-src 'none' and pins its one inline script by hash.
// 5. The CLI, run with networking disabled (every net, dns, http and fetch entry point throws),
//    verifies the paper's mark; a tampered paper and a tampered record do not verify.
// Negative controls (run by hand, recorded in the commit): the offline verifier skipping the ML-DSA
// check → 1 FAILED; the build keeping the glue's network loader → 4 FAILED.

import { register } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const UI = new URL("../", import.meta.url);
const ov = await import("../app/lib/offline_verify.mjs");
const va = await import("../app/lib/verify_anything.mjs");
const pc = await import("../app/lib/proof_code.ts");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");

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

const chain = { chainId: "tet-local-dev", genesisHash: "0x" + "ab".repeat(32) };
await activateTryWallet("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
const file = new TextEncoder().encode("a file someone marked");
const rec = await pc.signFileHash(file, chain);
const good = rec.bytes;
const text = new TextDecoder().decode(good);
const J = () => JSON.parse(text);
const flip = (b64) => {
  const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  b[3] ^= 1;
  return btoa(String.fromCharCode(...b));
};
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const variants = {
  "payload changed": (() => { const e = J(); e.payload = btoa(String.fromCharCode(...new Uint8Array(32).fill(7))); return enc(e); })(),
  "ed25519 signature flipped": (() => { const e = J(); const s = e.signatures.find((x) => x.keyid.startsWith("tet-ed25519:")); s.sig = flip(s.sig); return enc(e); })(),
  "ml-dsa signature flipped": (() => { const e = J(); const s = e.signatures.find((x) => x.keyid.startsWith("tet-mldsa44:")); s.sig = flip(s.sig); return enc(e); })(),
  "key id swapped": (() => { const e = J(); e.signatures[0].keyid = "tet-ed25519:" + "00".repeat(32); return enc(e); })(),
  "extra field": (() => { const e = J(); e.note = "x"; return enc(e); })(),
};

await check("the offline verifier agrees with the page's verifier, valid and tampered", async () => {
  const both = async (bytes, f, c) => {
    const a = await ov.verifyRecordOffline({ recordBytes: bytes, file: f, chain: c, mldsa44Verify });
    let env;
    try { env = JSON.parse(new TextDecoder().decode(bytes)); } catch { env = null; }
    const b = await va.verifyEnvelope({ envelope: env, content: f ?? new Uint8Array(), recordOnly: !f, chain: c, mldsa44Verify });
    return [a.ok, b.ok, a.reason ?? ""];
  };
  let [a, b] = await both(good, file, chain);
  assert.ok(a && b, "the valid record didn't verify in both");
  [a, b] = await both(good, null, chain);
  assert.ok(a && b, "the valid record without its file didn't verify in both");
  for (const [name, bytes] of Object.entries(variants)) {
    const [x, y, why] = await both(bytes, file, chain);
    assert.ok(!x && !y, `${name}: offline=${x} page=${y} (${why})`);
  }
  const [w1, w2] = await both(good, new TextEncoder().encode("another file"), chain);
  assert.ok(!w1 && !w2, "a different file passed");
  const [c1, c2] = await both(good, file, { ...chain, chainId: "another-chain" });
  assert.ok(!c1 && !c2, "another chain passed");
});

await check("its proof code equals proof_code.ts's", async () => {
  assert.equal(await ov.proofCode(good), pc.proofCode(good));
});

await check("the published files are what the build makes now", async () => {
  execFileSync("node", ["scripts/build_offline_verifier.mjs"], { cwd: UI, stdio: "pipe" });
  const git = (...a) => spawnSync("git", a, { cwd: UI, encoding: "utf8" }).stdout.trim();
  const changed = git("diff", "--name-only", "--", "public/verify");
  const unknown = git("ls-files", "--others", "--exclude-standard", "--", "public/verify");
  assert.equal(changed + unknown, "", `the rebuild differs from the committed files:\n${changed}\n${unknown}`);
});

const html = readFileSync(new URL("public/verify/tet-verify.html", UI), "utf8");
const cli = readFileSync(new URL("public/verify/tet-verify.mjs", UI), "utf8");
await check("SECURITY: neither file can reach the network", async () => {
  for (const [n, s] of [["html", html], ["cli", cli]]) {
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\.meta/.test(s), `${n} has a network API`);
  }
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /default-src 'none'/);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, "more than one script");
  assert.ok(!/<script[^>]+src=/.test(html), "an external script");
  const h = createHash("sha256").update(scripts[0][1]).digest("base64");
  assert.ok(csp.includes(`'sha256-${h}'`), "the CSP doesn't pin the inline script");
});

await check("the CLI verifies with networking disabled; tampered files don't", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tetverify-"));
  const blocker = join(dir, "no-network.mjs");
  writeFileSync(
    blocker,
    `import net from "node:net"; import dns from "node:dns"; import http from "node:http"; import https from "node:https"; import tls from "node:tls";
const no = () => { throw new Error("network disabled"); };
for (const m of [net, tls]) { m.connect = no; m.createConnection = no; }
dns.lookup = no; dns.resolve = no; http.request = no; http.get = no; https.request = no; https.get = no;
globalThis.fetch = no; globalThis.WebSocket = undefined;`,
  );
  const run = (...args) => spawnSync("node", ["--import", blocker, "public/verify/tet-verify.mjs", ...args], { cwd: UI, encoding: "utf8" });
  const ok = run("public/paper/marks/html.record.json", "public/paper/tet-technical-paper.html");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /VERIFIED/);
  const paper = readFileSync(new URL("public/paper/tet-technical-paper.html", UI));
  const tampered = Buffer.from(paper);
  tampered[100] ^= 1;
  writeFileSync(join(dir, "paper.html"), tampered);
  const bad = run("public/paper/marks/html.record.json", join(dir, "paper.html"));
  assert.equal(bad.status, 1, "a tampered paper verified");
  assert.match(bad.stdout, /DOES NOT VERIFY/);
  const r = JSON.parse(readFileSync(new URL("public/paper/marks/html.record.json", UI), "utf8"));
  r.payload = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
  writeFileSync(join(dir, "rec.json"), JSON.stringify(r));
  assert.equal(run(join(dir, "rec.json")).status, 1, "a tampered record verified");
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
