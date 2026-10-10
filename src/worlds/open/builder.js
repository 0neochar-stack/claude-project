// Geometry batching for buildings and props: everything is added in world space to per-material buckets
// and merged into one mesh per material per area, so a whole neighbourhood is a handful of draw calls.
// Also the procedural textures those materials use.
import * as THREE from 'three';
import { rng } from './layout.js';

// ---------- textures ----------
function tex(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const speckle = (g, W, H, n, seed, rgb, a) => {
  const r = rng(seed);
  for (let i = 0; i < n; i++) { const v = (r() - 0.5) * 2; g.fillStyle = `rgba(${rgb[0] + v * 30},${rgb[1] + v * 30},${rgb[2] + v * 30},${a})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
};

export function makeTextures() {
  const T = {};
  // Stucco: near-white with trowel texture; tinted per building by vertex colour.
  T.stucco = tex(256, 256, (g, W, H) => {
    g.fillStyle = '#e4e0d8'; g.fillRect(0, 0, W, H);
    speckle(g, W, H, 9000, 1, [215, 210, 200], 0.35);
    const r = rng(2);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(160,150,140,${0.04 + r() * 0.05})`; g.beginPath(); g.ellipse(r() * W, r() * H, 10 + r() * 30, 4 + r() * 10, r() * 3, 0, Math.PI * 2); g.fill(); }
    // Grime at the bottom.
    const grd = g.createLinearGradient(0, H * 0.75, 0, H);
    grd.addColorStop(0, 'rgba(90,80,70,0)'); grd.addColorStop(1, 'rgba(90,80,70,0.0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  });
  // Lap siding.
  T.siding = tex(256, 256, (g, W, H) => {
    g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 16) {
      const grd = g.createLinearGradient(0, y, 0, y + 16);
      grd.addColorStop(0, 'rgba(255,255,255,0.15)'); grd.addColorStop(0.85, 'rgba(0,0,0,0.05)'); grd.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = grd; g.fillRect(0, y, W, 16);
    }
    speckle(g, W, H, 3000, 3, [200, 196, 188], 0.2);
  });
  // Dark vertical boards for the Japanese village.
  T.boards = tex(256, 256, (g, W, H) => {
    const r = rng(4);
    for (let x = 0; x < W; x += 21) {
      const v = 70 + r() * 25;
      g.fillStyle = `rgb(${v},${v * 0.72},${v * 0.52})`; g.fillRect(x, 0, 21, H);
      g.fillStyle = 'rgba(20,12,8,0.6)'; g.fillRect(x, 0, 2, H);
      for (let k = 0; k < 12; k++) { g.fillStyle = `rgba(30,20,12,${r() * 0.25})`; g.fillRect(x + r() * 20, r() * H, 1, 10 + r() * 60); }
    }
  });
  // Clay barrel tiles.
  T.terracotta = tex(256, 256, (g, W, H) => {
    const r = rng(5);
    g.fillStyle = '#9a4a2a'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 32) for (let x = 0; x < W; x += 32) {
      const grd = g.createLinearGradient(x, 0, x + 32, 0);
      const c = 150 + r() * 40;
      grd.addColorStop(0, `rgb(${c * 0.62},${c * 0.28},${c * 0.16})`); grd.addColorStop(0.5, `rgb(${c},${c * 0.5},${c * 0.3})`); grd.addColorStop(1, `rgb(${c * 0.58},${c * 0.26},${c * 0.15})`);
      g.fillStyle = grd; g.fillRect(x, y + (x / 32 % 2) * 4, 32, 30);
      g.fillStyle = 'rgba(40,15,8,0.5)'; g.fillRect(x, y + 28, 32, 4);
    }
    speckle(g, W, H, 2000, 6, [120, 60, 40], 0.25);
  });
  T.shingle = tex(256, 256, (g, W, H) => {
    const r = rng(7);
    for (let y = 0; y < H; y += 16) for (let x = -(y / 16 % 2) * 16; x < W; x += 32) {
      const v = 60 + r() * 30;
      g.fillStyle = `rgb(${v},${v * 0.95},${v * 0.9})`; g.fillRect(x, y, 31, 15);
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x, y + 14, 32, 2);
    }
    speckle(g, W, H, 5000, 8, [70, 68, 64], 0.3);
  });
  T.kawara = tex(256, 256, (g, W, H) => {
    for (let x = 0; x < W; x += 24) {
      const grd = g.createLinearGradient(x, 0, x + 24, 0);
      grd.addColorStop(0, '#22262c'); grd.addColorStop(0.5, '#4a5058'); grd.addColorStop(1, '#1c1f24');
      g.fillStyle = grd; g.fillRect(x, 0, 24, H);
    }
    for (let y = 0; y < H; y += 28) { g.fillStyle = 'rgba(10,10,14,0.55)'; g.fillRect(0, y, W, 3); }
    speckle(g, W, H, 2500, 9, [60, 64, 70], 0.25);
  });
  T.gravel = tex(256, 256, (g, W, H) => { g.fillStyle = '#8a8680'; g.fillRect(0, 0, W, H); speckle(g, W, H, 14000, 10, [130, 126, 120], 0.55); });
  T.concrete = tex(256, 256, (g, W, H) => {
    g.fillStyle = '#b4b0a8'; g.fillRect(0, 0, W, H);
    speckle(g, W, H, 9000, 11, [170, 166, 158], 0.3);
    g.strokeStyle = 'rgba(70,66,60,0.5)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
  });
  T.lot = tex(256, 256, (g, W, H) => { g.fillStyle = '#3a3a3e'; g.fillRect(0, 0, W, H); speckle(g, W, H, 14000, 12, [60, 60, 64], 0.5); });
  T.glassTower = tex(256, 512, (g, W, H) => {
    // Curtain wall: mullions over blue-grey glass reflecting a fake sky gradient.
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#5a7088'); grd.addColorStop(1, '#2a3440');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(20,24,30,0.9)';
    for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 3, H);
    for (let y = 0; y < H; y += 48) g.fillRect(0, y, W, 6);
  });
  T.glassTowerLit = tex(256, 512, (g, W, H) => {
    // Night offices: whole floors on or off, a few lone windows, cool fluorescent or warm light.
    const r = rng(13);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 48) {
      const floor = r();
      const cool = r() < 0.6;
      for (let x = 0; x < W; x += 32) {
        const on = floor > 0.62 ? r() < 0.9 : r() < 0.08;
        if (!on) continue;
        const w = 170 + r() * 50;
        g.fillStyle = cool ? `rgb(${w * 0.86},${w * 0.94},${w})` : `rgb(${w},${w * 0.86},${w * 0.62})`;
        g.fillRect(x + 3, y + 6, 29, 42);
      }
    }
  });
  return T;
}

