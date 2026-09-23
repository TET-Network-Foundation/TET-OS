/**
 * Tmail burn checks — the two things about burn-after-read that no type checker can catch.
 *
 *   1. The burn-revoke pre-image is byte-identical to the Rust one (cross-language golden vector).
 *   2. The user-facing burn copy is verbatim spec §A.3.2 Layer 3 (locked decision #2).
 *   3. The scheduled-release copy is verbatim spec §A.2.5, in both the node and the UI (R6,
 *      locked decision #1).
 *
 * Part 1 — pre-image — TypeScript side of the cross-language golden vector (spec §A.3.2).
 *
 * The Rust side pins the identical literal in `tet-core/src/tests.rs`
 * (`TMAIL_BURN_REVOKE_GOLDEN_PREIMAGE`,
 * `tmail_burn_revoke_preimage_matches_the_cross_language_golden_vector`).
 *
 * The pre-image is the only thing the browser and the node must agree on byte-for-byte. One extra
 * separator, one un-lowercased wallet id, one reordered field, and every revoke the UI sends comes
 * back 401 — while the message stays on every node. That is the one failure burn-after-read must
 * never produce quietly, and it is invisible to a type checker, so it gets a golden vector.
 *
 * Needs no running node and no crypto: it exercises the string builder only.
 *
 *   node scripts/tmail_burn_preimage_golden.mjs      (or: npm run verify:tmail-burn)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Kept in sync by hand with app/lib/tmail_burn.ts::tmailBurnRevokeAuthMessageBytes. This file is a
// replica for the same reason tmail_interop_step4.mjs is one: the UI libs are TS modules inside a
// Next build and are not importable from a bare node script.
function tmailBurnRevokeAuthMessageBytes(opts) {
  const line =
    `tet tmail burn revoke v1|chain_id=${opts.chainId}|genesis_hash=${opts.genesisHash}` +
    `|msg_id=${opts.msgId.trim()}` +
    `|reader=${opts.readerWalletId.trim().toLowerCase()}` +
    `|read_at_ms=${opts.readAtMs}` +
    `|mldsa_pk=${opts.mldsaPubkeyB64.trim()}`;
  return new TextEncoder().encode(line);
}

const GOLDEN =
  "tet tmail burn revoke v1|chain_id=tet-interop-golden|genesis_hash=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff|msg_id=golden-msg-1|reader=abababababababababababababababababababababababababababababababab|read_at_ms=1700000000000|mldsa_pk=Z29sZGVuLXBr";

const INPUT = {
  chainId: "tet-interop-golden",
  genesisHash: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  msgId: "golden-msg-1",
  readerWalletId: "ab".repeat(32),
  readAtMs: 1700000000000,
  mldsaPubkeyB64: "Z29sZGVuLXBr",
};

let failures = 0;

function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       expected: ${expected}`);
    console.error(`       actual:   ${actual}`);
  }
}

console.log("Tmail burn checks");
console.log("\n[1] burn-revoke pre-image golden vector (TS side)");

check(
  "preimage matches the Rust golden",
  new TextDecoder().decode(tmailBurnRevokeAuthMessageBytes(INPUT)),
  GOLDEN,
);

// Same normalization the Rust pre-image applies: trim + lowercase the reader wallet id.
check(
  "reader wallet id is trimmed and lowercased",
  new TextDecoder().decode(
    tmailBurnRevokeAuthMessageBytes({
      ...INPUT,
      readerWalletId: `  ${"AB".repeat(32)}  `,
    }),
  ),
  GOLDEN,
);

// The domain separator keeps a revoke signature from being replayable as an envelope signature.
check(
  "carries its own domain separator",
  new TextDecoder().decode(tmailBurnRevokeAuthMessageBytes(INPUT)).split("|")[0],
  "tet tmail burn revoke v1",
);

// ---------------------------------------------------------------------------
// [2] The locked burn copy must be verbatim spec §A.3.2 Layer 3 (decision #2).
//
// This is the sentence that stops "best-effort network burn" being read as a cryptographic
// guarantee the protocol does not make (spec risk R4). Softening it is a product decision, not an
// editing decision, so drift between the spec and the shipped string is a build failure.
// ---------------------------------------------------------------------------

console.log("\n[2] locked burn disclosure is verbatim spec §A.3.2 (decision #2)");

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function specDisclosure() {
  const spec = readFileSync(resolve(REPO, "docs/SOVEREIGN_OS_PHASE0_SPEC.md"), "utf8");
  const marker = "**User-facing copy (Steve #2, locked):**";
  const at = spec.indexOf(marker);
  if (at < 0) throw new Error(`spec marker not found: ${marker}`);
  // The quoted block immediately after the marker; join its lines into one sentence.
  const lines = spec.slice(at + marker.length).split("\n");
  const quoted = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "") {
      if (quoted.length > 0) break;
      continue;
    }
    if (!t.startsWith(">")) break;
    quoted.push(t.replace(/^>\s?/, "").trim());
  }
  return quoted.join(" ").trim();
}

/**
 * Read a `const NAME = "..." [+ "..."];` string constant out of a Rust or TypeScript source file.
 *
 * Deliberately does NOT scan to the next `;` -- these disclosures contain semicolons, and doing so
 * truncated the declaration mid-literal, which is how this check first came up empty. It matches
 * the literal sequence directly from the `=` instead.
 *
 * `[\s\S]` rather than `.` in the escape branch: a Rust literal continues across lines with a
 * trailing backslash, and `.` does not match a newline in JS.
 */
