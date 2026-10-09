// Terrain mesh: 500 m chunks, each with three levels of detail and skirts to hide the seams between them.
// Colour comes from the vertex (biome, slope, height and noise) and a tiling detail texture adds grain.
import * as THREE from 'three';
import { HALF, CELL, N, fbm, smooth, LA, VILLAGE, PEAK } from './layout.js';

const CHUNK = 125; // cells per chunk side (500 m)
const LODS = [{ step: 1, dist: 0 }, { step: 4, dist: 520 }, { step: 10, dist: 1300 }];

function detailTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  // Tileable multi-scale grain: sums of wrapped value noise.
  const grid = (n, seed) => { const a = new Float32Array(n * n); let s = seed; for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s / 4294967296; } return a; };
  const layers = [[8, grid(8, 3), 0.45], [32, grid(32, 7), 0.3], [128, grid(128, 11), 0.25]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (const [n, a, w] of layers) {
      const fx = (x / S) * n, fy = (y / S) * n, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, t = fy - j;
      const q = (ii, jj) => a[(jj % n) * n + (ii % n)];
      const su = u * u * (3 - 2 * u), st = t * t * (3 - 2 * t);
      v += w * ((q(i, j) * (1 - su) + q(i + 1, j) * su) * (1 - st) + (q(i, j + 1) * (1 - su) + q(i + 1, j + 1) * su) * st);
    }
    const c = Math.round(150 + (v - 0.5) * 150);
    const k = (y * S + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.max(0, Math.min(255, c));
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const COL = {
  sand: new THREE.Color(0xcdb48a),
  wetSand: new THREE.Color(0x8c7556),
  lawn: new THREE.Color(0x5f7a3a),
  dry: new THREE.Color(0x9a8a58),
  scrub: new THREE.Color(0x6e6a40),
  forest: new THREE.Color(0x2f4a2a),
  moss: new THREE.Color(0x46602f),
  rock: new THREE.Color(0x5e5a55),
  darkRock: new THREE.Color(0x3c3936),
  dirt: new THREE.Color(0x6a5640),
  seabed: new THREE.Color(0x3a5a5a),
};
const tmp = new THREE.Color();

// Ground colour at a point, from where it is and how steep.
function groundColor(x, z, y, slope, out) {
  const n = fbm(x * 0.02, z * 0.02, 2), n2 = fbm(x * 0.004 + 7, z * 0.004, 2);
  const dLA = Math.hypot(Math.max(LA.x0 - x, 0, x - LA.x1), Math.max(LA.z0 - z, 0, z - LA.z1));
  const dPeak = Math.hypot(x - PEAK.x, z - PEAK.z);
  // Dry golden hills by default, greener in town (lawns) and on the mountain (forest).
  out.copy(COL.dry).lerp(COL.scrub, smooth(-0.2, 0.4, n2));
  out.lerp(COL.lawn, (1 - smooth(0, 120, dLA)) * 0.75);
  const mountain = 1 - smooth(500, 900, dPeak);
  const vill = 1 - smooth(VILLAGE.r * 0.5, VILLAGE.r * 1.4, Math.hypot(x - VILLAGE.x, z - VILLAGE.z));
  out.lerp(tmp.copy(COL.forest).lerp(COL.moss, smooth(-0.3, 0.5, n)), Math.max(mountain, vill * 0.8) * 0.9);
  // Rock on steep faces.
  out.lerp(tmp.copy(COL.rock).lerp(COL.darkRock, smooth(-0.3, 0.4, n)), smooth(0.55, 0.95, slope));
  // Beach and sea floor.
  out.lerp(COL.sand, smooth(-1615, -1660, z) * (1 - smooth(1.5, 0.5, y) * 0));
  out.lerp(COL.wetSand, smooth(1.2, -0.2, y) * smooth(-1615, -1660, z));
  out.lerp(COL.seabed, smooth(-0.5, -4, y));
  // Patchy variation.
  out.multiplyScalar(0.86 + 0.28 * (n * 0.5 + 0.5));
  return out;
}

export function buildTerrain(heights, preset) {
  const n = N + 1;
  const H = (i, j) => heights[Math.min(N, Math.max(0, j)) * n + Math.min(N, Math.max(0, i))];
  // Normals and colours once for the whole grid.
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * CELL), dz = (H(i, j + 1) - H(i, j - 1)) / (2 * CELL);
    const len = Math.hypot(dx, 1, dz);
    const k = (j * n + i) * 3;
    normals[k] = -dx / len; normals[k + 1] = 1 / len; normals[k + 2] = -dz / len;
    const slope = Math.hypot(dx, dz);
    groundColor(-HALF + i * CELL, -HALF + j * CELL, H(i, j), slope, c);
    colors[k] = c.r; colors[k + 1] = c.g; colors[k + 2] = c.b;
  }
  const detail = detailTexture();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0 });
  // World-space UVs so the grain tiles every 6 m regardless of chunk.
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = (modelMatrix * vec4(position, 1.0)).xz / 6.0;');
    // A second, larger scale of the same grain breaks up the tiling.
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      vec4 g1 = texture2D(map, vMapUv);
      vec4 g2 = texture2D(map, vMapUv * 0.123 + 0.37);
      diffuseColor.rgb *= (g1.rgb * 0.75 + 0.25) * (g2.rgb * 0.6 + 0.55) * 1.35;`);
  };

  const group = new THREE.Group();
  const chunks = Math.ceil(N / CHUNK);
  const lods = [];
  for (let cj = 0; cj < chunks; cj++) for (let ci = 0; ci < chunks; ci++) {
    const i0 = ci * CHUNK, j0 = cj * CHUNK;
    const i1 = Math.min(N, i0 + CHUNK), j1 = Math.min(N, j0 + CHUNK);
    const lod = new THREE.LOD();
    const levels = preset.detail === 0 ? LODS.slice(1) : LODS;
    for (const L of levels) {
      const geo = chunkGeometry(heights, normals, colors, i0, j0, i1, j1, L.step);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      lod.addLevel(mesh, L.dist);
    }
    lod.position.set(-HALF + ((i0 + i1) / 2) * CELL, 0, -HALF + ((j0 + j1) / 2) * CELL);
    lod.updateMatrix();
    lod.matrixAutoUpdate = false;
    for (const l of lod.levels) { l.object.position.set(-lod.position.x, 0, -lod.position.z); l.object.updateMatrix(); }
    group.add(lod);
    lods.push(lod);
  }
  return { group, material: mat, lods };
}

// One chunk at a given step, with a skirt hanging 6 m down around its edge.
function chunkGeometry(heights, normals, colors, i0, j0, i1, j1, step) {
  const n = N + 1;
  const xs = [], zs = [];
  for (let i = i0; i < i1; i += step) xs.push(i);
  xs.push(i1);
  for (let j = j0; j < j1; j += step) zs.push(j);
  zs.push(j1);
  const W = xs.length, D = zs.length;
  const vCount = W * D + 2 * (W + D);
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
  let v = 0;
  const put = (i, j, drop) => {
    const k = j * n + i;
    pos[v * 3] = -HALF + i * CELL; pos[v * 3 + 1] = heights[k] - drop; pos[v * 3 + 2] = -HALF + j * CELL;
    nor.set(normals.subarray(k * 3, k * 3 + 3), v * 3);
    col.set(colors.subarray(k * 3, k * 3 + 3), v * 3);
    return v++;
  };
  for (const j of zs) for (const i of xs) put(i, j, 0);
  const idx = [];
  for (let b = 0; b < D - 1; b++) for (let a = 0; a < W - 1; a++) {
    const p = b * W + a, q = p + 1, r = p + W, s = r + 1;
    idx.push(p, r, q, q, r, s);
  }
  // Skirts: duplicate each edge row 6 m lower and stitch.
  const edge = (list) => {
    const top = list.map(([i, j]) => zs.indexOf(j) * W + xs.indexOf(i));
    const bot = list.map(([i, j]) => put(i, j, 6));
    for (let k = 0; k < list.length - 1; k++) idx.push(top[k], bot[k], top[k + 1], top[k + 1], bot[k], bot[k + 1]);
  };
  edge(xs.map((i) => [i, zs[0]]));
  edge(zs.map((j) => [xs[W - 1], j]));
  edge(xs.slice().reverse().map((i) => [i, zs[D - 1]]));
  edge(zs.slice().reverse().map((j) => [xs[0], j]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, v * 3), 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
