// Trees and rocks. Each kind is instanced per 500 m chunk with a near and a far model, so the GPU only
// draws what is close in detail. Branches and fronds sway in the wind in the vertex shader, cherry trees
// shed petals around the camera, and every trunk is a collider.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeStatic } from '../../models.js';
import { InstanceField, impostor } from '../../instanceField.js';
import { groundColor } from './terrain.js';
import { HALF, LA, VILLAGE, PEAK, heightAt, roadQuery, rng, fbm, smooth, PCH_Z, BOULEVARD_Z, inLot } from './layout.js';

const wind = { uTime: { value: 0 }, uWind: { value: 0.5 } };

// ---------- textures ----------
function canvasTex(w, h, draw, repeat = false) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// A feathery palm frond: a rib down the middle with leaflets angled off both sides.
const frondTexture = () => canvasTex(128, 512, (g, W, H) => {
  const r = rng(4);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#6b6a3a';
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 0); g.stroke();
  for (let y = H - 24; y > 4; y -= 4.5) {
    const t = y / H;
    const len = (W / 2 - 3) * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.1 + 0.08)) * (0.85 + r() * 0.15);
    for (const s of [-1, 1]) {
      const v = 80 + r() * 60;
      g.strokeStyle = `rgb(${v * 0.55},${v * 0.95},${v * 0.4})`;
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + s * len * 0.5, y - 10, W / 2 + s * len, y - 24 + r() * 8);
      g.stroke();
    }
  }
});

// Clusters of five-petal blossoms on transparent ground.
const blossomTexture = () => canvasTex(256, 256, (g, W, H) => {
  const r = rng(8);
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const cx = W / 2 + (r() - 0.5) * W * 0.9 * Math.sqrt(r()), cy = H / 2 + (r() - 0.5) * H * 0.9 * Math.sqrt(r());
    if (Math.hypot(cx - W / 2, cy - H / 2) > W * 0.47) continue;
    const s = 5 + r() * 6;
    const pink = r();
    g.fillStyle = `rgb(${245 + pink * 10},${190 + (1 - pink) * 50},${210 + (1 - pink) * 30})`;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + r();
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55, s * 0.5, s * 0.32, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#d65a7a';
    g.beginPath(); g.arc(cx, cy, s * 0.2, 0, Math.PI * 2); g.fill();
  }
  // A few twigs showing through.
  g.strokeStyle = 'rgba(60,35,30,0.8)';
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + (r() - 0.5) * W * 0.8, H / 2 + (r() - 0.5) * H * 0.8); g.stroke(); }
});

const barkTexture = () => canvasTex(64, 256, (g, W, H) => {
  const r = rng(12);
  g.fillStyle = '#a8988a';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 3 + r() * 4) { g.fillStyle = `rgba(30,22,18,${0.2 + r() * 0.35})`; g.fillRect(0, y, W, 1 + r() * 2); }
  for (let i = 0; i < 300; i++) { const v = 80 + r() * 60; g.fillStyle = `rgba(${v},${v * 0.85},${v * 0.7},0.3)`; g.fillRect(r() * W, r() * H, 2, 3); }
}, true);