function stringConst(file, decl) {
  const src = readFileSync(resolve(REPO, file), "utf8");
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`${decl} not found in ${file}`);
  const m = src.slice(at).match(/=\s*((?:"(?:[^"\\]|\\[\s\S])*"\s*\+?\s*)+)/);
  if (!m) throw new Error(`no string literal for ${decl} in ${file}`);
  const parts = m[1].match(/"(?:[^"\\]|\\[\s\S])*"/g) ?? [];
  if (parts.length === 0) throw new Error(`no string literal for ${decl} in ${file}`);
  // Rust's backslash-newline continuation eats the newline and the following indentation.
  return parts
    .map((p) => JSON.parse(p.replace(/\\\n\s*/g, "")))
    .join("")
    .trim();
}

let spec;
let ui;
try {
  spec = specDisclosure();
  ui = stringConst("tet-network/ui/app/lib/tmail_burn.ts", "export const TMAIL_BURN_DISCLOSURE");
} catch (e) {
  failures += 1;
  console.error(`  FAIL could not read the disclosure: ${e.message}`);
}

if (spec !== undefined && ui !== undefined) {
  check("UI copy equals the spec §A.3.2 copy verbatim", ui, spec);
  check(
    "copy still says it is best-effort",
    /best-effort/i.test(ui) && /may retain/i.test(ui),
    true,
  );
}

// ---------------------------------------------------------------------------
// [3] The locked scheduled-release copy must be verbatim spec §A.2.5 (R6, decision #1).
//
// Same reasoning as [2]. "Time-lock" implies an enforcement this feature does not have; the
// disclosure is the only thing standing between the name and a false promise, and it has to agree
// across the spec, the node and the UI or one of them is lying to somebody.
// ---------------------------------------------------------------------------

console.log("\n[3] locked scheduled-release disclosure is verbatim spec §A.2.5 (R6)");

function blockquoteAfter(marker, file) {
  const text = readFileSync(resolve(REPO, file), "utf8");
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`marker not found in ${file}: ${marker}`);
  const lines = text.slice(at + marker.length).split("\n");
  const quoted = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "") {
      if (quoted.length > 0) break;
      continue;
    }
    if (!t.startsWith(">")) break;
    quoted.push(t.replace(/^>\s?/, "").trim());
  }
  return quoted.join(" ").trim();
}

try {
  const specTl = blockquoteAfter(
    "### A.2.5 User-facing copy (locked — risk R6, decision #1)",
    "docs/SOVEREIGN_OS_PHASE0_SPEC.md",
  );
  const rustTl = stringConst(
    "tet-core/src/tmail/timelock.rs",
    "pub const TMAIL_TIME_LOCK_DISCLOSURE",
  );
  const uiTl = stringConst(
    "tet-network/ui/app/lib/tmail_timelock.ts",
    "export const TMAIL_TIME_LOCK_DISCLOSURE",
  );
  check("node copy equals the spec §A.2.5 copy verbatim", rustTl, specTl);
  check("UI copy equals the spec §A.2.5 copy verbatim", uiTl, specTl);
  check(
    "copy still refuses the word 'lock' as a promise",
    /not an enforced lock/i.test(uiTl) && /could read it sooner/i.test(uiTl),
    true,
  );
} catch (e) {
  failures += 1;
  console.error(`  FAIL could not read the scheduled-release disclosure: ${e.message}`);
}

if (failures > 0) {
  console.error(
    `\n${failures} check(s) failed.\n` +
      "  - A pre-image mismatch means every read receipt the UI sends is rejected 401 and nothing\n" +
      "    burns. Fix both sides and the golden literal together.\n" +
      "  - A disclosure mismatch means shipped copy no longer matches a locked decision (#2 burn,\n" +
      "    #1 scheduled release). Change the spec first, deliberately, or restore the wording.",
  );
  process.exit(1);
}
console.log("\nAll checks passed.");
