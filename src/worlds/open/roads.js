// Road surfaces and everything that runs along them: markings, curbs and sidewalks in town, concrete
// gutters on the mountain, intersections with crosswalks, guardrails, the highway's centre barrier, and
// where the street lights go. Also returns the colliders those parts add.
import * as THREE from 'three';
import { clamp, heightAt, roadQuery, rng, smooth, inLot } from './layout.js';
import { splitByArea } from './builder.js';

// ---------- textures ----------
const TEX_LEN = 24; // metres of road per texture repeat

function asphaltBase(g, W, H, seed, tone = 46) {
  const r = rng(seed);
  g.fillStyle = `rgb(${tone},${tone},${tone + 3})`;
  g.fillRect(0, 0, W, H);
  // Aggregate: thousands of tiny light and dark specks.
  for (let i = 0; i < W * H * 0.05; i++) {
    const v = tone + (r() - 0.5) * 60;
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.35 + r() * 0.5})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  // Patches and cracks.
  for (let i = 0; i < 10; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? 20 : 70},${r() < 0.5 ? 20 : 70},${r() < 0.5 ? 22 : 72},0.12)`;
    g.fillRect(r() * W, r() * H, 20 + r() * 80, 30 + r() * 140);
  }
  g.strokeStyle = 'rgba(15,15,18,0.55)';
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    let x = r() * W, y = r() * H;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 18; y += r() * 14; g.lineTo(x, y); }
    g.stroke();
  }
}

// Markings: [lateral offset (m), line width (m), colour, dash length (m) or 0 for solid].
const MARKS = {
  street: [[-0.1, 0.1, 'y', 0], [0.1, 0.1, 'y', 0], [-3.7, 0.12, 'w', 0], [3.7, 0.12, 'w', 0]],
  boulevard: [[-1.65, 0.12, 'y', 0], [1.65, 0.12, 'y', 0], [-5.3, 0.12, 'w', 3], [5.3, 0.12, 'w', 3], [-8.5, 0.15, 'w', 0], [8.5, 0.15, 'w', 0]],
  coast: [[-0.1, 0.1, 'y', 0], [0.1, 0.1, 'y', 0], [-4.7, 0.14, 'w', 0], [4.7, 0.14, 'w', 0]],
  highway: [[-0.95, 0.14, 'y', 0], [0.95, 0.14, 'y', 0], [-4.55, 0.14, 'w', 3], [4.55, 0.14, 'w', 3], [-8.15, 0.18, 'w', 0], [8.15, 0.18, 'w', 0]],
  village: [[-3.5, 0.12, 'w', 0], [3.5, 0.12, 'w', 0], [0, 0.1, 'w', 1.5]],
  touge: [[-3.75, 0.15, 'w', 0], [3.75, 0.15, 'w', 0], [-0.08, 0.1, 'y', 0], [0.08, 0.1, 'y', 0]],
  ridge: [[-4.25, 0.15, 'w', 0], [4.25, 0.15, 'w', 0], [0, 0.12, 'y', 4]],
  pier: [],
};

// Weathered timber decking laid across the pier.
function plankTexture(g, W, H, seed) {
  const r = rng(seed);
  const board = H / 96;
  for (let y = 0; y < H; y += board) {
    const v = 120 + r() * 50;
    g.fillStyle = `rgb(${v},${v * 0.82},${v * 0.62})`;
    g.fillRect(0, y, W, board);
    g.fillStyle = 'rgba(30,20,12,0.7)';
    g.fillRect(0, y, W, 1.5);
    for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(60,40,25,${r() * 0.25})`; g.fillRect(r() * W, y + r() * board, 20 + r() * 80, 1); }
    // Butt joints and nail heads.
    const j = r() * W;
    g.fillStyle = 'rgba(20,14,8,0.8)'; g.fillRect(j, y, 2, board);
    g.fillStyle = 'rgba(40,40,44,0.8)';
    for (const x of [W * 0.12, W * 0.5, W * 0.88]) g.fillRect(x, y + board * 0.3, 2, 2);
  }
}

