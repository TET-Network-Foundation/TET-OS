// Publish the technical paper's two marks (made by paper_build.mjs) to a node's signature registry.
// Run once the demo is open; the records were signed earlier, so the codes don't change.
//
//   TET_TRY_ORIGIN=https://try.stevenexus.org node --experimental-strip-types scripts/paper_publish_marks.mjs
//
// It sends the saved record and the publisher's saved consent; no key is needed here.

import { readFileSync, writeFileSync } from "node:fs";

const ORIGIN = (process.env.TET_TRY_ORIGIN || "http://127.0.0.1:3200").replace(/\/+$/, "");
const marksPath = new URL("../app/whitepaper/marks.json", import.meta.url);
const marks = JSON.parse(readFileSync(marksPath, "utf8"));
for (const k of ["html", "pdf"]) {
  const dir = new URL("../public/paper/marks/", import.meta.url);
  const record = readFileSync(new URL(`${k}.record.json`, dir)).toString("base64");
  const consent = readFileSync(new URL(`${k}.consent.json`, dir)).toString("base64");
  const r = await fetch(`${ORIGIN}/tet-node-api/sigs/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record_b64: record, consent_b64: consent }),
  });
  console.log(`${k} ${marks[k].code}: HTTP ${r.status} ${r.status === 202 ? "published" : await r.text()}`);
  if (r.status !== 202) process.exit(1);
}
marks.published = { origin: ORIGIN, at: new Date().toISOString() };
writeFileSync(marksPath, JSON.stringify(marks, null, 2) + "\n");
