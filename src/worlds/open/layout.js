// Open world layout, as plain data and maths with no three.js, so tests can check it in node.
//
// The map is 3.9 km square, x east and z north:
//   south-west  Vista Del Mar, an LA-style beach town: a street grid with palms, houses, a strip with a
//               car meet, a boulevard, and the coast road along the Pacific.
//   middle      Route 7, a divided highway with long straights and sweepers toward the mountains.
//   north-east  Sakura Pass: a Japanese village at the foot of Mt. Kurogane, a touge of hairpins up the
//               mountain past a waterfall to a summit lookout, then a fast ridge road and a downhill run
//               back to the highway.
// Roads are splines sampled every few metres. Each has a height profile: town roads follow the ground,
// mountain and highway roads are smoothed and grade-limited, and then the terrain is cut and filled to them.

export const HALF = 1950; // map half-size (m)
export const CELL = 4; // terrain grid spacing (m)
export const N = Math.round((HALF * 2) / CELL); // terrain cells per side
export const SEA = 0; // sea level

// ---------- seeded noise ----------
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const PERM = new Uint8Array(512);
{
  const r = rng(90210);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GX = [1, -1, 1, -1, 1, -1, 0, 0], GZ = [1, 1, -1, -1, 0, 0, 1, -1];
// 2D gradient noise in about -1..1.
export function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
  const X = xi & 255, Z = zi & 255;
  const g = (ix, iz, dx, dz) => { const h = PERM[ix + PERM[iz]] & 7; return GX[h] * dx + GZ[h] * dz; };
  const n00 = g(X, Z, xf, zf), n10 = g(X + 1, Z, xf - 1, zf), n01 = g(X, Z + 1, xf, zf - 1), n11 = g(X + 1, Z + 1, xf - 1, zf - 1);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.3;
}
export function fbm(x, z, oct = 4) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f + i * 17.3, z * f - i * 9.1); norm += a; a *= 0.5; f *= 2.03; }
  return s / norm;
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// ---------- regions ----------
export const LA = { x0: -1900, x1: -640, z0: -1640, z1: -400 };
export const VILLAGE = { x: 1250, z: 610, r: 260 };
export const PEAK = { x: 1300, z: 1560 };
// Distance outside a box (0 inside).
const boxDist = (x, z, b) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));

