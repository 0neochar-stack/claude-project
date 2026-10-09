import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYER_MAIN_ONLY } from './wet.js';
import { NEONS, RIMS } from './garage.js';

export const PAINTS = [
  { name: 'Midnight Violet', color: 0x3b1a78 },
  { name: 'Hot Magenta', color: 0xc2186b },
  { name: 'Ice Cyan', color: 0x1aa6c9 },
  { name: 'Pearl White', color: 0xd9dde6 },
  { name: 'Racing Lime', color: 0x7ccf1f },
  { name: 'Gunmetal', color: 0x2a2e36 },
  { name: 'Sunset Orange', color: 0xe0561b },
  { name: 'Burnt Copper', color: 0x9c4a1c },
  { name: 'Graphite', color: 0x3b3e44 },
  { name: 'Candy Red', color: 0xa3101c },
  { name: 'Sky Blue', color: 0x3f86c9 },
  { name: 'Silver Frost', color: 0xb9bec6 },
  { name: 'Bordeaux', color: 0x4e1420 },
  { name: 'Glacier White', color: 0xeef0f2 },
  { name: 'Midnight Black', color: 0x0c0c10 },
  { name: 'Lime Pearl', color: 0xa8d61e },
  { name: 'Bayou Teal', color: 0x1f6f6a },
  { name: 'Matte Grey', color: 0x5d6066 },
  { name: 'Sakura Pink', color: 0xe68aa8 },
];

// Neon room captured into a PMREM so the clearcoat picks up pink and cyan streaks.
export function makeCarEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x05040a);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const strip = (color, x, y, z, sx, sy, sz, k = 6) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    env.add(m);
  };
  strip(0xff2bd6, -6, 3, 0, 0.5, 2, 14, 2.5);
  strip(0x22e6ff, 6, 3, 0, 0.5, 2, 14, 2.5);
  strip(0xffffff, 0, 8, 0, 10, 0.3, 1.2, 3);
  strip(0xffffff, 0, 8, 4, 10, 0.3, 0.6, 2);
  strip(0xffa040, 0, 4, -8, 8, 1.2, 0.5, 3);
  strip(0x6a4cff, 0, 4, 8, 8, 1.2, 0.5, 3);
  const floor = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x1a1024 }));
  floor.scale.set(30, 0.1, 30);
  floor.position.y = -1;
  env.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.03).texture;
  pmrem.dispose();
  return tex;
}

// ---------- shape helpers ----------

// 1D Catmull-Rom through [z, value] keys (ascending z), clamped at both ends.
function curve(keys) {
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    const n = keys.length;
    if (z >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (z > keys[i + 1][0]) i++;
    const p0 = keys[Math.max(0, i - 1)][1], p1 = keys[i][1], p2 = keys[i + 1][1], p3 = keys[Math.min(n - 1, i + 2)][1];
    const t = (z - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
}

// Closed Catmull-Rom through 2D control points: rounds the section outline.
function smoothRing(pts, n) {
  const out = [];
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  return out;
}

// Mirror a right-half outline (bottom centre -> top centre) into a full counter-clockwise ring.
function mirrorHalf(half) {
  const left = half.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return [...half, ...left];
}

// Skin a list of section rings (all the same length, counter-clockwise seen from +z) along z, with end caps.
function loft(rings, zs) {
  const M = rings[0].length, S = rings.length;
  const pos = [];
  rings.forEach((r, i) => r.forEach(([x, y]) => pos.push(x, y, zs[i])));
  const idx = [];
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M), c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
      idx.push(a, b, c, b, d, c);
    }
  }
  for (const [i, front] of [[0, false], [S - 1, true]]) {
    let cx = 0, cy = 0;
    rings[i].forEach(([x, y]) => { cx += x; cy += y; });
    const ci = pos.length / 3;
    pos.push(cx / M, cy / M, zs[i]);
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M);
      if (front) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A thin rod between two points (pillars, wing stands, mirror stalks).
function rod(a, b, r, mat, radial = 6) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, radial), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}

function box(sx, sy, sz, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  return m;
}

