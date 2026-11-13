#!/usr/bin/env node
// Weekly tidy report (report only): unused exports, dead files and the longest functions, as one
// Markdown document on stdout. Used by .github/workflows/tidy-report.yml; safe to run anywhere.
//
//   node scripts/tidy_report.mjs [--top N]
//
// Heuristics, not proofs, and the report says so:
// - unused export: an exported name (TS/JS) that appears in no other tracked file;
// - dead file: a TS/JS module under tet-network/ui/app or tet-agent-sdk/src whose base name no other
//   tracked file mentions in an import or require, route entry points (page, layout, route, ...) and
//   scripts excluded;
// - longest functions: brace-matched bodies of `fn` (Rust) and `function` / arrow functions bound to
//   a name (TS/JS), by line count.
// Every list is cut at --top (default 25) and the report states how many there were in all.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TOP = Number(process.argv[process.argv.indexOf("--top") + 1]) || 25;
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const read = (p) => {
  try {
    return readFileSync(`${ROOT}/${p}`, "utf8");
  } catch {
    return "";
  }
};
const JS = /\.(?:tsx?|mjs|cjs|js)$/;
const SKIP = /(^|\/)(node_modules|vendor|public|target|\.next)\/|\.d\.ts$|wallet_client_bundled\.js$|(^|\/)fixtures\//;
const code = tracked.filter((p) => JS.test(p) && !SKIP.test(p));
const rust = tracked.filter((p) => p.endsWith(".rs") && !SKIP.test(p));
const text = new Map([...code, ...rust].map((p) => [p, read(p)]));
const searchable = tracked.filter((p) => /\.(?:tsx?|mjs|cjs|js|rs|ya?ml|json|md|sh|py|html)$/.test(p) && !SKIP.test(p));
const allText = new Map(searchable.map((p) => [p, text.get(p) ?? read(p)]));

// Words each file mentions, for the "appears elsewhere" test.
const wordsOf = new Map([...allText].map(([p, t]) => [p, new Set(t.match(/[A-Za-z_$][\w$]*/g) ?? [])]));
const usedElsewhere = (name, self) => [...wordsOf].some(([p, w]) => p !== self && w.has(name));

// ── unused exports ─────────────────────────────────────────────────────────────────────────────
const NEXT_SPECIAL = new Set(["default", "metadata", "generateMetadata", "viewport", "generateViewport", "dynamic", "revalidate", "runtime", "generateStaticParams", "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "middleware", "config"]);
const unused = [];
for (const p of code) {
  const t = text.get(p);
  for (const m of t.matchAll(/^export\s+(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
    const name = m[1];
    if (NEXT_SPECIAL.has(name)) continue;
    if (!usedElsewhere(name, p)) unused.push(`${p}: ${name}`);
  }
}

// ── dead files ─────────────────────────────────────────────────────────────────────────────────
const ENTRY = /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|opengraph-image|icon|apple-icon|sitemap|robots)\.(tsx?|mjs|js)$|(^|\/)scripts\/|(^|\/)examples\/|next\.config|tailwind\.config|postcss\.config|eslint\.config|(^|\/)test|\.test\./;
const dead = code
  .filter((p) => /^(tet-network\/ui\/app|tet-agent-sdk\/src)\//.test(p) && !ENTRY.test(p))
  .filter((p) => {
    const base = p.split("/").pop().replace(JS, "");
    const pat = new RegExp(`(?:from\\s+|import\\(|require\\()\\s*["'][^"']*\\b${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.(?:tsx?|mjs|js))?["']`);
    return ![...allText].some(([q, t]) => q !== p && pat.test(t));
  });

// ── longest functions ──────────────────────────────────────────────────────────────────────────
function bodyLines(t, openAt) {
  let depth = 0;
  for (let i = openAt; i < t.length; i++) {
    const c = t[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return t.slice(openAt, i).split("\n").length;
  }
  return 0;
}
const fns = [];
for (const [p, t] of text) {
  const re = p.endsWith(".rs")
    ? /\bfn\s+([A-Za-z_]\w*)[^;{]*\{/g
    : /(?:\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{;]*\{|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>\s*\{)/g;
  for (const m of t.matchAll(re)) {
    const name = m[1] ?? m[2];
    const open = m.index + m[0].length - 1;
    const n = bodyLines(t, open);
    const line = t.slice(0, m.index).split("\n").length;
    if (n) fns.push({ where: `${p}:${line}`, name, n });
  }
}
fns.sort((a, b) => b.n - a.n);

// ── report ─────────────────────────────────────────────────────────────────────────────────────
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const list = (items, fmt = (x) => x) => (items.length ? items.slice(0, TOP).map((x) => `- ${fmt(x)}`).join("\n") : "- none");
console.log(`# Weekly tidy report

Commit \`${sha}\`. Report only: nothing was changed. These are heuristics (a name used only through a
re-export, a string or a dynamic import can look unused); check before deleting anything.

## Unused exports (${unused.length}, first ${Math.min(TOP, unused.length)})
An exported name that appears in no other tracked file.

${list(unused, (x) => `\`${x}\``)}

## Dead files (${dead.length}, first ${Math.min(TOP, dead.length)})
A module under tet-network/ui/app or tet-agent-sdk/src that no other file imports (route entry points and scripts excluded).

${list(dead, (x) => `\`${x}\``)}

## Longest functions (${fns.length} found, top ${Math.min(TOP, fns.length)})
${list(fns, (f) => `${f.n} lines: \`${f.name}\` at \`${f.where}\``)}
`);