// The ridge runs west from the summit, falling gently, so the ridge road can stay on top of it.
const RIDGE = [[1300, 1600, 196], [1000, 1700, 165], [650, 1700, 128], [300, 1640, 92], [0, 1640, 64], [-200, 1560, 45]];
function ridgeHeight(x, z) {
  let best = 0;
  for (let i = 0; i < RIDGE.length - 1; i++) {
    const [ax, az, ah] = RIDGE[i], [bx, bz, bh] = RIDGE[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    best = Math.max(best, (ah + (bh - ah) * t) * Math.exp(-((d / 230) ** 2)));
  }
  return best;
}

// Natural ground height before roads are cut in.
export function baseHeight(x, z) {
  // Rolling hills, dry and grassy.
  let h = 22 + fbm(x * 0.0011, z * 0.0011, 4) * 34 + fbm(x * 0.006, z * 0.006, 2) * 3;
  // The LA basin is flat and low.
  const la = 1 - smooth(0, 260, boxDist(x, z, LA));
  h = lerp(h, 5 + fbm(x * 0.004, z * 0.004, 2) * 1.5, la);
  // Hills behind town, with the big sign on them.
  h += 120 * Math.exp(-(((x + 1250) / 420) ** 2) - (((z - 180) / 230) ** 2)) * (0.85 + 0.3 * fbm(x * 0.01, z * 0.01, 2));
  // Mt. Kurogane and its ridge, rugged.
  const d = Math.hypot(x - PEAK.x, z - PEAK.z);
  const cone = 200 * Math.exp(-((d / 610) ** 2));
  const mount = Math.max(cone, ridgeHeight(x, z));
  h = Math.max(h, mount * (0.92 + 0.16 * fbm(x * 0.008, z * 0.008, 3)) + h * 0.15);
  // The village sits on a little plain.
  const vd = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
  h = lerp(h, 26, 1 - smooth(VILLAGE.r * 0.6, VILLAGE.r, vd));
  // The coast: beach then sea floor along the south edge.
  const coast = smooth(-1620, -1720, z);
  h = lerp(h, -9, coast);
  return h;
}

// ---------- roads ----------
// kinds: street (2 lanes, sidewalks), boulevard (4 lanes, palm median), coast, highway (divided 4 lanes),
// village (narrow, gutters), touge (narrow, gutters and guardrails), ridge (2 lanes, rails).
export const KINDS = {
  street: { width: 10, lanes: 2, follow: true, sidewalk: 3.2, lights: 34, blend: 14, curb: true, speed: 13 },
  boulevard: { width: 18, lanes: 4, follow: true, sidewalk: 3.6, lights: 30, blend: 16, curb: true, median: 3, speed: 17 },
  coast: { width: 12, lanes: 2, follow: false, grade: 0.06, smooth: 90, sidewalk: 3, lights: 40, blend: 20, curb: true, speed: 19 },
  highway: { width: 21, lanes: 4, follow: false, grade: 0.06, smooth: 160, shoulder: 2.5, lights: 60, blend: 26, barrier: true, rails: true, speed: 30 },
  village: { width: 7.5, lanes: 2, follow: true, gutter: 0.45, lights: 26, blend: 10, speed: 10 },
  touge: { width: 8, lanes: 2, follow: false, grade: 0.12, smooth: 70, gutter: 0.45, lights: 55, blend: 7, rails: true, speed: 15 },
  ridge: { width: 9, lanes: 2, follow: false, grade: 0.1, smooth: 120, gutter: 0.45, lights: 70, blend: 12, rails: true, speed: 22 },
  // Out over the water on pilings: flat, planked, railed, and never stamped into the sea floor.
  pier: { width: 13, lanes: 2, follow: false, flat: true, noStamp: true, lights: 24, blend: 0, rails: true, railAlways: true, speed: 8 },
};
export const PIER_X = -1262;

const AVENUES = [-1820, -1660, -1500, -1340, -1180, -1020, -860, -700];
const STREETS = [-1420, -1260, -1100, -780, -620, -460];
export const BOULEVARD_Z = -940;
export const PCH_Z = -1580;

export const ROAD_DEFS = [
  ...AVENUES.map((x, i) => ({ id: `ave${i}`, name: `${['Ocean', 'Palisades', 'Sunset', 'Lincoln', 'Venice', 'Pico', 'Rose', 'Vista'][i]} Ave`, kind: 'street', pts: [[x, PCH_Z], [x, -460]] })),
  ...STREETS.map((z, i) => ({ id: `st${i}`, name: `${['1st', '2nd', '3rd', '5th', '6th', '7th'][i]} St`, kind: 'street', pts: [[-1820, z], [-700, z]] })),
  { id: 'blvd', name: 'Del Mar Blvd', kind: 'boulevard', pts: [[-1900, BOULEVARD_Z], [-700, BOULEVARD_Z]] },
  { id: 'pch', name: 'Pacific Coast Hwy', kind: 'coast', pts: [[-1930, PCH_Z], [-1000, PCH_Z], [-200, PCH_Z], [150, -1560], [420, -1420], [560, -1200], [600, -960]] },
  { id: 'hwy', name: 'Route 7', kind: 'highway', pts: [[-700, BOULEVARD_Z], [-300, BOULEVARD_Z], [200, -935], [600, -900], [900, -720], [1100, -420], [1180, -60], [1205, 300], [1230, 470], [1240, 610]] },
  { id: 'vmain', name: 'Sakura-dori', kind: 'village', pts: [[1040, 610], [1240, 610], [1460, 610]] },
  { id: 'vside', name: 'Kawa-michi', kind: 'village', pts: [[1120, 520], [1130, 610], [1120, 700]] },
  { id: 'pier', name: 'Del Mar Pier', kind: 'pier', pts: [[PIER_X, PCH_Z], [PIER_X, -1700], [PIER_X, -1880]] },
  {
    id: 'touge', name: 'Kurogane Touge', kind: 'touge',
    pts: [[1240, 610], [1242, 720], [1246, 800], [1185, 860], [1085, 900], [1010, 948], [998, 985], [1040, 1010], [1150, 1030], [1300, 1052], [1430, 1082], [1500, 1122], [1512, 1158], [1470, 1186], [1350, 1212], [1200, 1242], [1080, 1282], [1030, 1322], [1046, 1352], [1100, 1366], [1210, 1392], [1335, 1424], [1452, 1466], [1520, 1512], [1540, 1548], [1500, 1586], [1400, 1616], [1300, 1640]],
  },
  {
    id: 'ridge', name: 'Ridge Line', kind: 'ridge',
    pts: [[1300, 1640], [1160, 1690], [960, 1712], [740, 1700], [520, 1660], [280, 1640], [60, 1640], [-120, 1560], [-220, 1380], [-180, 1120], [-60, 860], [100, 600], [280, 330], [470, 60], [660, -220], [820, -500], [900, -720]],
  },
];

// Paved lots: the car meet on the boulevard, the gas station, the summit plateau and a lookout on the
// first hairpin. Each is flattened to the height of the road it opens onto, counts as tarmac, and `gaps`
// open the curb along that road (side +1 is left of the road's direction, s in metres along it).
export const LOTS = [
  { id: 'meet', name: 'Del Mar Plaza car meet', shape: 'rect', x0: -1172, x1: -1030, z0: -924, z1: -838, road: 'blvd', blend: 12, gaps: [{ road: 'blvd', side: 1, s0: 748, s1: 846 }] },
  { id: 'gas', name: 'Gas station', shape: 'rect', x0: -1006, x1: -938, z0: -1004, z1: -955, road: 'blvd', blend: 10, gaps: [{ road: 'blvd', side: -1, s0: 898, s1: 958 }] },
  { id: 'summit', name: 'Kurogane summit lookout', shape: 'circle', x: 1296, z: 1606, r: 46, road: 'touge', at: 'end', blend: 30, gaps: [] },
  { id: 'lookout', name: 'Hairpin lookout', shape: 'rect', x0: 950, x1: 992, z0: 955, z1: 1000, road: 'touge', blend: 10, gaps: [] },
];
export function inLot(lot, x, z, pad = 0) {
  if (lot.shape === 'circle') return Math.hypot(x - lot.x, z - lot.z) <= lot.r + pad;
  return x >= lot.x0 - pad && x <= lot.x1 + pad && z >= lot.z0 - pad && z <= lot.z1 + pad;
}
const lotDist = (lot, x, z) => (lot.shape === 'circle'
  ? Math.max(0, Math.hypot(x - lot.x, z - lot.z) - lot.r)
  : Math.hypot(Math.max(lot.x0 - x, 0, x - lot.x1), Math.max(lot.z0 - z, 0, z - lot.z1)));

// Catmull-Rom through the control points, sampled about every `step` metres.
function sampleSpline(pts, step) {
  const out = [];
  const P = (i) => pts[clamp(i, 0, pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  out.push([...pts[pts.length - 1]]);
  return out;
}

// Even spacing along the curve, so tight hairpins are not over-sampled.
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= L) { const t = d / L; out.push([ax + (bx - ax) * t, az + (bz - az) * t]); d += step; }
    carry = L - (d - step);
  }
  const end = pts[pts.length - 1], lastOut = out[out.length - 1];
  if (Math.hypot(end[0] - lastOut[0], end[1] - lastOut[1]) > step * 0.3) out.push(end); else out[out.length - 1] = end;
  return out;
}