// ---------- body profiles ----------
// Each car's silhouette: plan width, shoulder line, centre-line top, sill, roof lift over the shoulder, arch
// flares, pillar positions, roof skin span and doors. z is forward, +x is the car's left. Overall size comes
// from the car's look.scale.
const WHEEL_R = 0.32;
const ARCH_R = 0.39;
const FRONT_Z = 1.28, REAR_Z = -1.34, TRACK = 0.82;
const BASE_HW = [[-2.26, 0.83], [-2.0, 0.89], [-1.34, 0.92], [-0.6, 0.89], [0.3, 0.88], [1.28, 0.91], [1.9, 0.87], [2.22, 0.76]];
const STREET_HW = [[-2.26, 0.8], [-2.0, 0.86], [-1.34, 0.89], [-0.6, 0.87], [0.3, 0.86], [1.28, 0.88], [1.9, 0.84], [2.22, 0.73]];
const STREET_BB = [[-2.26, 0.42], [-2.05, 0.28], [1.95, 0.25], [2.22, 0.32]];
export const BODY_PROFILES = {
  // Low widebody fastback with a ducktail (the original cars).
  widebody: {
    hw: BASE_HW,
    sh: [[-2.26, 0.84], [-1.95, 0.91], [-1.34, 0.89], [-0.5, 0.85], [0.5, 0.82], [1.28, 0.83], [1.9, 0.72], [2.22, 0.6]],
    tc: [[-2.26, 0.86], [-2.0, 0.93], [-1.6, 0.9], [-0.5, 0.86], [0.5, 0.82], [1.2, 0.76], [1.9, 0.66], [2.22, 0.56]],
    bb: [[-2.26, 0.4], [-2.05, 0.25], [1.95, 0.22], [2.22, 0.3]],
    roof: [[-1.8, 0], [-1.4, 0.24], [-1.0, 0.4], [-0.55, 0.42], [-0.2, 0.39], [0.25, 0.2], [0.62, 0]],
    flare: [0.04, 0.055], a: [0.6, -0.18], b: -0.72, c: [-1.62, -1.1], skin: [-0.15, -1.15], doors: [[0.64, -0.7]],
  },
  // Two-seat coupe: long bonnet, dome roof, tall rear haunches, hatch.
  z33: {
    hw: STREET_HW,
    sh: [[-2.26, 0.86], [-1.95, 0.93], [-1.34, 0.93], [-0.5, 0.84], [0.5, 0.8], [1.28, 0.81], [1.9, 0.7], [2.22, 0.58]],
    tc: [[-2.26, 0.88], [-2.0, 0.95], [-1.6, 0.93], [-0.5, 0.86], [0.5, 0.8], [1.2, 0.74], [1.9, 0.64], [2.22, 0.54]],
    bb: STREET_BB,
    roof: [[-1.85, 0], [-1.5, 0.2], [-1.1, 0.37], [-0.6, 0.45], [-0.2, 0.43], [0.2, 0.24], [0.6, 0]],
    flare: [0.03, 0.055], a: [0.58, -0.15], b: -0.62, c: [-1.72, -1.2], skin: [-0.1, -1.2], doors: [[0.64, -0.62]],
  },
  // Four-seat coupe: longer cabin, gentle fastback.
  v35: {
    hw: STREET_HW,
    sh: [[-2.26, 0.84], [-1.95, 0.9], [-1.34, 0.89], [-0.5, 0.84], [0.5, 0.81], [1.28, 0.81], [1.9, 0.71], [2.22, 0.59]],
    tc: [[-2.26, 0.86], [-2.0, 0.92], [-1.6, 0.9], [-0.5, 0.86], [0.5, 0.81], [1.2, 0.75], [1.9, 0.65], [2.22, 0.55]],
    bb: STREET_BB,
    roof: [[-1.8, 0], [-1.45, 0.24], [-1.0, 0.41], [-0.5, 0.44], [0, 0.41], [0.3, 0.21], [0.65, 0]],
    flare: [0.02, 0.03], a: [0.62, -0.1], b: -0.7, c: [-1.62, -1.05], skin: [-0.05, -1.1], doors: [[0.66, -0.72]],
  },
  // Long, low, sleek modern coupe.
  v37: {
    hw: STREET_HW,
    sh: [[-2.26, 0.83], [-1.95, 0.89], [-1.34, 0.88], [-0.5, 0.82], [0.5, 0.79], [1.28, 0.8], [1.9, 0.69], [2.22, 0.56]],
    tc: [[-2.26, 0.85], [-2.0, 0.91], [-1.6, 0.89], [-0.5, 0.84], [0.5, 0.79], [1.2, 0.73], [1.9, 0.62], [2.22, 0.52]],
    bb: STREET_BB,
    roof: [[-1.85, 0], [-1.45, 0.2], [-1.0, 0.37], [-0.45, 0.4], [0, 0.37], [0.3, 0.2], [0.72, 0]],
    flare: [0.02, 0.035], a: [0.7, -0.05], b: -0.68, c: [-1.66, -1.05], skin: [0, -1.1], doors: [[0.68, -0.7]],
  },
  // Compact notchback coupe with a short boot.
  s15: {
    hw: STREET_HW,
    sh: [[-2.26, 0.84], [-1.95, 0.88], [-1.34, 0.87], [-0.5, 0.84], [0.5, 0.8], [1.28, 0.8], [1.9, 0.7], [2.22, 0.58]],
    tc: [[-2.26, 0.86], [-2.0, 0.9], [-1.5, 0.89], [-0.5, 0.86], [0.5, 0.8], [1.2, 0.74], [1.9, 0.65], [2.22, 0.55]],
    bb: STREET_BB,
    roof: [[-1.4, 0], [-1.15, 0.2], [-0.85, 0.4], [-0.45, 0.43], [-0.1, 0.41], [0.25, 0.21], [0.62, 0]],
    flare: [0.02, 0.03], a: [0.6, -0.12], b: -0.6, c: [-1.32, -0.95], skin: [-0.1, -0.9], doors: [[0.64, -0.62]],
  },
  // Boxier 90s notchback: flat roof, upright glass.
  s13: {
    hw: STREET_HW,
    sh: [[-2.26, 0.85], [-1.95, 0.87], [-1.34, 0.87], [-0.5, 0.84], [0.5, 0.81], [1.28, 0.8], [1.9, 0.72], [2.22, 0.6]],
    tc: [[-2.26, 0.86], [-2.0, 0.89], [-1.5, 0.89], [-0.5, 0.86], [0.5, 0.81], [1.2, 0.76], [1.9, 0.68], [2.22, 0.58]],
    bb: STREET_BB,
    roof: [[-1.34, 0], [-1.12, 0.24], [-0.85, 0.43], [-0.4, 0.45], [0, 0.44], [0.28, 0.22], [0.6, 0]],
    flare: [0.015, 0.025], a: [0.58, -0.08], b: -0.6, c: [-1.28, -0.9], skin: [-0.05, -0.88], doors: [[0.62, -0.62]],
  },
  // Compact four-door sports sedan.
  xe10: {
    hw: STREET_HW,
    sh: [[-2.26, 0.86], [-1.95, 0.89], [-1.34, 0.88], [-0.5, 0.85], [0.5, 0.82], [1.28, 0.82], [1.9, 0.72], [2.22, 0.6]],
    tc: [[-2.26, 0.87], [-2.0, 0.91], [-1.5, 0.9], [-0.5, 0.87], [0.5, 0.82], [1.2, 0.76], [1.9, 0.67], [2.22, 0.57]],
    bb: STREET_BB,
    roof: [[-1.48, 0], [-1.22, 0.25], [-0.9, 0.45], [-0.3, 0.48], [0.1, 0.46], [0.36, 0.25], [0.7, 0]],
    flare: [0.015, 0.02], a: [0.66, -0.0], b: -0.3, c: [-1.45, -1.0], skin: [0, -1.0], doors: [[0.68, -0.28], [-0.3, -1.18]],
  },
  // Smooth long grand-tourer coupe with a rounded boot.
  z30: {
    hw: STREET_HW,
    sh: [[-2.26, 0.82], [-1.95, 0.87], [-1.34, 0.86], [-0.5, 0.83], [0.5, 0.79], [1.28, 0.78], [1.9, 0.68], [2.22, 0.56]],
    tc: [[-2.26, 0.83], [-2.0, 0.88], [-1.5, 0.88], [-0.5, 0.85], [0.5, 0.79], [1.2, 0.72], [1.9, 0.62], [2.22, 0.52]],
    bb: STREET_BB,
    roof: [[-1.55, 0], [-1.28, 0.22], [-0.95, 0.38], [-0.5, 0.42], [0, 0.4], [0.3, 0.21], [0.66, 0]],
    flare: [0.01, 0.02], a: [0.64, -0.05], b: -0.72, c: [-1.5, -1.0], skin: [-0.05, -1.0], doors: [[0.66, -0.74]],
  },
  // Modern coupe with a short boot.
  b8: {
    hw: STREET_HW,
    sh: [[-2.26, 0.84], [-1.95, 0.9], [-1.34, 0.89], [-0.5, 0.84], [0.5, 0.81], [1.28, 0.81], [1.9, 0.71], [2.22, 0.58]],
    tc: [[-2.26, 0.85], [-2.0, 0.91], [-1.5, 0.9], [-0.5, 0.86], [0.5, 0.81], [1.2, 0.75], [1.9, 0.65], [2.22, 0.54]],
    bb: STREET_BB,
    roof: [[-1.68, 0], [-1.36, 0.22], [-0.95, 0.4], [-0.45, 0.43], [0, 0.41], [0.35, 0.21], [0.7, 0]],
    flare: [0.02, 0.025], a: [0.68, -0.02], b: -0.7, c: [-1.6, -1.05], skin: [0, -1.05], doors: [[0.68, -0.72]],
  },
  // Long, boxy four-door with a flat boot.
  jzx: {
    hw: STREET_HW,
    sh: [[-2.26, 0.86], [-1.95, 0.88], [-1.34, 0.88], [-0.5, 0.85], [0.5, 0.82], [1.28, 0.81], [1.9, 0.73], [2.22, 0.61]],
    tc: [[-2.26, 0.87], [-2.0, 0.9], [-1.5, 0.9], [-0.5, 0.87], [0.5, 0.82], [1.2, 0.77], [1.9, 0.69], [2.22, 0.59]],
    bb: STREET_BB,
    roof: [[-1.44, 0], [-1.2, 0.25], [-0.9, 0.46], [-0.3, 0.48], [0.1, 0.47], [0.36, 0.25], [0.68, 0]],
    flare: [0.015, 0.02], a: [0.66, 0.0], b: -0.3, c: [-1.42, -1.0], skin: [0, -1.0], doors: [[0.68, -0.28], [-0.3, -1.16]],
  },
};
let P = BODY_PROFILES.widebody;
let halfWidth, shoulder, centreTop, baseBottom, roofTop;
function applyProfile(name) {
  P = BODY_PROFILES[name] || BODY_PROFILES.widebody;
  halfWidth = curve(P.hw);
  shoulder = curve(P.sh);
  centreTop = curve(P.tc);
  baseBottom = curve(P.bb);
  roofTop = curve(P.roof);
}
applyProfile('widebody');
const flare = (z) => P.flare[0] * Math.exp(-(((z - FRONT_Z) / 0.5) ** 2)) + P.flare[1] * Math.exp(-(((z - REAR_Z) / 0.55) ** 2));

