/**
 * Assert that a tet-pqc-wasm build — freshly compiled, or either committed copy — reproduces the
 * committed interop fixture exactly.
 *
 *   node scripts/check_wasm_interop.mjs <dir with tet_pqc_wasm.js + tet_pqc_wasm_bg.wasm> [...]
 *
 * WHY THIS AND NOT A HASH. `wasm-pack` output is not byte-reproducible across toolchains. Measured
 * 2026-09-30: a fresh build with rustc 1.94.1 / wasm-pack 0.14.0 matched NEITHER committed copy,
 * and all three produced identical public keys and identical signatures for every fixture vector
 * (12/12). So a hash comparison against a fresh build would go red on any compiler bump while
 * telling us nothing about the crypto, and a guard people learn to ignore is worse than none.
 *
 * What IS pinned by hash is the pair of committed copies against each other: same artifact, one
 * source, so they must be byte-identical. They were not — `tet-agent-sdk/vendor/` was five months
 * behind `tet-network/ui/public/pqc/` — which is the drift this catches.
 *
 * Follow-up worth doing separately: pin rustc, wasm-bindgen and wasm-opt, and then a byte diff
 * against a fresh build becomes honest.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = join(repoRoot, "tet-core", "src", "testdata", "agent_sdk_hybrid_sigs.json");

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("usage: node scripts/check_wasm_interop.mjs <pqc-dir> [<pqc-dir> ...]");
  process.exit(2);
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const cases = fixture.cases ?? [];
if (cases.length === 0) {
  console.error("FAIL: fixture has no cases — an empty set passes vacuously");
  process.exit(1);
}

let failures = 0;
for (const dir of dirs) {
  let dirFailures = 0;
  const abs = resolve(dir);
  const glue = await import(pathToFileURL(join(abs, "tet_pqc_wasm.js")).href);
  glue.initSync(readFileSync(join(abs, "tet_pqc_wasm_bg.wasm")));

  for (const [i, c] of cases.entries()) {
    const kp = glue.mldsa44_keypair_from_mnemonic_b64(c.mnemonic);
    const msg = new TextEncoder().encode(c.message_utf8);
    const sig = glue.mldsa44_sign_deterministic_b64(kp.keypair_b64, msg);
    const checks = [
      ["public key", kp.pubkey_b64 === c.mldsa_pubkey_b64],
      ["signature", sig === c.mldsa_sig_b64],
      ["verify", glue.mldsa44_verify_b64(c.mldsa_pubkey_b64, c.mldsa_sig_b64, msg) === true],
      ["pubkey is 1312 B", Buffer.from(kp.pubkey_b64, "base64").length === 1312],
      ["signature is 2420 B", Buffer.from(sig, "base64").length === 2420],
    ];
    for (const [what, ok] of checks) {
      if (!ok) {
        console.error(`FAIL ${dir} case ${i}: ${what} does not match the committed fixture`);
        dirFailures += 1;
        failures += 1;
      }
    }
  }
  if (dirFailures === 0) {
    console.log(`ok   ${dir} — ${cases.length} vectors reproduced`);
  } else {
    console.error(`BAD  ${dir} — ${dirFailures} mismatch(es) across ${cases.length} vectors`);
  }
}

if (failures > 0) {
  console.error(`${failures} mismatch(es): this signer does not agree with the one the node verifies`);
  process.exit(1);
}
