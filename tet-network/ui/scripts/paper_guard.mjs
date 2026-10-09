// Guard for the technical paper (app/whitepaper/paper.ts and its built files).
//
//   node --experimental-strip-types scripts/paper_guard.mjs
//
// 1. Every file a section cites exists in this tree (the paper's commit). Control: a made-up path.
// 2. The paper states a full 40-hex commit, and the page shows it.
// 3. public/paper/tet-technical-paper.html is exactly what paper.ts renders (rebuild with
//    paper_build.mjs after editing the text). Control: one changed word.
// 4. The marks (app/whitepaper/marks.json) match: each file's SHA-256, each code = proofCode(record),
//    and each record signs that file's SHA-256.
// 5. Wording, as on the rest of the site: no "first" claims, no money words, no "untraceable", never
//    "proves you made it", no absolute AI claims, ML-KEM only as "not"/"move to", and quantum
//    resistance stated as incomplete until wallet_id_v2. Controls.

import { register } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const UI = fileURLToPath(new URL("../", import.meta.url));
const paper = await import("../app/whitepaper/paper.ts");
const { paperHtml } = await import("./lib/paper_html.mjs");
const { proofCode } = await import("../app/lib/proof_code.ts");
// The money guard's own pattern (one definition): importing that guard would run it.
const MONEY = (() => {
  const src = readFileSync(new URL("./try_money_guard.mjs", import.meta.url), "utf8");
  const m = src.match(/export const MONEY = (new RegExp\([\s\S]*?\n\);)/);
  if (!m) throw new Error("try_money_guard.mjs: MONEY pattern not found");
  return (0, eval)(m[1]);
})();

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

const cited = (sections) => [...new Set(sections.flatMap((s) => s.sources))];
const missing = (sections) => cited(sections).filter((f) => !existsSync(`${ROOT}${f}`));
check(`every cited source exists (${cited(paper.SECTIONS).length} files)`, () => assert.deepEqual(missing(paper.SECTIONS), []));
check("control: a made-up cited path is caught", () =>
  assert.deepEqual(missing([{ sources: ["tet-core/src/does_not_exist.rs"] }]), ["tet-core/src/does_not_exist.rs"]),
);

check("the paper states the full commit it was written against, and the page shows it", () => {
  assert.match(paper.WRITTEN_AGAINST, /^[0-9a-f]{40}$/);
  const page = readFileSync(`${UI}app/whitepaper/page.tsx`, "utf8");
  assert.match(page, /WRITTEN_AGAINST/);
  assert.ok(paperHtml().includes(paper.WRITTEN_AGAINST));
});

const built = readFileSync(`${UI}public/paper/tet-technical-paper.html`, "utf8");
check("the built HTML is exactly what paper.ts renders", () => assert.ok(built === paperHtml(), "rebuild: node --experimental-strip-types scripts/paper_build.mjs"));
check("control: one changed word is caught", () => assert.notEqual(built.replace("Architecture", "Architektur"), paperHtml()));

const marks = JSON.parse(readFileSync(`${UI}app/whitepaper/marks.json`, "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
function marksMatch(m) {
  for (const k of ["html", "pdf"]) {
    const mk = m[k];
    assert.ok(mk, `no ${k} mark`);
    const file = readFileSync(`${UI}public/${mk.file}`);
    assert.equal(sha(file), mk.sha256, `${k}: the file changed after it was marked`);
    const rec = readFileSync(`${UI}public/paper/marks/${k}.record.json`);
    assert.equal(proofCode(new Uint8Array(rec)), mk.code, `${k}: the code isn't the record's`);
    const env = JSON.parse(rec.toString("utf8"));
    assert.equal(Buffer.from(env.payload, "base64").toString("hex"), mk.sha256, `${k}: the record signs another file`);
  }
}
check("the marks match the files and the records", () => marksMatch(marks));
check("control: a file hash that doesn't match is caught", () => assert.throws(() => marksMatch({ ...marks, pdf: { ...marks.pdf, sha256: "0".repeat(64) } })));

const allText = (p) =>
  [p.TITLE, p.SUBTITLE, p.ABSTRACT, ...p.SECTIONS.flatMap((s) => [s.title, ...s.body.flatMap((b) => ("p" in b ? [b.p] : "ul" in b ? b.ul : [...b.table.head, ...b.table.rows.flat()]))])];
const RULES = [
  ["a \"first\" claim", /\bfirst\b|世界初|初の/i],
  ["money wording", MONEY],
  ["\"untraceable\"", /untraceable|追跡不可能|無法追蹤/i],
  ["an authorship claim", /prove[sd]?\s+(?:that\s+)?you\s+(?:made|created|wrote)|proves?\s+(?:who\s+)?(?:the\s+)?author(?:ship)?\b(?!\s+is)/i],
  ["an absolute AI claim", /\bAI\s+(?:cannot|can't)\s+(?:access|enter)|AI[- ]free\b[^.]{0,30}guarantee/i],
  ["an unqualified ML-KEM claim", /^(?![\s\S]*(?:\bnot\b|move|moving|legacy|byte-incompatible))[\s\S]*\bML-KEM/i],
];
function wording(texts) {
  const bad = [];
  for (const t of texts) for (const [what, re] of RULES) if (re.test(t)) bad.push(`${what}: ${t.slice(0, 90)}`);
  return bad;
}
check("the paper keeps the site's wording rules", () => {
  const bad = wording(allText(paper));
  assert.deepEqual(bad, [], bad.join("\n     "));
});
check("controls: each rule catches its phrase", () => {
  for (const x of ["The first network with this.", "Earn TET by running a node.", "Messages are untraceable.", "A mark proves you made it.", "AI cannot access TET.", "Tmail uses ML-KEM-768."]) {
    assert.equal(wording([x]).length, 1, x);
  }
});
check("quantum resistance is stated as incomplete until wallet_id_v2", () => {
  const t = allText(paper).join("\n");
  assert.match(t, /quantum resistance is incomplete until `wallet_id_v2`/);
  assert.match(t, /forging a transaction will require breaking both Ed25519 and ML-DSA-44/);
  assert.doesNotMatch(t, /fully quantum[- ]resistant|quantum[- ]proof|quantum[- ]safe/i);
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
