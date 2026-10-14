// Guard for the "What is TET" page (app/try/WhatPanel.tsx) and its translations.
//
//   node --experimental-strip-types scripts/try_what_guard.mjs
//
// 1. No "first" claims, in any language: QRL and others already use post-quantum signatures, so
//    TET claims the combination, never a first. Control: "the first …" is caught.
// 2. No dates beyond Phase 1: the only year anywhere on the page is 2027, on the Phase 1 line; the
//    vision (phases 2–10) has no dates. Control: a vision item with a year is caught.
// 3. The page keeps its honest lines: this demo shows only part of TET; where TET is weaker today
//    (testnet only, one block producer, no audit, very few users); "no dates; the order may change";
//    the volunteer line; QRL named. Control: a page missing one is caught.
// 4. Every string on the page, including the comparison table and the vision list, has Japanese
//    and Hong Kong Chinese.

import { register } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const SRC = readFileSync(new URL("../app/try/WhatPanel.tsx", import.meta.url), "utf8");
const { JA } = await import("../app/try/i18n_ja.ts");
const { ZH_HK } = await import("../app/try/i18n_zh_hk.ts");

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
function mustThrow(name, fn) {
  return check(`control: ${name}`, async () => {
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    assert.ok(threw, "the check did not catch it");
  });
}

/** Every English string the page shows: t("…") literals and the ROWS / VISION arrays. */
function strings(src) {
  const out = new Set();
  for (const m of src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
  const block = (name) => {
    const i = src.indexOf(`export const ${name}`);
    return i < 0 ? "" : src.slice(i, src.indexOf("];", i));
  };
  for (const m of (block("ROWS") + block("VISION")).matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
  return [...out];
}
const pageText = (src, ja = JA, zh = ZH_HK) => {
  const en = strings(src);
  return { en, all: [...en, ...en.map((k) => ja[k] ?? ""), ...en.map((k) => zh[k] ?? "")] };
};

// 1. no "first"
const FIRST = /\bfirst\b|世界初|初の|最初の|初めての|首個|首創|第一個|全球首|首個/i;
const noFirst = (src, ja, zh) => {
  const bad = pageText(src, ja, zh).all.filter((s) => FIRST.test(s));
  assert.deepEqual(bad, [], `"first" claims: ${bad.join(" | ")}`);
};
await check("no \"first\" claims, in any language", () => noFirst(SRC));
await mustThrow("a \"first\" claim is caught", () => noFirst(SRC.replace('"Checking who made something, and when"', '"The first network for checking who made something"')));
await mustThrow("a Japanese \"first\" claim is caught", () => noFirst(SRC, { ...JA, "Checking who made something, and when": "世界初の、作者を確かめるネットワーク" }));

// 1b. No "first" CLAIM anywhere /try or /agents shows (added 2026-10-13). Until then only this page
// was checked. A claim is "the first <blockchain|network|…>", "first-ever", "first of its kind",
// "the first to …", 世界初 / 業界初 / 史上初, 首個 / 首創 / 全球首 / 第一個<區塊鏈|網絡|平台>.
// Ordinary sequence words ("join the set first", "the first post of a thread") are not claims and
// stay allowed on tetnet.org.
export const FIRST_CLAIM = new RegExp(
  [
    "\\b(?:the|world'?s|TET'?s?|our)\\s+first\\s+(?:post-quantum\\s+|quantum[- ]\\w+\\s+|public\\s+|open\\s+)?(?:blockchain|chain|network|ledger|L1|layer[- ]?1|project|platform|system|protocol|wallet|app|OS)\\b",
    "\\bthe\\s+first\\s+to\\s+(?:combine|offer|use|ship|bring|build|run|make)\\b",
    "\\bfirst[- ]ever\\b|\\bfirst of its kind\\b",
    "世界初|業界初|史上初|首個|首創|全球首|第一個(?:區塊鏈|網絡|平台)",
  ].join("|"),
  "i",
);
const shownStrings = (path, text) => {
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    const re = /i18n_[a-z_]+\.ts$|agents_text\.ts$/.test(path) ? /"((?:[^"\\]|\\.)*)"/g : /\bt\("((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    for (const m of line.matchAll(re)) out.push([i + 1, m[1] ?? m[2]]);
  });
  return out;
};
const firstClaims = (files) =>
  files.flatMap(([path, text]) => shownStrings(path, text).filter(([, str]) => FIRST_CLAIM.test(str)).map(([n, str]) => `${path}:${n}: ${str.slice(0, 100)}`));
const shownDirs = ["../app/try/", "../app/agents/"].map((d) => new URL(d, import.meta.url)).filter((u) => existsSync(u));
const shownFiles = shownDirs.flatMap((u) => readdirSync(u).filter((n) => /\.(?:tsx?|mjs)$/.test(n)).map((n) => [`${u.pathname.split("/app/")[1]}${n}`, readFileSync(new URL(n, u), "utf8")]));
await check(`no "first" claim anywhere /try or /agents shows (${shownFiles.length} files)`, () => {
  const bad = firstClaims(shownFiles);
  assert.deepEqual(bad, [], bad.join("\n     "));
});
await check("control: \"first\" claims are caught in any language; ordinary \"first\" isn't", () => {
  for (const c of ["TET is the first post-quantum blockchain.", "The world's first network for checking who made something.", "TET was the first to combine these.", "A first-ever.", "世界初のブロックチェーン", "首個後量子區塊鏈", "第一個區塊鏈"]) {
    assert.equal(firstClaims([["x.tsx", `t("${c}")`]]).length, 1, c);
  }
  for (const ok of ["Join the anonymity set first.", "The first post of the thread…", "the first 128 bits of the .sig.json's SHA-256", "最初の投稿"]) {
    assert.equal(firstClaims([["x.tsx", `t("${ok}")`]]).length, 0, ok);
  }
});

