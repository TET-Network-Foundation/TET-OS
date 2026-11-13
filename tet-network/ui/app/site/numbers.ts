/**
 * Every number the project site shows is measured or defined somewhere, and says where (owner,
 * 2026-11-13: "only measured numbers, with where they come from"). A page that uses one renders its
 * source with <SourceNote id> (app/site/kit.tsx); scripts/site_guard.mjs (N1) refuses a number in a
 * page's text that no entry here matches, or one whose SourceNote the page does not render.
 *
 * `matches` finds the number in shown text (English and Japanese). Names that contain digits
 * (Ed25519, ML-DSA-44, FIPS 204, PR and paper numbers, dates) are not quantities; site_guard lists
 * them separately.
 */
export type Measured = {
  value: string;
  what: string;
  source: { label: string; href: string };
  matches: RegExp;
};

const REPO = "https://github.com/TET-Network-Foundation/TET-OS";

export const NUMBERS = {
  "ci-tests": {
    value: "424",
    what: "Rust tests passed in CI (cargo test --workspace: 15 test binaries, 0 failed, 14 ignored)",
    source: { label: "CI run 43314464208, rust job, main at 7c73094", href: `${REPO}/actions/runs/43314464208/job/131518786764` },
    matches: /\b424\b/,
  },
  "receipt-size": {
    value: "239.0 KiB",
    what: "one real zero-knowledge receipt (244,778 bytes), verified against the guest image",
    source: { label: "docs/SPRINT_PLAN.md, S8-1 measurement (2026-09-24)", href: `${REPO}/blob/main/docs/SPRINT_PLAN.md` },
    matches: /239(?:\.0)?\s?KiB|244,778/,
  },
  "prove-time": {
    value: "15.8 s",
    what: "prove wall time for that receipt on an M-series laptop",
    source: { label: "docs/SPRINT_PLAN.md, S8-1 measurement (2026-09-24)", href: `${REPO}/blob/main/docs/SPRINT_PLAN.md` },
    matches: /15\.8\s?(?:s\b|秒)/,
  },
  "signed-bytes": {
    value: "210 bytes",
    what: "the size of the sample record in the terminal capture",
    source: { label: "the terminal capture on this page (tet-cli 0.1.0, 2026-11-13)", href: "#terminal" },
    matches: /\b210\s?(?:bytes|バイト)/,
  },
  "recovery-words": {
    value: "12 words",
    what: "the recovery phrase of a TET key (a BIP-39 phrase of 12 words)",
    source: { label: "BIP-39", href: "https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki" },
    matches: /\b12\s?words|12\s?語|12\s?個の単語/,
  },
} satisfies Record<string, Measured>;

export type NumberId = keyof typeof NUMBERS;
