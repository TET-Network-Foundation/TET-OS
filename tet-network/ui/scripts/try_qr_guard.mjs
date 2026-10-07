// Guard for TET QR (app/lib/tet_qr.ts): the page's own code.
//
//   node --experimental-strip-types scripts/try_qr_guard.mjs
//
// SECURITY properties:
// 1. Nothing about the document goes before the `#`: the link's path and query are exactly
//    `/try?tab=verify`, so a server (or its logs) sees no hash, key, chain or stamp.
// 2. Only a well-formed QR link pre-fills Verify: wrong version, bad or uppercase hex, a bad chain id,
//    a bad stamp hash, or a different fragment → null; the builder refuses what the parser would.
// 3. Verify says "the QR names this .sig.json" only for the exact bytes: a re-indented copy (the
//    same JSON) is not it. Control: a matcher that compares parsed JSON → FAILED.
// 4. The QR is the link: the library's modules for the same text, error correction M, quiet zone 4.

import { register } from "node:module";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const q = await import("../app/lib/tet_qr.ts");
const sa = await import("../app/lib/sign_anything.ts");
const { activateTryWallet } = await import("../app/lib/try_session.ts");
const qrcode = (await import("qrcode-generator")).default;

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
const env = await sa.signContent(new TextEncoder().encode("contract v3, page 1 of 1\n"), "text/plain", chain);
const sigBytes = sa.sigJsonBytes(env);
const link = {
  sigSha256: q.sigSha256(sigBytes),
  signerEd25519: env.tet.agent_ed25519_pubkey_hex,
  chainId: chain.chainId,
  genesisHash: chain.genesisHash,
  stampTx: "7".repeat(64),
};
const url = q.qrLink("https://try.example/", link);

await check("SECURITY: the link's path and query are /try?tab=verify; everything else is after the #", () => {
  const u = new URL(url);
  assert.equal(u.origin + u.pathname + u.search, "https://try.example/try?tab=verify");
  for (const v of [link.sigSha256, link.signerEd25519, link.stampTx, link.genesisHash]) {
    assert.ok(!(u.origin + u.pathname + u.search).includes(v));
    assert.ok(u.hash.includes(v));
  }
  assert.deepEqual(q.parseQrFragment(u.hash), link);
  const { stampTx: _, ...noStamp } = link;
  assert.deepEqual(q.parseQrFragment(new URL(q.qrLink("https://try.example", noStamp)).hash), noStamp);
});

await check("SECURITY: only a well-formed QR link pre-fills Verify", () => {
  const h = new URL(url).hash;
  const bad = [
    h.replace("tetqr=1", "tetqr=2"),
    h.replace(`s=${link.sigSha256}`, `s=${link.sigSha256.toUpperCase()}`),
    h.replace(`s=${link.sigSha256}`, `s=${link.sigSha256.slice(2)}`),
    h.replace(`k=${link.signerEd25519}`, "k=zz"),
    h.replace("c=tet-local-dev", "c=a%20b"),
    h.replace("g=0x", "g="),
    h.replace(`x=${link.stampTx}`, "x=123"),
    "#board=x",
    "",
  ];
  for (const b of bad) assert.equal(q.parseQrFragment(b), null, b);
  assert.throws(() => q.qrLink("https://try.example", { ...link, sigSha256: "00" }));
});

/** The property in (3), run against a matcher. */
function onlyTheExactBytes(matches) {
  assert.equal(matches(link, sigBytes), true);
  const reindented = new TextEncoder().encode(JSON.stringify(env) + "\n");
  assert.equal(matches(link, reindented), false, "a re-indented copy was taken for the .sig.json");
}

await check("SECURITY: the QR names only the exact .sig.json bytes", () => {
  onlyTheExactBytes(q.qrNamesThese);
});

await check("control: a matcher that compares parsed JSON is caught", () => {
  const byJson = (l, bytes) => JSON.stringify(JSON.parse(new TextDecoder().decode(bytes))) === JSON.stringify(env) && l.sigSha256 === q.sigSha256(sigBytes);
  assert.throws(() => onlyTheExactBytes(byJson));
});

await check("the QR is the link: same modules as the library at error correction M, quiet zone 4", () => {
  const { size, d } = q.qrSvgPath(url);
  const ref = qrcode(0, "M");
  ref.addData(url, "Byte");
  ref.make();
  const n = ref.getModuleCount();
  assert.equal(size, n + 8);
  const dark = new Set(d.match(/M\d+ \d+/g).map((m) => m.slice(1)));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) assert.equal(dark.has(`${c + 4} ${r + 4}`), ref.isDark(r, c));
  assert.ok(n <= 89, `version ${(n - 17) / 4} is too dense to print small`);
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
