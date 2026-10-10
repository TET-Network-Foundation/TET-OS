// Sign a build manifest with TET's publisher ID (docs/THREAT_MODEL.md rule 6). The founder runs it
// on their own machine, never on a server:
//
//   TET_PAPER_CHAIN_ID=… TET_PAPER_GENESIS_HASH=… \
//     node --experimental-strip-types scripts/sign_build_manifest.mjs https://tetnet.org --local <manifest.json> [--publish]
//
// 1. Fetches <origin>/build-manifest.json (the bytes the site serves).
// 2. Refuses unless it is byte-identical to --local, a manifest you built yourself from that commit
//    (the Docker image, as the demo does, then `node scripts/build_manifest.mjs --out x.json`): the
//    server's word is never what gets signed.
// 3. Signs the manifest's SHA-256 like any mark (a record plus the publisher's consent), prints the
//    proof code, and with --publish sends both to <origin>/tet-node-api/sigs/publish so anyone can
//    find it by the manifest's hash. Nothing else leaves this machine; the words never do.

import { register } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
register("./lib/ts_hooks.mjs", import.meta.url);

const origin = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(origin)) throw new Error("usage: sign_build_manifest.mjs <origin> [--publish]");
const CHAIN = { chainId: process.env.TET_PAPER_CHAIN_ID ?? "", genesisHash: process.env.TET_PAPER_GENESIS_HASH ?? "" };
if (!CHAIN.chainId || !/^(0x)?[0-9a-f]{64}$/i.test(CHAIN.genesisHash)) throw new Error("set TET_PAPER_CHAIN_ID and TET_PAPER_GENESIS_HASH");
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= CHAIN.chainId;
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const { manifestProblems } = await import("../app/lib/site_verify.mjs");
const pc = await import("../app/lib/proof_code.ts");
const { signContent, sigJsonBytes } = await import("../app/lib/sign_anything.ts");
const trySession = await import("../app/lib/try_session.ts");

const r = await fetch(`${origin}/build-manifest.json`, { cache: "no-store" });
if (!r.ok) throw new Error(`${origin}/build-manifest.json: HTTP ${r.status}`);
const bytes = new Uint8Array(await r.arrayBuffer());
const m = JSON.parse(new TextDecoder().decode(bytes));
const problems = manifestProblems(m);
if (problems.length) throw new Error(`not a build manifest: ${problems.join("; ")}`);
const li = process.argv.indexOf("--local");
const localPath = li > 0 ? process.argv[li + 1] : "";
if (!localPath || !existsSync(localPath)) throw new Error("--local <manifest you built yourself> is required: only a build you reproduced gets signed");
if (!Buffer.from(readFileSync(localPath)).equals(Buffer.from(bytes))) throw new Error("the served manifest differs from the one you built: not signing");
const shaHex = createHash("sha256").update(bytes).digest("hex");
console.log(`manifest: commit ${m.commit}, ${Object.keys(m.files).length} files, sha256 ${shaHex}`);

const words = process.env.TET_PUBLISHER_WORDS || join(homedir(), ".tet", "tet-publisher.words");
if (!existsSync(words)) throw new Error(`no publisher key at ${words}`);
await trySession.activateTryWallet(readFileSync(words, "utf8").trim());
const rec = await pc.signFileHash(bytes, CHAIN);
const consent = await signContent(createHash("sha256").update(rec.bytes).digest(), pc.CONSENT_PAYLOAD_TYPE, CHAIN);
console.log(`signed: proof code ${pc.proofCode(rec.bytes)} (publisher ${rec.env.tet.agent_ed25519_pubkey_hex.slice(0, 12)}…)`);

if (process.argv.includes("--publish")) {
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  const p = await fetch(`${origin}/tet-node-api/sigs/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record_b64: b64(rec.bytes), consent_b64: b64(sigJsonBytes(consent)) }),
  });
  console.log(`publish: HTTP ${p.status} ${p.status === 202 ? "published" : (await p.text()).slice(0, 200)}`);
}
