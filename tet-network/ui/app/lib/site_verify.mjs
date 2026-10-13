// "Verify this page" (docs/THREAT_MODEL.md rule 6): the build manifest lists every file the demo
// serves with its SHA-256 (scripts/build_manifest.mjs); the publisher signs the manifest's SHA-256
// like any mark; a checker fetches the files and compares. Pure helpers shared by the CLI
// (scripts/verify_site.mjs), the page and the guard (scripts/build_manifest_guard.mjs).

export const MANIFEST_KIND = "tet-build-manifest";

/** The manifest's canonical bytes: keys sorted, no whitespace, so the same build gives the same bytes. */
export function manifestBytes(m) {
  const files = Object.fromEntries(Object.keys(m.files).sort().map((k) => [k, m.files[k]]));
  return new TextEncoder().encode(JSON.stringify({ v: 1, kind: MANIFEST_KIND, commit: m.commit, files }) + "\n");
}

/** A manifest as published: the right kind, a commit, paths starting with "/", 64-hex hashes. */
export function manifestProblems(m) {
  const p = [];
  if (!m || m.v !== 1 || m.kind !== MANIFEST_KIND) p.push("not a TET build manifest");
  if (typeof m?.commit !== "string") p.push("no commit");
  for (const [k, v] of Object.entries(m?.files ?? {})) {
    if (!k.startsWith("/")) p.push(`path ${k}`);
    if (!/^[0-9a-f]{64}$/.test(String(v))) p.push(`hash for ${k}`);
  }
  if (!Object.keys(m?.files ?? {}).length) p.push("no files");
  return p;
}

/**
 * Compare what was fetched with the manifest. `got` maps a path to the SHA-256 of what was
 * served, or null if it couldn't be fetched.
 * @returns {{ matched: string[], changed: string[], missing: string[], unlisted: string[] }}
 */
export function compareFiles(manifest, got) {
  const out = { matched: [], changed: [], missing: [], unlisted: [] };
  for (const [path, want] of Object.entries(manifest.files)) {
    if (!(path in got) || got[path] === null) out.missing.push(path);
    else if (got[path] === want) out.matched.push(path);
    else out.changed.push(path);
  }
  for (const path of Object.keys(got)) if (!(path in manifest.files)) out.unlisted.push(path);
  return out;
}

/**
 * Among signature records (base64, from the registry), one by `publisher` over `manifestSha256`,
 * verified here (both signatures, the chain binding). Returns its proof code, or null.
 */
export async function publisherSignatureFor({ recordsB64, manifestSha256, publisher, chain, verifyRecordOffline, mldsa44Verify }) {
  for (const b64 of recordsB64) {
    const recordBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const r = await verifyRecordOffline({ recordBytes, file: null, chain, mldsa44Verify });
    if (r.ok && r.signer === publisher && r.signedSha256 === manifestSha256) return r.proofCode;
  }
  return null;
}
