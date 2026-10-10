"use client";

/**
 * "Verify this page" (docs/THREAT_MODEL.md rule 6): checks the files this page loaded against the
 * build manifest, and the manifest against the publisher's signature, here in the browser. It says
 * what it can't do: it runs from this site's own code, so a compromised site could serve a checker
 * that lies. The check that doesn't trust this site is scripts/verify_site.mjs on your own machine.
 */
import { useState } from "react";
import { compareFiles, manifestProblems, publisherSignatureFor } from "../lib/site_verify.mjs";
import { verifyRecordOffline, sha256, hex } from "../lib/offline_verify.mjs";
import { mldsa44Verify } from "../lib/pqc";
import marksJson from "../whitepaper/marks.json";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

const MARKS = marksJson as { signer: string; chain: { chainId: string; genesisHash: string } };

type Result =
  | { state: "checking" }
  | { state: "none" }
  | { state: "done"; commit: string; code: string | null; matched: number; changed: string[]; missing: string[] };

async function shaOf(path: string): Promise<string | null> {
  try {
    const r = await fetch(path, { cache: "force-cache" });
    return r.ok ? hex(await sha256(new Uint8Array(await r.arrayBuffer()))) : null;
  } catch {
    return null;
  }
}

export function VerifyThisPage(props: { buildSha: string; repo: string }) {
  const { t } = useLang();
  const [res, setRes] = useState<Result | null>(null);

  async function check() {
    setRes({ state: "checking" });
    const r = await fetch("/build-manifest.json", { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) return setRes({ state: "none" });
    const bytes = new Uint8Array(await r.arrayBuffer());
    let manifest: { commit: string; files: Record<string, string> };
    try {
      manifest = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return setRes({ state: "none" });
    }
    if (manifestProblems(manifest).length) return setRes({ state: "none" });
    const mSha = hex(await sha256(bytes));
    const sr = await fetch(`${BASE}/sigs/search?file=${mSha}&signer=${MARKS.signer}`).catch(() => null);
    const records: string[] = sr && sr.ok ? ((await sr.json()).records ?? []).map((x: { record_b64: string }) => x.record_b64) : [];
    const code = await publisherSignatureFor({ recordsB64: records, manifestSha256: mSha, publisher: MARKS.signer, chain: MARKS.chain, verifyRecordOffline, mldsa44Verify });
    // The files this page loaded (scripts, styles, the page itself), as far as the browser reports them.
    const loaded = new Set([location.pathname]);
    for (const e of performance.getEntriesByType("resource")) {
      const u = new URL(e.name);
      if (u.origin === location.origin && u.pathname in manifest.files) loaded.add(u.pathname);
    }
    const subset = { ...manifest, files: Object.fromEntries([...loaded].filter((p) => p in manifest.files).map((p) => [p, manifest.files[p]])) };
    const got: Record<string, string | null> = {};
    for (const p of Object.keys(subset.files)) got[p] = await shaOf(p);
    const c = compareFiles(subset, got);
    setRes({ state: "done", commit: manifest.commit, code, matched: c.matched.length, changed: c.changed, missing: c.missing });
  }

  return (
    <div className="mb-2 space-y-1 text-[#3d434a]">
      <p>
        <button type="button" className="underline" onClick={() => void check()} disabled={res?.state === "checking"}>
          {t("verify this page")}
        </button>
        {": "}
        {props.buildSha ? t("built from {sha}.", { sha: props.buildSha.slice(0, 10) }) : t("This build doesn't name its commit.")}{" "}
        <a className="underline" href={props.buildSha ? `${props.repo}/tree/${props.buildSha}/tet-network/ui` : `${props.repo}/tree/main/tet-network/ui`} target="_blank" rel="noreferrer">
          {t("source")}
        </a>
      </p>
      {res?.state === "checking" ? <p>{t("Checking…")}</p> : null}
      {res?.state === "none" ? <p>{t("This site serves no build manifest, so there is nothing to compare against.")}</p> : null}
      {res?.state === "done" ? (
        <>
          <p className={res.code && !res.changed.length && !res.missing.length ? "text-[#1e6b35]" : "text-[#9a1c1c]"}>
            {res.code
              ? t("The build manifest (commit {commit}) is signed by TET's publisher ID: proof code {code}.", { commit: res.commit.slice(0, 10), code: res.code })
              : t("The build manifest (commit {commit}) is not signed by TET's publisher ID.", { commit: res.commit.slice(0, 10) })}{" "}
            {res.changed.length || res.missing.length
              ? t("{n} files this page loaded don't match it.", { n: res.changed.length + res.missing.length })
              : t("All {n} files this page loaded match it.", { n: res.matched })}
          </p>
          <p className="text-[13px] text-[#5d646d]">
            {t("This check runs from this site's own code, so a compromised site could serve one that lies. For a check that doesn't trust this site, run scripts/verify_site.mjs from the source on your own computer.")}
          </p>
        </>
      ) : null}
    </div>
  );
}
