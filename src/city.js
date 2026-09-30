import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, ROADS, HALF, CURB, PILLARS, PLAZA_AREA } from './world.js';
import { makeWet, LAYER_WET, LAYER_MAIN_ONLY } from './wet.js';

const SIDEWALK = 4.5;
const NEON = [0xff2bd6, 0x22e6ff, 0xffa62b, 0x9d5cff, 0x2bffa0, 0xff3355];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rand = rng(1337);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const range = (a, b) => a + (b - a) * rand();

function flatRect(cx, cz, sx, sz, y = 0.012) {
  const g = new THREE.PlaneGeometry(sx, sz);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, y, cz);
  return g;
}

// ---------- sky ----------
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFlash;
      varying vec3 vDir;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p *= 2.1; a *= 0.5; } return s; }
      void main() {
        float y = vDir.y;
        vec3 zenith = vec3(0.012, 0.008, 0.03);
        vec3 horizon = vec3(0.16, 0.05, 0.2);
        vec3 glow = vec3(0.35, 0.09, 0.22);
        vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.55, y));
        col += glow * pow(1.0 - clamp(abs(y), 0.0, 1.0), 10.0);
        vec2 uv = vDir.xz / max(y + 0.25, 0.05) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
        float c = fbm(uv);
        float clouds = smoothstep(0.35, 0.85, c) * smoothstep(-0.05, 0.25, y);
        col += clouds * mix(vec3(0.2, 0.06, 0.2), vec3(0.08, 0.1, 0.2), c) * 0.9;
        col += uFlash * (0.25 + clouds * 1.4) * vec3(0.7, 0.75, 1.0);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