// Window, door and shop atlas: 4 x 4 cells of 256 px. `lit` draws the night version (emissive).
export const CELLS = {
  win: 0, win2: 1, picture: 2, door: 3,
  garage: 4, shopfront: 5, shoji: 6, slide: 7,
  vending: 8, lantern: 9, noren: 10, dark: 11,
  tower: 12, roller: 13, arch: 14, vent: 15,
};
export function atlasTexture(lit) {
  return tex(1024, 1024, (g) => {
    const r = rng(lit ? 21 : 20);
    g.fillStyle = lit ? '#000' : '#222';
    g.fillRect(0, 0, 1024, 1024);
    const cell = (id, fn) => { g.save(); g.translate((id % 4) * 256, Math.floor(id / 4) * 256); fn(); g.restore(); };
    const glass = (x, y, w, h, warm = true) => {
      if (lit) {
        const grd = g.createLinearGradient(x, y, x, y + h);
        grd.addColorStop(0, warm ? '#ffd9a0' : '#cfe6ff'); grd.addColorStop(1, warm ? '#ffb060' : '#9fc0ff');
        g.fillStyle = grd;
      } else {
        const grd = g.createLinearGradient(x, y, x + w, y + h);
        grd.addColorStop(0, '#5c7488'); grd.addColorStop(0.5, '#2c3a48'); grd.addColorStop(1, '#4a5a68');
        g.fillStyle = grd;
      }
      g.fillRect(x, y, w, h);
    };
    const frame = (x, y, w, h, c = '#f2efe8', t = 12) => { if (lit) return; g.strokeStyle = c; g.lineWidth = t; g.strokeRect(x + t / 2, y + t / 2, w - t, h - t); };
    // Sash window with curtains.
    cell(CELLS.win, () => {
      glass(20, 20, 216, 216);
      if (!lit) { g.fillStyle = 'rgba(230,220,200,0.85)'; g.fillRect(28, 28, 40, 200); g.fillRect(188, 28, 40, 200); }
      else { g.fillStyle = 'rgba(120,60,20,0.5)'; g.fillRect(28, 28, 40, 200); g.fillRect(188, 28, 40, 200); }
      frame(10, 10, 236, 236); if (!lit) { g.fillStyle = '#f2efe8'; g.fillRect(10, 122, 236, 12); }
    });
    // Window with blinds.
    cell(CELLS.win2, () => {
      glass(20, 20, 216, 216, true);
      g.fillStyle = lit ? 'rgba(0,0,0,0.35)' : 'rgba(220,215,205,0.7)';
      for (let y = 26; y < 160; y += 9) g.fillRect(24, y, 208, 4);
      frame(10, 10, 236, 236, '#ffffff');
    });
    cell(CELLS.picture, () => { glass(10, 30, 236, 196); frame(0, 20, 256, 216, '#2a2a2e', 10); if (!lit) { g.fillStyle = '#2a2a2e'; g.fillRect(124, 30, 8, 196); } });
    cell(CELLS.door, () => {
      if (!lit) { g.fillStyle = '#6a3e24'; g.fillRect(48, 0, 160, 256); g.fillStyle = 'rgba(0,0,0,0.25)'; for (const y of [30, 130]) g.fillRect(70, y, 116, 80); g.fillStyle = '#d4b060'; g.beginPath(); g.arc(186, 140, 6, 0, 7); g.fill(); }
      glass(96, 20, 64, 50);
    });
    cell(CELLS.garage, () => {
      if (lit) return;
      g.fillStyle = '#e8e6e0'; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 64) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y + 60, 256, 4); for (let x = 8; x < 256; x += 62) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(x, y + 10, 52, 44); } }
    });
    cell(CELLS.shopfront, () => {
      glass(0, 40, 256, 216, true);
      if (!lit) { g.fillStyle = '#1a1a1e'; g.fillRect(0, 0, 256, 40); g.fillRect(120, 40, 16, 216); g.fillRect(0, 140, 256, 6); }
      else { g.fillStyle = 'rgba(0,0,0,0.6)'; for (let k = 0; k < 5; k++) g.fillRect(20 + k * 46, 180 + r() * 20, 24, 76); }
    });
    cell(CELLS.shoji, () => {
      g.fillStyle = lit ? '#ffcf8a' : '#e8e0cc'; g.fillRect(8, 8, 240, 240);
      g.fillStyle = lit ? 'rgba(60,30,10,0.85)' : '#5a3e2a';
      for (let x = 8; x <= 248; x += 48) g.fillRect(x - 3, 8, 6, 240);
      for (let y = 8; y <= 248; y += 40) g.fillRect(8, y - 3, 240, 6);
    });
    cell(CELLS.slide, () => {
      if (!lit) { g.fillStyle = '#4a3020'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#2a1a10'; g.fillRect(126, 0, 4, 256); }
      g.fillStyle = lit ? '#ffc47a' : '#d8ccb0';
      for (const x of [16, 144]) for (let y = 20; y < 236; y += 54) g.fillRect(x, y, 96, 46);
    });
    cell(CELLS.vending, () => {
      g.fillStyle = lit ? '#e8f4ff' : '#d8e6f4'; g.fillRect(16, 0, 224, 256);
      for (let y = 20; y < 150; y += 42) for (let x = 30; x < 220; x += 30) { g.fillStyle = `hsl(${r() * 360},70%,${lit ? 60 : 50}%)`; g.fillRect(x, y, 18, 30); }
      g.fillStyle = lit ? '#3060c0' : '#2050a0'; g.fillRect(16, 170, 224, 30);
      g.fillStyle = '#111'; g.fillRect(40, 214, 120, 30);
    });
    cell(CELLS.lantern, () => {
      const grd = g.createRadialGradient(128, 128, 10, 128, 128, 120);
      grd.addColorStop(0, lit ? '#ffcc66' : '#e04030'); grd.addColorStop(1, lit ? '#e03010' : '#8a1a10');
      g.fillStyle = grd; g.beginPath(); g.ellipse(128, 128, 110, 124, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(40,0,0,0.5)'; g.lineWidth = 3;
      for (let y = 30; y < 240; y += 22) { g.beginPath(); g.moveTo(24, y); g.lineTo(232, y); g.stroke(); }
      g.fillStyle = lit ? '#400' : '#111'; g.font = 'bold 90px serif'; g.textAlign = 'center'; g.fillText('祭', 128, 160);
    });
    cell(CELLS.noren, () => {
      if (lit) { g.fillStyle = '#2a0c08'; g.fillRect(0, 0, 256, 256); return; }
      g.fillStyle = '#1a2a5a'; g.fillRect(0, 0, 256, 160);
      g.fillStyle = '#e8e4dc'; g.font = 'bold 80px serif'; g.textAlign = 'center'; g.fillText('湯', 128, 110);
      for (const x of [84, 170]) { g.fillStyle = '#0a0a0a'; g.fillRect(x, 0, 3, 160); }
    });
    cell(CELLS.dark, () => { g.fillStyle = lit ? '#000' : '#1a1a1e'; g.fillRect(0, 0, 256, 256); });
    cell(CELLS.tower, () => {
      for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
        if (lit) { if (r() < 0.5) { const w = 180 + r() * 70; g.fillStyle = `rgb(${w},${w * 0.9},${w * 0.7})`; g.fillRect(x + 6, y + 8, 52, 48); } }
        else { glass(x + 6, y + 8, 52, 48, false); }
      }
    });
    cell(CELLS.roller, () => { if (lit) return; g.fillStyle = '#9a9ca0'; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 256; y += 8) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, y, 256, 2); } });
    cell(CELLS.arch, () => { glass(40, 60, 176, 196); if (!lit) { g.fillStyle = '#e4e0d8'; g.fillRect(0, 0, 256, 60); g.beginPath(); g.arc(128, 60, 88, Math.PI, 0); g.fillStyle = '#5c7488'; g.fill(); } });
    cell(CELLS.vent, () => { if (lit) return; g.fillStyle = '#6a6c70'; g.fillRect(0, 0, 256, 256); for (let y = 10; y < 256; y += 20) { g.fillStyle = '#3a3c40'; g.fillRect(10, y, 236, 8); } });
  }, false);
}