// Height profile: follow the ground, or smooth it and limit the grade both ways.
function profile(samples, kind, pinStart, pinEnd) {
  const k = KINDS[kind];
  const n = samples.length;
  const raw = samples.map((p) => baseHeight(p.x, p.z));
  if (k.follow) return raw;
  // Moving average over ~smooth metres (prefix sums), weighted with an upward bias so cuts beat fills a bit.
  const ds = n > 1 ? samples[1].s - samples[0].s : 1;
  const w = Math.max(1, Math.round(k.smooth / ds / 2));
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + raw[i];
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n - 1, i + w);
    y[i] = (pre[b + 1] - pre[a]) / (b - a + 1);
  }
  if (pinStart !== undefined) y[0] = pinStart;
  if (pinEnd !== undefined) y[n - 1] = pinEnd;
  // Grade limit, forward and backward, a few times so both ends agree.
  for (let pass = 0; pass < 4; pass++) {
    const last = pinEnd !== undefined ? n - 2 : n - 1, first = pinStart !== undefined ? 1 : 0;
    for (let i = 1; i <= last; i++) { const d = (samples[i].s - samples[i - 1].s) * k.grade; y[i] = clamp(y[i], y[i - 1] - d, y[i - 1] + d); }
    for (let i = n - 2; i >= first; i--) { const d = (samples[i + 1].s - samples[i].s) * k.grade; y[i] = clamp(y[i], y[i + 1] - d, y[i + 1] + d); }
    if (pinStart !== undefined) y[0] = pinStart;
    if (pinEnd !== undefined) y[n - 1] = pinEnd;
  }
  // A last light smoothing pass takes the corners off grade changes.
  const out = Array.from(y);
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < n - 1; i++) out[i] = (out[i - 1] + 2 * out[i] + out[i + 1]) / 4;
  return out;
}