// ---------- ground, sidewalks, markings ----------
function makeGround(group, refl) {
  const size = HALF * 2 + 520;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    makeWet(new THREE.MeshStandardMaterial({ color: 0x2e2d38, roughness: 0.82 }), refl, { wet: 1, puddle: 1, grain: 1 }),
  );
  ground.layers.set(LAYER_WET);
  group.add(ground);

  // Raised sidewalks on every block, plus a wide slab outside the city edge.
  const slabs = [];
  for (const b of BLOCKS) {
    if (b.plaza) continue;
    const g = new THREE.BoxGeometry(b.x1 - b.x0, CURB, b.z1 - b.z0);
    g.translate((b.x0 + b.x1) / 2, CURB / 2, (b.z0 + b.z1) / 2);
    slabs.push(g);
  }
  const outer = 260;
  for (const [cx, cz, sx, sz] of [
    [0, -HALF - outer / 2, HALF * 2 + outer * 2, outer], [0, HALF + outer / 2, HALF * 2 + outer * 2, outer],
    [-HALF - outer / 2, 0, outer, HALF * 2], [HALF + outer / 2, 0, outer, HALF * 2],
  ]) {
    const g = new THREE.BoxGeometry(sx, CURB, sz);
    g.translate(cx, CURB / 2, cz);
    slabs.push(g);
  }
  const walk = new THREE.Mesh(
    mergeGeometries(slabs),
    makeWet(new THREE.MeshStandardMaterial({ color: 0x4a4755, roughness: 0.9 }), refl, { wet: 0.8, puddle: 0.35, grain: 0.5 }),
  );
  walk.layers.set(LAYER_WET);
  group.add(walk);

  // Lane paint.
  const white = [], yellow = [];
  const ranges = BLOCKS.filter((b) => b.j === 0).map((b) => [b.x0, b.x1]);
  const inPlaza = (x, z) => x > PLAZA_AREA.x0 && x < PLAZA_AREA.x1 && z > PLAZA_AREA.z0 && z < PLAZA_AREA.z1;
  const rect = (list, alongZ, c, t, sa, sc) => list.push(alongZ ? flatRect(c, t, sc, sa) : flatRect(t, c, sa, sc));
  for (const alongZ of [true, false]) {
    for (const road of ROADS) {
      for (const [lo, hi] of ranges) {
        const mid = (lo + hi) / 2;
        if (alongZ ? inPlaza(road.c, mid) : inPlaza(mid, road.c)) continue;
        const len = hi - lo - 8;
        // Edge lines.
        for (const s of [-1, 1]) rect(white, alongZ, road.c + s * (road.w / 2 - 0.9), mid, len, 0.16);
        // Centre: double yellow on avenues, dashes on side streets.
        if (road.w >= 22) {
          for (const s of [-1, 1]) rect(yellow, alongZ, road.c + s * 0.22, mid, len, 0.14);
          if (road.w >= 26) {
            for (const s of [-1, 1]) {
              for (let t = lo + 7; t < hi - 7; t += 9) rect(white, alongZ, road.c + s * road.w / 4, t + 1.5, 3, 0.14);
            }
          }
        } else {
          for (let t = lo + 7; t < hi - 7; t += 9) rect(white, alongZ, road.c, t + 1.5, 3, 0.14);
        }
        // Zebra crossings at both ends.
        for (const end of [lo + 1.2, hi - 4.2]) {
          for (let o = -road.w / 2 + 1.6; o < road.w / 2 - 1.2; o += 1.3) rect(white, alongZ, road.c + o, end + 1.5, 3, 0.7);
        }
      }
    }
  }
  // Drift lot: a painted ring around each pylon and bay lines along the edges.
  for (const p of PILLARS) {
    const r = p.r + 9;
    const ring = new THREE.RingGeometry(r - 0.2, r, 64).rotateX(-Math.PI / 2).translate(p.x, 0.012, p.z);
    yellow.push(ring);
  }
  for (let x = PLAZA_AREA.x0 + 6; x < PLAZA_AREA.x1 - 4; x += 3.2) {
    white.push(flatRect(x, PLAZA_AREA.z0 + 3.5, 0.14, 5));
    white.push(flatRect(x, PLAZA_AREA.z1 - 3.5, 0.14, 5));
  }
  const paint = (list, color) => {
    const m = new THREE.MeshStandardMaterial({
      color, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(mergeGeometries(list), makeWet(m, refl, { wet: 1, puddle: 1, grain: 0.25 }));
    mesh.layers.set(LAYER_WET);
    group.add(mesh);
  };
  paint(white, 0x9c9a92);
  paint(yellow, 0xb88a2c);
}

// ---------- buildings ----------
function planBuildings() {
  const list = [];
  const add = (x0, x1, z0, z1, h, faces) => list.push({ x0, x1, z0, z1, h, faces });
  for (const b of BLOCKS) {
    if (b.plaza) continue;
    const ix0 = b.x0 + SIDEWALK, ix1 = b.x1 - SIDEWALK, iz0 = b.z0 + SIDEWALK, iz1 = b.z1 - SIDEWALK;
    const nx = rand() < 0.5 ? 2 : 3, nz = rand() < 0.5 ? 2 : 3;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const centrality = 1 - Math.min(1, Math.hypot(cx, cz) / (HALF * 1.1));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const gap = 1.2;
        const x0 = ix0 + ((ix1 - ix0) * i) / nx + (i ? gap : 0);
        const x1 = ix0 + ((ix1 - ix0) * (i + 1)) / nx - (i < nx - 1 ? gap : 0);
        const z0 = iz0 + ((iz1 - iz0) * j) / nz + (j ? gap : 0);
        const z1 = iz0 + ((iz1 - iz0) * (j + 1)) / nz - (j < nz - 1 ? gap : 0);
        let h = range(14, 46) * (1 + 1.6 * centrality);
        if (rand() < 0.1) h = range(110, 190);
        const faces = [];
        if (i === 0) faces.push('w');
        if (i === nx - 1) faces.push('e');
        if (j === 0) faces.push('s');
        if (j === nz - 1) faces.push('n');
        add(x0, x1, z0, z1, h, faces);
      }
    }
  }
  // A skyline wall beyond the city edge, set back behind its own sidewalk.
  const edge = HALF + SIDEWALK;
  for (let t = -HALF - 120; t < HALF + 120;) {
    const w = range(18, 38);
    for (const side of [0, 1, 2, 3]) {
      const d0 = edge, d1 = edge + range(24, 45), h = range(35, 150);
      if (side === 0) add(t, t + w, -d1, -d0, h, ['n']);
      if (side === 1) add(t, t + w, d0, d1, h, ['s']);
      if (side === 2 && Math.abs(t) < HALF) add(-d1, -d0, t, t + w, h, ['e']);
      if (side === 3 && Math.abs(t) < HALF) add(d0, d1, t, t + w, h, ['w']);
    }
    t += w + range(1, 3);
  }
  return list;
}