function bottomAt(z) {
  let yb = baseBottom(z);
  for (const wz of [FRONT_Z, REAR_Z]) {
    const dz = z - wz;
    if (Math.abs(dz) < ARCH_R) yb = Math.max(yb, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  return yb;
}

function bodySection(z) {
  const hw = halfWidth(z), bulge = flare(z), yb = bottomAt(z), sh = shoulder(z), tc = centreTop(z);
  const mid = yb + (sh - yb) * 0.45;
  return mirrorHalf([
    [0, yb], [hw * 0.55, yb], [hw - 0.04, yb + 0.015], [hw + bulge, Math.min(mid, sh - 0.1)],
    [hw + bulge * 0.7 - 0.015, sh - 0.07], [hw - 0.12, sh], [hw * 0.45, tc], [0, tc],
  ]);
}

// Greenhouse: the roof lift curve of the profile, from the windscreen base back to the rear glass.
function glassSection(z) {
  const base = Math.max(shoulder(z), centreTop(z)) - 0.03;
  const lift = Math.max(roofTop(z), 0.002);
  const top = base + lift;
  const hb = halfWidth(z) - 0.13, ht = halfWidth(z) * 0.68;
  return {
    base, top, hb, ht,
    ring: mirrorHalf([
      [0, base - 0.06], [hb, base - 0.06], [hb, base], [hb * 0.3 + ht * 0.7, base + lift * 0.72],
      [ht, top - lift * 0.08], [ht * 0.5, top], [0, top],
    ]),
  };
}

// ---------- surface sampling for details ----------
// Points on the car's left flank (+x) at section z between two heights, nudged out so trim sits on the paint.
function flankPoints(z, y0, y1, out = 0.004) {
  const ring = smoothRing(bodySection(z), 4);
  const pts = ring.filter(([x, y]) => x > 0.3 && y >= y0 && y <= y1).sort((p, q) => p[1] - q[1]);
  return pts.map(([x, y]) => new THREE.Vector3(x + out, y, z));
}
// Height of the body's top surface at section z and lateral offset x.
function topAt(z, x) {
  const ring = smoothRing(bodySection(z), 4);
  const sh = shoulder(z);
  const top = ring.filter(([, y]) => y > sh - 0.08).sort((p, q) => p[0] - q[0]);
  const ax = Math.abs(x);
  for (let i = 0; i < top.length - 1; i++) {
    const [x0, y0] = top[i], [x1, y1] = top[i + 1];
    if (ax >= x0 && ax <= x1) return y0 + ((y1 - y0) * (ax - x0)) / Math.max(1e-6, x1 - x0);
  }
  return centreTop(z);
}
// Flank surface x at section z and height y.
function flankX(z, y) {
  const pts = flankPoints(z, y - 0.05, y + 0.05, 0);
  return pts.length ? Math.max(...pts.map((p) => p.x)) : halfWidth(z);
}

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const DISPLAY = '"Chakra Petch", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

function plateTexture(text) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#e9ecef';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2c6e3f';
    g.lineWidth = 6;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#2c6e3f';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 28px ${DISPLAY}`;
    g.fillText('NEO-SHINJUKU 300', w / 2, 32);
    g.font = `700 64px ${DISPLAY}`;
    g.fillText(text, w / 2, 86);
  });
}

function decalTexture(name) {
  return canvasTexture(512, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = `italic 700 66px ${DISPLAY}`;
    g.textBaseline = 'middle';
    g.fillText(name.toUpperCase(), 18, h / 2 + 2);
    const tw = g.measureText(name.toUpperCase()).width;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      const x = 40 + tw + k * 26;
      g.moveTo(x, h - 14); g.lineTo(x + 16, h - 14); g.lineTo(x + 34, 14); g.lineTo(x + 18, 14);
      g.closePath();
      g.globalAlpha = 1 - k * 0.2;
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

// Sidewall lettering laid out for RingGeometry's planar UVs.
let sidewallTex = null;
function sidewallTexture() {
  if (sidewallTex) return sidewallTex;
  sidewallTex = canvasTexture(512, 512, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.translate(w / 2, w / 2);
    g.fillStyle = '#d8dbe2';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const words = [['NEOGRIP', 34], ['R-DRIFT 265/35 R18', 18], ['NEOGRIP', 34], ['R-DRIFT 265/35 R18', 18]];
    words.forEach(([word, size], k) => {
      g.font = `700 ${size}px ${DISPLAY}`;
      const r = 0.875 * (w / 2);
      const chars = [...word];
      const span = (chars.length * size * 0.62) / r;
      const start = (k * Math.PI) / 2 - span / 2;
      chars.forEach((ch, i) => {
        const a = start + (span * (i + 0.5)) / chars.length;
        g.save();
        g.rotate(a);
        g.translate(0, -r);
        g.fillText(ch, 0, 0);
        g.restore();
      });
    });
  });
  return sidewallTex;
}

// Bakes every mesh under `group` (except `keep`) into one mesh per material, in group space.
// A detailed car ends up as a handful of draw calls.
function mergeByMaterial(group, keep = new Set()) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map(), dead = [];
  const m = new THREE.Matrix4();
  group.traverse((o) => {
    if (!o.isMesh || keep.has(o)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    const keepUv = !!o.material.map;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(keepUv && name === 'uv')) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
    dead.push(o);
  });
  for (const o of dead) o.removeFromParent();
  for (const [mat, list] of buckets) {
    const indexed = list.every((g) => g.index);
    const geo = mergeGeometries(indexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g)));
    list.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geo, mat);
    if (mat.transparent) mesh.renderOrder = 2;
    group.add(mesh);
  }
}

