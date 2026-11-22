// Guard for the demo page's 3D view (view3d.js): every marker and the strip's "signed log" line come
// from the records the checker read in its copy, never from the simulation's own telemetry.
//
//   node prep/demos/robot-sim/test_view3d.mjs           runs the tests (node only, nothing installed)
//   node prep/demos/robot-sim/test_view3d.mjs --plan    reads a /state JSON on stdin, prints the view's
//                                                        plan (test_robotsim.py feeds it a real state)
//
// The states below are shaped like /state; test_robotsim.py runs the same plan() on a state made with
// the real notebook.py and tet-cli. Negative control: controls_view.sh makes logView() read the live
// telemetry instead of the records, and these tests must then fail.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.VIEW3D_JS || path.join(here, "view3d.js");
const box = {};
vm.runInNewContext(fs.readFileSync(file, "utf8"), box);
// Results are copied into this realm: deepStrictEqual compares prototypes, and the vm's arrays are not this realm's.
const J = (x) => JSON.parse(JSON.stringify(x));
const V = { plan: (S) => J(box.View3D.plan(S)), logView: (S) => J(box.View3D.logView(S)), pickRenderer: (c, w) => J({ kind: box.View3D.pickRenderer(c, w).kind }) };

if (process.argv.includes("--plan")) {
  const S = JSON.parse(fs.readFileSync(0, "utf8"));
  const P = V.plan(S);
  process.stdout.write(JSON.stringify({ vehicle: P.vehicle, markers: P.markers, stripLog: P.stripLog, stripLive: P.stripLive, parted: P.parted }));
  process.exit(0);
}