// 2. no dates beyond Phase 1
const PHASE1 = "Phase 1: genesis, the start of the real network. Target: Q1 2027. A target, not a promise; it moves if the work isn't ready.";
const datesOk = (src, ja, zh) => {
  const { en } = pageText(src, ja, zh);
  for (const k of en) {
    for (const s of [k, (ja ?? JA)[k] ?? "", (zh ?? ZH_HK)[k] ?? ""]) {
      const years = [...s.matchAll(/(?:19|20)\d\d/g)].map((m) => m[0]);
      if (k === PHASE1) assert.deepEqual(years, ["2027"], `Phase 1 must name 2027 only: ${s}`);
      else if (k.startsWith("Proof of stake since")) assert.deepEqual(years, ["2022"], "Ethereum's switch year, a past fact");
      else assert.deepEqual(years, [], `a date outside Phase 1: ${s}`);
      if (k !== PHASE1) assert.ok(!/\bQ[1-4]\b|第[1-4一二三四]四半期|第[一二三四]季/.test(s), `a quarter outside Phase 1: ${s}`);
    }
  }
  assert.ok(en.includes(PHASE1), "the Phase 1 line is gone");
};
await check("no dates beyond Phase 1 (the vision is undated)", () => datesOk(SRC));
await mustThrow("a vision item with a year is caught", () => datesOk(SRC.replace('"An outside security audit"', '"An outside security audit (2028)"')));

// 3. honest lines
const REQUIRED = [
  "This demo shows only part of what TET can do.",
  "It's a testnet only: nothing on it is meant to last or has value.",
  "One block producer makes every block.",
  "No security audit has been done.",
  "Very few people use it.",
  "After that: the vision. No dates; the order may change.",
  "TET is a volunteer open-source project. There are no jobs or tokens to offer.",
];
const honest = (src) => {
  const { en } = pageText(src);
  for (const r of REQUIRED) assert.ok(en.includes(r), `missing: ${r}`);
  assert.ok(en.some((s) => /QRL/.test(s)), "QRL isn't named (the combination, not a first)");
};
await check("the page keeps its honest lines", () => honest(SRC));
await mustThrow("a page missing the weaker-today line is caught", () => honest(SRC.replace('t("No security audit has been done.")', 't("Audited.")')));

// 4. translations
await check("every string on the page has Japanese and Hong Kong Chinese", () => {
  const missing = strings(SRC).filter((k) => !JA[k] || !ZH_HK[k]);
  assert.deepEqual(missing, []);
});

// "Get involved" points everyone to Discussions (enabled on the repo), developers to issues and PRs.
const involved = (src) => {
  assert.match(src, /href=\{`\$\{REPO\}\/discussions`\}/, "no Discussions link");
  assert.match(src, /href=\{`\$\{REPO\}\/issues`\}/, "no Issues link");
};
await check("\"Get involved\" links Discussions and Issues", () => involved(SRC));
await check("control: a page without the Discussions link is caught", () => {
  assert.throws(() => involved(SRC.replace("/discussions`}", "/wiki`}")));
});

// Quantum resistance is incomplete until Phase 1 (wallet_id_v2: the wallet ID is still the Ed25519
// key; the ML-DSA key isn't bound to it — SECURITY.md). The comparison row can't say "Yes", and
// What is TET and About say the limit.
const ABOUT = readFileSync(new URL("../app/try/AboutPanel.tsx", import.meta.url), "utf8");
function quantumHonest(what, about) {
  const row = what.match(/\["Post-quantum signatures today",[^\]]*\]/)?.[0] ?? "";
  assert.ok(row, "the comparison row is missing");
  assert.doesNotMatch(row.split(",").slice(3).join(","), /"Yes/, "the TET cell claims full post-quantum signatures today");
  assert.match(row, /until Phase 1/, "the TET cell doesn't say it's incomplete until Phase 1");
  assert.match(what, /isn't bound to it until the Phase 1 genesis/, "What is TET doesn't say the ML-DSA key isn't bound yet");
  assert.match(about, /that protection is incomplete/, "About doesn't say the protection is incomplete");
}
await check("quantum resistance is stated as incomplete until Phase 1", () => quantumHonest(SRC, ABOUT));
await check("control: a \"Yes\" row or a missing limit is caught", () => {
  assert.throws(() => quantumHonest(SRC.replace("Partly: every transaction also carries", "Yes: every transaction also carries"), ABOUT));
  assert.throws(() => quantumHonest(SRC.replace("isn't bound to it until the Phase 1 genesis", "is bound to it"), ABOUT));
  assert.throws(() => quantumHonest(SRC, ABOUT.replace("that protection is incomplete", "it is safe")));
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