function makeBuildings(group, plan) {
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.15 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBPos; varying vec3 vBNorm; varying float vBSeed;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        mat4 bm = modelMatrix * instanceMatrix;
      #else
        mat4 bm = modelMatrix;
      #endif
      vBPos = (bm * vec4(transformed, 1.0)).xyz;
      vBNorm = normalize(mat3(bm) * objectNormal);
      vBSeed = fract(bm[3].x * 0.137 + bm[3].z * 0.719);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      varying vec3 vBPos; varying vec3 vBNorm; varying float vBSeed;
      float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec3 bn = normalize(vBNorm);
      if (abs(bn.y) < 0.5) {
        float along = abs(bn.x) > 0.5 ? vBPos.z : vBPos.x;
        vec2 fp = vec2(along, vBPos.y);
        vec2 sz = vec2(2.3 + vBSeed * 1.4, 3.4);
        vec2 cell = floor(fp / sz);
        vec2 f = fract(fp / sz);
        float win = step(0.15, f.x) * step(f.x, 0.85) * step(0.2, f.y) * step(f.y, 0.8) * step(5.0, vBPos.y);
        float hh = bHash(cell + floor(vBSeed * 97.0));
        float lit = step(0.68 - vBSeed * 0.2, hh);
        vec3 wc = hh > 0.95 ? vec3(1.0, 0.3, 0.85) : (hh > 0.83 ? vec3(0.45, 0.78, 1.0) : vec3(1.0, 0.64, 0.34));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.01, 0.015, 0.03), win);
        totalEmissiveRadiance += win * lit * wc * (0.12 + 0.6 * bHash(cell + 5.3));
        if (vBPos.y < 4.4) {
          float shop = floor(along / 6.5);
          float hs = bHash(vec2(shop, floor(vBSeed * 53.0)));
          vec3 sc = hs < 0.3 ? vec3(1.0, 0.16, 0.7) : (hs < 0.6 ? vec3(0.1, 0.85, 1.0) : vec3(1.0, 0.55, 0.18));
          float fr = fract(along / 6.5);
          float glass = step(0.07, fr) * step(fr, 0.93) * step(0.5, vBPos.y) * step(vBPos.y, 3.5) * step(0.25, hs);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), glass);
          totalEmissiveRadiance += glass * sc * 0.8;
          float awning = step(3.7, vBPos.y) * step(vBPos.y, 4.0) * step(0.25, hs);
          totalEmissiveRadiance += awning * sc * 2.2;
        }
      }`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, plan.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  plan.forEach((b, i) => {
    m.makeScale(b.x1 - b.x0, b.h, b.z1 - b.z0).setPosition((b.x0 + b.x1) / 2, CURB, (b.z0 + b.z1) / 2);
    mesh.setMatrixAt(i, m);
    c.setHSL(range(0.62, 0.75), range(0.1, 0.25), range(0.05, 0.11));
    mesh.setColorAt(i, c);
  });
  group.add(mesh);

  // Neon trims: roof outlines and corner strips on some towers.
  const trims = [];
  for (const b of plan) {
    const color = new THREE.Color(pick(NEON)).multiplyScalar(range(2, 3.4));
    const top = CURB + b.h;
    if (rand() < 0.45) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      trims.push({ x: (b.x0 + b.x1) / 2, y: top, z: b.z0, sx: w, sy: 0.35, sz: 0.35, color });
      trims.push({ x: (b.x0 + b.x1) / 2, y: top, z: b.z1, sx: w, sy: 0.35, sz: 0.35, color });
      trims.push({ x: b.x0, y: top, z: (b.z0 + b.z1) / 2, sx: 0.35, sy: 0.35, sz: d, color });
      trims.push({ x: b.x1, y: top, z: (b.z0 + b.z1) / 2, sx: 0.35, sy: 0.35, sz: d, color });
    }
    if (rand() < 0.3) {
      const cx = rand() < 0.5 ? b.x0 : b.x1, cz = rand() < 0.5 ? b.z0 : b.z1;
      trims.push({ x: cx, y: CURB + 5 + (b.h - 5) / 2, z: cz, sx: 0.3, sy: b.h - 5, sz: 0.3, color });
    }
  }
  const trimMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), trims.length);
  trims.forEach((t, i) => {
    m.makeScale(t.sx, t.sy, t.sz).setPosition(t.x, t.y, t.z);
    trimMesh.setMatrixAt(i, m);
    trimMesh.setColorAt(i, t.color);
  });
  group.add(trimMesh);
}

// ---------- neon signs ----------
const VERTICAL_WORDS = ['ドリフト', 'ネオン', 'ラーメン', '居酒屋', 'カラオケ', '電脳街', 'ホテル', '雨夜'];
const HORIZONTAL_WORDS = ['DRIFT', 'RAMEN 24H', 'NEON', 'KARAOKE', 'HOTEL', 'ARCADE', 'TUNE SHOP', 'NOODLES'];

function makeSignAtlas() {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 1024;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 1024);
  const colors = ['#ff3fd0', '#35eaff', '#ffb040', '#b07bff', '#44ffae', '#ff4d6d', '#35eaff', '#ff3fd0'];
  const glowText = (text, x, y, color, size) => {
    g.font = `800 ${size}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Chakra Petch", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = size * 0.35;
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.shadowBlur = 0;
    g.fillStyle = '#fff';
    g.globalAlpha = 0.55;
    g.fillText(text, x, y);
    g.globalAlpha = 1;
  };
  const frame = (x, y, w, h, color) => {
    g.fillStyle = '#0a0612';
    g.fillRect(x + 4, y + 4, w - 8, h - 8);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.strokeRect(x + 12, y + 12, w - 24, h - 24);
    g.shadowBlur = 0;
  };
  VERTICAL_WORDS.forEach((word, i) => {
    const x = i * 128, color = colors[i];
    frame(x, 0, 128, 512, color);
    const chars = [...word];
    const step = Math.min(96, 440 / chars.length);
    chars.forEach((ch, k) => glowText(ch, x + 64, 256 + (k - (chars.length - 1) / 2) * step, color, Math.min(84, step * 0.9)));
  });
  HORIZONTAL_WORDS.forEach((word, i) => {
    const x = (i % 2) * 512, y = 512 + Math.floor(i / 2) * 128, color = colors[(i + 3) % colors.length];
    frame(x, y, 512, 128, color);
    glowText(word, x + 256, y + 66, color, word.length > 7 ? 60 : 76);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function signQuad(w, h, uv, place) {
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv;
  for (let k = 0; k < a.count; k++) {
    a.setXY(k, uv[0] + a.getX(k) * (uv[2] - uv[0]), uv[1] + a.getY(k) * (uv[3] - uv[1]));
  }
  place(g);
  return g;
}

function makeSigns(group, plan) {
  const quads = [];
  const vUV = (i) => [(i * 128) / 1024, 0.5, ((i + 1) * 128) / 1024, 1];
  const hUV = (i) => {
    const x = (i % 2) * 0.5, y = 1 - (512 + Math.floor(i / 2) * 128 + 128) / 1024;
    return [x, y, x + 0.5, y + 0.125];
  };
  const normals = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };
  for (const b of plan) {
    for (const f of b.faces) {
      if (rand() < 0.35) continue;
      const [nx, nz] = normals[f];
      const faceX = nx ? (nx > 0 ? b.x1 : b.x0) : null;
      const faceZ = nz ? (nz > 0 ? b.z1 : b.z0) : null;
      const span = nx ? [b.z0, b.z1] : [b.x0, b.x1];
      const count = rand() < 0.5 ? 1 : 2;
      for (let k = 0; k < count; k++) {
        const t = range(span[0] + 2.5, span[1] - 2.5);
        const rotY = Math.atan2(nx, nz);
        const blade = rand() < 0.45;
        const vertical = blade || rand() < 0.5;
        const idx = Math.floor(rand() * 8);
        const scale = rand() < 0.12 ? 2.2 : 1;
        const w = (vertical ? 2 : 8) * scale, h = (vertical ? 8 : 2) * scale;
        const y = Math.min(range(6, 22), b.h - h / 2 - 1) + (scale > 1 ? 10 : 0);
        if (y - h / 2 < 4.5 || y + h / 2 > b.h) continue;
        const uv = vertical ? vUV(idx) : hUV(idx);
        const px = nx ? faceX : t, pz = nz ? faceZ : t;
        if (blade) {
          // Perpendicular to the wall, readable from both directions along the street.
          for (const side of [1, -1]) {
            quads.push(signQuad(w, h, uv, (g) => {
              g.rotateY(rotY + (side * Math.PI) / 2);
              g.translate(px + nx * (w / 2 + 0.6) + nz * side * 0.03, y, pz + nz * (w / 2 + 0.6) - nx * side * 0.03);
            }));
          }
        } else {
          quads.push(signQuad(w, h, uv, (g) => {
            g.rotateY(rotY);
            g.translate(px + nx * 0.25, y, pz + nz * 0.25);
          }));
        }
      }
    }
  }
  const mat = new THREE.MeshBasicMaterial({ map: makeSignAtlas(), color: new THREE.Color(2.6, 2.6, 2.6) });
  const mesh = new THREE.Mesh(mergeGeometries(quads), mat);
  group.add(mesh);
  return mat;
}

// ---------- street lamps ----------
function radialTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

function makeLamps(group, radial) {
  const lamps = [];
  const ranges = BLOCKS.filter((b) => b.j === 0).map((b) => [b.x0, b.x1]);
  const blockAt = (x, z) => BLOCKS.find((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
  for (const road of ROADS) {
    for (const [lo, hi] of ranges) {
      for (const t of [lo + 12, (lo + hi) / 2, hi - 12]) {
        for (const s of [-1, 1]) {
          const off = road.c + s * (road.w / 2 + 0.9);
          for (const alongZ of [true, false]) {
            const x = alongZ ? off : t, z = alongZ ? t : off;
            const b = blockAt(x, z);
            if (b && b.plaza) continue;
            const r = rand();
            const color = r < 0.7 ? 0xbfe4ff : r < 0.85 ? 0xff4fd8 : 0x3ff0ff;
            lamps.push({ x, z, dx: alongZ ? -s : 0, dz: alongZ ? 0 : -s, color });
          }
        }
      }
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 7.6, 6).translate(0, 3.8 + CURB, 0);
  const armGeo = new THREE.BoxGeometry(0.12, 0.12, 2.4).translate(0, 7.5 + CURB, 1.1);
  const headGeo = new THREE.BoxGeometry(0.5, 0.12, 1.1).translate(0, 7.42 + CURB, 2.1);
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b1c24, roughness: 0.5, metalness: 0.7 });
  const poles = new THREE.InstancedMesh(mergeGeometries([poleGeo, armGeo]), metal, lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial(), lamps.length);
  const pools = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: radial, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
    lamps.length,
  );
  pools.layers.set(LAYER_MAIN_ONLY);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  lamps.forEach((l, i) => {
    q.setFromAxisAngle(up, Math.atan2(l.dx, l.dz));
    m.compose(new THREE.Vector3(l.x, 0, l.z), q, new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    heads.setColorAt(i, c.set(l.color).multiplyScalar(4));
    m.compose(new THREE.Vector3(l.x + l.dx * 2.8, 0.03, l.z + l.dz * 2.8), new THREE.Quaternion(), new THREE.Vector3(15, 1, 15));
    pools.setMatrixAt(i, m);
    pools.setColorAt(i, c.set(l.color).multiplyScalar(0.35));
  });
  group.add(poles, heads, pools);
}

// ---------- drift lot pylons ----------
function makePylons(group) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 0.8 });
  for (const [k, p] of PILLARS.entries()) {
    const h = k === 0 ? 26 : 9;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, h, 32).translate(0, h / 2, 0), concrete);
    col.position.set(p.x, 0, p.z);
    group.add(col);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(k === 0 ? 0xff2bd6 : 0x22e6ff).multiplyScalar(3) });
    for (let y = 1.2; y < h; y += k === 0 ? 3.2 : 2.6) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(p.r + 0.04, 0.09, 6, 48), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, y, p.z);
      group.add(ring);
    }
  }
}

export function buildCity(scene, refl) {
  const group = new THREE.Group();
  const sky = makeSky();
  scene.add(sky);
  makeGround(group, refl);
  const plan = planBuildings();
  makeBuildings(group, plan);
  const signMat = makeSigns(group, plan);
  makeLamps(group, radialTexture());
  makePylons(group);
  scene.add(group);
  return {
    sky,
    radial: radialTexture(),
    update(t, camera, flash) {
      sky.position.copy(camera.position);
      sky.material.uniforms.uTime.value = t;
      sky.material.uniforms.uFlash.value = flash;
      // A slow buzz on the signs, like old transformers.
      const buzz = 2.45 + Math.sin(t * 13.0) * 0.05 + (Math.sin(t * 2.3) > 0.985 ? -1.2 : 0);
      signMat.color.setScalar(buzz);
    },
  };
}
