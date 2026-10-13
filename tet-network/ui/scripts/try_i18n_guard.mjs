// Guard for Try TET's languages (app/try/i18n.tsx): every string the try page passes to `t()` has a
// Japanese and a Hong Kong Chinese translation, with the same {placeholders}. Includes Tmail's
// locked disclosures, which stay byte-identical in English and are translated by meaning.
//
//   node --experimental-strip-types scripts/try_i18n_guard.mjs [--missing | --keys]
//
// 1. Every `t("…")` literal in app/try/*.tsx, and every locked disclosure the page passes to t(),
//    has a non-empty entry in JA and ZH_HK.
// 2. A translation keeps exactly the English key's {placeholders} (a dropped {n} would hide a number
//    the notice depends on). Control: a dictionary missing a key, and one with a wrong placeholder,
//    → FAILED.
// 3. The English locked disclosures are the constants themselves (the page passes the constant).
//
// `--missing` prints the keys without a translation (for translating), one per line.

import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const { JA } = await import("../app/try/i18n_ja.ts");
const { ZH_HK } = await import("../app/try/i18n_zh_hk.ts");
const { TMAIL_ANON_DISCLOSURE } = await import("../app/lib/tmail_anon.ts");
const { TMAIL_BURN_DISCLOSURE } = await import("../app/lib/tmail_burn.ts");
const { TMAIL_TIME_LOCK_DISCLOSURE } = await import("../app/lib/tmail_timelock.ts");

const LOCKED = { TMAIL_ANON_DISCLOSURE, TMAIL_BURN_DISCLOSURE, TMAIL_TIME_LOCK_DISCLOSURE };

/** Every key the try page translates: `t("…")` literals, plus constants passed as t(NAME). */
export function pageKeys(sources) {
  const keys = new Set();
  for (const raw of Object.values(sources)) {
    // Comments may quote t("…") without being page text.
    const src = raw
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
    for (const m of src.matchAll(/\bt\(\s*([A-Z][A-Z0-9_]+)\s*[,)]/g)) {
      if (!(m[1] in LOCKED)) throw new Error(`t(${m[1]}): only the locked disclosures may be passed by name`);
      keys.add(LOCKED[m[1]]);
    }
  }
  return keys;
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/** Problems with one dictionary for these keys. */
function dictProblems(name, dict, keys) {
  const out = [];
  for (const k of keys) {
    const v = dict[k];
    if (typeof v !== "string" || !v.trim()) out.push(`${name}: missing "${k}"`);
    else if (placeholders(v) !== placeholders(k)) out.push(`${name}: placeholders differ for "${k}" ({${placeholders(k)}} vs {${placeholders(v)}})`);
  }
  return out;
}

const dir = new URL("../app/try/", import.meta.url);
// The try page, and the other pages that use its dictionaries (the technical paper's page).
const wpDir = new URL("../app/whitepaper/", import.meta.url);
const sources = Object.fromEntries([
  ...readdirSync(dir)
    .filter((n) => /\.tsx?$/.test(n) && !/^i18n_/.test(n))
    .map((n) => [n, readFileSync(new URL(n, dir), "utf8")]),
  ...readdirSync(wpDir)
    .filter((n) => /\.tsx$/.test(n))
    .map((n) => [`whitepaper/${n}`, readFileSync(new URL(n, wpDir), "utf8")]),
]);
const keys = pageKeys(sources);

// `--keys` prints every key the page uses (the dictionary generator keeps exactly these).
if (process.argv.includes("--keys")) {
  for (const k of keys) console.log(JSON.stringify(k));
  process.exit(0);
}

if (process.argv.includes("--missing")) {
  for (const k of keys) if (!JA[k] || !ZH_HK[k]) console.log(JSON.stringify(k));
  process.exit(0);
}

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

await check(`every string on the try page has Japanese and Hong Kong Chinese (${keys.size} strings)`, () => {
  const problems = [...dictProblems("ja", JA, keys), ...dictProblems("zh-HK", ZH_HK, keys)];
  assert.deepEqual(problems.slice(0, 20), []);
});

await check("the locked Tmail disclosures are translated, and English is the constant itself", () => {
  for (const [name, en] of Object.entries(LOCKED)) {
    if (!keys.has(en)) continue;
    assert.ok(JA[en] && ZH_HK[en], `${name} has no translation`);
  }
  assert.ok([...Object.values(sources)].some((s) => /t\(TMAIL_BURN_DISCLOSURE\)/.test(s)), "the burn disclosure is not passed as the constant");
});

await check("control: a missing key and a dropped placeholder are caught", () => {
  const k = "{n} anonymous post left today · about 30 s to prove";
  assert.ok(dictProblems("x", {}, [k]).length === 1);
  assert.ok(dictProblems("x", { [k]: "今日はあと匿名投稿できます" }, [k]).length === 1);
  assert.ok(dictProblems("x", { [k]: "今日の匿名投稿はあと{n}件" }, [k]).length === 0);
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
