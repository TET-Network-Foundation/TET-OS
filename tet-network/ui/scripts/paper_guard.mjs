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
// 6. Images of the paper (previews in docs/, anything in public/paper/) are rendered from the paper's
//    source only: each is listed in public/paper/images.json with its SHA-256 and the exact text it
//    shows, that text must appear in the paper, and any contact line in an image (an email address,
//    "Contact:") must be one the paper's text itself carries. No OCR: an image not listed, or changed
//    since it was rendered, fails. Controls: an unlisted image; a listed one showing a contact line
//    the text doesn't.

import { register } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

// ---- 6. images come from the source only --------------------------------------------------------
const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const f = `${dir}/${n}`;
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}
/** Paper images in the tree: under public/paper/, and paper/whitepaper previews in docs/. */
function paperImages() {
  const inPaper = walk(`${UI}public/paper`).filter((f) => IMAGE.test(f));
  const inDocs = walk(`${ROOT}docs`).filter((f) => IMAGE.test(f) && /phrack|whitepaper|paper/i.test(f.split("/").pop()));
  return [...inPaper, ...inDocs].map((f) => f.slice(ROOT.length));
}
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.]+|\bcontact\s*:/gi;
/** Problems with `images` (repo paths) against `manifest` ({path: {sha256, text}}) and the paper's text. */
function imageProblems(images, manifest, paperText, sha) {
  const out = [];
  for (const f of images) {
    const m = manifest[f];
    if (!m) {
      out.push(`${f}: not rendered from the paper (not in public/paper/images.json)`);
      continue;
    }
    if (sha(f) !== m.sha256) out.push(`${f}: changed since it was rendered`);
    for (const line of String(m.text).split("\n").map((l) => l.trim()).filter(Boolean)) {
      if (!paperText.includes(line)) out.push(`${f}: shows text the paper doesn't have: ${line.slice(0, 60)}`);
      for (const c of line.match(CONTACT) ?? []) if (!paperText.includes(c)) out.push(`${f}: a contact the paper's text doesn't carry: ${c}`);
    }
  }
  return out;
}
{
  const manifestPath = `${UI}public/paper/images.json`;
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const paperText = [paper.TITLE, paper.SUBTITLE, paper.ABSTRACT, ...allText(paper)].join("\n");
  const sha = (f) => createHash("sha256").update(readFileSync(`${ROOT}${f}`)).digest("hex");
  check("every paper image is rendered from the paper's text, with no contact line the text lacks", () => {
    assert.deepEqual(imageProblems(paperImages(), manifest, paperText, sha), []);
  });
  check("control: an unlisted image, and one showing a contact the text lacks, are caught", () => {
    const fake = "docs/paper_preview.png";
    assert.equal(imageProblems([fake], {}, paperText, () => "x").length, 1);
    const listed = { [fake]: { sha256: "x", text: `${paper.TITLE}\nContact: someone@example.com` } };
    assert.ok(imageProblems([fake], listed, paperText, () => "x").some((p) => p.includes("contact")));
    assert.deepEqual(imageProblems([fake], { [fake]: { sha256: "x", text: paper.TITLE } }, paperText, () => "x"), []);
  });
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
