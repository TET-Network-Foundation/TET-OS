// The demo page's 3D view: a small hand-written WebGL renderer (boxes, cylinders, lines, one light),
// with a 2D top view when WebGL is not available. No library, nothing fetched.
//
// What the view draws, and from where:
//   - the vehicle, its path and the range ray: the simulation's own telemetry (/state "live");
//   - one marker per record, the "signed log" line of the strip, and red for a refused record: ONLY
//     the records the checker read in its copy (/state "check.records"). logView() takes no other
//     input; test_view3d.mjs fails if the log line or a marker can be moved by changing "live".
// The page server inlines this file into page.html (robotsim.py); the tests load it with node.
(function (root) {
  "use strict";

  // ── what to draw (pure functions; tested) ──────────────────────────────────────────────────────

  function parseValue(v) {
    const out = {};
    if (typeof v !== "string") return out;
    for (const m of v.matchAll(/\b([a-z_][a-z0-9_]*)=(-?[0-9]+(?:\.[0-9]+)?)/gi)) out[m[1].toLowerCase()] = Number(m[2]); // control:field-names
    return out;
  }
  const altOf = (p) => (p.alt != null ? p.alt : p.z != null ? p.z : p.altitude != null ? p.altitude : null);

  // The machines the page knows. The cold-chain box is drawn on its route map (km); the plate reader's run
  // is drawn along a time axis (x = minutes / 10), since it does not move.
  const KINDS = ["drone", "robot", "coldchain", "lab"];
  function place(kind, p) {
    if (kind === "lab") return p.min != null ? { x: p.min / 10, y: 1 } : { x: null, y: null };
    return { x: p.x != null ? p.x : null, y: p.y != null ? p.y : null };
  }

  function vehicleOf(S) {
    if (KINDS.includes(S.vehicle)) return S.vehicle;
    return (S.live || []).some((t) => altOf(t) != null) ? "drone" : "robot";
  }

  function startOf(S) {
    const c = Array.isArray(S.course) && S.course[0];
    return Array.isArray(S.start) ? S.start : c ? c : [0, 0];
  }

  function quantity(vehicle, start) {
    if (vehicle === "drone") return { label: "altitude, m", of: (p) => p.z };
    if (vehicle === "coldchain") return { label: "temperature in the box, °C", of: (p) => (p.temp != null ? p.temp : null) };
    if (vehicle === "lab") return { label: "optical density, OD600", of: (p) => (p.od600 != null ? p.od600 : null) };
    return { label: "distance from the start, m", of: (p) => (p.x == null || p.y == null ? null : Math.hypot(p.x - start[0], p.y - start[1])) };
  }

  // The log, as the checker read it: markers and the strip's "signed log" line. Reads S.check, the
  // vehicle kind and the start point only; never S.live.
  function logView(S) {
    const vehicle = KINDS.includes(S.vehicle) ? S.vehicle : null;
    const recs = S.check && Array.isArray(S.check.records) ? S.check.records : [];
    const pts = recs.map((r) => {
      const p = parseValue(r.value); // control:log-from-records
      const at = place(vehicle, p);
      return { file: r.file, x: at.x, y: at.y, z: altOf(p), temp: p.temp != null ? p.temp : null, od600: p.od600 != null ? p.od600 : null,
        heading: p.heading != null ? p.heading : null, refused: r.status === "refused", status: r.status,
        permit: !!r.permit, reasons: r.reasons || [] };
    });
    const v = vehicle || (pts.some((p) => p.z != null) ? "drone" : "robot");
    const q = quantity(v, startOf(S));
    return { markers: pts.filter((p) => p.x != null && p.y != null), stripLog: pts.map((p) => [p.file, q.of(p)]) };
  }

  // The simulation, live: the vehicle and its path.
  function liveView(S) {
    const vehicle = vehicleOf(S);
    const pts = (S.live || []).map((t) => { const at = place(vehicle, t);
      return { seq: t.seq, x: at.x, y: at.y, z: altOf(t), heading: t.heading, range: t.range, temp: t.temp, od600: t.od600 }; });
    // A vehicle that reports no heading (the drone) faces the way it last moved.
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].heading != null) continue;
      const a = pts[i - 1], b = pts[i];
      pts[i].heading = a && Math.hypot(b.x - a.x, b.y - a.y) > 1e-6 ? (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI : a ? a.heading : 0;
    }
    const q = quantity(vehicle, startOf(S));
    return { vehicle, live: pts, stripLive: pts.map((p) => [p.seq, q.of(p)]), stripLabel: q.label };
  }

  function fenceOf(S, vehicle) {
    const g = S.geofence || {};
    const r = Array.isArray(S.fence) && S.fence.length === 4 && S.fence.every((v) => typeof v === "number") ? S.fence : null;
    const poly = r ? [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] : Array.isArray(g) ? g : Array.isArray(g.polygon) ? g.polygon : null;
    const [W, H] = S.arena || [4, 3];
    return {
      poly: poly && poly.length >= 3 ? poly : [[0, 0], [W, 0], [W, H], [0, H]],
      top: g.ceiling != null ? g.ceiling : S.ceiling != null ? S.ceiling : vehicle === "drone" ? 3 : 0.35,
      label: poly ? "geofence" : vehicle === "drone" ? "flight volume" : "arena wall",
    };
  }

  // Records where the two strip lines part: the log's value differs from the live value of the same step.
  function partings(stripLive, stripLog) {
    const live = new Map(stripLive);
    const out = [];
    for (const [f, v] of stripLog) {
      const l = live.get(f);
      if (l === undefined || (v == null) !== (l == null) || (v != null && Math.abs(v - l) > 1e-6)) out.push(f);
    }
    return out;
  }

  function plan(S) {
    const lv = liveView(S), gv = logView(S);
    return Object.assign({}, lv, gv, { fence: fenceOf(S, lv.vehicle), parted: partings(lv.stripLive, gv.stripLog),
      limit: S.limit && typeof S.limit.value === "number" ? S.limit : null,
      course: S.course || [], closed: lv.vehicle === "robot", home: S.home || null, ceiling: S.ceiling != null ? S.ceiling : null, gate: S.gate || null, permitSeen: !!S.permit_seq, start: startOf(S) });
  }

  // ── matrices (column-major) ────────────────────────────────────────────────────────────────────

  const M = {
    id: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
      return o;
    },
    T(x, y, z) { const m = M.id(); m[12] = x; m[13] = y; m[14] = z; return m; },
    S(x, y, z) { const m = M.id(); m[0] = x; m[5] = y; m[10] = z; return m; },
    Rz(a) { const m = M.id(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
    Rx(a) { const m = M.id(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    persp(fy, asp, n, f) {
      const t = 1 / Math.tan(fy / 2), m = new Float32Array(16);
      m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f);
      return m;
    },
    lookAt(e, c, u) {
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
      const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const f = nrm(sub(c, e)), s = nrm(cr(f, u)), uu = cr(s, f);
      return new Float32Array([s[0], uu[0], -f[0], 0, s[1], uu[1], -f[1], 0, s[2], uu[2], -f[2], 0, -dot(s, e), -dot(uu, e), dot(f, e), 1]);
    },
  };
  // base * T(l) * Rz * Rx * S
  const xf = (base, l, rz, rx, s) => M.mul(base, M.mul(M.T(l[0], l[1], l[2]), M.mul(M.Rz(rz || 0), M.mul(M.Rx(rx || 0), M.S(s[0], s[1], s[2])))));

  // ── meshes: unit box (-0.5..0.5) and unit cylinder (radius 0.5, z -0.5..0.5) ───────────────────

  function boxMesh() {
    const v = [];
    const faces = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    for (const n of faces) {
      const a = n[0] ? [0, 1, 2] : n[1] ? [1, 2, 0] : [2, 0, 1];
      const corner = (u, w) => { const p = [0, 0, 0]; p[a[0]] = n[a[0]] * 0.5; p[a[1]] = u; p[a[2]] = w; return p; };
      const q = [corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5)];
      for (const i of [0, 1, 2, 0, 2, 3]) v.push(...q[i], ...n);
    }
    return new Float32Array(v);
  }
  function cylMesh(seg) {
    const v = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
      const p0 = [0.5 * Math.cos(a0), 0.5 * Math.sin(a0)], p1 = [0.5 * Math.cos(a1), 0.5 * Math.sin(a1)];
      const n0 = [Math.cos(a0), Math.sin(a0), 0], n1 = [Math.cos(a1), Math.sin(a1), 0];
      v.push(p0[0], p0[1], -0.5, ...n0, p1[0], p1[1], -0.5, ...n1, p1[0], p1[1], 0.5, ...n1);
      v.push(p0[0], p0[1], -0.5, ...n0, p1[0], p1[1], 0.5, ...n1, p0[0], p0[1], 0.5, ...n0);
      v.push(0, 0, 0.5, 0, 0, 1, p0[0], p0[1], 0.5, 0, 0, 1, p1[0], p1[1], 0.5, 0, 0, 1);
      v.push(0, 0, -0.5, 0, 0, -1, p1[0], p1[1], -0.5, 0, 0, -1, p0[0], p0[1], -0.5, 0, 0, -1);
    }
    return new Float32Array(v);
  }

  // ── colours ────────────────────────────────────────────────────────────────────────────────────

  // Two themes. "light" is the default (paper and ink); "dark" is a dark grey, not black. The page
  // picks one with View3D.setTheme(); status colours always come with a shape or a word as well.
  const PAL = {
    light: {
      clear: [0.965, 0.957, 0.937, 1], ground: [0.925, 0.918, 0.894, 1], grid: [0.78, 0.776, 0.757, 1], course: [0.17, 0.45, 0.27, 1],
      fence: [0.12, 0.31, 0.55, 0.10], fenceEdge: [0.12, 0.31, 0.55, 0.6], path: [0.22, 0.24, 0.27, 1],
      logLine: [0.6, 0.42, 0.0, 0.85], ok: [0.18, 0.49, 0.2, 1], bad: [0.7, 0.15, 0.12, 1], sel: [0.12, 0.31, 0.55, 1],
      body: [0.97, 0.97, 0.96, 1], dark: [0.2, 0.21, 0.23, 1], blue: [0.12, 0.31, 0.55, 1], red: [0.7, 0.15, 0.12, 1],
      rotor: [0.3, 0.33, 0.38, 0.18], blade: [0.2, 0.22, 0.26, 1], shadow: [0, 0, 0, 0.16], ray: [0.7, 0.15, 0.12, 0.75],
      gate: [0.6, 0.42, 0.0, 1], gateDone: [0.17, 0.45, 0.27, 1], tether: [0.35, 0.37, 0.4, 0.5],
    },
    dark: {
      clear: [0.106, 0.114, 0.129, 1], ground: [0.14, 0.15, 0.17, 1], grid: [0.24, 0.26, 0.29, 1], course: [0.3, 0.62, 0.38, 1],
      fence: [0.5, 0.68, 0.92, 0.12], fenceEdge: [0.5, 0.68, 0.92, 0.6], path: [0.86, 0.87, 0.89, 1],
      logLine: [0.85, 0.65, 0.25, 0.85], ok: [0.36, 0.72, 0.42, 1], bad: [0.93, 0.42, 0.38, 1], sel: [0.5, 0.68, 0.92, 1],
      body: [0.86, 0.88, 0.92, 1], dark: [0.09, 0.1, 0.12, 1], blue: [0.5, 0.68, 0.92, 1], red: [0.93, 0.42, 0.38, 1],
      rotor: [0.85, 0.9, 1.0, 0.22], blade: [0.2, 0.22, 0.26, 1], shadow: [0, 0, 0, 0.35], ray: [0.93, 0.42, 0.38, 0.75],
      gate: [0.85, 0.65, 0.25, 1], gateDone: [0.3, 0.62, 0.38, 1], tether: [0.5, 0.55, 0.62, 0.5],
    },
  };
  // The same, for the 2D top view and the strip (canvas colour strings).
  const PAL2 = {
    light: { bg: "#f6f4ef", ink: "#1d1f23", dim: "#55595f", axis: "#8a8d91", fence: "rgba(31,78,140,.08)", fenceEdge: "rgba(31,78,140,.6)",
      course: "#2b7345", gate: "#9a6a00", live: "#383d45", log: "#9a6a00", ok: "#2e7d32", bad: "#b3261e", sel: "#1f4e8c",
      body: "#ffffff", ceil: "rgba(179,38,30,.7)", part: "rgba(179,38,30,.16)", selBar: "rgba(31,78,140,.35)" },
    dark: { bg: "#1b1d21", ink: "#e4e6ea", dim: "#a3a8b0", axis: "#6b7078", fence: "rgba(128,173,235,.10)", fenceEdge: "rgba(128,173,235,.6)",
      course: "#4d9e61", gate: "#d9a640", live: "#dcdee3", log: "#d9a640", ok: "#5cb86b", bad: "#ee6b61", sel: "#80adeb",
      body: "#e4e6ea", ceil: "rgba(238,107,97,.7)", part: "rgba(238,107,97,.22)", selBar: "rgba(128,173,235,.4)" },
  };
  let C = PAL.light, K = PAL2.light;
  function setTheme(name) { const t = PAL[name] ? name : "light"; C = PAL[t]; K = PAL2[t]; return t; }
  // Reduced motion: the camera jumps instead of easing and the rotors stand still.
  const still = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ── the WebGL renderer ─────────────────────────────────────────────────────────────────────────

  function pickRenderer(canvas3d, want) {
    if (want === "2d") return { kind: "2d", gl: null };
    let gl = null;
    try { gl = canvas3d.getContext("webgl", { antialias: true }) || canvas3d.getContext("experimental-webgl"); } catch (e) { gl = null; }
    return gl ? { kind: "3d", gl } : { kind: "2d", gl: null }; // control:no-webgl
  }

  function GL(gl) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec3 p;attribute vec3 n;uniform mat4 M,VP;varying vec3 vn;void main(){vn=mat3(M)*n;gl_Position=VP*M*vec4(p,1.0);}"));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, "precision mediump float;varying vec3 vn;uniform vec4 c;uniform float lit;void main(){vec3 L=normalize(vec3(0.35,0.25,0.9));float d=lit>0.5?0.42+0.62*max(dot(normalize(vn),L),0.0):1.0;gl_FragColor=vec4(c.rgb*d,c.a);}"));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("shader");
    gl.useProgram(prog);
    const A = { p: gl.getAttribLocation(prog, "p"), n: gl.getAttribLocation(prog, "n") };
    const U = { M: gl.getUniformLocation(prog, "M"), VP: gl.getUniformLocation(prog, "VP"), c: gl.getUniformLocation(prog, "c"), lit: gl.getUniformLocation(prog, "lit") };
    const mk = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return { b, n: data.length / 6 }; };
    const box = mk(boxMesh()), cyl = mk(cylMesh(24));
    const dyn = gl.createBuffer();
    gl.enableVertexAttribArray(A.p); gl.enableVertexAttribArray(A.n);
    const bind = (b) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 24, 12); };
    const I = M.id();
    return {
      frame(w, h, VP) {
        gl.viewport(0, 0, w, h); gl.clearColor(C.clear[0], C.clear[1], C.clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true); gl.uniformMatrix4fv(U.VP, false, VP);
      },
      solid(mesh, m, col) {
        const o = mesh === "box" ? box : cyl;
        bind(o.b); gl.uniformMatrix4fv(U.M, false, m); gl.uniform4fv(U.c, col); gl.uniform1f(U.lit, 1);
        if (col[3] < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
        gl.drawArrays(gl.TRIANGLES, 0, o.n);
        if (col[3] < 1) { gl.disable(gl.BLEND); gl.depthMask(true); }
      },
      // verts: flat [x,y,z,...]; mode "lines" (pairs) or "tris"; unlit
      raw(verts, mode, col) {
        if (!verts.length) return;
        const d = new Float32Array((verts.length / 3) * 6);
        for (let i = 0, j = 0; i < verts.length; i += 3, j += 6) { d[j] = verts[i]; d[j + 1] = verts[i + 1]; d[j + 2] = verts[i + 2]; d[j + 5] = 1; }
        gl.bindBuffer(gl.ARRAY_BUFFER, dyn); gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW); bind(dyn);
        gl.uniformMatrix4fv(U.M, false, I); gl.uniform4fv(U.c, col); gl.uniform1f(U.lit, 0);
        const tr = col[3] < 1;
        if (tr) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
        gl.drawArrays(mode === "lines" ? gl.LINES : gl.TRIANGLES, 0, verts.length / 3);
        if (tr) { gl.disable(gl.BLEND); gl.depthMask(true); }
      },
    };
  }

  const strip = (pts, z) => { const v = []; for (let i = 1; i < pts.length; i++) v.push(pts[i - 1][0], pts[i - 1][1], pts[i - 1][2] != null ? pts[i - 1][2] : z, pts[i][0], pts[i][1], pts[i][2] != null ? pts[i][2] : z); return v; };

  // A machine that is not a vehicle (the cold-chain box, the plate reader): a plain box with a dark lid.
  function drawBox(R, x, y, h, k) {
    const b = M.mul(M.T(x, y, 0), M.Rz(h));
    R.solid("box", xf(b, [0, 0, 0.13 * k], 0, 0, [0.34 * k, 0.24 * k, 0.13 * k]), C.body);
    R.solid("box", xf(b, [0, 0, 0.27 * k], 0, 0, [0.35 * k, 0.25 * k, 0.012 * k]), C.dark);
  }

  function drawRobot(R, x, y, h, k, range) {
    const b = M.mul(M.T(x, y, 0), M.Rz(h));
    R.solid("box", xf(b, [0, 0, 0.1 * k], 0, 0, [0.3 * k, 0.22 * k, 0.1 * k]), C.body);
    R.solid("box", xf(b, [-0.02 * k, 0, 0.156 * k], 0, 0, [0.22 * k, 0.18 * k, 0.012 * k]), C.dark);
    for (const s of [-1, 1]) R.solid("cyl", xf(b, [0.02 * k, s * 0.13 * k, 0.055 * k], 0, Math.PI / 2, [0.11 * k, 0.11 * k, 0.035 * k]), C.dark);
    R.solid("box", xf(b, [-0.12 * k, 0, 0.025 * k], 0, 0, [0.04 * k, 0.04 * k, 0.05 * k]), C.dark);
    R.solid("box", xf(b, [0.13 * k, 0, 0.17 * k], 0, 0, [0.06 * k, 0.1 * k, 0.05 * k]), C.blue);
    R.solid("box", xf(b, [0.165 * k, 0, 0.1 * k], 0, 0, [0.02 * k, 0.06 * k, 0.03 * k]), C.red);
    if (range != null) R.raw([x + Math.cos(h) * 0.17 * k, y + Math.sin(h) * 0.17 * k, 0.17 * k, x + Math.cos(h) * range, y + Math.sin(h) * range, 0.17 * k], "lines", C.ray);
  }

  function drawDrone(R, x, y, z, h, k, spin) {
    R.raw(disc(x, y, 0.004, 0.2 * k, 20), "tris", C.shadow);
    R.raw([x, y, 0.004, x, y, z], "lines", C.tether);
    const b = M.mul(M.T(x, y, z), M.Rz(h));
    R.solid("box", xf(b, [0, 0, 0], 0, 0, [0.14 * k, 0.1 * k, 0.05 * k]), C.body);
    R.solid("box", xf(b, [0.075 * k, 0, 0], 0, 0, [0.02 * k, 0.05 * k, 0.03 * k]), C.red);
    for (const a of [Math.PI / 4, -Math.PI / 4]) R.solid("box", xf(b, [0, 0, 0.01 * k], a, 0, [0.42 * k, 0.025 * k, 0.018 * k]), C.dark);
    let i = 0;
    for (const [sx, sy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const l = [sx * 0.148 * k, sy * 0.148 * k];
      R.solid("cyl", xf(b, [l[0], l[1], 0.025 * k], 0, 0, [0.035 * k, 0.035 * k, 0.04 * k]), C.dark);
      const a = spin * (i++ % 2 ? -1 : 1);
      R.solid("box", xf(b, [l[0], l[1], 0.05 * k], a, 0, [0.19 * k, 0.018 * k, 0.004 * k]), C.blade);
      R.solid("cyl", xf(b, [l[0], l[1], 0.052 * k], 0, 0, [0.2 * k, 0.2 * k, 0.002 * k]), C.rotor);
    }
    for (const s of [-1, 1]) R.solid("box", xf(b, [0, s * 0.05 * k, -0.04 * k], 0, 0, [0.12 * k, 0.008 * k, 0.04 * k]), C.dark);
  }

  function disc(x, y, z, r, seg) {
    const v = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
      v.push(x, y, z, x + r * Math.cos(a0), y + r * Math.sin(a0), z, x + r * Math.cos(a1), y + r * Math.sin(a1), z);
    }
    return v;
  }

  // ── the view: camera, input, 3D and 2D drawing, the strip ──────────────────────────────────────

  function mount(o) {
    const cv3 = o.canvas3d, cv2 = o.canvas2d, st = o.strip;
    let pick = pickRenderer(cv3, o.want);
    let R = null;
    if (pick.kind === "3d") { try { R = GL(pick.gl); } catch (e) { pick = { kind: "2d", gl: null }; } }
    const view = { kind: pick.kind, selected: null, mode: "follow", P: null, onchange: o.onchange || (() => {}) };
    cv3.hidden = view.kind !== "3d"; cv2.hidden = view.kind === "3d";
    const cam = { yaw: -2.2, pitch: 0.62, dist: 5.5, tgt: [2, 1.5, 0], want: [2, 1.5, 0] };
    let last = null, prev = null, tUpd = 0, stepMs = 500, running = false;

    view.update = (S) => {
      const P = plan(S);
      // A new vehicle or area (the page can switch between them): start the camera and the pose again.
      const key = P.vehicle + ":" + P.fence.poly.join(";");
      if (!view.P || key !== view.key) {
        const e = extent(P);
        cam.dist = Math.max(e.w, e.h) * 1.35 + 1; cam.tgt = [e.cx, e.cy, 0]; cam.want = [e.cx, e.cy, 0];
        last = prev = null; view.selected = null; view.key = key;
      }
      const nl = P.live[P.live.length - 1];
      if (nl && (!last || nl.seq !== last.seq || nl.seq < last.seq)) { prev = last && nl.seq > last.seq ? last : null; last = nl; tUpd = now(); }
      stepMs = (S.step_s || 0.5) * 1000; running = !!S.running;
      view.P = P;
      drawStrip(st, P, view.selected);
    };
    const now = () => (root.performance ? root.performance.now() : Date.now());
    const extent = (P) => {
      const xs = P.fence.poly.map((p) => p[0]), ys = P.fence.poly.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    };
    const pose = () => {
      if (!last) return null;
      if (!prev) return last;
      const f = Math.min(1, (now() - tUpd) / stepMs), L = (a, b) => (a == null || b == null ? b : a + (b - a) * f);
      let dh = (last.heading - prev.heading) % 360; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
      return { x: L(prev.x, last.x), y: L(prev.y, last.y), z: L(prev.z, last.z), heading: prev.heading + dh * f, range: last.range };
    };
    const markerZ = (m, P) => (P.vehicle === "drone" ? (m.z != null ? m.z : 0) : 0.02);

    view.setMode = (m) => {
      view.mode = m;
      const P = view.P;
      if (m === "top" && P) { const e = extent(P); cam.want = [e.cx, e.cy, 0]; cam.pitch = 1.553; cam.yaw = -Math.PI / 2; cam.dist = Math.max(e.w, e.h) * 1.25 + 0.5 + (P.vehicle === "drone" ? P.fence.top : 0); }
      if (m === "follow" && P) { const e = extent(P); cam.pitch = Math.min(cam.pitch, 0.9); cam.dist = Math.min(cam.dist, Math.max(e.w, e.h) * 0.9); }
      view.onchange();
    };
    view.focus = (file) => {
      const P = view.P; if (!P) return;
      const m = P.markers.find((x) => x.file === file); if (!m) return;
      view.selected = file; view.mode = "record";
      const e = extent(P);
      cam.want = [m.x, m.y, markerZ(m, P)]; cam.dist = Math.min(cam.dist, Math.max(e.w, e.h) * 0.6); if (cam.pitch > 1.2) cam.pitch = 0.8;
      drawStrip(st, P, file); view.onchange();
    };
    view.step = (d) => {
      const P = view.P; if (!P || !P.markers.length) return;
      const files = P.markers.map((m) => m.file);
      let i = files.indexOf(view.selected);
      i = i < 0 ? (d > 0 ? 0 : files.length - 1) : Math.max(0, Math.min(files.length - 1, i + d));
      view.focus(files[i]);
    };
    view.toggle2d = () => {
      if (view.kind === "3d") view.kind = "2d";
      else if (R) view.kind = "3d";
      cv3.hidden = view.kind !== "3d"; cv2.hidden = view.kind === "3d"; view.onchange();
    };

    // input: drag to turn, wheel or pinch to zoom, arrows and +/- on the focused canvas
    const ptrs = new Map(); let pinch = null;
    const turn = (dx, dy) => { cam.yaw -= dx * 0.008; cam.pitch = Math.max(0.06, Math.min(1.553, cam.pitch + dy * 0.008)); if (view.mode === "top") { view.mode = "free"; view.onchange(); } };
    const zoom = (f) => { const e = view.P ? extent(view.P) : { w: 4, h: 3 }, s = Math.max(e.w, e.h); cam.dist = Math.max(0.15 * s, Math.min(4 * s, cam.dist * f)); };
    cv3.addEventListener("pointerdown", (e) => { cv3.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = null; });
    cv3.addEventListener("pointermove", (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const [px, py] = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoom(pinch / d); pinch = d;
      } else turn(e.clientX - px, e.clientY - py);
    });
    const up = (e) => { ptrs.delete(e.pointerId); pinch = null; };
    cv3.addEventListener("pointerup", up); cv3.addEventListener("pointercancel", up);
    cv3.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    cv3.addEventListener("keydown", (e) => {
      const k = { ArrowLeft: () => turn(-25, 0), ArrowRight: () => turn(25, 0), ArrowUp: () => turn(0, -20), ArrowDown: () => turn(0, 20),
        "+": () => zoom(0.85), "=": () => zoom(0.85), "-": () => zoom(1.18) }[e.key];
      if (k) { e.preventDefault(); k(); }
    });

    function frame() {
      const P = view.P;
      if (P) (view.kind === "3d" ? draw3d : draw2d)(P);
      root.requestAnimationFrame(frame);
    }

    function size(cv) {
      const dpr = Math.min(2, root.devicePixelRatio || 1), w = Math.round(cv.clientWidth * dpr), h = Math.round(w * 0.72);
      if (w > 0 && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; }
    }

    function draw3d(P) {
      size(cv3);
      const g = pose(), e = extent(P), k = P.vehicle === "drone" ? Math.max(1, Math.max(e.w, e.h) / 5) : Math.max(1, Math.max(e.w, e.h) / 6);
      if (view.mode === "follow" && g) cam.want = [g.x, g.y, P.vehicle === "drone" && g.z != null ? g.z : 0];
      for (let i = 0; i < 3; i++) cam.tgt[i] += (cam.want[i] - cam.tgt[i]) * (still() ? 1 : 0.12);
      const t = cam.tgt, cp = Math.cos(cam.pitch);
      const eye = [t[0] + cam.dist * cp * Math.cos(cam.yaw), t[1] + cam.dist * cp * Math.sin(cam.yaw), t[2] + cam.dist * Math.sin(cam.pitch)];
      const VP = M.mul(M.persp(0.8, cv3.width / cv3.height, cam.dist * 0.005, cam.dist * 6 + Math.max(e.w, e.h) * 3), M.lookAt(eye, t, [0, 0, 1]));
      R.frame(cv3.width, cv3.height, VP);
      // ground and grid
      const pad = Math.max(e.w, e.h) * 0.25;
      const gx0 = e.x0 - pad, gx1 = e.x1 + pad, gy0 = e.y0 - pad, gy1 = e.y1 + pad;
      R.raw([gx0, gy0, 0, gx1, gy0, 0, gx1, gy1, 0, gx0, gy0, 0, gx1, gy1, 0, gx0, gy1, 0], "tris", C.ground);
      const raw10 = Math.max(e.w, e.h) / 10, mag = Math.pow(10, Math.floor(Math.log10(raw10))), st1 = raw10 / mag;
      const step = mag * (st1 < 1.5 ? 1 : st1 < 3.5 ? 2 : st1 < 7.5 ? 5 : 10), gl = [];
      for (let x = Math.ceil(gx0 / step) * step; x <= gx1; x += step) gl.push(x, gy0, 0.001, x, gy1, 0.001);
      for (let y = Math.ceil(gy0 / step) * step; y <= gy1; y += step) gl.push(gx0, y, 0.001, gx1, y, 0.001);
      R.raw(gl, "lines", C.grid);
      // course, gate
      const course = (P.home ? [[P.home[0], P.home[1], 0]] : []).concat(P.course, P.closed ? [P.course[0]] : P.home && P.vehicle === "drone" ? [[P.home[0], P.home[1], P.course.length && P.course[P.course.length - 1][2] != null ? P.course[P.course.length - 1][2] : 0]] : []);
      if (course.length > 1) R.raw(strip(course.map((c) => [c[0], c[1], c[2] != null ? c[2] : null]), 0.003), "lines", C.course);
      if (P.home) R.raw(disc(P.home[0], P.home[1], 0.004, 0.03 * Math.max(e.w, e.h), 24), "tris", C.course);
      if (P.gate) R.solid("box", xf(M.id(), [P.gate[0], P.gate[1], 0.01], 0, 0, [0.22, 0.22, 0.02]), P.permitSeen ? C.gateDone : C.gate);
      // live path behind the vehicle
      R.raw(strip(P.live.map((p) => [p.x, p.y, P.vehicle === "drone" ? p.z : null]), 0.006), "lines", C.path);
      // the log: a faint line through the records in file order, and one marker per record
      R.raw(strip(P.markers.map((m) => [m.x, m.y, markerZ(m, P) + 0.004]), 0.024), "lines", C.logLine);
      const ms = 0.045 * k;
      for (const m of P.markers) {
        const sel = m.file === view.selected, s = sel ? ms * 1.9 : m.refused ? ms * 1.4 : ms;
        R.solid("box", xf(M.id(), [m.x, m.y, markerZ(m, P) + s * 0.6], Math.PI / 4, 0, [s, s, s]), sel ? C.sel : m.refused ? C.bad : C.ok);
        if (m.refused) R.raw([m.x, m.y, 0, m.x, m.y, markerZ(m, P) + 0.25 * k], "lines", C.bad);
      }
      // vehicle
      if (g) {
        const h = (g.heading || 0) * Math.PI / 180;
        if (P.vehicle === "drone") drawDrone(R, g.x, g.y, g.z || 0, h, k, running && !still() ? now() * 0.06 : 0.6);
        else if (P.vehicle === "robot") drawRobot(R, g.x, g.y, h, k, g.range);
        else drawBox(R, g.x, g.y, h, k);
      }
      // translucent fence walls, last
      const f = P.fence.poly, wall = [], edge = [];
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length], z = P.fence.top;
        wall.push(a[0], a[1], 0, b[0], b[1], 0, b[0], b[1], z, a[0], a[1], 0, b[0], b[1], z, a[0], a[1], z);
        edge.push(a[0], a[1], z, b[0], b[1], z, a[0], a[1], 0, a[0], a[1], z);
      }
      R.raw(edge, "lines", C.fenceEdge);
      R.raw(wall, "tris", C.fence);
    }

    function draw2d(P) {
      size(cv2);
      const g2 = cv2.getContext("2d"), e = extent(P), W = cv2.width, H = cv2.height;
      const sc = Math.min(W / (e.w * 1.1), H / (e.h * 1.1)), ox = (W - e.w * sc) / 2, oy = (H - e.h * sc) / 2;
      const X = (x) => ox + (x - e.x0) * sc, Y = (y) => H - oy - (y - e.y0) * sc;
      g2.fillStyle = K.bg; g2.fillRect(0, 0, W, H);
      g2.fillStyle = K.fence; g2.strokeStyle = K.fenceEdge; g2.lineWidth = 2; g2.beginPath();
      P.fence.poly.forEach((p, i) => (i ? g2.lineTo(X(p[0]), Y(p[1])) : g2.moveTo(X(p[0]), Y(p[1])))); g2.closePath(); g2.fill(); g2.stroke();
      if (P.course.length) { g2.setLineDash([8, 8]); g2.strokeStyle = K.course; g2.beginPath(); P.course.forEach((c, i) => (i ? g2.lineTo(X(c[0]), Y(c[1])) : g2.moveTo(X(c[0]), Y(c[1])))); if (P.closed) g2.closePath(); g2.stroke(); g2.setLineDash([]); }
      if (P.gate) { g2.fillStyle = K.gate; g2.fillRect(X(P.gate[0]) - 10, Y(P.gate[1]) - 10, 20, 20); }
      g2.strokeStyle = K.live; g2.lineWidth = 2; g2.beginPath();
      P.live.forEach((p, i) => (i ? g2.lineTo(X(p.x), Y(p.y)) : g2.moveTo(X(p.x), Y(p.y)))); g2.stroke();
      g2.strokeStyle = K.log; g2.lineWidth = 1; g2.beginPath();
      P.markers.forEach((m, i) => (i ? g2.lineTo(X(m.x), Y(m.y)) : g2.moveTo(X(m.x), Y(m.y)))); g2.stroke();
      for (const m of P.markers) {
        const sel = m.file === view.selected, r = sel ? 7 : m.refused ? 6 : 3.5;
        // shape as well as colour: a cross for a refused record, a dot for a checked one, a ring round the selected one
        if (m.refused) { g2.strokeStyle = K.bad; g2.lineWidth = 2.5; g2.beginPath(); g2.moveTo(X(m.x) - r, Y(m.y) - r); g2.lineTo(X(m.x) + r, Y(m.y) + r); g2.moveTo(X(m.x) + r, Y(m.y) - r); g2.lineTo(X(m.x) - r, Y(m.y) + r); g2.stroke(); }
        else { g2.fillStyle = K.ok; g2.beginPath(); g2.arc(X(m.x), Y(m.y), sel ? 4 : r, 0, 7); g2.fill(); }
        if (sel) { g2.strokeStyle = K.sel; g2.lineWidth = 2; g2.beginPath(); g2.arc(X(m.x), Y(m.y), r + 3, 0, 7); g2.stroke(); }
      }
      const g = pose();
      if (g) {
        const h = (g.heading || 0) * Math.PI / 180;
        g2.save(); g2.translate(X(g.x), Y(g.y)); g2.rotate(-h);
        g2.fillStyle = K.body; g2.strokeStyle = K.ink; g2.lineWidth = 1; g2.fillRect(-14, -10, 28, 20); g2.strokeRect(-14, -10, 28, 20); g2.fillStyle = K.bad; g2.beginPath(); g2.moveTo(15, 0); g2.lineTo(7, -5); g2.lineTo(7, 5); g2.fill();
        g2.restore();
        if (P.vehicle === "drone" && g.z != null) { g2.fillStyle = K.ink; g2.font = "13px ui-monospace, Menlo, monospace"; g2.fillText(`altitude ${g.z.toFixed(1)} m`, X(g.x) + 16, Y(g.y) - 12); }
      }
      g2.fillStyle = K.dim; g2.font = "13px sans-serif"; g2.textAlign = "right"; g2.fillText("2D top view, north up", W - 10, 20); g2.textAlign = "left";
    }

    root.requestAnimationFrame(frame);
    return view;
  }

  // The strip: the same quantity twice, from the live simulation and from the signed log. Both axes
  // carry their unit: the quantity on the vertical axis, the record number on the horizontal one.
  const STRIP_H = 140;
  function niceStep(span) { const m = Math.pow(10, Math.floor(Math.log10(span / 3 || 1))), r = span / 3 / m; return m * (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10); }
  function drawStrip(cv, P, selected) {
    if (!cv || !cv.getContext) return;
    const dpr = Math.min(2, root.devicePixelRatio || 1), w = Math.round(cv.clientWidth * dpr) || cv.width, h = Math.round(STRIP_H * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext("2d"), left = 46 * dpr, right = 10 * dpr, top = 32 * dpr, bottom = 26 * dpr;
    g.clearRect(0, 0, w, h); g.fillStyle = K.bg; g.fillRect(0, 0, w, h);
    const all = P.stripLive.concat(P.stripLog).filter((p) => p[1] != null);
    g.font = `${11 * dpr}px sans-serif`; g.fillStyle = K.dim;
    g.fillText(`${P.stripLabel}:  `, left, 13 * dpr);
    let lx = left + g.measureText(`${P.stripLabel}:  `).width;
    g.fillStyle = K.live; g.fillText("—— live simulation   ", lx, 13 * dpr); lx += g.measureText("—— live simulation   ").width;
    g.fillStyle = K.log; g.fillText("- - - signed log, as checked", lx, 13 * dpr);
    if (!all.length) return;
    const n = Math.max(...all.map((p) => p[0]), 2), v0 = Math.min(0, ...all.map((p) => p[1]));
    // A line the quantity must stay under: the drone's ceiling, or the limit the scenario names (8 °C for the box).
    const lim = P.vehicle === "drone" && P.ceiling != null ? { value: P.ceiling, label: `ceiling ${P.ceiling} m` } : P.limit;
    const v1 = Math.max(lim ? lim.value : 0, ...all.map((p) => p[1])) * 1.08 || 1;
    const X = (f) => left + ((f - 1) / (n - 1)) * (w - left - right), Y = (v) => h - bottom - ((v - v0) / (v1 - v0)) * (h - top - bottom);
    // axes, ticks and units
    g.strokeStyle = K.axis; g.lineWidth = 1 * dpr; g.beginPath(); g.moveTo(left, top - 4 * dpr); g.lineTo(left, h - bottom); g.lineTo(w - right, h - bottom); g.stroke();
    g.fillStyle = K.dim; g.font = `${10 * dpr}px ui-monospace, Menlo, monospace`; g.textAlign = "right";
    const ys = niceStep(v1 - v0), unit = (P.stripLabel.split(", ").pop() || "");
    for (let v = Math.ceil(v0 / ys) * ys; v <= v1; v += ys) { g.fillText(String(+v.toFixed(3)), left - 5 * dpr, Y(v) + 3 * dpr); g.beginPath(); g.moveTo(left - 3 * dpr, Y(v)); g.lineTo(left, Y(v)); g.stroke(); }
    // the axis title: the whole label when it fits along the axis, else its unit
    g.save(); g.font = `${11 * dpr}px sans-serif`; g.fillStyle = K.ink;
    const title = g.measureText(P.stripLabel).width <= h - top - bottom ? P.stripLabel : unit;
    g.translate(11 * dpr, (top + h - bottom) / 2); g.rotate(-Math.PI / 2); g.textAlign = "center"; g.fillText(title, 0, 0); g.restore();
    g.font = `${10 * dpr}px ui-monospace, Menlo, monospace`; g.fillStyle = K.dim;
    g.textAlign = "center";
    const xs = Math.max(1, niceStep(n - 1));
    for (let f = 1; f <= n; f += f === 1 && xs > 1 ? xs - 1 : xs) { g.fillText(String(f), X(f), h - bottom + 12 * dpr); g.beginPath(); g.moveTo(X(f), h - bottom); g.lineTo(X(f), h - bottom + 3 * dpr); g.stroke(); }
    g.textAlign = "right"; g.fillText("record no.", w - right, h - 3 * dpr); g.textAlign = "left";
    if (lim) {
      g.strokeStyle = K.ceil; g.setLineDash([2 * dpr, 3 * dpr]); g.lineWidth = 1 * dpr; g.beginPath(); g.moveTo(left, Y(lim.value)); g.lineTo(w - right, Y(lim.value)); g.stroke(); g.setLineDash([]);
      g.fillStyle = K.ceil; g.font = `${11 * dpr}px sans-serif`; g.textAlign = "right"; g.fillText(lim.label, w - right, Y(lim.value) - 3 * dpr); g.textAlign = "left";
    }
    for (const f of P.parted) { g.fillStyle = K.part; g.fillRect(X(f) - 3 * dpr, top, 6 * dpr, h - top - bottom); }
    if (selected != null) { g.fillStyle = K.selBar; g.fillRect(X(selected) - 1 * dpr, top, 2 * dpr, h - top - bottom); }
    const line = (pts, col, dash) => {
      g.strokeStyle = col; g.lineWidth = 1.6 * dpr; g.setLineDash(dash ? [5 * dpr, 4 * dpr] : []); g.beginPath();
      let on = false;
      for (const [f, v] of pts) { if (v == null) { on = false; continue; } on ? g.lineTo(X(f), Y(v)) : g.moveTo(X(f), Y(v)); on = true; }
      g.stroke(); g.setLineDash([]);
    };
    line(P.stripLive, K.live, false);
    line(P.stripLog, K.log, true);
    if (P.parted.length) { g.fillStyle = K.bad; g.font = `${11 * dpr}px sans-serif`; g.fillText(`the lines part at record ${P.parted.slice(0, 4).join(", ")}${P.parted.length > 4 ? ", …" : ""}`, left, 27 * dpr); }
  }

  root.View3D = { parseValue, logView, liveView, plan, partings, pickRenderer, mount, setTheme, M };
})(typeof window !== "undefined" ? window : globalThis);
