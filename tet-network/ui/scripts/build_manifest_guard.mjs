// The signed build manifest (docs/THREAT_MODEL.md rule 6). Each check with a negative control.
// 1. The manifest covers exactly what deploy/demo/Caddyfile serves from the UI.
// 2. Built from a UI folder: deterministic, served files only, dotfiles and unserved paths left out.
// 3. compareFiles flags a changed and a missing file.
// 4. publisherSignatureFor accepts only a valid signature by the publisher over this manifest's hash.
// 5. The Docker build writes the manifest, and the build id is the commit.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const { SERVED, buildManifest } = await import("./build_manifest.mjs");
const sv = await import("../app/lib/site_verify.mjs");
const { verifyRecordOffline } = await import("../app/lib/offline_verify.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const pc = await import("../app/lib/proof_code.ts");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { generateDisposableWords } = await import("../app/lib/disposable_wallet.mjs");

let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split("\n")[0]}`);
  }
};
const fails = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

// 1. the served list equals the Caddyfile's
const caddy = readFileSync(new URL("../../../deploy/demo/Caddyfile", import.meta.url), "utf8");
const pageLine = (src) => (src.match(/^\t@page path (.+)$/m)?.[1] ?? "").trim().split(/\s+/);
const sameAsCaddy = (list) => {
  const ours = [...SERVED.exact, ...SERVED.prefixes.map((p) => `${p}*`)].sort();
  assert.deepEqual(ours, [...list].sort());
};
await check("the manifest covers exactly the paths the demo serves (Caddyfile @page)", () => sameAsCaddy(pageLine(caddy)));
await check("control: a path Caddy serves that the manifest skips FAILS", () => fails(() => sameAsCaddy([...pageLine(caddy), "/extra/*"])).then(assert.ok));

// 2. a manifest from a fixture UI folder
const ui = mkdtempSync(join(tmpdir(), "tet-manifest-"));
const put = (rel, text) => {
  mkdirSync(join(ui, rel, ".."), { recursive: true });
  writeFileSync(join(ui, rel), text);
};
put(".next/static/chunks/a.js", "console.log(1)");
put(".next/server/app/try.html", "<html>try</html>");
put("public/pqc/tet_pqc_wasm_bg.wasm", "wasm");
put("public/pqc/.gitignore", "*");
put("public/secret-notes.txt", "not served");
const m1 = buildManifest(ui, "abc1234");
await check("served files only; dotfiles and unserved paths left out", () => {
  assert.deepEqual(Object.keys(m1.files).sort(), ["/_next/static/chunks/a.js", "/pqc/tet_pqc_wasm_bg.wasm", "/try"]);
});
await check("the same build gives the same bytes", () => assert.deepEqual(sv.manifestBytes(buildManifest(ui, "abc1234")), sv.manifestBytes(m1)));

// 3. comparing
const shaOf = (s) => createHash("sha256").update(s).digest("hex");
const allGood = { "/_next/static/chunks/a.js": shaOf("console.log(1)"), "/pqc/tet_pqc_wasm_bg.wasm": shaOf("wasm"), "/try": shaOf("<html>try</html>") };
await check("matching files pass; a changed and a missing file are flagged", () => {
  assert.equal(sv.compareFiles(m1, allGood).matched.length, 3);
  const c = sv.compareFiles(m1, { ...allGood, "/try": shaOf("<html>evil</html>"), "/pqc/tet_pqc_wasm_bg.wasm": null });
  assert.deepEqual([c.changed, c.missing], [["/try"], ["/pqc/tet_pqc_wasm_bg.wasm"]]);
});

// 4. the publisher's signature
const chain = { chainId: "tet-local-dev", genesisHash: "0x" + "ab".repeat(32) };
const mBytes = sv.manifestBytes(m1);
const mSha = shaOf(Buffer.from(mBytes));
const publisher = await activateTryWallet(generateDisposableWords());
const rec = await pc.signFileHash(mBytes, chain);
const b64 = Buffer.from(rec.bytes).toString("base64");
const find = (over) => sv.publisherSignatureFor({ recordsB64: [b64], manifestSha256: mSha, publisher, chain, verifyRecordOffline, mldsa44Verify, ...over });
await check("a valid signature by the publisher over this manifest is found", async () => assert.ok(await find({})));
await check("control: another signer is not the publisher", async () => assert.equal(await find({ publisher: "cd".repeat(32) }), null));
await check("control: a signature over another manifest doesn't count", async () => assert.equal(await find({ manifestSha256: "00".repeat(32) }), null));
await check("control: a signature bound to another chain doesn't count", async () => assert.equal(await find({ chain: { ...chain, genesisHash: "0x" + "cd".repeat(32) } }), null));

// 5. the build writes it, and the build id is the commit
await check("the Docker build writes the manifest; the build id is the commit", () => {
  const docker = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /npm run build \\\n && node scripts\/build_manifest\.mjs/);
  const cfg = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(cfg, /generateBuildId: async \(\) => process\.env\.NEXT_PUBLIC_TET_BUILD_SHA/);
});

// 6. the review's two rules: the checker needs the expected commit (no silent rollback), and the
//    signer signs only a manifest identical to one built locally.
const verifySrc = readFileSync(new URL("./verify_site.mjs", import.meta.url), "utf8");
const signSrc = readFileSync(new URL("./sign_build_manifest.mjs", import.meta.url), "utf8");
const rollbackRule = (src) => {
  assert.match(src, /if \(!EXPECT && !process\.argv\.includes\("--any-commit"\)\) throw/);
  assert.match(src, /const ok = !!code && commitOk &&/);
};
const localRule = (src) => {
  assert.match(src, /if \(!localPath \|\| !existsSync\(localPath\)\) throw/);
  assert.match(src, /\.equals\(Buffer\.from\(bytes\)\)\) throw/);
  assert.ok(src.indexOf("equals(Buffer.from(bytes))") < src.indexOf("signFileHash("), "the comparison comes before signing");
};
await check("verify_site requires the expected commit and fails another one", () => rollbackRule(verifySrc));
await check("control: accepting any signed build FAILS", () => fails(() => rollbackRule(verifySrc.replace("const ok = !!code && commitOk &&", "const ok = !!code &&"))).then(assert.ok));
await check("sign_build_manifest signs only a manifest identical to a local build", () => localRule(signSrc));
await check("control: signing the served manifest unchecked FAILS", () => fails(() => localRule(signSrc.replace(/if \(!Buffer\.from[^\n]*\n/, ""))).then(assert.ok));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