const val = (t) => `x=${t.x.toFixed(3)} y=${t.y.toFixed(3)} heading=${t.heading.toFixed(1)} range=1.000 v=0.35`;
function state(n) {
  const live = [];
  for (let i = 1; i <= n; i++) live.push({ seq: i, x: 0.8 + 0.2 * i, y: 0.8, heading: 0, range: 1, range_true: 1, v: 0.35 });
  for (const t of live) t.value = val(t);
  return {
    arena: [4, 3], course: [[0.8, 0.8], [3.2, 0.8], [3.2, 2.2], [0.8, 2.2]], gate: [3.2, 2.2], step_s: 0.5, running: true,
    live, check: { verdict: "VALID", records: live.map((t) => ({ file: t.seq, seq: t.seq, value: t.value, permit: false, status: "checked", reasons: [] })) },
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

test("the log's markers and line are read from the records, with the live telemetry unreadable", () => {
  const S = state(5);
  const poisoned = new Proxy(S, { get(t, k) { if (k === "live") throw new Error("the log view read S.live"); return t[k]; } });
  const g = V.logView(poisoned);
  assert.equal(g.markers.length, 5);
  assert.deepEqual(g.markers.map((m) => m.x), [1.0, 1.2, 1.4, 1.6, 1.8]);
});

test("moving the live telemetry moves neither a marker nor the signed-log line", () => {
  const S = state(5), T = clone(S);
  for (const t of T.live) { t.x += 1; t.y += 1; t.value = val(t); }
  const a = V.plan(S), b = V.plan(T);
  assert.deepEqual(b.markers, a.markers);
  assert.deepEqual(b.stripLog, a.stripLog);
  assert.notDeepEqual(b.stripLive, a.stripLive);
});

test("an altered record moves its marker and makes the two lines part there, and only there", () => {
  const S = state(6);
  const r = S.check.records[2];
  r.value = r.value.replace(/x=([0-9.]+)/, (_, x) => `x=${(Number(x) + 0.5).toFixed(3)}`);
  r.status = "refused"; r.reasons = ["signature: ..."];
  S.check.verdict = "INVALID";
  const P = V.plan(S);
  const m = P.markers.find((x) => x.file === 3);
  assert.equal(m.refused, true);
  assert.ok(Math.abs(m.x - (S.live[2].x + 0.5)) < 1e-9);
  assert.deepEqual(P.parted, [3]);
  assert.equal(P.markers.filter((x) => x.refused).length, 1);
});

test("two swapped records swap their markers, and the lines part at both", () => {
  const S = state(6);
  const R = S.check.records;
  [R[2].value, R[3].value] = [R[3].value, R[2].value];
  R[2].status = R[3].status = "refused";
  const P = V.plan(S);
  assert.deepEqual(P.parted, [3, 4]);
  assert.ok(Math.abs(P.markers[2].x - S.live[3].x) < 1e-9);
});

test("a record the simulation never made (a second permit use) is a marker and a parting", () => {
  const S = state(4);
  const extra = clone(S.check.records[3]);
  extra.file = 5; extra.permit = true; extra.status = "refused"; extra.reasons = ["permit: ... was already used by record 2"];
  S.check.records.push(extra);
  const P = V.plan(S);
  assert.equal(P.markers.length, 5);
  assert.equal(P.markers[4].refused, true);
  assert.deepEqual(P.parted, [5]);
});

test("an untouched log: every marker is checked and the lines do not part", () => {
  const P = V.plan(state(8));
  assert.equal(P.markers.length, 8);
  assert.ok(P.markers.every((m) => !m.refused));
  assert.deepEqual(P.parted, []);
  assert.equal(P.vehicle, "robot");
});

test("a drone's altitude is read from the record, and the strip draws altitude", () => {
  const S = state(3);
  S.vehicle = "drone";
  S.live.forEach((t, i) => { t.alt = 10 + i; t.value = val(t) + ` alt=${t.alt.toFixed(1)}`; });
  S.check.records.forEach((r, i) => { r.value = S.live[i].value; });
  S.check.records[1].value = S.check.records[1].value.replace(/alt=[0-9.]+/, "alt=55.0");
  const P = V.plan(S);
  assert.equal(P.vehicle, "drone");
  assert.equal(P.stripLabel, "altitude, m");
  assert.deepEqual(P.stripLog.map((p) => p[1]), [10, 55, 12]);
  assert.deepEqual(P.parted, [2]);
  // The drone server sends its geofence as a rectangle and its ceiling: the walls stand on it, that high.
  const F = V.plan(Object.assign(S, { fence: [10, 10, 190, 140], ceiling: 120 })).fence;
  assert.deepEqual(F.poly, [[10, 10], [190, 10], [190, 140], [10, 140]]);
  assert.equal(F.top, 120);
});

test("a cold-chain box's temperature is read from the record, and the strip carries the 8 °C limit", () => {
  const live = [3.9, 9.2, 13.1, 9.9].map((temp, i) => ({ seq: i + 1, min: 15 * (i + 1), temp, door: "closed", x: 20 + 7 * i, y: 30 + 3 * i, batt: 99 }));
  for (const t of live) t.value = `min=${t.min} temp=${t.temp.toFixed(2)} door=closed x=${t.x.toFixed(1)} y=${t.y.toFixed(1)} batt=99.0`;
  const S = { vehicle: "coldchain", arena: [320, 160], course: [[20, 30], [160, 90], [300, 130]], home: [20, 30], limit: { value: 8, label: "limit 8 °C" }, live,
    check: { verdict: "INVALID", records: live.map((t) => ({ file: t.seq, seq: t.seq, value: t.value, permit: false, status: "checked", reasons: [] })) } };
  S.check.records[2].value = S.check.records[2].value.replace(/temp=[0-9.]+/, "temp=7.80");
  const P = V.plan(S);
  assert.equal(P.vehicle, "coldchain");
  assert.equal(P.stripLabel, "temperature in the box, °C");
  assert.deepEqual(P.stripLog.map((p) => p[1]), [3.9, 9.2, 7.8, 9.9]);
  assert.deepEqual(P.parted, [3]);
  assert.deepEqual(P.limit, { value: 8, label: "limit 8 °C" });
  assert.deepEqual(P.markers.map((m) => [m.x, m.y]), live.map((t) => [t.x, t.y]));
});

test("a plate reader's run is placed on a time axis from each record's own minute, and the strip draws OD600", () => {
  const live = [0.05, 0.12, 0.41, 0.24].map((od600, i) => ({ seq: i + 1, min: 5 * i, od600, temp: 37 }));
  for (const t of live) t.value = `min=${t.min} od600=${t.od600.toFixed(3)} temp=37.00`;
  const S = { vehicle: "lab", arena: [12, 2], course: [[0, 1], [12.5, 1]], live,
    check: { verdict: "INVALID", records: live.map((t) => ({ file: t.seq, seq: t.seq, value: t.value, permit: false, status: "checked", reasons: [] })) } };
  // The outlier's record is taken out of the copy: the records left keep their own minutes.
  S.check.records.splice(2, 1);
  const P = V.plan(S);
  assert.equal(P.stripLabel, "optical density, OD600");
  assert.deepEqual(P.markers.map((m) => [m.file, m.x, m.y]), [[1, 0, 1], [2, 0.5, 1], [4, 1.5, 1]]);
  assert.deepEqual(P.stripLog, [[1, 0.05], [2, 0.12], [4, 0.24]]);
  assert.equal(P.closed, false);
});

test("without WebGL the view falls back to the 2D top view", () => {
  assert.equal(V.pickRenderer({ getContext: () => null }).kind, "2d");
  assert.equal(V.pickRenderer({ getContext: () => { throw new Error("no gpu"); } }).kind, "2d");
  assert.equal(V.pickRenderer({ getContext: () => ({}) }, "2d").kind, "2d");
  assert.equal(V.pickRenderer({ getContext: () => ({}) }).kind, "3d");
});