// ---------- wheels ----------
function buildWheelParts(mats) {
  // Tyre with three tread grooves and a rounded shoulder.
  const tyre = new THREE.LatheGeometry([
    [0.2, -0.125], [0.29, -0.13], [0.31, -0.118], [0.32, -0.095],
    [0.32, -0.062], [0.307, -0.058], [0.307, -0.046], [0.32, -0.042],
    [0.32, -0.008], [0.307, -0.005], [0.307, 0.005], [0.32, 0.008],
    [0.32, 0.042], [0.307, 0.046], [0.307, 0.058], [0.32, 0.062],
    [0.32, 0.095], [0.31, 0.118], [0.29, 0.13], [0.2, 0.125],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 40).rotateZ(Math.PI / 2);
  // Deep-dish rim: lip at the outer face, barrel inside.
  const rim = new THREE.LatheGeometry([
    [0.05, 0.02], [0.2, 0.055], [0.215, 0.1], [0.225, 0.12], [0.212, 0.125], [0.2, 0.1], [0.2, -0.11],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 32).rotateZ(-Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.035, 0.17, 0.045).translate(0, 0.115, 0);
  const cap = new THREE.CylinderGeometry(0.03, 0.034, 0.03, 12).rotateZ(Math.PI / 2);
  const lug = new THREE.CylinderGeometry(0.011, 0.011, 0.024, 6).rotateZ(Math.PI / 2);
  const hat = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 20).rotateZ(Math.PI / 2);
  const letters = new THREE.RingGeometry(0.235, 0.305, 48, 1).rotateY(Math.PI / 2);
  // Deep dish: a stepped polished lip in front of the spokes.
  const dishLip = new THREE.LatheGeometry([
    [0.2, 0.06], [0.228, 0.07], [0.232, 0.125], [0.222, 0.13], [0.205, 0.12], [0.2, 0.06],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 32).rotateZ(-Math.PI / 2);
  const disc = new THREE.CylinderGeometry(0.18, 0.18, 0.025, 24).rotateZ(Math.PI / 2);
  const caliper = new THREE.BoxGeometry(0.06, 0.1, 0.13);
  return { tyre, rim, spoke, cap, disc, caliper, lug, hat, letters, dishLip, mats };
}

function makeWheel(parts, side, front, style = 'six') {
  const { mats } = parts;
  const pivot = new THREE.Group(); // steers
  const mount = new THREE.Group(); // faces outward, with camber
  mount.rotation.y = side > 0 ? 0 : Math.PI;
  mount.rotation.z = front ? 0.03 : 0.06; // negative camber: tops lean in
  pivot.add(mount);
  const disc = new THREE.Mesh(parts.disc, mats.disc);
  disc.position.x = -0.02;
  mount.add(disc);
  const cal = new THREE.Mesh(parts.caliper, mats.caliper);
  cal.position.set(-0.01, 0.09, -0.1);
  mount.add(cal);
  const spin = new THREE.Group();
  spin.add(new THREE.Mesh(parts.tyre, mats.tyre));
  spin.add(new THREE.Mesh(parts.rim, mats.rim));
  if (style === 'mesh') {
    // Cross-laced mesh: chords from hub to rim, crossing each other.
    for (let k = 0; k < 10; k++) {
      const a = (k * Math.PI * 2) / 10;
      for (const tw of [0.42, -0.42]) {
        spin.add(rod([0.08, Math.cos(a) * 0.05, Math.sin(a) * 0.05], [0.07, Math.cos(a + tw) * 0.2, Math.sin(a + tw) * 0.2], 0.008, mats.rim, 4));
      }
    }
  } else {
    const n = style === 'five' ? 5 : style === 'dish' ? 8 : 6;
    const geo = style === 'five' ? new THREE.BoxGeometry(0.06, 0.17, 0.05).translate(0, 0.115, 0) : style === 'dish' ? new THREE.BoxGeometry(0.022, 0.15, 0.03).translate(0, 0.11, 0) : parts.spoke;
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(geo, mats.rim);
      s.position.x = style === 'dish' ? 0.04 : 0.07;
      s.rotation.x = (k * Math.PI * 2) / n;
      s.rotation.z = style === 'dish' ? -0.05 : -0.12;
      spin.add(s);
    }
    if (style === 'dish') spin.add(new THREE.Mesh(parts.dishLip, mats.chrome));
  }
  for (let k = 0; k < 5; k++) {
    const a = (k * Math.PI * 2) / 5;
    const l = new THREE.Mesh(parts.lug, mats.chrome);
    l.position.set(0.09, Math.cos(a) * 0.045, Math.sin(a) * 0.045);
    spin.add(l);
  }
  const cap = new THREE.Mesh(parts.cap, mats.cap);
  cap.position.x = 0.095;
  spin.add(cap);
  const letters = new THREE.Mesh(parts.letters, mats.letters);
  letters.position.x = 0.1315;
  spin.add(letters);
  const hat = new THREE.Mesh(parts.hat, mats.disc);
  hat.position.x = -0.03;
  mount.add(hat);
  mount.add(spin);
  mergeByMaterial(spin);
  const keep = new Set();
  spin.traverse((o) => o.isMesh && keep.add(o));
  mergeByMaterial(mount, keep);
  return { pivot, mount, spin, dir: side > 0 ? 1 : -1 };
}

// ---------- the car ----------
// look: { scale: [width, height, length], wing: 'duck' | 'gt' | 'none', paint, neon, rims } (indices into the palettes).
export function buildCar(envMap, radial, look = {}) {
  applyProfile(look.body);
  const [sx, sy, sz] = look.scale || [1, 1, 1];
  const driverX = look.lhd ? 0.36 : -0.36; // +x is the car's left
  const root = new THREE.Group();
  const body = new THREE.Group(); // rolls and pitches on the suspension
  body.scale.set(sx, sy, sz);
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: PAINTS[0].color, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05, envMap, envMapIntensity: 1.0,
  });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0d0d12, roughness: 0.35, metalness: 0.5, envMap, envMapIntensity: 0.8 });
  const matte = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.9 });
  // Tinted, see-through glass so the cage and seats show.
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a0d16, metalness: 0.1, roughness: 0.02, clearcoat: 1, envMap, envMapIntensity: 2.2, transparent: true, opacity: 0.62, depthWrite: false,
  });
  const seam = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.7 });
  const cabin = new THREE.MeshStandardMaterial({ color: 0x15141b, roughness: 0.85 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1c1a24, roughness: 0.95 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd8203f, roughness: 0.5 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, metalness: 1, roughness: 0.12, envMap, envMapIntensity: 1.6 });
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x22e6ff).multiplyScalar(3) });
  const neonBase = new THREE.Color(0x22e6ff);

  // Body shell.
  const zs = [], rings = [];
  for (let i = 0; i <= 64; i++) {
    const z = -2.26 + (4.48 * i) / 64;
    zs.push(z);
    rings.push(smoothRing(bodySection(z), 4));
  }
  body.add(new THREE.Mesh(loft(rings, zs), paint));

  // Glass cabin, then a painted roof skin and pillars over it.
  const gz = [], gr = [];
  const g0 = P.roof[P.roof.length - 1][0], g1 = P.roof[0][0];
  for (let i = 0; i <= 36; i++) {
    const z = g0 - ((g0 - g1) * i) / 36;
    gz.unshift(z);
    gr.unshift(smoothRing(glassSection(z).ring, 3));
  }
  body.add(new THREE.Mesh(loft(gr, gz), glass));
  const rz = [], rr = [];
  for (let i = 0; i <= 16; i++) {
    const z = P.skin[0] - ((P.skin[0] - P.skin[1]) * i) / 16;
    const s = glassSection(z);
    rz.unshift(z);
    rr.unshift(smoothRing(mirrorHalf([[0, s.top - 0.03], [s.ht * 0.92, s.top - 0.035], [s.ht * 0.96, s.top - 0.01], [s.ht * 0.5, s.top + 0.012], [0, s.top + 0.014]]), 3));
  }
  body.add(new THREE.Mesh(loft(rr, rz), paint));
  const at = (z, f) => { const s = glassSection(z); return [s.hb + (s.ht - s.hb) * f, s.base + (s.top - s.base) * f]; };
  for (const side of [1, -1]) {
    const [ax0, ay0] = at(P.a[0], 0), [ax1, ay1] = at(P.a[1], 1);
    body.add(rod([side * (ax0 + 0.005), ay0, P.a[0]], [side * (ax1 + 0.01), ay1, P.a[1]], 0.028, paint));
    const [bx0, by0] = at(P.b, 0), [bx1, by1] = at(P.b, 1);
    body.add(rod([side * (bx0 + 0.012), by0, P.b], [side * (bx1 + 0.012), by1, P.b], 0.032, carbon));
    const [cx0, cy0] = at(P.c[0], 0), [cx1, cy1] = at(P.c[1], 1);
    body.add(rod([side * (cx0 + 0.005), cy0, P.c[0]], [side * (cx1 + 0.01), cy1, P.c[1]], 0.04, paint));
    // Mirrors.
    const mx = halfWidth(0.45) - 0.05;
    body.add(rod([side * mx, shoulder(0.45) + 0.03, 0.45], [side * (mx + 0.12), shoulder(0.45) + 0.1, 0.42], 0.015, carbon));
    const mirror = box(0.16, 0.085, 0.1, paint, side * (mx + 0.16), shoulder(0.45) + 0.12, 0.42);
    body.add(mirror);
  }

  // Wheel wells so nothing shows through the arches, and a floor pan.
  const liner = new THREE.CylinderGeometry(ARCH_R, ARCH_R, 0.36, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2);
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 1, side: THREE.DoubleSide });
  for (const z of [FRONT_Z, REAR_Z]) {
    for (const side of [1, -1]) {
      const l = new THREE.Mesh(liner, linerMat);
      l.position.set(side * (TRACK - 0.04), WHEEL_R, z);
      body.add(l);
    }
  }
  body.add(box(1.3, 0.08, 4.1, matte, 0, 0.25, -0.02));

  // Aero: splitter with a neon edge, side skirts, diffuser, ducktail wing.
  body.add(box(1.72, 0.03, 0.3, carbon, 0, 0.215, 2.1));
  body.add(box(1.6, 0.012, 0.012, neon, 0, 0.215, 2.25));
  for (const side of [1, -1]) {
    const skirt = box(0.08, 0.1, 2.15, carbon, side * (halfWidth(0) - 0.01), 0.26, -0.03);
    body.add(skirt);
    body.add(box(0.012, 0.012, 2.1, neon, side * (halfWidth(0) + 0.035), 0.22, -0.03));
  }
  body.add(box(1.42, 0.12, 0.3, carbon, 0, 0.32, -2.16));
  for (let k = -2; k <= 2; k++) body.add(box(0.02, 0.1, 0.28, carbon, k * 0.26, 0.26, -2.18));
  if (look.wing === 'gt') {
    // Tall swan-neck GT wing with endplates and a neon trailing edge.
    const wy = 1.42;
    const plane = box(1.9, 0.05, 0.46, carbon, 0, wy, -2.05);
    plane.rotation.x = -0.1;
    body.add(plane);
    body.add(box(1.84, 0.02, 0.02, neon, 0, wy + 0.01, -2.29));
    for (const side of [1, -1]) {
      body.add(box(0.03, 0.34, 0.58, paint, side * 0.96, wy - 0.06, -2.05));
      body.add(rod([side * 0.42, wy, -2.0], [side * 0.4, centreTop(-2.1) - 0.02, -2.12], 0.026, carbon));
    }
  } else if (look.wing === 'duck' || !look.wing) {
    body.add(box(1.78, 0.03, 0.34, carbon, 0, 1.2, -1.98));
    for (const side of [1, -1]) {
      body.add(box(0.02, 0.18, 0.4, carbon, side * 0.89, 1.17, -1.99));
      body.add(rod([side * 0.5, 1.2, -1.92], [side * 0.48, centreTop(-1.95) - 0.02, -1.9], 0.022, carbon));
    }
  } else {
    // Small lip spoiler on the boot.
    body.add(box(1.5, 0.025, 0.12, carbon, 0, centreTop(-2.18) + 0.02, -2.18));
  }

  // Front: intake, slim LED headlights with projector dots.
  body.add(box(1.0, 0.16, 0.08, matte, 0, 0.36, 2.2));
  for (const side of [1, -1]) body.add(box(0.26, 0.1, 0.06, matte, side * 0.66, 0.34, 2.17));
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.3, 4.8) });
  const headHousing = new THREE.BoxGeometry(0.44, 0.09, 0.26);
  for (const side of [1, -1]) {
    const hz = 1.98;
    const house = new THREE.Mesh(headHousing, glass);
    house.position.set(side * 0.56, shoulder(hz) - 0.06, hz + 0.06);
    house.rotation.x = 0.28;
    house.rotation.y = side * -0.12;
    body.add(house);
    const drl = box(0.4, 0.018, 0.02, headMat, side * 0.56, shoulder(hz) - 0.035, hz + 0.19);
    drl.rotation.y = side * -0.12;
    body.add(drl);
    for (const k of [0.43, 0.63]) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), headMat);
      dot.position.set(side * k, shoulder(hz) - 0.08, hz + 0.14);
      body.add(dot);
    }
  }

  // Rear lights, in the car's own style.
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.08, 0.12) });
  const clearLens = new THREE.MeshStandardMaterial({ color: 0xd8dce4, metalness: 0.3, roughness: 0.15, envMap, envMapIntensity: 1.5 });
  const tail = look.tail || 'quad';
  const back = -2.265;
  if (tail === 'quad') {
    const lampGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.03, 20).rotateX(Math.PI / 2);
    const ringGeo = new THREE.TorusGeometry(0.09, 0.012, 6, 20);
    for (const x of [-0.72, -0.46, 0.46, 0.72]) {
      const lamp = new THREE.Mesh(lampGeo, tailMat);
      lamp.position.set(x, 0.72, back);
      body.add(lamp);
      const ring = new THREE.Mesh(ringGeo, chrome);
      ring.position.set(x, 0.72, back - 0.005);
      body.add(ring);
    }
    body.add(box(1.3, 0.012, 0.012, tailMat, 0, 0.83, -2.26));
  } else if (tail === 'bar') {
    // A thin full-width light bar with deeper clusters at the corners.
    body.add(box(1.5, 0.035, 0.02, tailMat, 0, 0.76, back));
    for (const s of [1, -1]) {
      const c = box(0.34, 0.1, 0.05, tailMat, s * 0.62, 0.74, back + 0.01);
      c.rotation.y = s * 0.22;
      body.add(c);
    }
  } else if (tail === 'boomerang') {
    // Tall swept lamps that wrap up the rear corners.
    for (const s of [1, -1]) {
      for (const [y, h, rz] of [[0.72, 0.26, s * 0.55], [0.62, 0.12, 0]]) {
        const c = box(0.09, h, 0.05, tailMat, s * (0.66 - (y < 0.7 ? 0.08 : 0)), y, back + 0.01);
        c.rotation.z = rz;
        c.rotation.y = s * 0.35;
        body.add(c);
      }
    }
  } else if (tail === 'square') {
    for (const s of [1, -1]) {
      body.add(box(0.42, 0.13, 0.03, tailMat, s * 0.52, 0.73, back));
      body.add(box(0.12, 0.06, 0.032, clearLens, s * 0.38, 0.7, back - 0.002));
    }
  } else if (tail === 'wide') {
    // One red lens across the whole tail, ribbed.
    body.add(box(1.52, 0.15, 0.03, tailMat, 0, 0.72, back));
    for (let k = -6; k <= 6; k++) body.add(box(0.01, 0.15, 0.034, seam, k * 0.115, 0.72, back - 0.002));
  } else if (tail === 'clear') {
    // Clear lenses with round red elements inside.
    const lampGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16).rotateX(Math.PI / 2);
    for (const s of [1, -1]) {
      body.add(box(0.44, 0.15, 0.03, clearLens, s * 0.55, 0.73, back + 0.002));
      for (const dx of [0.08, -0.08]) {
        const l = new THREE.Mesh(lampGeo, tailMat);
        l.position.set(s * (0.55 + dx), 0.73, back - 0.004);
        body.add(l);
      }
    }
  } else if (tail === 'band') {
    body.add(box(1.56, 0.09, 0.03, tailMat, 0, 0.67, back));
    body.add(box(0.5, 0.05, 0.034, seam, 0, 0.67, back - 0.002));
  }
  // Exhaust tips per car, each with a sooty inner and its own backfire flame.
  const tips = { single: [-0.55], dual: [-0.55, 0.55], quad: [-0.62, -0.44, 0.44, 0.62], center: [-0.09, 0.09] }[look.exhaust || 'single'];
  const pipeGeo = new THREE.CylinderGeometry(0.06, 0.055, 0.26, 18, 1, true).rotateX(Math.PI / 2);
  const sootGeo = new THREE.CircleGeometry(0.056, 18).rotateY(Math.PI);
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeos = [];
  for (const x of tips) {
    const tipY = look.exhaust === 'center' ? 0.27 : 0.3;
    const pipe = new THREE.Mesh(pipeGeo, chrome);
    pipe.position.set(x, tipY, -2.33);
    body.add(pipe);
    const soot = new THREE.Mesh(sootGeo, matte);
    soot.position.set(x, tipY, -2.36);
    body.add(soot);
    flameGeos.push(new THREE.ConeGeometry(0.07, 0.55, 10).rotateX(-Math.PI / 2).translate(x, tipY, -2.74));
  }
  const flame = new THREE.Mesh(mergeGeometries(flameGeos), flameMat);
  flame.visible = false;
  body.add(flame);

  // Neon body line along each flank.
  for (const side of [1, -1]) {
    const pts = [];
    for (let z = -2.0; z <= 1.85; z += 0.15) {
      const y = shoulder(z) - 0.075;
      pts.push(new THREE.Vector3(side * (halfWidth(z) + flare(z) * 0.72 - 0.004), y, z));
    }
    body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.009, 5), neon));
  }

  // ---------- detail ----------
  const tube = (pts, r, mat, seg = 24) => pts.length > 1 && body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 4), mat));
  const both = (fn) => { fn(1); fn(-1); };
  const mirror = (pts, side) => pts.map((p) => new THREE.Vector3(p.x * side, p.y, p.z));

  // Panel seams: door shut lines, bonnet and boot edges.
  both((side) => {
    for (const [d0, d1] of P.doors) {
      for (const z of [d0, d1]) tube(mirror(flankPoints(z, 0.34, shoulder(z) - 0.03), side), 0.0045, seam, 12);
      // Lower door edge along the sill.
      const sill = [];
      for (let z = d0; z >= d1; z -= 0.1) sill.push(new THREE.Vector3(side * (flankX(z, 0.36) + 0.004), 0.36, z));
      tube(sill, 0.004, seam, 16);
    }
    // Bonnet shut lines either side, and the boot lid's.
    const hood = [], boot = [];
    for (let z = 0.64; z <= 2.05; z += 0.1) hood.push(new THREE.Vector3(side * 0.62, topAt(z, 0.62) + 0.003, z));
    for (let z = -1.84; z >= -2.2; z -= 0.06) boot.push(new THREE.Vector3(side * 0.6, topAt(z, 0.6) + 0.003, z));
    tube(hood, 0.004, seam, 20);
    tube(boot, 0.004, seam, 8);
    // Door handle, recessed.
    for (const [, d1] of P.doors) {
      const hz = d1 + 0.22, hy = shoulder(hz) - 0.11;
      body.add(box(0.012, 0.028, 0.13, chrome, side * (flankX(hz, hy) + 0.008), hy, hz));
    }
    // Gills behind the front wheel.
    for (let k = 0; k < 3; k++) {
      const z = 0.82 - k * 0.07, y = 0.55;
      const g = box(0.01, 0.16, 0.022, seam, side * (flankX(z, y) + 0.003), y, z);
      g.rotation.x = 0.35;
      body.add(g);
    }
    // Side mirror glass.
    const mx = halfWidth(0.45) - 0.05;
    const mg = box(0.12, 0.06, 0.004, glass, side * (mx + 0.16), shoulder(0.45) + 0.12, 0.368);
    body.add(mg);
    // Window seal along the glass base.
    const seal = [];
    for (let z = 0.56; z >= -1.6; z -= 0.12) { const gs = glassSection(z); seal.push(new THREE.Vector3(side * (gs.hb + 0.008), gs.base + 0.004, z)); }
    tube(seal, 0.008, matte, 24);
  });
  const across = (z, xmax, y = 0.003) => { const pts = []; for (let x = -xmax; x <= xmax + 1e-6; x += xmax / 8) pts.push(new THREE.Vector3(x, topAt(z, x) + y, z)); return pts; };
  tube(across(0.64, 0.62), 0.0045, seam, 16);
  tube(across(-1.84, 0.6), 0.0045, seam, 16);
  // Fuel filler on the left rear quarter.
  {
    const z = -1.0, y = shoulder(z) - 0.16;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.004, 4, 20).rotateY(Math.PI / 2), seam);
    ring.position.set(flankX(z, y) + 0.004, y, z);
    body.add(ring);
  }
  // Bonnet vents with slats.
  both((side) => {
    const z = 1.32, x = side * 0.32, y = topAt(z, x);
    const slope = Math.atan2(topAt(z + 0.1, x) - topAt(z - 0.1, x), 0.2);
    const vent = box(0.34, 0.012, 0.24, seam, x, y + 0.002, z);
    vent.rotation.x = -slope;
    body.add(vent);
    for (let k = -2; k <= 2; k++) {
      const sl = box(0.32, 0.008, 0.016, carbon, x, y + 0.012, z + k * 0.045);
      sl.rotation.x = -slope;
      body.add(sl);
    }
  });
  // Wipers resting at the base of the screen, a stubby antenna on the roof.
  for (const x0 of [-0.52, 0.02]) {
    const z = 0.56, y = glassSection(0.6).base + 0.02;
    body.add(rod([x0, y, z], [x0 + 0.46, y + 0.01, z + 0.015], 0.006, matte, 4));
  }
  body.add(rod([0.32, glassSection(-1.25).top - 0.01, -1.25], [0.33, glassSection(-1.25).top + 0.2, -1.4], 0.005, matte, 4));
  // Canards on the front bumper corners, tow hooks front and rear.
  both((side) => {
    for (const [y, l] of [[0.44, 0.2], [0.36, 0.16]]) {
      const c = box(l, 0.008, 0.08, carbon, side * 0.72, y, 2.08);
      c.rotation.z = side * 0.25;
      c.rotation.y = side * -0.5;
      body.add(c);
    }
  });
  const hookMat = new THREE.MeshStandardMaterial({ color: 0xd8203f, roughness: 0.45 });
  for (const [x, z] of [[0.52, 2.235], [-0.42, -2.275]]) {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 14), hookMat);
    hook.position.set(x, 0.31, z);
    body.add(hook);
  }
  // Fog lamps in the side intakes, reflector bowls behind the projectors, amber side markers.
  const fogMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.4, 1.6) });
  const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.1) });
  both((side) => {
    const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 14).rotateX(Math.PI / 2), fogMat);
    fog.position.set(side * 0.66, 0.34, 2.205);
    body.add(fog);
    const hz = 1.98;
    for (const k of [0.43, 0.63]) {
      const bowl = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), chrome);
      bowl.position.set(side * k, shoulder(hz) - 0.08, hz + 0.115);
      bowl.rotation.x = -0.28;
      body.add(bowl);
    }
    const mk = box(0.008, 0.03, 0.07, amber, side * (flankX(1.9, 0.62) + 0.004), 0.62, 1.9);
    body.add(mk);
  });
  // Third brake light on the boot.
  body.add(box(0.36, 0.02, 0.03, tailMat, 0, topAt(-2.05, 0) + 0.015, -2.05));
  // Number plates, front and back.
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(look.plate || '86-13'), roughness: 0.5 });
  const plateF = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.165), plateMat);
  plateF.position.set(0, 0.49, 2.228);
  body.add(plateF);
  const plateR = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.165), plateMat);
  plateR.position.set(0, 0.52, -2.268);
  plateR.rotation.y = Math.PI;
  body.add(plateR);
  // Door decals in the neon colour.
  const decalMat = new THREE.MeshBasicMaterial({ map: decalTexture(look.decal || 'Ronin'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  both((side) => {
    const y = shoulder(-0.1) - 0.22;
    const x = Math.max(flankX(-0.6, y), flankX(-0.1, y), flankX(0.4, y)) + 0.006;
    const d = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.19), decalMat);
    d.rotation.y = side * Math.PI / 2;
    d.position.set(side * x, y, -0.1);
    body.add(d);
  });

  // Cabin: dash, bucket seats with harness, steering wheel and (on built cars) a roll cage.
  let steeringWheel = null;
  const fz = glassSection(0.2);
  body.add(box(1.36, 0.12, 0.36, cabin, 0, fz.base - 0.07, 0.3));
  body.add(box(1.2, 0.22, 2.2, cabin, 0, 0.36, -0.7));
  // Interior tub: dark trim laid over the body shell inside the glasshouse, so from the driver's seat the
  // cabin reads as door cards and parcel shelf instead of the paint underneath.
  {
    const z0 = P.a[0] - 0.04, z1 = P.c[0] + 0.04, n = 10;
    for (let k = 0; k < n; k++) {
      const za = z0 + ((z1 - z0) * k) / n, zb = z0 + ((z1 - z0) * (k + 1)) / n, zm = (za + zb) / 2;
      const gs = glassSection(zm);
      const y = Math.max(gs.base, shoulder(zm), centreTop(zm)) + 0.014;
      body.add(box(2 * (gs.hb - 0.02), 0.02, Math.abs(zb - za) + 0.01, cabin, 0, y, zm));
    }
  }
  both((side) => {
    const x = side * 0.36;
    const seat = new THREE.Group();
    seat.add(box(0.46, 0.1, 0.48, seatMat, 0, 0.5, 0));
    const back = box(0.46, 0.66, 0.1, seatMat, 0, 0.84, -0.25);
    back.rotation.x = -0.18;
    seat.add(back);
    for (const bx of [-0.22, 0.22]) {
      const bol = box(0.06, 0.5, 0.14, seatMat, bx, 0.82, -0.2);
      bol.rotation.x = -0.18;
      seat.add(bol);
    }
    for (const hx of [-0.09, 0.09]) {
      const strap = box(0.045, 0.55, 0.01, accent, hx, 0.86, -0.18);
      strap.rotation.x = -0.18;
      seat.add(strap);
    }
    seat.position.set(x, 0, -0.55);
    body.add(seat);
  });
  {
    // Steering wheel on the driver's side, kept out of the merge so it turns with the front wheels.
    steeringWheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 24), cabin);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.02), cabin);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.025), accent);
    mark.position.y = 0.165;
    steeringWheel.add(rim, spoke, mark);
    steeringWheel.position.set(driverX, fz.base + 0.02, 0.05);
    steeringWheel.rotation.x = -0.35;
    steeringWheel.rotation.order = 'XYZ';
    body.add(steeringWheel);
    body.add(rod([driverX, fz.base + 0.02, 0.05], [driverX, fz.base - 0.05, 0.25], 0.02, cabin, 6));
    body.add(rod([0, 0.45, -0.15], [0, 0.66, -0.12], 0.01, chrome, 6));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), accent);
    knob.position.set(0, 0.67, -0.12);
    body.add(knob);
  }
  if (look.cage !== 'none') {
    const cage = look.cage === 'paint' ? paint : accent;
    const hoopZ = -0.95, gs = glassSection(hoopZ);
    const top = gs.top - 0.06, xs = gs.ht - 0.06, xb = gs.hb - 0.12;
    body.add(rod([xb, 0.42, hoopZ], [xs, top, hoopZ], 0.018, cage, 6));
    body.add(rod([-xb, 0.42, hoopZ], [-xs, top, hoopZ], 0.018, cage, 6));
    body.add(rod([xs, top, hoopZ], [-xs, top, hoopZ], 0.018, cage, 6));
    body.add(rod([xb, 0.42, hoopZ], [-xs, top, hoopZ], 0.015, cage, 6));
    const gf = glassSection(0.35);
    for (const side of [1, -1]) {
      body.add(rod([side * xs, top, hoopZ], [side * (gf.ht - 0.02), gf.top - 0.04, 0.35], 0.016, cage, 6));
      body.add(rod([side * (gf.ht - 0.02), gf.top - 0.04, 0.35], [side * (gf.hb - 0.1), gf.base - 0.12, 0.52], 0.016, cage, 6));
      body.add(rod([side * xs, top, hoopZ], [side * 0.45, 0.42, -1.75], 0.015, cage, 6));
      body.add(rod([side * xb, 0.5, hoopZ], [side * (gf.hb - 0.1), 0.5, 0.45], 0.014, cage, 6));
    }
  }

  // Underglow: bright strip under the sills plus a coloured pool on the road.
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff2bd6 });
  body.add(box(1.4, 0.02, 3.4, glowMat, 0, 0.2, 0));
  const poolMat = new THREE.MeshBasicMaterial({ map: radial, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.6 * sx, 7 * sz).rotateX(-Math.PI / 2), poolMat);
  pool.position.y = 0.035;
  pool.layers.set(LAYER_MAIN_ONLY);
  root.add(pool);

  // Headlight beam and a red wash behind.
  const beam = new THREE.SpotLight(0xdde8ff, 260, 70, 0.42, 0.55, 1.4);
  beam.position.set(0, 0.7, 2.0);
  beam.target.position.set(0, 0, 14);
  body.add(beam, beam.target);
  const tailGlow = new THREE.PointLight(0xff2030, 6, 7, 2);
  tailGlow.position.set(0, 0.6, -2.8);
  body.add(tailGlow);

  // Wheels.
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0ad, metalness: 1, roughness: 0.22, envMap, envMapIntensity: 1.4 });
  const parts = buildWheelParts({
    tyre: new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.88 }),
    rim: rimMat,
    cap: neon,
    disc: new THREE.MeshStandardMaterial({ color: 0x5a5c63, metalness: 0.9, roughness: 0.4, envMap }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xff2a5a, roughness: 0.4, emissive: 0x40061a }),
    chrome,
    letters: new THREE.MeshStandardMaterial({ map: sidewallTexture(), transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  });
  const wheels = [];
  for (const [side, z, front] of [[1, FRONT_Z, true], [-1, FRONT_Z, true], [1, REAR_Z, false], [-1, REAR_Z, false]]) {
    const w = makeWheel(parts, side, front, look.wheels);
    w.pivot.position.set(side * TRACK * sx, WHEEL_R, z * sz);
    w.front = front;
    root.add(w.pivot);
    wheels.push(w);
  }

  // Bake the body into one mesh per material; the flames toggle on their own.
  const keep = new Set([flame]);
  steeringWheel?.traverse((o) => o.isMesh && keep.add(o));
  mergeByMaterial(body, keep);
  // Cockpit eye point for the first-person camera, in body space.
  const eye = new THREE.Vector3(driverX, glassSection(-0.5).base + 0.27, -0.66);

  let paintIndex = 0;
  let flameTime = 0;
  let lastThrottle = 0;
  let neonIndex = 0, rimIndex = 0;
  const roll = { x: 0, v: 0 }, pitch = { x: 0, v: 0 };
  const stance = { y: 0 };
  const api = {
    root, body, wheels, beam,
    rearTrack: TRACK * sx, rearZ: REAR_Z * sz,
    onBackfire: null,
    // Ride height, camber and spacers, as set in Customize.
    setStance(t = {}) {
      stance.y = (t.rideHeight || 0) / 100;
      for (const w of wheels) {
        const camber = ((w.front ? t.camberF ?? -1.5 : t.camberR ?? -1) * Math.PI) / 180;
        const spacer = ((w.front ? t.trackF : t.trackR) || 0) / 100;
        w.pivot.position.x = w.dir * (TRACK * sx + spacer);
        w.mount.rotation.z = -camber; // mount is mirrored per side, so one sign leans both tops in
      }
    },
    // World position of the driver's eyes, and the direction the car faces, for the cockpit camera.
    cockpit(out) {
      body.updateMatrixWorld();
      return out.copy(eye).applyMatrix4(body.matrixWorld);
    },
    steeringWheel,
    // Reflections: each world hands the car its own sky or neon environment.
    setEnvMap(tex) {
      root.traverse((o) => {
        for (const m of [].concat(o.material || [])) {
          if (m.envMap !== undefined && m.envMap !== tex && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) { m.envMap = tex; m.needsUpdate = true; }
        }
      });
    },
    // Headlight beam on at night, off in daylight.
    setLights(on) { beam.visible = on; tailGlow.visible = on; },
    setPaint(i) {
      paintIndex = (i + PAINTS.length) % PAINTS.length;
      paint.color.set(PAINTS[paintIndex].color);
      return PAINTS[paintIndex].name;
    },
    setNeon(i) {
      neonIndex = (i + NEONS.length) % NEONS.length;
      neonBase.set(NEONS[neonIndex].color);
      neon.color.copy(neonBase).multiplyScalar(3);
      glowMat.color.copy(neonBase).multiplyScalar(3);
      poolMat.color.copy(neonBase).multiplyScalar(0.3);
      decalMat.color.copy(neonBase).multiplyScalar(1.4);
      return NEONS[neonIndex].name;
    },
    setRims(i) {
      rimIndex = (i + RIMS.length) % RIMS.length;
      rimMat.color.set(RIMS[rimIndex].color);
      return RIMS[rimIndex].name;
    },
    get paintIndex() { return paintIndex; },
    get neonIndex() { return neonIndex; },
    get rimIndex() { return rimIndex; },
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material || [])) {
          if (m.map && m.map !== radial && m.map !== sidewallTex) m.map.dispose();
          m.dispose();
        }
      });
    },
    update(car, dt, ground = null) {
      root.position.set(car.x, ground ? ground.y : 0, car.z);
      root.rotation.y = car.h;
      body.position.y = stance.y;
      if (ground) { root.rotation.x = ground.pitch || 0; root.rotation.z = ground.roll || 0; root.rotation.order = 'YXZ'; }
      if (steeringWheel) steeringWheel.rotation.z = -car.steer * 2.6;
      // Body roll from lateral load, pitch from acceleration.
      // Roll and pitch from the same load transfer the tyres feel, on a slightly bouncy spring.
      roll.v += (THREE.MathUtils.clamp(car.ay * 0.0075, -0.075, 0.075) - roll.x) * 90 * dt - roll.v * 11 * dt;
      roll.x += roll.v * dt;
      pitch.v += (THREE.MathUtils.clamp(-car.ax * 0.0065, -0.05, 0.05) - pitch.x) * 90 * dt - pitch.v * 11 * dt;
      pitch.x += pitch.v * dt;
      body.rotation.z = roll.x;
      body.rotation.x = pitch.x;
      for (const w of wheels) {
        if (w.front) {
          w.pivot.rotation.y = car.steer;
          w.spin.rotation.x += w.dir * (car.u / WHEEL_R) * dt;
        } else w.spin.rotation.x = w.dir * car.wheelSpinAngle;
      }
      const braking = car.braking > 0.1 || car.handbrake;
      tailMat.color.setRGB(braking ? 6 : 2.2, braking ? 0.2 : 0.08, braking ? 0.25 : 0.12);
      tailGlow.intensity = braking ? 14 : 5;

      // Anti-lag pops: lifting off high in the rev range, or a shift under power.
      const lift = lastThrottle > 0.6 && car.driveThrottle < 0.1 && car.rpm > 4800;
      if ((lift || (car.shiftTimer > 0.1 && lastThrottle > 0.6)) && flameTime <= 0 && Math.random() < 0.8) {
        flameTime = 0.09 + Math.random() * 0.12;
        api.onBackfire?.();
      }
      lastThrottle = car.driveThrottle;
      flameTime -= dt;
      flame.visible = flameTime > 0;
      if (flame.visible) flame.scale.setScalar(0.7 + Math.random() * 0.6);
    },
  };
  api.setPaint(look.paint || 0);
  api.setNeon(look.neon || 0);
  api.setRims(look.rims || 0);
  return api;
}

