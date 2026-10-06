// Module hooks that let a guard script import the UI's own TypeScript modules under plain Node,
// so a guard tests the code the page runs rather than a copy of it. No dependency: Node strips the
// types itself (22.6+; run with --experimental-strip-types before 22.18).
//
// - An extensionless relative import (`./tmail`, as Next resolves it) tries `.ts`, `.tsx`, `.mjs`
//   and `.js`, in that order.
// - `/pqc/tet_pqc_wasm.js`, which `lib/pqc.ts` imports from the site root, is served as a shim whose
//   init reads the WASM from disk instead of fetching `/pqc/…`. It uses `public/pqc/` when that has
//   been built, else the repository's one committed copy of the same signer, `tet-agent-sdk/vendor/`
//   (CI's wasm job checks the two are the same build; the ui job has only the committed one).
//
// Use: `import { register } from "node:module"; register("./lib/ts_hooks.mjs", import.meta.url);`
// then import the modules dynamically.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUILT_PQC = new URL("../../public/pqc/", import.meta.url);
const VENDOR_PQC = new URL("../../../../tet-agent-sdk/vendor/", import.meta.url);
const PUBLIC_PQC = existsSync(fileURLToPath(new URL("tet_pqc_wasm.js", BUILT_PQC))) ? BUILT_PQC : VENDOR_PQC;
const PQC_SHIM = "tet-try-shim:pqc";

export async function resolve(specifier, context, next) {
  if (specifier === "/pqc/tet_pqc_wasm.js") return { url: PQC_SHIM, shortCircuit: true };
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = new URL(specifier, context.parentURL);
    if (!/\.[cm]?[jt]sx?$/.test(base.pathname) || !existsSync(fileURLToPath(base))) {
      for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
        const cand = new URL(base.href + ext);
        if (existsSync(fileURLToPath(cand))) return { url: cand.href, shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === PQC_SHIM) {
    const js = new URL("tet_pqc_wasm.js", PUBLIC_PQC).href;
    const wasm = fileURLToPath(new URL("tet_pqc_wasm_bg.wasm", PUBLIC_PQC));
    return {
      format: "module",
      shortCircuit: true,
      source: `
        import init, * as real from ${JSON.stringify(js)};
        import { readFileSync } from "node:fs";
        export default async () => init({ module_or_path: readFileSync(${JSON.stringify(wasm)}) });
        export const mldsa44_keypair_from_mnemonic_b64 = real.mldsa44_keypair_from_mnemonic_b64;
        export const mldsa44_sign_deterministic_b64 = real.mldsa44_sign_deterministic_b64;
        export const mldsa44_verify_b64 = real.mldsa44_verify_b64;
      `,
    };
  }
  return next(url, context);
}

export { pathToFileURL };