// Builds every road: samples with position, height, tangent, and distance along.
export function buildNetwork() {
  const roads = [];
  const byId = {};
  for (const def of ROAD_DEFS) {
    const k = KINDS[def.kind];
    const pts = resample(sampleSpline(def.pts, 0.75), 3);
    const samples = [];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      samples.push({ x: pts[i][0], z: pts[i][1], s, y: 0, tx: 0, tz: 1 });
    }
    for (let i = 0; i < samples.length; i++) {
      const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      samples[i].tx = (b.x - a.x) / L;
      samples[i].tz = (b.z - a.z) / L;
    }
    const road = { ...def, ...k, hw: k.width / 2, samples, length: s };
    roads.push(road);
    byId[def.id] = road;
  }
  // Heights: town roads first, then the graded roads pinned to where they meet them.
  const at = (id, x, z) => { const r = byId[id]; let best = null; for (const p of r.samples) { const d = Math.hypot(p.x - x, p.z - z); if (!best || d < best.d) best = { d, y: p.y }; } return best.y; };
  for (const r of roads) {
    if (r.follow) {
      const ys = profile(r.samples, r.kind);
      r.samples.forEach((p, i) => { p.y = ys[i]; });
    }
  }
  const pin = {
    pch: [byId.ave0.samples[0].y, undefined],
    hwy: [at('blvd', -700, BOULEVARD_Z), at('vmain', 1240, 610)],
    touge: [at('vmain', 1240, 610), undefined],
  };
  for (const id of ['pch', 'hwy', 'touge']) {
    const r = byId[id];
    const ys = profile(r.samples, r.kind, ...pin[id]);
    r.samples.forEach((p, i) => { p.y = ys[i]; });
  }
  // The coast road ends on the highway; the ridge starts at the summit and ends on the highway.
  {
    const r = byId.pch, last = r.samples[r.samples.length - 1];
    const ys = profile(r.samples, r.kind, pin.pch[0], at('hwy', last.x, last.z));
    r.samples.forEach((p, i) => { p.y = ys[i]; });
    const g = byId.ridge, end = g.samples[g.samples.length - 1];
    const gy = profile(g.samples, g.kind, byId.touge.samples[byId.touge.samples.length - 1].y, at('hwy', end.x, end.z));
    g.samples.forEach((p, i) => { p.y = gy[i]; });
  }
  // The pier sits level with the coast road where it leaves it.
  {
    const r = byId.pier, start = r.samples[0];
    r.samples.forEach((p) => { p.y = at('pch', start.x, start.z); });
  }
  // Lot heights from the road they open onto.
  for (const lot of LOTS) {
    const r = byId[lot.road];
    if (lot.at === 'end') { lot.y = r.samples[r.samples.length - 1].y; continue; }
    const cx = lot.shape === 'circle' ? lot.x : (lot.x0 + lot.x1) / 2, cz = lot.shape === 'circle' ? lot.z : (lot.z0 + lot.z1) / 2;
    let best = null;
    for (const p of r.samples) { const d = Math.hypot(p.x - cx, p.z - cz); if (!best || d < best.d) best = { d, y: p.y }; }
    lot.y = best.y;
  }
  return { roads, byId, index: buildIndex(roads), lots: LOTS };
}

// Spatial index of road segments in 32 m cells.
const ICELL = 32;
function buildIndex(roads) {
  const cells = new Map();
  const key = (cx, cz) => cx * 4096 + cz;
  roads.forEach((r, ri) => {
    const pad = r.hw + 14;
    for (let i = 0; i < r.samples.length - 1; i++) {
      const a = r.samples[i], b = r.samples[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - pad) / ICELL), x1 = Math.floor((Math.max(a.x, b.x) + pad) / ICELL);
      const z0 = Math.floor((Math.min(a.z, b.z) - pad) / ICELL), z1 = Math.floor((Math.max(a.z, b.z) + pad) / ICELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(ri, i);
      }
    }
  });
  return { cells, key };
}

