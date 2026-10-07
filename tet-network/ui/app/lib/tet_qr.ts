/**
 * TET QR: a printable label for a `.sig.json`. Scanning it opens /try Verify, pre-filled.
 *
 * A QR can't hold the signature itself: an ML-DSA-44 signature (2,420 bytes) and its public key
 * (1,312 bytes) are more than a QR's largest size (2,953 bytes). So the QR **names** a `.sig.json`
 * by its SHA-256 and carries what Verify needs around it:
 *
 *     <origin>/try?tab=verify#tetqr=1&s=<sha256 of the .sig.json>&k=<signer Ed25519 hex>
 *                                  &c=<chain id>&g=<genesis hash>[&x=<stamp tx hash>]
 *
 * Everything about the document is after the `#`, which browsers never send to a server. Verify
 * proves the `.sig.json` it's given is the one the QR names only if the bytes hash to `s` exactly;
 * `k` is shown to the reader before that, as a claim.
 */
import qrcode from "qrcode-generator";
import { sha256 } from "@noble/hashes/sha2";

export const QR_FRAGMENT_KEY = "tetqr";

export type QrLink = {
  /** SHA-256 of the exact .sig.json bytes, lowercase hex. */
  sigSha256: string;
  /** The signer's Ed25519 key, lowercase hex (a claim until the .sig.json is checked). */
  signerEd25519: string;
  chainId: string;
  /** 0x + 64 hex. */
  genesisHash: string;
  /** The stamp's fee transaction, if stamped. */
  stampTx?: string;
};

const HEX64 = /^[0-9a-f]{64}$/;
const CHAIN_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function sigSha256(sigBytes: Uint8Array): string {
  return hex(sha256(sigBytes));
}

/** The link a QR carries. `origin` is the page's origin (e.g. https://try.example). */
export function qrLink(origin: string, l: QrLink): string {
  const p = new URLSearchParams();
  p.set(QR_FRAGMENT_KEY, "1");
  p.set("s", l.sigSha256);
  p.set("k", l.signerEd25519);
  p.set("c", l.chainId);
  p.set("g", l.genesisHash);
  if (l.stampTx) p.set("x", l.stampTx);
  if (parseQrFragment(`#${p.toString()}`) === null) throw new Error("Not a valid QR link.");
  return `${origin.replace(/\/+$/, "")}/try?tab=verify#${p.toString()}`;
}

/** The QR fields in a URL fragment (`#tetqr=1&…`), or null if it isn't a well-formed QR link. */
export function parseQrFragment(hash: string): QrLink | null {
  if (!hash.startsWith(`#${QR_FRAGMENT_KEY}=`)) return null;
  const p = new URLSearchParams(hash.slice(1));
  if (p.get(QR_FRAGMENT_KEY) !== "1") return null;
  const s = p.get("s") ?? "";
  const k = p.get("k") ?? "";
  const c = p.get("c") ?? "";
  const g = p.get("g") ?? "";
  const x = p.get("x");
  if (!HEX64.test(s) || !HEX64.test(k) || !CHAIN_ID.test(c) || !/^0x[0-9a-f]{64}$/.test(g)) return null;
  if (x !== null && !HEX64.test(x)) return null;
  return { sigSha256: s, signerEd25519: k, chainId: c, genesisHash: g, ...(x !== null ? { stampTx: x } : {}) };
}

/** Is `sigBytes` exactly the .sig.json the QR names? Byte-exact: a re-indented copy is not. */
export function qrNamesThese(qr: QrLink, sigBytes: Uint8Array): boolean {
  return sigSha256(sigBytes) === qr.sigSha256;
}

/** The QR's dark modules as one SVG path (no innerHTML): error correction M, quiet zone 4. */
export function qrSvgPath(text: string): { size: number; d: string } {
  const q = qrcode(0, "M");
  q.addData(text, "Byte");
  q.make();
  const n = q.getModuleCount();
  const margin = 4;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return { size: n + 2 * margin, d };
}
