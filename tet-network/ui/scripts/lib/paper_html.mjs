// The technical paper as one standalone HTML page, rendered from app/whitepaper/paper.ts.
// Deterministic: the same text always gives the same bytes (paper_guard relies on it).
// Callers must have registered ./ts_hooks.mjs (paper.ts is TypeScript).

const paper = await import("../../app/whitepaper/paper.ts");

export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const REPO = "https://github.com/TET-Network-Foundation/TET-OS";

function block(b) {
  if ("p" in b) return `<p>${inline(b.p)}</p>`;
  if ("ul" in b) return `<ul>${b.ul.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`;
  return `<table><thead><tr>${b.table.head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${b.table.rows
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

const CSS = `body{font:16px/1.6 Georgia,"Hiragino Mincho ProN",serif;color:#1c1f23;max-width:46rem;margin:2.5rem auto;padding:0 1.2rem}
h1{font-size:1.9rem;margin:0}h2{font-size:1.35rem;margin:2.2rem 0 .6rem}code{font:.9em ui-monospace,Menlo,monospace;background:#f1f3f5;padding:0 .2em}
.meta,.src{color:#5d646d;font-size:.85rem}.abstract{border-left:2px solid #c9ced4;padding-left:1rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e3e5e8;padding:.35rem .5rem .35rem 0}
a{color:inherit}@media print{body{margin:0 auto}h2{break-after:avoid}.lastpage{break-before:page}}`;

export function paperHtml(extra = "") {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(paper.TITLE)}</title><style>${CSS}</style></head><body>
<h1>${esc(paper.TITLE)}</h1>
<p class="meta">${esc(paper.SUBTITLE)} · ${esc(paper.DATE)} · written against commit <a href="${REPO}/tree/${paper.WRITTEN_AGAINST}">${paper.WRITTEN_AGAINST}</a> · the public seeds run ${esc(paper.SEEDS_RUN)} · this is a testnet; data may be reset</p>
<p class="abstract">${inline(paper.ABSTRACT)}</p>
${paper.SECTIONS.map(
  (s) =>
    `<h2 id="${s.id}">${esc(s.title)}</h2>\n${s.body.map(block).join("\n")}\n<p class="src">Sources: ${s.sources
      .map((f) => `<a href="${REPO}/blob/${paper.WRITTEN_AGAINST}/${f}">${esc(f)}</a>`)
      .join(", ")}</p>`,
).join("\n")}
${extra}</body></html>
`;
}

