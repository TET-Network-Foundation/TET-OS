// Check a live TET site against its signed build manifest, from your own machine: this script
// doesn't depend on any code the site serves, so a compromised server can't make it lie
// (docs/THREAT_MODEL.md rule 6).
//
//   node --experimental-strip-types scripts/verify_site.mjs https://tetnet.org --commit <sha>
//
// --commit is the build you expect to be live (e.g. `git ls-remote https://github.com/TET-Network-Foundation/TET-OS main`):
// a signed manifest only proves the publisher once signed that build, so without it a compromised
// site could serve an older signed build (a rollback). Without --commit the check refuses unless
// you pass --any-commit, and then it says which commit you got.
//
// 1. Fetches /build-manifest.json and hashes it.
// 2. Looks up signatures on that hash in the node's registry (/tet-node-api/sigs/search) and checks
//    each here, with the offline verifier's code: both signatures, the chain binding, and that the
//    signer is TET's publisher ID (from the paper's marks, committed in this repository).
// 3. Fetches every file the manifest lists and compares its SHA-256.
// Exit 0 only when the manifest is signed by the publisher and every file matches.

import { register } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
register("./lib/ts_hooks.mjs", import.meta.url);

const origin = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(origin)) throw new Error("usage: verify_site.mjs <origin> --commit <sha> | --any-commit");
const ci = process.argv.indexOf("--commit");
const EXPECT = ci > 0 ? String(process.argv[ci + 1] ?? "").toLowerCase() : "";
if (!EXPECT && !process.argv.includes("--any-commit")) throw new Error("say which build you expect: --commit <sha> (or --any-commit to accept whichever signed build is served)");
const marks = JSON.parse(readFileSync(new URL("../app/whitepaper/marks.json", import.meta.url), "utf8"));
const PUBLISHER = marks.signer;
const CHAIN = marks.chain;
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= CHAIN.chainId;
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const sv = await import("../app/lib/site_verify.mjs");
const { verifyRecordOffline } = await import("../app/lib/offline_verify.mjs");
const { mldsa44Verify } = await import("../app/lib/pqc.ts");
const sha = (b) => createHash("sha256").update(b).digest("hex");

const mr = await fetch(`${origin}/build-manifest.json`, { cache: "no-store" });
if (!mr.ok) throw new Error(`no build manifest at ${origin} (HTTP ${mr.status})`);
const mBytes = new Uint8Array(await mr.arrayBuffer());
const manifest = JSON.parse(new TextDecoder().decode(mBytes));
const problems = sv.manifestProblems(manifest);
if (problems.length) throw new Error(`not a build manifest: ${problems.join("; ")}`);
const mSha = sha(mBytes);
console.log(`manifest: commit ${manifest.commit}, ${Object.keys(manifest.files).length} files, sha256 ${mSha}`);

const sr = await fetch(`${origin}/tet-node-api/sigs/search?file=${mSha}&signer=${PUBLISHER}`);
const records = sr.ok ? ((await sr.json()).records ?? []).map((r) => r.record_b64) : [];
const code = await sv.publisherSignatureFor({ recordsB64: records, manifestSha256: mSha, publisher: PUBLISHER, chain: CHAIN, verifyRecordOffline, mldsa44Verify });
console.log(code ? `signed by TET's publisher ID: proof code ${code}` : "NOT SIGNED by TET's publisher ID (no valid signature found on this manifest)");

const got = {};
for (const path of Object.keys(manifest.files)) {
  try {
    const r = await fetch(`${origin}${path}`, { cache: "no-store" });
    got[path] = r.ok ? sha(new Uint8Array(await r.arrayBuffer())) : null;
  } catch {
    got[path] = null;
  }
}
const c = sv.compareFiles(manifest, got);
console.log(`files: ${c.matched.length} match, ${c.changed.length} changed, ${c.missing.length} missing`);
for (const p of c.changed) console.log(`  CHANGED ${p}`);
for (const p of c.missing) console.log(`  MISSING ${p}`);
const commitOk = EXPECT ? manifest.commit.toLowerCase().startsWith(EXPECT) || EXPECT.startsWith(manifest.commit.toLowerCase()) : true;
if (EXPECT && !commitOk) console.log(`WRONG BUILD: the site serves commit ${manifest.commit}, you expected ${EXPECT} (an older signed build is a rollback)`);
if (!EXPECT) console.log(`note: --any-commit: this is the signed build of commit ${manifest.commit}; check that it is the current one`);
const ok = !!code && commitOk && c.changed.length === 0 && c.missing.length === 0;
console.log(ok ? "VERIFIED: every file this site serves is the publisher-signed build." : "NOT VERIFIED");
process.exit(ok ? 0 : 1);
