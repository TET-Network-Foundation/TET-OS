// The replay view, on the vendored three.js (vendor/three, see its SHA256SUMS). It draws only what
// /state returns: the track read from the checker's copy of the ULog and each chunk's verdict.
import * as THREE from "three";
import { OrbitControls } from "./vendor/three/addons/OrbitControls.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const OK = 0x2e7d4f, BAD = 0xb3261e, FENCE = 0xe0a100;
let S = null, track = [], playing = false, idx = 0, last = 0;
// playback by log time, not by sample: PX4 logs position at about 100 Hz, the stand-in at 10 Hz
const SPEEDUP = 6;

// NED (x north, y east, alt up) to three.js (X east, Y up, Z south).
const P = (p) => new THREE.Vector3(p.y, p.alt, -p.x);

const view = $("view");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe6ea);
scene.fog = new THREE.Fog(0xdfe6ea, 400, 900);
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
camera.position.set(-190, 150, 190);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 40, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-120, 260, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 10, far: 600 });
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 400), new THREE.MeshStandardMaterial({ color: 0xb9c4a8, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(500, 50, 0x8e9a86, 0xa6b19c);
grid.position.y = 0.05;
scene.add(grid);

// The vehicle: a body, four arms, four rotor discs. Scaled up 10x so it can be seen at 200 m.
function quad() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x30363b, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), mat);
  g.add(body);
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.03), mat);
    arm.position.set(sx * 0.12, 0, sz * 0.12);
    arm.rotation.y = sx * sz > 0 ? -Math.PI / 4 : Math.PI / 4;
    g.add(arm);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.01, 24),
      new THREE.MeshStandardMaterial({ color: 0x9fb3c0, transparent: true, opacity: 0.6 }));
    rotor.position.set(sx * 0.24, 0.05, sz * 0.24);
    g.add(rotor);
  }
  g.traverse((o) => { o.castShadow = true; });
  g.scale.setScalar(10);
  return g;
}
const vehicle = quad();
scene.add(vehicle);

let world = new THREE.Group();
scene.add(world);

function fenceAndCeiling(f, ceiling) {
  const grp = new THREE.Group();
  const w = f.y_max - f.y_min, d = f.x_max - f.x_min;
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, ceiling, d)),
    new THREE.LineBasicMaterial({ color: FENCE }));
  box.position.set((f.y_max + f.y_min) / 2, ceiling / 2, -(f.x_max + f.x_min) / 2);
  grp.add(box);
  const lid = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: FENCE, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  lid.rotation.x = -Math.PI / 2;
  lid.position.set((f.y_max + f.y_min) / 2, ceiling, -(f.x_max + f.x_min) / 2);
  grp.add(lid);
  return grp;
}

function build() {
  scene.remove(world);
  world = new THREE.Group();
  scene.add(world);
  world.add(fenceAndCeiling(S.fence, S.ceiling_m));
  // the trail, coloured by its chunk's verdict
  const pos = [], col = [];
  const ok = new THREE.Color(OK), bad = new THREE.Color(BAD);
  for (let i = 1; i < track.length; i++) {
    for (const p of [track[i - 1], track[i]]) {
      const v = P(p); pos.push(v.x, v.y, v.z);
      const c = track[i].checked ? ok : bad; col.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  world.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
  // the trail's shadow on the ground
  const gpos = track.map((p) => new THREE.Vector3(p.y, 0.1, -p.x));
  world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(gpos), new THREE.LineBasicMaterial({ color: 0x5d6a58, transparent: true, opacity: 0.5 })));
  // one marker per signed chunk, at its first sample
  const seen = new Set();
  for (const p of track) {
    if (p.chunk === null || seen.has(p.chunk)) continue;
    seen.add(p.chunk);
    const m = new THREE.Mesh(new THREE.SphereGeometry(p.checked ? 0.9 : 1.8, 12, 8), new THREE.MeshStandardMaterial({ color: p.checked ? OK : BAD }));
    m.position.copy(P(p));
    m.castShadow = true;
    world.add(m);
  }
}