// Nearest point on any road to (x, z): road, segment, lateral offset (+ is left of travel), height there.
export function roadQuery(net, x, z, out = {}) {
  const list = net.index.cells.get(net.index.key(Math.floor(x / ICELL), Math.floor(z / ICELL)));
  out.road = null;
  out.d = Infinity;
  out.score = Infinity;
  if (!list) return out;
  for (let k = 0; k < list.length; k += 2) {
    const r = net.roads[list[k]], i = list[k + 1];
    const a = r.samples[i], b = r.samples[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    // Prefer the road whose surface we are actually on, then the nearest centre line.
    const score = d - r.hw;
    if (score < out.score) {
      const L = Math.sqrt(L2);
      out.road = r; out.i = i; out.t = t; out.d = d; out.score = score;
      out.x = px; out.z = pz; out.y = a.y + (b.y - a.y) * t;
      out.tx = dx / L; out.tz = dz / L;
      out.lat = ((x - px) * -out.tz + (z - pz) * out.tx); // signed, + to the left
      out.s = a.s + (b.s - a.s) * t;
    }
  }
  return out;
}

// ---------- terrain ----------
// Heights on the grid with the roads cut and filled in. Each node keeps the strongest road influence.
export function bakeHeights(net) {
  const n = N + 1;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < n; i++) h[j * n + i] = baseHeight(-HALF + i * CELL, z);
  }
  const w = new Float32Array(n * n);
  const ry = new Float32Array(n * n);
  // Roads on stilts (the pier) only cut the ground away under them, never build it up.
  for (const r of net.roads) {
    if (!r.noStamp) continue;
    const core = r.hw + CELL;
    for (const p of r.samples) {
      const i0 = Math.max(0, Math.floor((p.x - core + HALF) / CELL)), i1 = Math.min(N, Math.ceil((p.x + core + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((p.z - core + HALF) / CELL)), j1 = Math.min(N, Math.ceil((p.z + core + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        if (Math.hypot(-HALF + i * CELL - p.x, -HALF + j * CELL - p.z) <= core) h[k] = Math.min(h[k], p.y - 0.6);
      }
    }
  }
  for (const r of net.roads) {
    if (r.noStamp) continue;
    // Flat out to a cell and a bit past the edge, so the terrain's 4 m grid never pokes up through the road.
    const core = r.hw + (r.sidewalk || r.shoulder || 0) + (r.gutter ? r.gutter + 0.6 : 0) + CELL * 0.8;
    const reach = core + r.blend;
    for (let s = 0; s < r.samples.length - 1; s++) {
      const a = r.samples[s], b = r.samples[s + 1];
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + HALF) / CELL)), i1 = Math.min(N, Math.ceil((Math.max(a.x, b.x) + reach + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach + HALF) / CELL)), j1 = Math.min(N, Math.ceil((Math.max(a.z, b.z) + reach + HALF) / CELL));
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
        const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
        if (d > reach) continue;
        const wt = d <= core ? 1 : 1 - smooth(core, reach, d);
        const k = j * n + i;
        // Sit the ground a little under the road surface so it never pokes through. Where two roads'
        // cores overlap (junctions), the lower one wins so the ground is under both.
        const y = a.y + (b.y - a.y) * t - 0.25;
        if (wt >= 0.999) { if (w[k] < 0.999 || y < ry[k]) ry[k] = y; w[k] = 1; }
        else if (wt > w[k]) { w[k] = wt; ry[k] = y; }
      }
    }
  }
  for (let k = 0; k < n * n; k++) if (w[k] > 0) h[k] = h[k] + (ry[k] - h[k]) * w[k];
  // Lots: flatten to their height, blending out, but leave the roads alone.
  for (const lot of net.lots) {
    const ext = (lot.shape === 'circle' ? lot.r : Math.max(lot.x1 - lot.x0, lot.z1 - lot.z0)) + lot.blend + 8;
    const cx = lot.shape === 'circle' ? lot.x : (lot.x0 + lot.x1) / 2, cz = lot.shape === 'circle' ? lot.z : (lot.z0 + lot.z1) / 2;
    const i0 = Math.max(0, Math.floor((cx - ext + HALF) / CELL)), i1 = Math.min(N, Math.ceil((cx + ext + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - ext + HALF) / CELL)), j1 = Math.min(N, Math.ceil((cz + ext + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * n + i;
      const d = lotDist(lot, x, z);
      if (d > lot.blend) continue;
      const wt = (1 - smooth(1, lot.blend, d)) * (1 - w[k]);
      h[k] = h[k] + (lot.y - 0.1 - h[k]) * wt;
    }
  }
  return h;
}

export function heightAt(h, x, z) {
  const fx = clamp((x + HALF) / CELL, 0, N - 1e-4), fz = clamp((z + HALF) / CELL, 0, N - 1e-4);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = N + 1;
  const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Cross-section of a road at lateral offset `lat`: surface height relative to the centre line.
// Gutters dip 0.18 m in a rounded channel just past the edge line; curbs step up to the sidewalk.
export function crossSection(r, lat) {
  const a = Math.abs(lat);
  if (a <= r.hw) return 0;
  if (r.gutter && a <= r.hw + r.gutter) {
    const t = (a - r.hw) / r.gutter;
    return -0.18 * Math.sin(Math.PI * t);
  }
  if (r.curb && a <= r.hw + r.sidewalk) return 0.15;
  return null; // off the road: the terrain decides
}
