// The build manifest: every file the demo serves to a browser, with its SHA-256, written to
// public/build-manifest.json after `next build` (the Dockerfile runs it). The publisher signs the
// manifest's SHA-256 (scripts/sign_build_manifest.mjs); anyone checks a live site against it
// (scripts/verify_site.mjs, or "verify this page"). docs/THREAT_MODEL.md rule 6.
//
//   NEXT_PUBLIC_TET_BUILD_SHA=<commit> node scripts/build_manifest.mjs [--out <file>]
//
// What is listed is exactly what deploy/demo/Caddyfile's `@page` matcher serves (build_manifest_guard
// checks the two lists agree): the prerendered /try and /whitepaper pages, the app icons, and every
// file under the served public folders and /_next/static. The same build gives the same bytes: keys
// sorted, and the build id is the commit (next.config.ts).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestBytes } from "../app/lib/site_verify.mjs";

const UI = fileURLToPath(new URL("../", import.meta.url));

/** The paths deploy/demo/Caddyfile serves from the UI (`@page`), besides the node API. */
export const SERVED = {
  exact: ["/try", "/whitepaper", "/build-manifest.json", "/favicon.ico", "/apple-icon.png"],
  prefixes: ["/paper/", "/verify/", "/_next/static/", "/pqc/", "/brand/"],
};

const sha = (b) => createHash("sha256").update(b).digest("hex");
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

/** Build the manifest object from a UI directory after `next build`. */
export function buildManifest(ui = UI, commit = process.env.NEXT_PUBLIC_TET_BUILD_SHA || "") {
  const files = {};
  const add = (path, file) => {
    // Dotfiles (a folder's .gitignore) aren't served.
    if (path.split("/").some((seg) => seg.startsWith("."))) return;
    const served = SERVED.exact.includes(path) || SERVED.prefixes.some((p) => path.startsWith(p));
    if (served && path !== "/build-manifest.json") files[path] = sha(readFileSync(file));
  };
  for (const f of walk(join(ui, ".next/static"))) add("/_next/static/" + relative(join(ui, ".next/static"), f).split("\\").join("/"), f);
  for (const f of walk(join(ui, "public"))) add("/" + relative(join(ui, "public"), f).split("\\").join("/"), f);
  const app = join(ui, ".next/server/app");
  for (const [path, file] of [
    ["/try", "try.html"],
    ["/whitepaper", "whitepaper.html"],
    ["/favicon.ico", "favicon.ico.body"],
    ["/apple-icon.png", "apple-icon.png.body"],
  ]) {
    if (existsSync(join(app, file))) add(path, join(app, file));
  }
  return { v: 1, kind: "tet-build-manifest", commit, files };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--out");
  const out = i > 0 ? process.argv[i + 1] : join(UI, "public/build-manifest.json");
  const m = buildManifest();
  if (!Object.keys(m.files).length) throw new Error("no files: run `next build` first");
  const bytes = manifestBytes(m);
  writeFileSync(out, bytes);
  console.log(`${Object.keys(m.files).length} files, commit ${m.commit || "(none)"}; manifest sha256 ${sha(bytes)} → ${out}`);
}