function place(i) {
  if (!track.length) return;
  idx = Math.max(0, Math.min(track.length - 1, i));
  const p = track[idx];
  vehicle.position.copy(P(p));
  if (p.q) {
    // PX4's q rotates body FRD into NED; map NED axes to three's (east, up, south).
    const [w, x, y, z] = p.q;
    vehicle.quaternion.set(y, -z, -x, w).normalize();
  }
  const outside = p.x < S.fence.x_min || p.x > S.fence.x_max || p.y < S.fence.y_min || p.y > S.fence.y_max;
  $("hud").textContent = `t ${p.t.toFixed(1)} s   alt ${p.alt.toFixed(1)} m${p.alt > S.ceiling_m ? " (above ceiling)" : ""}   ` +
    `x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} m${outside ? " (outside fence)" : ""}   chunk ${p.chunk} ${p.checked ? "checked" : "REFUSED"}`;
  $("scrub").value = Math.round((idx / (track.length - 1)) * 1000);
}

function show() {
  $("source").textContent = S.source;
  const c = S.check;
  $("verdict").textContent = c.verdict;
  $("verdict").className = c.verdict;
  const refused = c.chunks.filter((r) => r.status === "refused");
  $("summary").textContent = `${c.chunks.length} chunks, ${c.chunks.length - refused.length} checked, ${refused.length} refused` +
    (S.tampered ? ` — copy changed: ${S.tampered.name}, ${S.tampered.messages} message(s)` : " — copy as signed");
  $("reasons").innerHTML = refused.map((r) => `<div class="bad">${r.i === null ? "a record that is not a chunk" : `chunk ${r.i}`} (record ${r.record}${r.t0 === undefined ? "" : `, t ${(r.t0 / 1e6).toFixed(0)}–${(r.t1 / 1e6).toFixed(0)} s`}): ${esc(r.reasons.join("; "))}</div>`).join("") +
    c.file.map((w) => `<div class="bad">${esc(w)}</div>`).join("");
  if (S.contact) {
    const L = S.contact.landing.map((r) => `${+r.v_down} m/s: peak ${r.peak_force_n} N (${r.peak_over_weight}× weight), at rest ${r.rest_force_n} N`).join("<br>");
    const R = S.contact.robot.map((r) => `floor friction ${r.mu}: wheels slip ${(r.slip_speeding_up * 100).toFixed(0)} % while speeding up`).join("<br>");
    $("contact").innerHTML = `MuJoCo ${esc(S.contact.mujoco)}. Touchdown of a 1.5 kg frame on four legs:<br>${L}<br>Ground robot:<br>${R}`;
  }
  track = c.track;
  if (!track.length) $("hud").textContent = "nothing to replay: the copy could not be read as a ULog file (see the check)";
  build();
  place(idx);
}

async function load(method, path) {
  const r = await fetch(path, { method });
  S = await r.json();
  show();
}

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

$("t-near").onclick = () => load("POST", "/tamper/near_miss").then(() => place(track.findIndex((p) => !p.checked)));
$("t-fence").onclick = () => load("POST", "/tamper/geofence").then(() => place(track.findIndex((p) => !p.checked)));
$("t-reset").onclick = () => load("POST", "/reset");
$("play").onclick = () => { playing = !playing; $("play").textContent = playing ? "Pause" : "Play"; if (idx >= track.length - 1) idx = 0; };
$("scrub").oninput = (e) => place(Math.round((e.target.value / 1000) * (track.length - 1)));
window.demo = { place: (i) => place(i), frac: (f) => place(Math.round(f * (track.length - 1))), camera, controls, get track() { return track; } };

function tick(now) {
  if (playing && track.length && now - last > 30) {
    const until = track[idx].t + (Math.min(now - last, 200) / 1000) * SPEEDUP;
    last = now;
    let j = idx + 1;
    while (j < track.length - 1 && track[j].t < until) j++;
    place(j);
    if (idx >= track.length - 1) { playing = false; $("play").textContent = "Play"; }
  } else if (!playing) {
    last = now;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
load("GET", "/state").then(() => requestAnimationFrame(tick));