// ---------- low-detail cars ----------
// Traffic, parked cars and the police use the same body profiles as one vertex-coloured geometry (paint,
// glass, trim, tyres, rims), about 1.6k triangles, plus a small geometry for the lamps. Origin at the
// ground between the axles, nose toward +z, like the full model.
const tintGeo = (geo, color) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
};
const lowCache = new Map();
export function carLowGeometry(look = {}, paint = 0xffffff) {
  const k = `${look.body || 'widebody'}|${(look.scale || []).join(',')}|${paint}|${look.police ? 1 : 0}`;
  if (lowCache.has(k)) return lowCache.get(k);
  applyProfile(look.body);
  const [sx, sy, sz] = look.scale || [1, 1, 1];
  const parts = [];
  // Shell.
  const zs = [], rings = [];
  for (let i = 0; i <= 14; i++) { const z = -2.26 + (4.48 * i) / 14; zs.push(z); rings.push(smoothRing(bodySection(z), 1)); }
  const shell = loft(rings, zs);
  if (look.police) {
    // Black and white: colour by height and length, doors white.
    const g = tintGeo(shell, 0x0c0c10);
    const pos = g.attributes.position, col = g.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), z = pos.getZ(i);
      if (y < 0.78 && Math.abs(z) < 1.05) col.setXYZ(i, 0.92, 0.92, 0.94);
    }
    parts.push(g);
  } else parts.push(tintGeo(shell, paint));
  // Glasshouse and roof.
  const gz = [], gr = [];
  const g0 = P.roof[P.roof.length - 1][0], g1 = P.roof[0][0];
  for (let i = 0; i <= 6; i++) { const z = g0 - ((g0 - g1) * i) / 6; gz.unshift(z); gr.unshift(smoothRing(glassSection(z).ring, 1)); }
  parts.push(tintGeo(loft(gr, gz), 0x10141c));
  const rz = [], rr = [];
  for (let i = 0; i <= 4; i++) {
    const z = P.skin[0] - ((P.skin[0] - P.skin[1]) * i) / 4;
    const s = glassSection(z);
    rz.unshift(z);
    rr.unshift(smoothRing(mirrorHalf([[0, s.top - 0.03], [s.ht * 0.94, s.top - 0.03], [s.ht * 0.5, s.top + 0.012], [0, s.top + 0.014]]), 1));
  }
  parts.push(tintGeo(loft(rr, rz), look.police ? 0xf0f0f2 : paint));
  // Bumper shadows, grille and sills.
  parts.push(tintGeo(new THREE.BoxGeometry(1.5, 0.14, 0.12).translate(0, 0.33, 2.2), 0x08080a));
  parts.push(tintGeo(new THREE.BoxGeometry(1.4, 0.12, 0.12).translate(0, 0.33, -2.22), 0x08080a));
  for (const s of [1, -1]) parts.push(tintGeo(new THREE.BoxGeometry(0.06, 0.08, 2.2).translate(s * (halfWidth(0) - 0.02), 0.26, 0), 0x0a0a0c));
  // Wheels: tyre and rim face.
  for (const [s, z] of [[1, FRONT_Z], [-1, FRONT_Z], [1, REAR_Z], [-1, REAR_Z]]) {
    const x = s * TRACK;
    parts.push(tintGeo(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.23, 10).rotateZ(Math.PI / 2).translate(x, WHEEL_R, z), 0x0b0b0d));
    parts.push(tintGeo(new THREE.CircleGeometry(WHEEL_R * 0.66, 8).rotateY(s * Math.PI / 2).translate(x + s * 0.118, WHEEL_R, z), look.police ? 0x2a2c30 : 0x9aa0ad));
  }
  if (look.police) {
    // Push bar.
    parts.push(tintGeo(new THREE.BoxGeometry(1.0, 0.3, 0.08).translate(0, 0.45, 2.3), 0x111114));
  }
  const body = mergeGeometries(parts);
  body.scale(sx, sy, sz);
  body.computeBoundingSphere();
  // Lamps: white heads and red tails, lit at night.
  const lp = [];
  const lamp = (w, h, d, x, y, z, c) => lp.push(tintGeo(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c));
  for (const s of [1, -1]) {
    lamp(0.36, 0.08, 0.06, s * 0.58, shoulder(2.0) - 0.07, 2.2, 0xffffff);
    lamp(0.34, 0.08, 0.05, s * 0.6, shoulder(-2.1) - 0.06, -2.26, 0xff1020);
  }
  const lights = mergeGeometries(lp);
  lights.scale(sx, sy, sz);
  const out = { body, lights, length: 4.5 * sz, width: 2 * halfWidth(0) * sx, roof: glassSection(-0.4).top * sy };
  lowCache.set(k, out);
  return out;
}