function roadTexture(kind, width, seed) {
  const W = 512, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (kind === 'pier') plankTexture(g, W, H, seed);
  else asphaltBase(g, W, H, seed, kind === 'highway' ? 52 : kind === 'touge' || kind === 'ridge' ? 42 : 48);
  const pxm = W / width, pym = H / TEX_LEN;
  const X = (lat) => W / 2 - lat * pxm;
  // Polished wheel tracks.
  g.fillStyle = 'rgba(20,20,24,0.18)';
  const lanes = kind === 'highway' ? [-6.3, -2.7, 2.7, 6.3] : kind === 'boulevard' ? [-7, -3.5, 3.5, 7] : [-width / 4, width / 4];
  if (kind !== 'pier') for (const c of lanes) for (const o of [-0.8, 0.8]) g.fillRect(X(c + o) - 0.3 * pxm, 0, 0.6 * pxm, H);
  // Drift marks on the mountain roads: long black arcs where the line goes.
  if (kind === 'touge' || kind === 'ridge') {
    const r = rng(seed + 9);
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = `rgba(8,8,10,${0.15 + r() * 0.3})`;
      g.lineWidth = (0.2 + r() * 0.12) * pxm;
      const x0 = X((r() - 0.5) * width * 0.7), y0 = r() * H;
      g.beginPath();
      g.moveTo(x0, y0);
      g.bezierCurveTo(x0 + (r() - 0.5) * 120, y0 + 200, x0 + (r() - 0.5) * 160, y0 + 420, x0 + (r() - 0.5) * 200, y0 + 620);
      g.stroke();
      g.beginPath();
      g.moveTo(x0 + 1.5 * pxm, y0);
      g.bezierCurveTo(x0 + 1.5 * pxm + (r() - 0.5) * 120, y0 + 200, x0 + 1.5 * pxm + (r() - 0.5) * 160, y0 + 420, x0 + 1.5 * pxm + (r() - 0.5) * 200, y0 + 620);
      g.stroke();
    }
  }
  // Highway shoulders get a rumble strip.
  if (kind === 'highway') {
    g.fillStyle = 'rgba(30,30,34,0.6)';
    for (const s of [-1, 1]) for (let y = 0; y < H; y += 0.3 * pym) g.fillRect(X(s * 8.7) - 0.25 * pxm, y, 0.5 * pxm, 0.15 * pym);
  }
  for (const [lat, w, col, dash] of MARKS[kind]) {
    g.fillStyle = col === 'y' ? 'rgba(232,180,40,0.92)' : 'rgba(235,235,230,0.9)';
    const x = X(lat) - (w * pxm) / 2;
    if (!dash) g.fillRect(x, 0, w * pxm, H);
    else for (let y = 0; y < H; y += dash * 4 * pym) g.fillRect(x, y, w * pxm, dash * pym);
  }
  // Worn paint: knock the lines back in places.
  const r = rng(seed + 3);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(48,48,52,${r() * 0.5})`;
    g.fillRect(r() * W, r() * H, 2 + r() * 6, 2 + r() * 6);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tileTexture(kind) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const r = rng(kind === 'sidewalk' ? 5 : 8);
  g.fillStyle = kind === 'sidewalk' ? '#a49f96' : '#8c8a85';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    const v = 120 + r() * 70;
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`;
    g.fillRect(r() * S, r() * S, 1.5, 1.5);
  }
  if (kind === 'sidewalk') {
    // 1.5 m slabs with joints, and a few stains.
    g.strokeStyle = 'rgba(70,66,60,0.7)';
    g.lineWidth = 2;
    for (let k = 0; k <= 2; k++) { g.beginPath(); g.moveTo(0, k * 128); g.lineTo(S, k * 128); g.stroke(); g.beginPath(); g.moveTo(k * 128, 0); g.lineTo(k * 128, S); g.stroke(); }
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(60,55,50,0.12)'; g.beginPath(); g.arc(r() * S, r() * S, 6 + r() * 20, 0, Math.PI * 2); g.fill(); }
  } else {
    // Gutter concrete: board marks and grime in the channel.
    g.fillStyle = 'rgba(40,44,38,0.25)';
    g.fillRect(S * 0.3, 0, S * 0.4, S);
    g.strokeStyle = 'rgba(60,58,55,0.6)';
    for (let y = 0; y < S; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beamTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#9aa0a6'); grd.addColorStop(0.2, '#e4e8ec'); grd.addColorStop(0.45, '#7d838a');
  grd.addColorStop(0.55, '#7d838a'); grd.addColorStop(0.8, '#e4e8ec'); grd.addColorStop(1, '#8a9096');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- geometry helpers ----------
class Strip {
  constructor() { this.pos = []; this.uv = []; this.nor = []; this.idx = []; }
  // Adds a ribbon from rows of [x, y, z, u, v] points (each row the same length), normals from the surface.
  rows(rows) {
    const base = this.pos.length / 3, M = rows[0].length;
    for (const row of rows) for (const p of row) { this.pos.push(p[0], p[1], p[2]); this.uv.push(p[3], p[4]); this.nor.push(0, 1, 0); }
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < M - 1; j++) {
      const a = base + i * M + j, b = a + 1, c = a + M, d = c + 1;
      this.idx.push(a, b, c, b, d, c);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// Is this stretch of road edge a driveway into a lot?
function inGap(net, r, side, s) {
  for (const lot of net.lots) for (const g of lot.gaps) if (g.road === r.id && g.side === side && s >= g.s0 && s <= g.s1) return true;
  return false;
}

// Is (x, z) on the paved part of a road other than `self`?
function onOtherRoad(net, x, z, self, pad = 0.5) {
  const list = net.index.cells.get(net.index.key(Math.floor(x / 32), Math.floor(z / 32)));
  if (!list) return false;
  for (let k = 0; k < list.length; k += 2) {
    const r = net.roads[list[k]];
    if (r === self) continue;
    const a = r.samples[list[k + 1]], b = r.samples[list[k + 1] + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
    if (Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < r.hw + pad) return true;
  }
  return false;
}

// ---------- build ----------
export function buildRoads(net, heights, preset) {
  const group = new THREE.Group();
  const segs = []; // collision walls: { ax, az, bx, bz, h }
  const lamps = [];
  const rails = [];
  const mats = {};
  const offsets = { street: 1, boulevard: 2, coast: 3, highway: 4, village: 1, touge: 2, ridge: 3 };
  const strips = {};
  const sidewalk = new Strip(), curbs = new Strip(), gutter = new Strip(), barrier = new Strip(), median = new Strip(), medianGrass = new Strip();

  net.roads.forEach((r, ri) => {
    if (!strips[r.kind]) {
      strips[r.kind] = new Strip();
      mats[r.kind] = new THREE.MeshStandardMaterial({
        map: roadTexture(r.kind, r.width, 11 + ri), roughness: r.kind === 'pier' ? 0.9 : 0.82, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -offsets[r.kind],
      });
    }
    const S = r.samples;
    const rows = [];
    const crown = r.kind === 'highway' ? 0 : 0.04;
    for (const p of S) {
      const nx = -p.tz, nz = p.tx; // left normal
      const v = p.s / TEX_LEN;
      const row = [];
      for (const f of [-1, -0.5, 0, 0.5, 1]) {
        const lat = f * r.hw;
        row.push([p.x + nx * lat, p.y + 0.02 + crown * (1 - f * f), p.z + nz * lat, 0.5 - f * 0.5, v]);
      }
      rows.push(row);
    }
    strips[r.kind].rows(rows);

    // Edges, per side: sidewalk and curb, or gutter, and guardrails where the ground falls away.
    for (const side of [1, -1]) {
      let run = null;
      const flush = () => { if (run && run.length > 1) (r.gutter ? gutterRun : sidewalkRun)(run); run = null; };
      const sidewalkRun = (pts) => {
        const sw = r.sidewalk;
        const rowsTop = [], rowsCurb = [];
        for (const p of pts) {
          const nx = -p.tz * side, nz = p.tx * side;
          const e = r.hw, o = r.hw + sw, y = p.y + 0.02;
          rowsCurb.push([[p.x + nx * e, y, p.z + nz * e, 0, p.s], [p.x + nx * e, y + 0.16, p.z + nz * e, 0.15, p.s]]);
          rowsTop.push([[p.x + nx * e, y + 0.16, p.z + nz * e, 0, p.s / 1.5], [p.x + nx * o, y + 0.16, p.z + nz * o, sw / 1.5, p.s / 1.5], [p.x + nx * (o + 0.05), y - 0.4, p.z + nz * (o + 0.05), sw / 1.5 + 0.2, p.s / 1.5]]);
        }
        if (side < 0) { rowsCurb.forEach((row) => row.reverse()); rowsTop.forEach((row) => row.reverse()); }
        curbs.rows(rowsCurb);
        sidewalk.rows(rowsTop);
      };
      const gutterRun = (pts) => {
        const rowsG = [];
        const K = 5;
        for (const p of pts) {
          const nx = -p.tz * side, nz = p.tx * side;
          const row = [];
          for (let k = 0; k <= K; k++) {
            const t = k / K, lat = r.hw + r.gutter * t;
            row.push([p.x + nx * lat, p.y + 0.02 - 0.18 * Math.sin(Math.PI * t), p.z + nz * lat, t * 0.5, p.s / 2]);
          }
          // Lip back up to the verge.
          row.push([p.x + nx * (r.hw + r.gutter + 0.25), p.y + 0.05, p.z + nz * (r.hw + r.gutter + 0.25), 0.6, p.s / 2]);
          rowsG.push(row);
        }
        if (side < 0) rowsG.forEach((row) => row.reverse());
        gutter.rows(rowsG);
      };
      for (let i = 0; i < S.length; i++) {
        const p = S[i];
        if (!(r.sidewalk || r.gutter)) break;
        const nx = -p.tz * side, nz = p.tx * side;
        const off = r.hw + (r.sidewalk || r.gutter) * 0.5;
        // No sidewalk or gutter across another road (junctions and intersections).
        const blocked = onOtherRoad(net, p.x + nx * off, p.z + nz * off, r, 1.5) || onOtherRoad(net, p.x + nx * (r.hw + 0.3), p.z + nz * (r.hw + 0.3), r, 0.2) || inGap(net, r, side, p.s);
        if (blocked) { flush(); continue; }
        (run ||= []).push(p);
      }
      flush();

      // Guardrails on mountain roads and the highway where the drop is real, or on the outside of tight bends.
      if (r.rails) {
        let railRun = null;
        const railOff = r.hw + (r.gutter ? r.gutter + 0.6 : r.shoulder ? 0.4 : 0.6);
        const endRail = () => { if (railRun && railRun.length > 3) rails.push({ pts: railRun, side, off: railOff }); railRun = null; };
        for (let i = 2; i < S.length - 2; i++) {
          const p = S[i];
          const nx = -p.tz * side, nz = p.tx * side;
          const drop = p.y - heightAt(heights, p.x + nx * (railOff + 4), p.z + nz * (railOff + 4));
          // Curvature sign: positive when this side is the outside of the bend.
          const a = S[i - 2], b = S[i + 2];
          const turn = (a.tx * b.tz - a.tz * b.tx) * side;
          const tight = turn < -0.02;
          const near = onOtherRoad(net, p.x + nx * (railOff + 0.5), p.z + nz * (railOff + 0.5), r, 2) || net.lots.some((l) => inLot(l, p.x + nx * (railOff + 1), p.z + nz * (railOff + 1), 2));
          if ((drop > 1.2 || tight || r.railAlways) && !near) (railRun ||= []).push(p);
          else endRail();
        }
        endRail();
      }
    }

    // Boulevard median: a raised planter with grass, palms go on it later.
    if (r.median) {
      const rowsM = [], rowsG = [];
      const mh = r.median / 2;
      const opening = (p) => onOtherRoad(net, p.x, p.z, r, 0.5) || inGap(net, r, 1, p.s) || inGap(net, r, -1, p.s);
      for (const p of S) {
        if (opening(p)) { if (rowsM.length > 1) { median.rows(rowsM.splice(0)); medianGrass.rows(rowsG.splice(0)); } rowsM.length = 0; rowsG.length = 0; continue; }
        const nx = -p.tz, nz = p.tx, y = p.y + 0.02;
        rowsM.push([[p.x - nx * mh, y, p.z - nz * mh, 0, p.s], [p.x - nx * mh, y + 0.2, p.z - nz * mh, 0.2, p.s], [p.x + nx * mh, y + 0.2, p.z + nz * mh, 0.4, p.s], [p.x + nx * mh, y, p.z + nz * mh, 0.6, p.s]]);
        rowsG.push([[p.x - nx * (mh - 0.15), y + 0.22, p.z - nz * (mh - 0.15), 0, p.s / 3], [p.x + nx * (mh - 0.15), y + 0.22, p.z + nz * (mh - 0.15), 1, p.s / 3]]);
      }
      if (rowsM.length > 1) { median.rows(rowsM); medianGrass.rows(rowsG); }
      for (let i = 0; i < S.length - 1; i += 1) {
        const a = S[i], b = S[i + 1];
        if (opening(a) || opening(b)) continue;
        for (const s of [-1, 1]) segs.push({ ax: a.x - a.tz * mh * s, az: a.z + a.tx * mh * s, bx: b.x - b.tz * mh * s, bz: b.z + b.tx * mh * s, low: true });
      }
    }

    // Highway: concrete jersey barrier down the middle.
    if (r.barrier) {
      const rowsB = [];
      const prof = [[-0.3, 0], [-0.2, 0.08], [-0.12, 0.3], [-0.08, 0.82], [0.08, 0.82], [0.12, 0.3], [0.2, 0.08], [0.3, 0]];
      for (const p of S) {
        if (onOtherRoad(net, p.x, p.z, r, 0.5)) { if (rowsB.length > 1) barrier.rows(rowsB.splice(0)); rowsB.length = 0; continue; }
        const nx = -p.tz, nz = p.tx;
        rowsB.push(prof.map(([l, h], k) => [p.x + nx * l, p.y + 0.02 + h, p.z + nz * l, k / 7, p.s / 4]));
      }
      if (rowsB.length > 1) barrier.rows(rowsB);
      for (let i = 0; i < S.length - 1; i++) {
        const a = S[i], b = S[i + 1];
        if (onOtherRoad(net, a.x, a.z, r, 0.5)) continue;
        segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, thick: 0.35 });
      }
    }

    // Street lights.
    if (r.lights) {
      const rnd = rng(100 + ri);
      let side = 1;
      for (let s = r.lights * 0.5; s < r.length - 4; s += r.lights) {
        const i = Math.min(S.length - 1, Math.round(s / 3));
        const p = S[i];
        const style = r.kind === 'village' ? 'lantern' : r.kind === 'highway' ? 'twin' : r.kind === 'touge' || r.kind === 'ridge' ? 'mountain' : r.kind === 'pier' ? 'lot' : 'cobra';
        const off = style === 'twin' ? 0 : r.kind === 'pier' ? r.hw - 0.5 : r.hw + (r.sidewalk ? r.sidewalk - 0.6 : r.gutter ? r.gutter + 0.9 : 1.2);
        const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
        if (style !== 'twin' && onOtherRoad(net, x, z, r, 1.5)) continue;
        lamps.push({ x, y: style === 'twin' ? p.y + 0.85 : r.kind === 'pier' ? p.y : heightAt(heights, x, z), z, nx: p.tz * side, nz: -p.tx * side, style, road: r, arm: style === 'twin' ? r.hw * 0.42 : 2.2 });
        if (r.kind !== 'boulevard' && r.kind !== 'highway') side = rnd() < 0.85 ? -side : side;
      }
    }
  });

  // Guardrail meshes and their colliders.
  const beamMat = new THREE.MeshStandardMaterial({ map: beamTexture(), metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
  const beam = new Strip();
  const posts = [];
  for (const run of rails) {
    const rowsR = [];
    let acc = 0;
    run.pts.forEach((p, k) => {
      const nx = -p.tz * run.side, nz = p.tx * run.side;
      const x = p.x + nx * run.off, z = p.z + nz * run.off, y = p.y + 0.02;
      rowsR.push([[x, y + 0.48, z, 0, p.s / 4], [x, y + 0.8, z, 1, p.s / 4]]);
      if (k > 0) {
        const q = run.pts[k - 1];
        acc += p.s - q.s;
        segs.push({ ax: q.x - q.tz * run.side * run.off, az: q.z + q.tx * run.side * run.off, bx: x, bz: z, thick: 0.15, rail: true });
      }
      if (k === 0 || acc >= 4) { acc = 0; posts.push([x + nx * 0.12, y, z + nz * 0.12]); }
    });
    beam.rows(rowsR);
  }

  // Each long strip is cut into 300 m tiles so only what is in view gets drawn.
  const tiles = [];
  const add = (strip, mat, detail = false) => {
    if (!strip.pos.length) return null;
    for (const g of splitByArea(strip.build(), 500)) {
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.castShadow = false;
      m.matrixAutoUpdate = false;
      group.add(m);
      tiles.push({ m, x: g.boundingSphere.center.x, z: g.boundingSphere.center.z, r: g.boundingSphere.radius, detail });
    }
    return null;
  };
  for (const [kind, strip] of Object.entries(strips)) add(strip, mats[kind]);
  const concrete = new THREE.MeshStandardMaterial({ map: tileTexture('sidewalk'), roughness: 0.9 });
  add(sidewalk, concrete, true);
  add(curbs, new THREE.MeshStandardMaterial({ color: 0xb8b2a8, roughness: 0.85, side: THREE.DoubleSide }), true);
  add(gutter, new THREE.MeshStandardMaterial({ map: tileTexture('gutter'), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  add(barrier, new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 0.9 }));
  add(median, new THREE.MeshStandardMaterial({ color: 0xbab4a8, roughness: 0.9 }), true);
  add(medianGrass, new THREE.MeshStandardMaterial({ color: 0x4f6e2e, roughness: 1 }));
  add(beam, beamMat, true);
  if (posts.length) {
    const pg = new THREE.BoxGeometry(0.1, 0.85, 0.12).translate(0, 0.42, 0);
    const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.6, roughness: 0.45 }), posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach((p, i) => pm.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])));
    pm.computeBoundingSphere();
    group.add(pm);
  }

  // Intersections: plain asphalt where roads cross, with crosswalks in town.
  const crossings = intersections(net);
  const patch = new Strip(), zebra = new Strip();
  for (const c of crossings) {
    const { x, z, y, ax, az, wa, wb, town } = c; // ax,az: unit along road A; road B perpendicular-ish
    const bx = -az, bz = ax;
    const ha = wb / 2 + (town ? 0.2 : 0.5), hb = wa / 2 + (town ? 0.2 : 0.5);
    const P = (u, v) => [x + ax * u + bx * v, y + 0.035, z + az * u + bz * v];
    const q = [P(-ha, -hb), P(ha, -hb), P(-ha, hb), P(ha, hb)];
    patch.rows([[[...q[0], 0, 0], [...q[1], 1, 0]], [[...q[2], 0, 1], [...q[3], 1, 1]]]);
    if (!town) continue;
    // Zebra stripes across each approach, 3 m deep, 0.5 m bars.
    for (const [dirU, dirV, along, across] of [[1, 0, ha, hb], [-1, 0, ha, hb], [0, 1, hb, ha], [0, -1, hb, ha]]) {
      for (let k = -across + 0.6; k < across - 0.5; k += 1.0) {
        const o0 = along + 0.4, o1 = along + 3.2;
        const pts = dirU ? [[dirU * o0, k], [dirU * o1, k], [dirU * o0, k + 0.5], [dirU * o1, k + 0.5]] : [[k, dirV * o0], [k, dirV * o1], [k + 0.5, dirV * o0], [k + 0.5, dirV * o1]];
        const Q = pts.map(([u, v]) => P(u, v));
        zebra.rows([[[...Q[0], 0, 0], [...Q[1], 1, 0]], [[...Q[2], 0, 1], [...Q[3], 1, 1]]]);
      }
    }
  }
  const plainTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; asphaltBase(cv.getContext('2d'), 256, 256, 77); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const patchMesh = add(patch, new THREE.MeshStandardMaterial({ map: plainTex, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
  add(zebra, new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 }));
  void patchMesh;

  // Curbs bump the car: low walls along sidewalk edges.
  for (const r of net.roads) {
    if (!r.curb) continue;
    for (let i = 0; i < r.samples.length - 1; i++) {
      const a = r.samples[i], b = r.samples[i + 1];
      for (const s of [1, -1]) {
        const o = r.hw + 0.05;
        const ax = a.x - a.tz * o * s, az = a.z + a.tx * o * s, bx = b.x - b.tz * o * s, bz = b.z + b.tx * o * s;
        // Skip anything touching a junction or a driveway, so no invisible wall pokes into the crossing.
        if (onOtherRoad(net, ax, az, r, 1.6) || onOtherRoad(net, bx, bz, r, 1.6) || inGap(net, r, s, a.s) || inGap(net, r, s, b.s)) continue;
        segs.push({ ax, az, bx, bz, curb: true });
      }
    }
  }
  void smooth;
  void roadQuery;
  // Small parts (curbs, sidewalks, rails) drop out sooner than the road surfaces themselves.
  const far = Math.min(preset.far, 2600);
  const update = (cam) => {
    for (const t of tiles) {
      const d = Math.hypot(t.x - cam.x, t.z - cam.z) - t.r;
      t.m.visible = d < (t.detail ? far * 0.3 : far * 0.65);
    }
  };
  return { group, segs, lamps, crossings, materials: mats, update };
}

// Where two roads cross (in town) or meet at a junction: centre, height, directions and widths.
function intersections(net) {
  const out = [];
  const town = new Set(['street', 'boulevard', 'coast']);
  const roads = net.roads;
  for (let a = 0; a < roads.length; a++) for (let b = a + 1; b < roads.length; b++) {
    const A = roads[a], B = roads[b];
    // Only straight town roads cross at right angles in a grid; check their end-to-end lines.
    if (!(town.has(A.kind) && town.has(B.kind))) continue;
    if (A.kind === 'coast') continue;
    const a0 = A.samples[0], a1 = A.samples[A.samples.length - 1];
    for (let i = 0; i < B.samples.length - 1; i++) {
      const p = B.samples[i], q = B.samples[i + 1];
      const hit = segX(a0.x, a0.z, a1.x, a1.z, p.x, p.z, q.x, q.z);
      if (!hit) continue;
      const ax = (a1.x - a0.x), az = (a1.z - a0.z), L = Math.hypot(ax, az);
      out.push({ x: hit[0], z: hit[1], y: p.y, ax: ax / L, az: az / L, wa: A.width, wb: B.width, town: true });
      break;
    }
  }
  return out;
}

function segX(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1x = bx - ax, r1z = bz - az, r2x = dx - cx, r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * r2z - (cz - az) * r2x) / den;
  const u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [ax + r1x * t, az + r1z * t];
}
