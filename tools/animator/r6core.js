/* r6core.js: R6 pose maths shared by the phone animator page and its tests.
   Must match tools/animator/r6core.py exactly (tested by tools/animator/test_parity.py).

   Pose format (what is saved):
     pose[part] = { x, y, z }  degrees, rotation of the part relative to its parent in the part's own
                  axes, applied as R = Rz(z) * Rx(x) * Ry(y)   (Roblox axes: +Y up, character faces -Z)
     pose.Torso.h = height offset in studs (crouch / jump)
   Studio export: Motor6D.Transform  T = C0r^-1 * R * C1r  (limbs), RootJoint T = C0^-1 * ((0,h,0),R) * C1
   The R6 joint table is the classic Roblox one (same values as tools/mocap/cmu_to_r6.py R6_JOINTS). */
(function (root) {
  "use strict";
  const PARTS = ["Torso", "Head", "Right Arm", "Left Arm", "Right Leg", "Left Leg"];
  const SIZES = { Torso: [2, 2, 1], Head: [2, 1, 1], "Right Arm": [1, 2, 1], "Left Arm": [1, 2, 1], "Right Leg": [1, 2, 1], "Left Leg": [1, 2, 1] };
  // quaternions are [w, x, y, z]
  const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  const qconj = q => [q[0], -q[1], -q[2], -q[3]];
  const qaxis = (ax, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return [Math.cos(h), ax[0] * s, ax[1] * s, ax[2] * s]; };
  const qrot = (q, v) => { const p = qmul(qmul(q, [0, v[0], v[1], v[2]]), qconj(q)); return [p[1], p[2], p[3]]; };
  const qnorm = q => { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map(v => v / n); };
  function mat2q(m) { // row-major 3x3
    const t = m[0] + m[4] + m[8]; let s;
    if (t > 0) { s = Math.sqrt(t + 1) * 2; return qnorm([0.25 * s, (m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s]); }
    if (m[0] >= m[4] && m[0] >= m[8]) { s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; return qnorm([(m[7] - m[5]) / s, 0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s]); }
    if (m[4] >= m[8]) { s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; return qnorm([(m[2] - m[6]) / s, (m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s]); }
    s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; return qnorm([(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s]);
  }
  const cf = (x, y, z, ...r) => [[x, y, z], mat2q(r)];
  const cfmul = (a, b) => { const p = qrot(a[1], b[0]); return [[a[0][0] + p[0], a[0][1] + p[1], a[0][2] + p[2]], qnorm(qmul(a[1], b[1]))]; };
  const cfinv = a => { const qi = qconj(a[1]), p = qrot(qi, a[0]); return [[-p[0], -p[1], -p[2]], qi]; };
  const JOINTS = [ // name, part0, part1, C0, C1   (classic R6)
    ["RootJoint", "HumanoidRootPart", "Torso", cf(0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0), cf(0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0)],
    ["Neck", "Torso", "Head", cf(0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0), cf(0, -0.5, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0)],
    ["Right Shoulder", "Torso", "Right Arm", cf(1, 0.5, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0), cf(-0.5, 0.5, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0)],
    ["Left Shoulder", "Torso", "Left Arm", cf(-1, 0.5, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0), cf(0.5, 0.5, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0)],
    ["Right Hip", "Torso", "Right Leg", cf(1, -1, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0), cf(0.5, 1, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0)],
    ["Left Hip", "Torso", "Left Leg", cf(-1, -1, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0), cf(-0.5, 1, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0)],
  ];
  const HRP = [[0, 3, 0], [1, 0, 0, 0]];

  function partRot(p) { // R = Rz(z) * Rx(x) * Ry(y)
    return qnorm(qmul(qmul(qaxis([0, 0, 1], p.z || 0), qaxis([1, 0, 0], p.x || 0)), qaxis([0, 1, 0], p.y || 0)));
  }
  // Motor6D Transforms for a pose: { part: [[x,y,z],[w,x,y,z]] }
  function transforms(pose) {
    const out = {};
    for (const [, , p1, c0, c1] of JOINTS) {
      const pp = pose[p1] || {}, R = partRot(pp);
      if (p1 === "Torso") out[p1] = cfmul(cfmul(cfinv(c0), [[0, pp.h || 0, 0], R]), c1);
      else out[p1] = [[0, 0, 0], qnorm(qmul(qmul(qconj(c0[1]), R), c1[1]))];
    }
    return out;
  }
  // World part CFrames (Part1 = Part0 * C0 * T * C1^-1), HRP standing at (0,3,0)
  function fk(pose) {
    const T = transforms(pose), cfs = { HumanoidRootPart: HRP };
    for (const [, p0, p1, c0, c1] of JOINTS) cfs[p1] = cfmul(cfmul(cfmul(cfs[p0], c0), T[p1]), cfinv(c1));
    return cfs;
  }

  // ---- interpolation between keys ----
  // key = { t, feel: "smooth" | "snap" | "hold", pose }. The feel shapes the segment that STARTS at the key.
  const CHANNELS = [];
  for (const p of PARTS) for (const c of ["x", "y", "z"]) CHANNELS.push([p, c]);
  CHANNELS.push(["Torso", "h"]);
  const val = (key, ch) => ((key.pose[ch[0]] || {})[ch[1]] || 0);
  function tangents(keys, loop, duration) {
    const n = keys.length, T = [];
    for (let i = 0; i < n; i++) {
      const row = [];
      for (const ch of CHANNELS) {
        let m = 0, ok = true, tp, pp, tn, pn;
        if (i > 0 && i < n - 1) { tp = keys[i - 1].t; pp = val(keys[i - 1], ch); tn = keys[i + 1].t; pn = val(keys[i + 1], ch); }
        else if (loop && n >= 3) {
          if (i === 0) { tp = keys[n - 2].t - duration; pp = val(keys[n - 2], ch); tn = keys[1].t; pn = val(keys[1], ch); }
          else { tp = keys[n - 2].t; pp = val(keys[n - 2], ch); tn = keys[1].t + duration; pn = val(keys[1], ch); }
        } else ok = false;
        if (ok) { const p = val(keys[i], ch); if ((p - pp) * (pn - p) > 0) m = (pn - pp) / (tn - tp); }
        row.push(m);
      }
      T.push(row);
    }
    return T;
  }
  const snapEase = s => 1 - Math.pow(1 - s, 3); // fast out, soft landing (cubic out)
  function sample(anim, t, cache) {
    const keys = anim.keys, n = keys.length;
    if (n === 0) return {};
    if (n === 1 || t <= keys[0].t) return clonePose(keys[0].pose);
    if (t >= keys[n - 1].t) return clonePose(keys[n - 1].pose);
    let i = 0; while (i < n - 2 && t >= keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1], dt = b.t - a.t, s = Math.min(1, Math.max(0, (t - a.t) / dt));
    const feel = a.feel || "smooth";
    const T = (cache && cache.T) || tangents(keys, !!anim.loop, keys[n - 1].t);
    const out = {};
    CHANNELS.forEach((ch, c) => {
      const v0 = val(a, ch), v1 = val(b, ch); let v;
      if (feel === "hold") v = s < 1 ? v0 : v1;
      else if (feel === "snap") v = v0 + (v1 - v0) * snapEase(s);
      else { const s2 = s * s, s3 = s2 * s; v = (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * dt * T[i][c] + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * dt * T[i + 1][c]; }
      (out[ch[0]] = out[ch[0]] || {})[ch[1]] = v;
    });
    return out;
  }
  function clonePose(p) { return JSON.parse(JSON.stringify(p || {})); }
  // Frames Studio will play with Linear poses: smooth/snap curves baked at fps, holds kept crisp.
  function bake(anim, fps) {
    const keys = anim.keys, end = keys.length ? keys[keys.length - 1].t : 0, cache = { T: tangents(keys, !!anim.loop, end) };
    const times = new Set();
    for (let k = 0; k * (1 / fps) < end - 1e-6; k++) times.add(+(k / fps).toFixed(4));
    times.add(+end.toFixed(4));
    keys.forEach((k, i) => { times.add(+k.t.toFixed(4)); if ((k.feel === "hold") && i < keys.length - 1) times.add(+(keys[i + 1].t - 1 / 240).toFixed(4)); });
    const sorted = [...times].sort((x, y) => x - y);
    return sorted.map(t => [t, sample(anim, t, cache)]);
  }
  function mirror(pose) {
    const out = clonePose(pose), swap = { "Right Arm": "Left Arm", "Left Arm": "Right Arm", "Right Leg": "Left Leg", "Left Leg": "Right Leg" };
    for (const p of PARTS) {
      const src = pose[swap[p] || p] || {};
      out[p] = { x: src.x || 0, y: -(src.y || 0), z: -(src.z || 0) };
      if (p === "Torso") out[p].h = (pose.Torso || {}).h || 0;
    }
    return out;
  }
  const api = { PARTS, SIZES, JOINTS, transforms, fk, sample, bake, tangents, mirror, partRot, clonePose, qrot, qmul };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.R6 = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
