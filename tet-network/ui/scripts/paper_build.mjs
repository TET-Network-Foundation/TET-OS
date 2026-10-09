// Build the technical paper's files from app/whitepaper/paper.ts, and mark them.
//
//   TET_PAPER_CHAIN_ID=… TET_PAPER_GENESIS_HASH=… [TET_PUBLISHER_WORDS=~/.tet/tet-publisher.words] \
//     node --experimental-strip-types scripts/paper_build.mjs
//
// 1. public/paper/tet-technical-paper.html: the paper's text as one standalone page (deterministic:
//    the same text always gives the same bytes). This is the paper's source file.
// 2. Mark it: a signature record over its SHA-256 by the TET publisher ID, bound to the chain the
//    records will be published on (the testnet's chain id and genesis hash): code A.
// 3. public/paper/tet-technical-paper.pdf: the same page printed by headless Chrome, plus a last page
//    with code A, its QR, the HTML's SHA-256, and what the code covers. A file can't carry its own
//    code, so the PDF shows the code of its text, not of itself.
// 4. Mark the PDF itself: code B, shown next to the download link (app/whitepaper/marks.json).
// Records and the publisher's consents are saved in public/paper/marks/, to publish on the demo once
// it is open (scripts/paper_publish_marks.mjs). Nothing is sent anywhere here.

import { register } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

register("./lib/ts_hooks.mjs", import.meta.url);
process.env.NEXT_PUBLIC_TET_CHAIN_ID ||= process.env.TET_PAPER_CHAIN_ID || "tet-local-dev";
process.env.NEXT_PUBLIC_TET_TREASURY_ADDRESS ||= "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";

const UI = new URL("../", import.meta.url);
const OUT = new URL("public/paper/", UI);
const MARKS_DIR = new URL("public/paper/marks/", UI);
const CHAIN = { chainId: process.env.TET_PAPER_CHAIN_ID ?? "", genesisHash: process.env.TET_PAPER_GENESIS_HASH ?? "" };
if (!CHAIN.chainId || !/^(0x)?[0-9a-f]{64}$/i.test(CHAIN.genesisHash)) {
  console.error("Set TET_PAPER_CHAIN_ID and TET_PAPER_GENESIS_HASH to the chain the marks will be published on.");
  process.exit(2);
}

const paper = await import("../app/whitepaper/paper.ts");
const { qrSvgPath } = await import("../app/lib/tet_qr.ts");
const pc = await import("../app/lib/proof_code.ts");
const { CONSENT_PAYLOAD_TYPE } = pc;
const { signContent, sigJsonBytes } = await import("../app/lib/sign_anything.ts");
const trySession = await import("../app/lib/try_session.ts");

const { paperHtml, esc } = await import("./lib/paper_html.mjs");

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");

/** The publisher ID: TET's own, kept outside the repository. Never made here: a key nobody has
 * written down is a key nobody can recover, so it is made only by scripts/new_publisher_key.mjs. */
function publisherWords() {
  const path = process.env.TET_PUBLISHER_WORDS || join(homedir(), ".tet", "tet-publisher.words");
  if (!existsSync(path)) {
    console.error(`No publisher key at ${path}. Make one in your own terminal: node scripts/new_publisher_key.mjs`);
    process.exit(2);
  }
  return readFileSync(path, "utf8").trim();
}

async function mark(name, bytes) {
  const rec = await pc.signFileHash(bytes, CHAIN);
  const consent = await signContent(createHash("sha256").update(rec.bytes).digest(), CONSENT_PAYLOAD_TYPE, CHAIN);
  mkdirSync(MARKS_DIR, { recursive: true });
  writeFileSync(new URL(`${name}.record.json`, MARKS_DIR), rec.bytes);
  writeFileSync(new URL(`${name}.consent.json`, MARKS_DIR), sigJsonBytes(consent));
  return { code: pc.proofCode(rec.bytes), sha256: sha256hex(bytes), signer: rec.env.tet.agent_ed25519_pubkey_hex };
}

async function printPdf(html, out) {
  const dir = mkdtempSync(join(tmpdir(), "tetpaper-"));
  const src = join(dir, "paper.html");
  writeFileSync(src, html);
  const port = 9900 + Math.floor(Math.random() * 90);
  const chrome = spawn(process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`,
    "--no-first-run",
    "about:blank",
  ], { stdio: "ignore" });
  try {
    let ws;
    for (let i = 0; i < 60 && !ws; i++) {
      try {
        const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === "page");
        if (t) ws = new WebSocket(t.webSocketDebuggerUrl);
      } catch {}
      if (!ws) await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id));
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const t = setTimeout(() => reject(new Error(`no answer to ${method}`)), 60_000);
        pending.set(n, (m) => (clearTimeout(t), resolve(m)));
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    await send("Page.enable");
    await send("Page.navigate", { url: `file://${src}` });
    await new Promise((r) => setTimeout(r, 1500));
    const r = await send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: false,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.7,
      marginBottom: 0.7,
      marginLeft: 0.7,
      marginRight: 0.7,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font:8px sans-serif;color:#888;width:100%;text-align:center">${esc(paper.TITLE)} · <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    writeFileSync(out, Buffer.from(r.result.data, "base64"));
  } finally {
    chrome.kill("SIGKILL");
  }
}

await trySession.activateTryWallet(publisherWords());
mkdirSync(OUT, { recursive: true });

// 1–2. The text, and its mark.
const html = paperHtml();
writeFileSync(new URL("tet-technical-paper.html", OUT), html);
const htmlBytes = new Uint8Array(Buffer.from(html));
const a = await mark("html", htmlBytes);

// 3. The PDF, with code A on its last page.
const verifyLink = `https://try.stevenexus.org/try#code=${a.code}`;
const { size, d } = qrSvgPath(verifyLink);
const last = `<div class="lastpage">
<h2>This paper's proof code</h2>
<p style="font:700 1.7rem ui-monospace,Menlo,monospace;margin:.5rem 0">${a.code}</p>
<svg viewBox="0 0 ${size} ${size}" width="170" height="170" shape-rendering="crispEdges" style="background:#fff"><path d="${d}" fill="#000"/></svg>
<p>The code marks the text of this paper: the file <code>paper/tet-technical-paper.html</code>, SHA-256<br><code style="word-break:break-all">${a.sha256}</code>,<br>marked by TET's publisher ID <code style="word-break:break-all">${a.signer}</code>.</p>
<p>Check it: enter the code at try.stevenexus.org, or scan the QR. Or drop that HTML file into the search box: an exact copy matches; a copy changed by one byte doesn't.</p>
<p class="meta">What it proves: this ID marked exactly that text. What it doesn't prove: who wrote it, or that it is correct. This PDF file has a code of its own, shown next to its download link (a file can't contain its own code).</p>
</div>`;
const pdfPath = new URL("tet-technical-paper.pdf", OUT);
await printPdf(paperHtml(last), pdfPath);

// 4. The PDF's own mark.
const pdfBytes = new Uint8Array(readFileSync(pdfPath));
const b = await mark("pdf", pdfBytes);

writeFileSync(
  new URL("../app/whitepaper/marks.json", import.meta.url),
  JSON.stringify(
    {
      html: { code: a.code, sha256: a.sha256, file: "paper/tet-technical-paper.html" },
      pdf: { code: b.code, sha256: b.sha256, file: "paper/tet-technical-paper.pdf" },
      signer: a.signer,
      chain: CHAIN,
      published: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(`html ${a.code} ${a.sha256}\npdf  ${b.code} ${b.sha256}\nsigner ${a.signer}`);
process.exit(0);