// Shop signs, one per row of 128 px in a 1024 x 1024 sheet (2 columns of 512).
export const SIGNS = ['TACOS', 'DONUTS', 'BOBA', 'LIQUOR', 'LAUNDRY', 'AUTO PARTS', 'PHO', 'NAILS', 'PIZZA', 'GAS', 'MOTEL', 'TATTOO', 'ラーメン', '居酒屋', 'たばこ', 'DINER'];
export function signTexture() {
  return tex(1024, 1024, (g) => {
    const colors = ['#ff3f6a', '#ffb02e', '#3ff0c0', '#ff5ad0', '#4ab0ff', '#ffe04a', '#ff6a3a', '#c05aff'];
    SIGNS.forEach((s, i) => {
      const x = (i % 2) * 512, y = Math.floor(i / 2) * 128;
      g.fillStyle = '#101014'; g.fillRect(x + 4, y + 4, 504, 120);
      g.strokeStyle = colors[i % colors.length]; g.lineWidth = 6; g.strokeRect(x + 10, y + 10, 492, 108);
      g.fillStyle = colors[(i + 3) % colors.length];
      g.font = `bold ${s.length > 8 ? 60 : 78}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = g.fillStyle; g.shadowBlur = 16;
      g.fillText(s, x + 256, y + 66);
      g.shadowBlur = 0;
    });
  }, false);
}

// ---------- builder ----------
export class Builder {
  constructor() { this.buckets = new Map(); }
  bucket(name) {
    let b = this.buckets.get(name);
    if (!b) this.buckets.set(name, (b = { pos: [], nor: [], uv: [], col: [], idx: [] }));
    return b;
  }
  // A quad from four corners (counter-clockwise seen from the front), with UVs and a colour.
  quad(mat, a, b, c, d, uv = [[0, 0], [1, 0], [1, 1], [0, 1]], color = 0xffffff) {
    const B = this.bucket(mat), base = B.pos.length / 3;
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const col = new THREE.Color(color);
    for (const [p, t] of [[a, uv[0]], [b, uv[1]], [c, uv[2]], [d, uv[3]]]) {
      B.pos.push(p.x, p.y, p.z); B.nor.push(n.x, n.y, n.z); B.uv.push(t[0], t[1]); B.col.push(col.r, col.g, col.b);
    }
    B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Wall from p0 to p1 (bottom, outward normal to the right of p0->p1 when seen from above... i.e. counter-
  // clockwise footprints face out), height h, world-scaled UVs.
  wall(mat, p0, p1, y0, h, color, scale = 3) {
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const su = Array.isArray(scale) ? scale[0] : scale, sv = Array.isArray(scale) ? scale[1] : scale;
    const a = new THREE.Vector3(p0.x, y0, p0.z), b = new THREE.Vector3(p1.x, y0, p1.z);
    const c = new THREE.Vector3(p1.x, y0 + h, p1.z), d = new THREE.Vector3(p0.x, y0 + h, p0.z);
    this.quad(mat, a, b, c, d, [[0, y0 / sv], [len / su, y0 / sv], [len / su, (y0 + h) / sv], [0, (y0 + h) / sv]], color);
  }
  // A planar polygon (3 or 4 points, counter-clockwise seen from its front) with UVs laid flat on its plane.
  planar(mat, pts, color = 0xffffff, scale = 2) {
    const [a, b] = pts;
    const n = new THREE.Vector3().subVectors(pts[1], a).cross(new THREE.Vector3().subVectors(pts[pts.length - 1], a)).normalize();
    const eu = new THREE.Vector3().subVectors(b, a).normalize();
    const ev = new THREE.Vector3().crossVectors(n, eu);
    const uv = pts.map((p) => { const d = new THREE.Vector3().subVectors(p, a); return [d.dot(eu) / scale, d.dot(ev) / scale]; });
    if (pts.length === 3) this.quad(mat, pts[0], pts[1], pts[2], pts[2], [uv[0], uv[1], uv[2], uv[2]], color);
    else this.quad(mat, pts[0], pts[1], pts[2], pts[3], uv, color);
  }
  // A box with optional per-face materials: { side, top }; rotation about y by `rot`.
  box(cx, y0, cz, w, h, d, rot, mats, color = 0xffffff, scale = 3) {
    const pts = footprint(cx, cz, w, d, rot);
    const side = typeof mats === 'string' ? mats : mats.side;
    for (let i = 0; i < 4; i++) this.wall(side, pts[i], pts[(i + 1) % 4], y0, h, color, scale);
    const top = typeof mats === 'string' ? mats : mats.top;
    if (top) this.planar(top, pts.map((p) => new THREE.Vector3(p.x, y0 + h, p.z)), color, Array.isArray(scale) ? 3 : scale);
  }
  // Hip or gable roof over a w x d footprint at height y, rising `rise`, with eaves `over`.
  roof(mat, cx, y, cz, w, d, rot, rise, over, type = 'hip', color = 0xffffff, scale = 2) {
    const W = w / 2 + over, D = d / 2 + over;
    const along = w >= d; // ridge along the longer side
    const half = type === 'gable' ? (along ? W : D) : Math.max(0.01, along ? W - D : D - W);
    const c = Math.cos(rot), s = Math.sin(rot);
    const L = (x, z, yy) => new THREE.Vector3(cx + x * c + z * s, yy, cz - x * s + z * c);
    const e = [L(-W, -D, y), L(W, -D, y), L(W, D, y), L(-W, D, y)];
    const gm = type === 'gable' ? this.gableMat || mat : mat;
    if (along) {
      const r0 = L(-half, 0, y + rise), r1 = L(half, 0, y + rise);
      this.planar(mat, [e[1], e[0], r0, r1], color, scale);
      this.planar(mat, [e[3], e[2], r1, r0], color, scale);
      this.planar(gm, [e[2], e[1], r1], color, scale);
      this.planar(gm, [e[0], e[3], r0], color, scale);
    } else {
      const r0 = L(0, -half, y + rise), r1 = L(0, half, y + rise);
      this.planar(mat, [e[0], e[3], r1, r0], color, scale);
      this.planar(mat, [e[2], e[1], r0, r1], color, scale);
      this.planar(gm, [e[1], e[0], r0], color, scale);
      this.planar(gm, [e[3], e[2], r1], color, scale);
    }
    // Soffit under the eaves.
    this.quad('trim', e[0], e[1], e[2], e[3], undefined, 0x2a2622);
  }
  // A flat quad facing out of a wall: atlas cell `cell` (0..15), centre (x, y, z), size w x h, facing `rot`.
  decal(mat, x, y, z, w, h, rot, cell, color = 0xffffff, cols = 4) {
    const c = Math.cos(rot), s = Math.sin(rot);
    // Facing direction (outward) is (sin rot, cos rot); the decal's right is (cos rot, -sin rot).
    const rx = c, rz = -s;
    const a = new THREE.Vector3(x - rx * w / 2, y - h / 2, z - rz * w / 2), b = new THREE.Vector3(x + rx * w / 2, y - h / 2, z + rz * w / 2);
    const cc = new THREE.Vector3(x + rx * w / 2, y + h / 2, z + rz * w / 2), d = new THREE.Vector3(x - rx * w / 2, y + h / 2, z - rz * w / 2);
    const u0 = (cell % cols) / cols, v1 = 1 - Math.floor(cell / cols) / cols, du = 1 / cols;
    this.quad(mat, a, b, cc, d, [[u0, v1 - du], [u0 + du, v1 - du], [u0 + du, v1], [u0, v1]], color);
  }
  build(materials, group, { shadow = true, receive = true, split = 0 } = {}) {
    const out = [];
    for (const [name, B] of this.buckets) {
      if (!B.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
      g.setIndex(B.idx);
      g.computeBoundingSphere();
      for (const part of split ? splitByArea(g, split) : [g]) {
        const m = new THREE.Mesh(part, materials[name]);
        m.castShadow = shadow && !materials[name].transparent;
        m.receiveShadow = receive;
        m.matrixAutoUpdate = false;
        group.add(m);
        out.push(m);
      }
    }
    this.buckets.clear();
    return out;
  }
}

// Splits a big geometry into tiles by triangle centre, so frustum culling can skip what is off screen.
// Works on indexed or non-indexed geometry; keeps every attribute.
export function splitByArea(geo, size = 400) {
  const index = geo.index ? geo.index.array : null;
  const names = Object.keys(geo.attributes);
  const pos = geo.attributes.position.array;
  const triCount = index ? index.length / 3 : pos.length / 9;
  const buckets = new Map();
  const vi = (t, k) => (index ? index[t * 3 + k] : t * 3 + k);
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
    const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    const key = `${Math.floor(cx / size)},${Math.floor(cz / size)}`;
    let bk = buckets.get(key);
    if (!bk) buckets.set(key, (bk = { verts: [] }));
    bk.verts.push(a, b, c);
  }
  const out = [];
  for (const bk of buckets.values()) {
    const g = new THREE.BufferGeometry();
    for (const n of names) {
      const attr = geo.attributes[n], sz = attr.itemSize, src = attr.array;
      const arr = new Float32Array(bk.verts.length * sz);
      bk.verts.forEach((v, i) => { for (let k = 0; k < sz; k++) arr[i * sz + k] = src[v * sz + k]; });
      g.setAttribute(n, new THREE.BufferAttribute(arr, sz));
    }
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}

// Corners of a w x d rectangle centred at (cx, cz), rotated by rot, counter-clockwise from above.
export function footprint(cx, cz, w, d, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const L = (x, z) => ({ x: cx + x * c + z * s, z: cz - x * s + z * c });
  return [L(-w / 2, d / 2), L(w / 2, d / 2), L(w / 2, -d / 2), L(-w / 2, -d / 2)];
}