// ---------- wind ----------
function windy(mat, { bend = 0.004, flutter = 0 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 ip = instanceMatrix[3];
          float ph = ip.x * 0.13 + ip.z * 0.07;
          float h = max(position.y, 0.0);
          float sway = sin(uTime * 1.2 + ph) * 0.7 + sin(uTime * 2.9 + ph * 1.7) * 0.3;
          float gust = 0.35 + uWind;
          transformed.x += sway * gust * h * h * ${bend.toFixed(5)};
          transformed.z += cos(uTime * 0.9 + ph) * 0.5 * gust * h * h * ${bend.toFixed(5)};
          ${flutter ? `float r = length(position.xz);
          transformed.y += sin(uTime * 4.0 + ph + r * 2.5) * ${flutter.toFixed(3)} * r * gust;` : ''}
        }`);
  };
  mat.customProgramCacheKey = () => `windy${bend}${flutter}`;
  return mat;
}

// ---------- tree models ----------
const vc = (geo, color, jitter = 0, seed = 1) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const r = rng(seed);
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = 1 + (r() - 0.5) * jitter;
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
};

// Tapered, gently curved tube along y with a vertex-coloured bark.
function trunk(height, r0, r1, bend, radial, rings, color, seed) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, y = t * height, r = r0 + (r1 - r0) * t, cx = bend * t * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * r, y, Math.sin(a) * r);
      uv.push(j / radial, y / 2);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return vc(g, color, 0.15, seed);
}

// Palm: tall skinny trunk, a brown skirt of dead fronds, and a crown of drooping green fronds.
function palmModel(height, bend, fronds, seed, far) {
  const r = rng(seed);
  const tr = trunk(height, 0.3, 0.2, bend, far ? 4 : 7, far ? 3 : 10, 0xd8c8b0, seed);
  const top = new THREE.Vector3(bend, height, 0);
  const skirt = vc(new THREE.CylinderGeometry(0.55, 0.32, 1.6, far ? 5 : 9, 1, true).translate(top.x, height - 0.9, 0), 0x6a5236, 0.3, seed + 1);
  const crown = [];
  const n = far ? Math.ceil(fronds / 2) : fronds;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.3;
    const L = 3.4 + r() * 1.0, droop = 0.35 + r() * 0.6, lift = 0.5 + r() * 0.4;
    const segs = far ? 2 : 5;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, d = L * t;
      const y = lift * Math.sin(t * Math.PI * 0.6) * 1.2 - droop * t * t * 2.4;
      const w = 0.85 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.06));
      for (const s of [-1, 1]) {
        const px = Math.cos(a) * d - Math.sin(a) * w * s, pz = Math.sin(a) * d + Math.cos(a) * w * s;
        pos.push(top.x + px, height + y - Math.abs(s) * w * 0.15, pz);
        uv.push(s < 0 ? 0 : 1, t);
      }
    }
    for (let i = 0; i < segs; i++) { const p = i * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    crown.push(vc(g, 0xc8e0a0, 0.25, seed + k));
  }
  return { wood: mergeGeometries([tr, skirt]), leaves: mergeGeometries(crown) };
}

// Cherry: a short twisting trunk, a few limbs, and a cloud of blossom cards.
function sakuraModel(seed, far) {
  const r = rng(seed);
  const parts = [trunk(2.4, 0.26, 0.18, 0.3, far ? 4 : 6, far ? 2 : 5, 0x4a3530, seed)];
  if (!far) for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + r();
    const limb = new THREE.CylinderGeometry(0.06, 0.12, 2.6, 5).translate(0, 1.3, 0).rotateZ(0.7 + r() * 0.3).rotateY(a).translate(0.3, 2.2, 0);
    parts.push(vc(limb, 0x4a3530, 0.1, seed + k));
  }
  const cards = [];
  const n = far ? 14 : 44;
  for (let k = 0; k < n; k++) {
    const u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1);
    const rx = 3.2, ry = 2.0;
    const p = new THREE.Vector3(Math.sin(v) * Math.cos(u) * rx, Math.cos(v) * ry * 0.8 + 4.0, Math.sin(v) * Math.sin(u) * rx);
    const s = far ? 3.2 : 2.2 + r() * 0.8;
    const card = new THREE.PlaneGeometry(s, s);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * Math.PI, r() * Math.PI, r() * Math.PI));
    card.applyQuaternion(q).translate(p.x + 0.3, p.y, p.z);
    const tint = r() < 0.3 ? 0xfff0f4 : r() < 0.6 ? 0xffd0dc : 0xffb8cc;
    cards.push(vc(card, tint, 0.1, seed + 50 + k));
  }
  return { wood: mergeGeometries(parts), leaves: mergeGeometries(cards) };
}

// Japanese cedar: a straight trunk, a dark inner cone for body, and drooping needle cards around it.
function cedarModel(height, seed, far) {
  const r = rng(seed);
  const wood = trunk(height * 0.4, 0.28, 0.16, 0, far ? 4 : 5, 1, 0x6a5444, seed);
  const parts = [];
  const coneH = height * 0.78, coneR = height * 0.17;
  const cone = new THREE.ConeGeometry(coneR, coneH, far ? 6 : 9, far ? 1 : 3, false);
  const cp = cone.attributes.position;
  for (let i = 0; i < cp.count; i++) { const y = cp.getY(i); if (y < coneH / 2 - 0.01) { const j = 0.85 + r() * 0.3; cp.setX(i, cp.getX(i) * j); cp.setZ(i, cp.getZ(i) * j); } }
  cone.computeVertexNormals();
  cone.translate(0, height * 0.22 + coneH / 2, 0);
  // The body cone goes with the trunk (no needle cut-outs), the cards carry the needles.
  const body = mergeGeometries([wood, vc(cone, far ? 0x2c4a2c : 0x24402a, 0.15, seed)]);
  if (far) return { wood: body, leaves: null };
  {
    // Needle cards: tilted downward, arranged in whorls up the tree, shrinking toward the top.
    const whorls = 9;
    for (let w = 0; w < whorls; w++) {
      const t = w / whorls;
      const y = height * (0.26 + t * 0.66);
      const rad = coneR * (1.05 - t * 0.85) + 0.5;
      const n = Math.max(4, Math.round(9 - t * 5));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r() * 0.6 + w;
        const len = rad * (1.1 + r() * 0.4), wid = rad * 0.9;
        const card = new THREE.PlaneGeometry(wid, len).translate(0, len / 2, 0).rotateX(Math.PI / 2 + 0.55 + r() * 0.25).rotateY(-a + Math.PI / 2);
        card.translate(Math.cos(a) * rad * 0.15, y, Math.sin(a) * rad * 0.15);
        parts.push(vc(card, r() < 0.5 ? 0x6a9a60 : 0x7aa86a, 0.2, seed + w * 31 + k));
      }
    }
  }
  return { wood: body, leaves: mergeGeometries(parts) };
}

// A spray of cedar needles on transparent ground: a central twig with dense fine needles.
const needleTexture = () => canvasTex(128, 256, (g, W, H) => {
  const r = rng(14);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#4a3a2a'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 10); g.stroke();
  for (let i = 0; i < 900; i++) {
    const t = r(), y = H - t * (H - 12);
    const spread = (W / 2 - 6) * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.1));
    const x = W / 2 + (r() - 0.5) * 2 * spread;
    const v = 50 + r() * 60;
    g.strokeStyle = `rgba(${v * 0.45},${v},${v * 0.5},0.95)`;
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 8, y - 6 - r() * 8); g.stroke();
  }
});

// Oak or chaparral: a squat trunk with a lumpy crown.
function oakModel(seed, far) {
  const r = rng(seed);
  const wood = trunk(2.2, 0.32, 0.2, 0.2, 5, 1, 0x5a4636, seed);
  const blobs = [];
  const n = far ? 2 : 6;
  for (let k = 0; k < n; k++) {
    const b = new THREE.IcosahedronGeometry(1.6 + r() * 1.1, far ? 0 : 1);
    const p = b.attributes.position;
    for (let i = 0; i < p.count; i++) { const j = 0.85 + r() * 0.3; p.setXYZ(i, p.getX(i) * j, p.getY(i) * j * 0.8, p.getZ(i) * j); }
    b.computeVertexNormals();
    b.translate((r() - 0.5) * 3, 3.2 + r() * 1.2, (r() - 0.5) * 3);
    blobs.push(vc(b, r() < 0.5 ? 0x4a5a2a : 0x56602e, 0.2, seed + k));
  }
  return { wood, leaves: mergeGeometries(blobs) };
}

// A clump of grass: tapered blades leaning out from the middle, dark at the root and light at the tip,
// with upward normals so both faces light the same.
function grassClump(blades, height, seed) {
  const r = rng(seed);
  const pos = [], col = [], nor = [];
  for (let b = 0; b < blades; b++) {
    const a = r() * Math.PI * 2, lean = 0.1 + r() * 0.25, h = height * (0.6 + r() * 0.6), w = 0.035 + r() * 0.03;
    const ox = (r() - 0.5) * 0.25, oz = (r() - 0.5) * 0.25;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz * w, pz = dx * w;
    const mid = [ox + dx * lean * h * 0.4, h * 0.55, oz + dz * lean * h * 0.4], tip = [ox + dx * lean * h, h, oz + dz * lean * h];
    const v = [[ox - px, 0, oz - pz], [ox + px, 0, oz + pz], [mid[0] + px * 0.6, mid[1], mid[2] + pz * 0.6], [mid[0] - px * 0.6, mid[1], mid[2] - pz * 0.6], tip];
    const shade = [0.45, 0.45, 0.8, 0.8, 1.1];
    for (const tri of [[0, 1, 2], [0, 2, 3], [3, 2, 4]]) for (const i of tri) { pos.push(...v[i]); col.push(shade[i], shade[i], shade[i]); nor.push(0, 1, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

function rockModel(seed) {
  const r = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const j = 0.7 + r() * 0.5; p.setXYZ(i, p.getX(i) * j * 1.3, p.getY(i) * j * 0.8, p.getZ(i) * j); }
  g.computeVertexNormals();
  return { wood: vc(g, 0x6a6660, 0.25, seed), leaves: null };
}

// ---------- placement ----------
export function buildNature(net, heights, preset, extra = {}) {
  const group = new THREE.Group();
  const colliders = [];
  const lists = { palm: [], sakura: [], cedar: [], oak: [], rock: [], bush: [], maple: [], grass: [] };
  const assets = extra.assets || new Map();
  const RB = rng(31337); // bushes have their own stream so the trees stay where they were
  const R = rng(2024);
  const q = {};
  const nearRoad = (x, z, pad) => {
    roadQuery(net, x, z, q);
    return q.road && q.d < q.road.hw + (q.road.sidewalk || q.road.gutter || q.road.shoulder || 0) + pad;
  };
  // variant is taken modulo the number of models of that kind.
  const add = (kind, x, z, s = 1, rot = R() * Math.PI * 2, variant = Math.floor(R() * 60)) => {
    lists[kind].push({ x, z, y: heightAt(heights, x, z), s, rot, variant });
  };
  const density = preset.props;

  // Palms: lining the boulevard median and the coast road, dotted along the avenues.
  const blvd = net.byId.blvd;
  for (let s = 8; s < blvd.length; s += 15) {
    const p = blvd.samples[Math.round(s / 3)];
    if (Math.abs(p.x + 1020) < 14 || nearCross(net, p.x, p.z, blvd) || net.lots.some((l) => l.gaps.some((g) => g.road === 'blvd' && p.s >= g.s0 - 6 && p.s <= g.s1 + 6))) continue;
    add('palm', p.x, p.z, 0.95 + R() * 0.25, R() * 6.28, 2);
  }
  const pch = net.byId.pch;
  for (let s = 10; s < pch.length; s += 18) {
    const p = pch.samples[Math.round(s / 3)];
    const off = pch.hw + 4.5;
    for (const side of [1, -1]) {
      if (side > 0 && R() < 0.4) continue;
      const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
      if (nearCross(net, x, z, pch)) continue;
      add('palm', x, z, 0.9 + R() * 0.3, R() * 6.28, R() < 0.6 ? 2 : 1);
    }
  }
  for (const r of net.roads) {
    if (r.kind !== 'street') continue;
    for (let s = 16; s < r.length - 8; s += 26 + R() * 10) {
      const p = r.samples[Math.round(s / 3)];
      const side = R() < 0.5 ? 1 : -1, off = r.hw + 1.4;
      const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
      if (nearCross(net, x, z, r) || R() > 0.55 * density + 0.2) continue;
      add('palm', x, z, 0.85 + R() * 0.3);
    }
  }
  for (const t of extra.yardTrees || []) add(t.kind, t.x, t.z, t.s ?? 1);

  // Cherry trees: along the village streets, the first stretch of the touge, the summit lookout.
  for (const id of ['vmain', 'vside']) {
    const r = net.byId[id];
    for (let s = 6; s < r.length - 4; s += 11) {
      const p = r.samples[Math.round(s / 3)];
      for (const side of [1, -1]) {
        const off = r.hw + r.gutter + 2.6 + R() * 1.2;
        const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
        if (nearRoad(x, z, 1.5) || (extra.blocked && extra.blocked(x, z))) continue;
        add('sakura', x, z, 0.9 + R() * 0.25);
      }
    }
  }
  const touge = net.byId.touge;
  for (let s = 30; s < touge.length; s += 9 + R() * 8) {
    const along = s / touge.length;
    if (along > 0.3 && along < 0.85 && R() < 0.75) continue; // thickest at the bottom and near the top
    const p = touge.samples[Math.round(s / 3)];
    const side = R() < 0.5 ? 1 : -1, off = touge.hw + touge.gutter + 3 + R() * 6;
    const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
    if (nearRoad(x, z, 2)) continue;
    const y = heightAt(heights, x, z);
    if (Math.abs(y - p.y) > 6) continue;
    add('sakura', x, z, 0.85 + R() * 0.3);
  }
  for (const t of extra.sakuraSpots || []) add('sakura', t.x, t.z, t.s ?? 1);

  // Forest on the mountain, oaks and brush on the hills: jittered grid thinned by noise.
  const step = 10.5 / Math.sqrt(Math.max(0.35, density));
  for (let x = -HALF + 20; x < HALF - 20; x += step) for (let z = -HALF + 20; z < HALF - 20; z += step) {
    const px = x + (R() - 0.5) * step * 0.9, pz = z + (R() - 0.5) * step * 0.9;
    const dPeak = Math.hypot(px - PEAK.x, pz - PEAK.z);
    const inLA = px > LA.x0 - 60 && px < LA.x1 + 60 && pz > LA.z0 - 60 && pz < LA.z1 + 60;
    if (inLA || pz < PCH_Z - 30) continue;
    const vill = Math.hypot(px - VILLAGE.x, pz - VILLAGE.z) < VILLAGE.r * 0.9;
    if (vill) continue;
    const n = fbm(px * 0.004, pz * 0.004, 3);
    const mountain = 1 - smooth(450, 950, dPeak);
    const want = mountain * (0.75 + n * 0.5) + (1 - mountain) * Math.max(0, n * 0.9 + 0.08) * 0.5;
    if (R() > want) continue;
    if (nearRoad(px, pz, 4) || net.lots.some((l) => inLot(l, px, pz, l.id === 'summit' ? 75 : 14))) continue;
    const y = heightAt(heights, px, pz);
    const sl = Math.hypot(heightAt(heights, px + 2, pz) - heightAt(heights, px - 2, pz), heightAt(heights, px, pz + 2) - heightAt(heights, px, pz - 2)) / 4;
    if (y < 1.5 || sl > 1.0) continue;
    if (mountain > 0.35) add('cedar', px, pz, 0.8 + R() * 0.5);
    else {
      add('oak', px, pz, 0.7 + R() * 0.6);
      // Undergrowth round the hill trees.
      for (let k = RB() < 0.85 ? 1 + Math.floor(RB() * 4) : 0; k > 0; k--) {
        const a = RB() * Math.PI * 2, d = 2.5 + RB() * 5, bx = px + Math.cos(a) * d, bz = pz + Math.sin(a) * d;
        if (!nearRoad(bx, bz, 2)) lists.bush.push({ x: bx, z: bz, y: heightAt(heights, bx, bz), s: 0.8 + RB() * 0.6, rot: RB() * 6.28, variant: Math.floor(RB() * 60) });
      }
    }
  }
  // Brush along the highway verges, and red maples along the touge.
  for (const [id, kind, every, near, far] of [['hwy', 'bush', 9, 3, 14], ['touge', 'maple', 7, 2, 8], ['ridge', 'maple', 14, 3, 10], ['vside', 'maple', 10, 3, 6]]) {
    const r = net.byId[id];
    if (!r) continue;
    for (let s0 = 10; s0 < r.length - 10; s0 += every * (0.6 + RB() * 0.8)) {
      const p = r.samples[Math.round(s0 / 3)];
      const side = RB() < 0.5 ? 1 : -1, off = r.hw + (r.shoulder || r.gutter || 0) + near + RB() * (far - near);
      const bx = p.x - p.tz * off * side, bz = p.z + p.tx * off * side;
      if (nearRoad(bx, bz, 1.5) || net.lots.some((l) => inLot(l, bx, bz, 6))) continue;
      const y = heightAt(heights, bx, bz);
      if (y < 1 || Math.abs(y - p.y) > 5) continue;
      lists[kind].push({ x: bx, z: bz, y, s: 0.7 + RB() * 0.7, rot: RB() * 6.28, variant: Math.floor(RB() * 60) });
    }
  }
  // Rocks on the steep faces of the mountain.
  for (let k = 0; k < 2200 * density; k++) {
    const a = R() * Math.PI * 2, d = 150 + R() * 900;
    const px = PEAK.x + Math.cos(a) * d, pz = PEAK.z + Math.sin(a) * d;
    const sl = Math.hypot(heightAt(heights, px + 2, pz) - heightAt(heights, px - 2, pz), heightAt(heights, px, pz + 2) - heightAt(heights, px, pz - 2)) / 4;
    if (sl < 0.45 || nearRoad(px, pz, 1.2)) continue;
    add('rock', px, pz, 0.6 + R() * 1.8);
  }
  // Scrub, boulders and grass everywhere off the roads outside town: a fine jittered grid, thinned by
  // noise, densest near the roads where you see it. Its own random stream keeps the trees in place.
  {
    const RG = rng(777001), gc = new THREE.Color();
    const gstep = 3.2 / Math.sqrt(Math.max(0.35, density));
    for (let x = -HALF + 10; x < HALF - 10; x += gstep) for (let z = -HALF + 10; z < HALF - 10; z += gstep) {
      const px = x + (RG() - 0.5) * gstep, pz = z + (RG() - 0.5) * gstep;
      if (px > LA.x0 - 10 && px < LA.x1 + 10 && pz > LA.z0 - 10 && pz < LA.z1 + 10) continue;
      if (Math.hypot(px - VILLAGE.x, pz - VILLAGE.z) < VILLAGE.r * 0.75) continue;
      roadQuery(net, px, pz, q);
      const edge = q.road ? q.d - (q.road.hw + (q.road.sidewalk || q.road.gutter || q.road.shoulder || 0)) : 999;
      if (edge < 1.2) continue;
      // Grass thick along the roads, thinning out into the distance; occasional bushes and stones.
      const n = fbm(px * 0.03, pz * 0.03, 2);
      const keep = edge < 60 ? 0.9 : edge < 160 ? 0.35 : 0.08;
      const roll = RG();
      if (roll > keep * (0.6 + n * 0.5)) continue;
      const y = heightAt(heights, px, pz);
      if (y < 0.6) continue;
      if (net.lots.some((l) => inLot(l, px, pz, 2))) continue;
      const sl = Math.hypot(heightAt(heights, px + 2, pz) - heightAt(heights, px - 2, pz), heightAt(heights, px, pz + 2) - heightAt(heights, px, pz - 2)) / 4;
      if (sl > 0.9) continue;
      const pick = RG();
      if (pick < 0.035 && edge > 3) lists.bush.push({ x: px, z: pz, y, s: 0.6 + RG() * 0.8, rot: RG() * 6.28, variant: Math.floor(RG() * 60) });
      else if (pick < 0.05 && edge > 2) lists.rock.push({ x: px, z: pz, y, s: 0.12 + RG() * 0.3, rot: RG() * 6.28, variant: Math.floor(RG() * 60) });
      else {
        groundColor(px, pz, y, sl, gc);
        lists.grass.push({ x: px, z: pz, y, s: 0.7 + RG() * 0.7, rot: RG() * 6.28, variant: Math.floor(RG() * 60), color: gc.clone().multiplyScalar(1.25) });
      }
    }
  }
  for (const t of extra.rocks || []) add('rock', t.x, t.z, t.s ?? 1);

  // ---------- meshes ----------
  const bark = barkTexture();
  const mats = {
    wood: windy(new THREE.MeshStandardMaterial({ vertexColors: true, map: bark, roughness: 0.95 }), { bend: 0.0018 }),
    palmLeaf: windy(new THREE.MeshStandardMaterial({ vertexColors: true, map: frondTexture(), alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.8 }), { bend: 0.0018, flutter: 0.05 }),
    blossom: windy(new THREE.MeshStandardMaterial({ vertexColors: true, map: blossomTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, emissive: 0x3a1820, emissiveIntensity: 0.25 }), { bend: 0.006, flutter: 0.02 }),
    cedar: windy(new THREE.MeshStandardMaterial({ vertexColors: true, map: needleTexture(), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.95 }), { bend: 0.0012 }),
    oak: windy(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), { bend: 0.0015 }),
    rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    grass: windy(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }), { bend: 0.16, flutter: 0 }),
  };
  const procModels = {
    palm: [0, 1, 2].map((v) => ({ near: palmModel([10, 14, 18][v], [0.5, 1.4, 0.9][v], 14, 31 + v), far: palmModel([10, 14, 18][v], [0.5, 1.4, 0.9][v], 14, 31 + v, true), leaf: mats.palmLeaf })),
    sakura: [0, 1, 2].map((v) => ({ near: sakuraModel(51 + v), far: sakuraModel(51 + v, true), leaf: mats.blossom })),
    cedar: [0, 1, 2].map((v) => ({ near: cedarModel([16, 20, 24][v], 71 + v), far: cedarModel([16, 20, 24][v], 71 + v, true), leaf: mats.cedar })),
    oak: [0, 1, 2].map((v) => ({ near: oakModel(91 + v), far: oakModel(91 + v, true), leaf: mats.oak })),
    rock: [0, 1, 2].map((v) => { const m = rockModel(111 + v); return { near: m, far: m, leaf: null, woodMat: mats.rock }; }),
  };
  // Each model variant is a list of [geometry, material] parts per level of detail.
  const parts = (m, leaf, woodMat) => [...(m.wood ? [[m.wood, woodMat || mats.wood]] : []), ...(m.leaves ? [[m.leaves, leaf]] : [])];
  const models = {};
  for (const [kind, vs] of Object.entries(procModels)) models[kind] = vs.map((v) => ({ near: parts(v.near, v.leaf, v.woodMat), far: parts(v.far, v.leaf, v.woodMat) }));
  // Downloaded models where they loaded: broadleaf trees for the hills, rocks, bushes and red maples.
  const glb = (key, opts) => (assets.get(key) ? bakeStatic(assets.get(key), opts) : null);
  const swaying = (v, bend) => v.parts.map((p) => [p.geometry, windy(p.material, { bend })]);
  const trees = glb('trees', { split: true, height: 10, matte: true });
  if (trees) models.oak = trees.map((v, i) => ({ near: swaying(v, 0.0012), far: models.oak[i % models.oak.length].far }));
  const rocks = [glb('rockA', { length: 2.8, matte: true }), glb('rockB', { length: 2.6, matte: true })].filter(Boolean).flat();
  if (rocks.length) models.rock = rocks.map((v) => { const p = v.parts.map((q) => [q.geometry, q.material]); return { near: p, far: p }; });
  const bushes = glb('bushes', { split: true, height: 1.5, matte: true });
  models.bush = bushes ? bushes.map((v) => { const p = swaying(v, 0.02); return { near: p, far: null }; }) : [];
  const maple = glb('maple', { height: 2.2, matte: true });
  models.maple = maple ? maple.map((v) => { const p = swaying(v, 0.012); return { near: p, far: null }; }) : [];
  const radius = { palm: 0.32, sakura: 0.3, cedar: 0.42, oak: 0.55, rock: 0.9 };

  // Grass: a clump of tapered blades, coloured from the ground it grows on.
  models.grass = [0, 1].map((v) => ({ near: [[grassClump(7 + v * 3, 0.55 + v * 0.2, 61 + v), mats.grass]] }));

  // Levels of detail per kind: the full model close up, a lighter one further out, then flat cards drawn
  // from the full model (impostors) out to the draw distance. Distances shrink on the lower presets.
  const k = [0.55, 0.8, 1][preset.detail ?? 2];
  const hide = Math.min(preset.far * 0.7, 2200);
  const cards = (m) => (extra.renderer ? impostor(extra.renderer, m.near) : m.far || m.near);
  const plan = {
    palm: (m) => [{ parts: m.near, dist: 150 * k }, { parts: m.far, dist: 420 * k }, { parts: cards(m), dist: hide }],
    sakura: (m) => [{ parts: m.near, dist: 140 * k }, { parts: cards(m), dist: hide * 0.7 }],
    cedar: (m) => [{ parts: m.near, dist: 110 * k }, { parts: m.far, dist: 380 * k }, { parts: cards(m), dist: hide }],
    oak: (m) => [{ parts: m.near, dist: 110 * k }, { parts: cards(m), dist: hide }],
    rock: (m) => [{ parts: m.near, dist: 320 * k }],
    bush: (m) => [{ parts: m.near, dist: 80 * k }, { parts: cards(m), dist: 260 * k }],
    maple: (m) => [{ parts: m.near, dist: 90 * k }, { parts: cards(m), dist: 320 * k }],
    grass: (m) => [{ parts: m.near, dist: 60 * k }],
  };
  const height = { palm: 18, sakura: 7, cedar: 24, oak: 10, rock: 2, bush: 2, maple: 2.5, grass: 0.8 };
  const field = new InstanceField({ cell: 48, shadows: preset.shadows > 0 });
  for (const [kind, list] of Object.entries(lists)) {
    if (!models[kind]?.length || !list.length) continue; // a downloaded model that didn't load
    models[kind].forEach((m, v) => field.addKind(`${kind}:${v}`, { lods: plan[kind](m).filter((l) => l.parts), height: height[kind], shadow: kind !== 'bush' && kind !== 'grass', color: kind === 'grass' }));
    for (const t of list) {
      field.add(`${kind}:${t.variant % models[kind].length}`, t.x, t.y - (kind === 'grass' ? 0.05 : 0.15), t.z, t.rot, t.s, t.color);
      if (kind === 'bush' || kind === 'maple' || kind === 'grass') continue; // you can plough through these
      if (kind !== 'rock' || t.s > 1) colliders.push({ type: 'circle', x: t.x, z: t.z, r: radius[kind] * t.s * (kind === 'rock' ? 1.1 : 1) });
    }
  }
  group.add(field.build());
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  // ---------- petals ----------
  const sakuras = lists.sakura;
  const PET = Math.round(900 * Math.max(0.5, density));
  const petPos = new Float32Array(PET * 3), petVel = new Float32Array(PET * 3), petLife = new Float32Array(PET);
  const petGeo = new THREE.BufferGeometry();
  petGeo.setAttribute('position', new THREE.BufferAttribute(petPos, 3).setUsage(THREE.DynamicDrawUsage));
  const petals = new THREE.Points(petGeo, new THREE.PointsMaterial({ color: 0xffc4d6, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }));
  petals.frustumCulled = false;
  group.add(petals);
  let petCursor = 0, petAcc = 0;
  // Ground carpets of fallen petals under each cherry.
  if (sakuras.length) {
    const carpet = new THREE.InstancedMesh(new THREE.CircleGeometry(3.6, 14).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: mats.blossom.map, transparent: true, opacity: 0.5, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), sakuras.length);
    sakuras.forEach((t, i) => carpet.setMatrixAt(i, m4.compose(ps.set(t.x + 0.3, t.y + 0.06, t.z), qt.setFromAxisAngle(up, t.rot), sc.setScalar(t.s))));
    carpet.computeBoundingSphere();
    group.add(carpet);
  }

  return {
    group,
    colliders,
    lists,
    field,
    // Picks what to draw for a camera; called before each view is rendered.
    cull(camera) { field.update(camera); },
    // camera: the view camera (its position drives the petals).
    update(t, dt, camera, windLevel, particles) {
      const cam = camera.position;
      wind.uTime.value = t;
      wind.uWind.value = windLevel;
      // Petals drift down from cherry trees near the camera, carried by the wind.
      petAcc += dt * 60 * (0.4 + windLevel);
      while (petAcc >= 1 && sakuras.length) {
        petAcc -= 1;
        const tree = sakuras[Math.floor(Math.random() * sakuras.length)];
        if (Math.abs(tree.x - cam.x) > 70 || Math.abs(tree.z - cam.z) > 70) continue;
        const i = petCursor;
        petCursor = (petCursor + 1) % PET;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 3.2 * tree.s;
        petPos[i * 3] = tree.x + Math.cos(a) * r; petPos[i * 3 + 1] = tree.y + (3 + Math.random() * 2.5) * tree.s; petPos[i * 3 + 2] = tree.z + Math.sin(a) * r;
        petVel[i * 3] = 0.6 + Math.random() * 0.8; petVel[i * 3 + 1] = -0.5 - Math.random() * 0.4; petVel[i * 3 + 2] = 0.2 + (Math.random() - 0.5) * 0.8;
        petLife[i] = 9;
      }
      for (let i = 0; i < PET; i++) {
        if (petLife[i] <= 0) continue;
        petLife[i] -= dt;
        const k = i * 3;
        const flutter = Math.sin(t * 5 + i) * 0.6;
        petPos[k] += (petVel[k] * (0.5 + windLevel) + flutter * 0.4) * dt;
        petPos[k + 1] += (petVel[k + 1] + Math.cos(t * 3 + i) * 0.25) * dt;
        petPos[k + 2] += (petVel[k + 2] + flutter * 0.3) * dt;
        const gy = heightAt(heights, petPos[k], petPos[k + 2]) + 0.03;
        if (petPos[k + 1] < gy) { petPos[k + 1] = gy; petVel[k] *= 0.2; petVel[k + 2] *= 0.2; petVel[k + 1] = 0; if (petLife[i] > 2) petLife[i] = 2; }
        if (petLife[i] <= 0) petPos[k + 1] = -1000;
      }
      petGeo.attributes.position.needsUpdate = true;
      void particles;
    },
  };
}

// True where (x, z) sits on or right next to a junction with another road.
function nearCross(net, x, z, self) {
  const q = {};
  roadQuery(net, x, z, q);
  if (!q.road) return false;
  if (q.road !== self && q.d < q.road.hw + 4) return true;
  // Check a little either side for crossing streets.
  for (const [dx, dz] of [[12, 0], [-12, 0], [0, 12], [0, -12]]) {
    roadQuery(net, x + dx, z + dz, q);
    if (q.road && q.road !== self && q.d < q.road.hw + 2) return true;
  }
  return false;
}
void BOULEVARD_Z;
