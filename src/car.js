import * as THREE from 'three';
import { LAYER_MAIN_ONLY } from './wet.js';

export const PAINTS = [
  { name: 'Midnight Violet', color: 0x3b1a78 },
  { name: 'Hot Magenta', color: 0xc2186b },
  { name: 'Ice Cyan', color: 0x1aa6c9 },
  { name: 'Pearl White', color: 0xd9dde6 },
  { name: 'Racing Lime', color: 0x7ccf1f },
  { name: 'Gunmetal', color: 0x2a2e36 },
  { name: 'Sunset Orange', color: 0xe0561b },
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

// ---------- body profile ----------
// A low widebody coupe: long hood, fastback roof, ducktail, flared arches. z is forward, +x is the car's left.
const WHEEL_R = 0.32;
const ARCH_R = 0.39;
const FRONT_Z = 1.28, REAR_Z = -1.34, TRACK = 0.82;
const halfWidth = curve([[-2.26, 0.83], [-2.0, 0.89], [-1.34, 0.92], [-0.6, 0.89], [0.3, 0.88], [1.28, 0.91], [1.9, 0.87], [2.22, 0.76]]);
const shoulder = curve([[-2.26, 0.84], [-1.95, 0.91], [-1.34, 0.89], [-0.5, 0.85], [0.5, 0.82], [1.28, 0.83], [1.9, 0.72], [2.22, 0.6]]);
const centreTop = curve([[-2.26, 0.86], [-2.0, 0.93], [-1.6, 0.9], [-0.5, 0.86], [0.5, 0.82], [1.2, 0.76], [1.9, 0.66], [2.22, 0.56]]);
const baseBottom = curve([[-2.26, 0.4], [-2.05, 0.25], [1.95, 0.22], [2.22, 0.3]]);
const flare = (z) => 0.04 * Math.exp(-(((z - FRONT_Z) / 0.5) ** 2)) + 0.055 * Math.exp(-(((z - REAR_Z) / 0.55) ** 2));

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

// Greenhouse: windscreen from z 0.62 back to the fastback tail at -1.8.
const roofTop = curve([[-1.8, 0], [-1.4, 0.24], [-1.0, 0.4], [-0.55, 0.42], [-0.2, 0.39], [0.25, 0.2], [0.62, 0]]);
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

// ---------- wheels ----------
function buildWheelParts(mats) {
  const tyre = new THREE.LatheGeometry([
    [0.2, -0.125], [0.29, -0.13], [0.31, -0.115], [0.32, -0.07], [0.32, 0.07], [0.31, 0.115], [0.29, 0.13], [0.2, 0.125],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 32).rotateZ(Math.PI / 2);
  // Deep-dish rim: lip at the outer face, barrel inside.
  const rim = new THREE.LatheGeometry([
    [0.05, 0.02], [0.2, 0.055], [0.215, 0.1], [0.225, 0.12], [0.212, 0.125], [0.2, 0.1], [0.2, -0.11],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 32).rotateZ(-Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.035, 0.17, 0.045).translate(0, 0.115, 0);
  const cap = new THREE.CylinderGeometry(0.045, 0.05, 0.03, 12).rotateZ(Math.PI / 2);
  const disc = new THREE.CylinderGeometry(0.18, 0.18, 0.025, 24).rotateZ(Math.PI / 2);
  const caliper = new THREE.BoxGeometry(0.06, 0.1, 0.13);
  return { tyre, rim, spoke, cap, disc, caliper, mats };
}

function makeWheel(parts, side, front) {
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
  for (let k = 0; k < 6; k++) {
    const s = new THREE.Mesh(parts.spoke, mats.rim);
    s.position.x = 0.07;
    s.rotation.x = (k * Math.PI) / 3;
    s.rotation.z = -0.12;
    spin.add(s);
  }
  const cap = new THREE.Mesh(parts.cap, mats.cap);
  cap.position.x = 0.08;
  spin.add(cap);
  mount.add(spin);
  return { pivot, spin, dir: side > 0 ? 1 : -1 };
}

// ---------- the car ----------
export function buildCar(envMap, radial) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // rolls and pitches on the suspension
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: PAINTS[0].color, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05, envMap, envMapIntensity: 1.0,
  });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0d0d12, roughness: 0.35, metalness: 0.5, envMap, envMapIntensity: 0.8 });
  const matte = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x05060b, metalness: 0.1, roughness: 0.02, clearcoat: 1, envMap, envMapIntensity: 2.2 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, metalness: 1, roughness: 0.12, envMap, envMapIntensity: 1.6 });
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x22e6ff).multiplyScalar(3) });

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
  for (let i = 0; i <= 36; i++) {
    const z = 0.62 - (2.42 * i) / 36;
    gz.unshift(z);
    gr.unshift(smoothRing(glassSection(z).ring, 3));
  }
  body.add(new THREE.Mesh(loft(gr, gz), glass));
  const rz = [], rr = [];
  for (let i = 0; i <= 16; i++) {
    const z = -0.15 - (1.0 * i) / 16;
    const s = glassSection(z);
    rz.unshift(z);
    rr.unshift(smoothRing(mirrorHalf([[0, s.top - 0.03], [s.ht * 0.92, s.top - 0.035], [s.ht * 0.96, s.top - 0.01], [s.ht * 0.5, s.top + 0.012], [0, s.top + 0.014]]), 3));
  }
  body.add(new THREE.Mesh(loft(rr, rz), paint));
  const at = (z, f) => { const s = glassSection(z); return [s.hb + (s.ht - s.hb) * f, s.base + (s.top - s.base) * f]; };
  for (const side of [1, -1]) {
    const [ax0, ay0] = at(0.6, 0), [ax1, ay1] = at(-0.18, 1);
    body.add(rod([side * (ax0 + 0.005), ay0, 0.6], [side * (ax1 + 0.01), ay1, -0.18], 0.028, paint));
    const [bx0, by0] = at(-0.72, 0), [bx1, by1] = at(-0.72, 1);
    body.add(rod([side * (bx0 + 0.012), by0, -0.72], [side * (bx1 + 0.012), by1, -0.72], 0.032, carbon));
    const [cx0, cy0] = at(-1.62, 0), [cx1, cy1] = at(-1.1, 1);
    body.add(rod([side * (cx0 + 0.005), cy0, -1.62], [side * (cx1 + 0.01), cy1, -1.1], 0.04, paint));
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
  body.add(box(1.78, 0.03, 0.34, carbon, 0, 1.2, -1.98));
  for (const side of [1, -1]) {
    body.add(box(0.02, 0.18, 0.4, carbon, side * 0.89, 1.17, -1.99));
    body.add(rod([side * 0.5, 1.2, -1.92], [side * 0.48, centreTop(-1.95) - 0.02, -1.9], 0.022, carbon));
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

  // Rear: quad round tail lamps with chrome rings, one fat exhaust.
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.08, 0.12) });
  const lampGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.03, 20).rotateX(Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(0.09, 0.012, 6, 20);
  for (const x of [-0.72, -0.46, 0.46, 0.72]) {
    const lamp = new THREE.Mesh(lampGeo, tailMat);
    lamp.position.set(x, 0.72, -2.265);
    body.add(lamp);
    const ring = new THREE.Mesh(ringGeo, chrome);
    ring.position.set(x, 0.72, -2.27);
    body.add(ring);
  }
  body.add(box(1.3, 0.012, 0.012, tailMat, 0, 0.83, -2.26));
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.26, 16, 1, true).rotateX(Math.PI / 2), chrome);
  exhaust.position.set(-0.55, 0.3, -2.33);
  body.add(exhaust);
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.55, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.28), flameMat);
  flame.position.set(-0.55, 0.3, -2.46);
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

  // Underglow: bright strip under the sills plus a coloured pool on the road.
  const glowColor = new THREE.Color(0xff2bd6);
  body.add(box(1.4, 0.02, 3.4, new THREE.MeshBasicMaterial({ color: glowColor.clone().multiplyScalar(3) }), 0, 0.2, 0));
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: radial, color: glowColor.clone().multiplyScalar(0.45), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
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
  const parts = buildWheelParts({
    tyre: new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.88 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x9aa0ad, metalness: 1, roughness: 0.22, envMap, envMapIntensity: 1.4 }),
    cap: neon,
    disc: new THREE.MeshStandardMaterial({ color: 0x5a5c63, metalness: 0.9, roughness: 0.4, envMap }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xff2a5a, roughness: 0.4, emissive: 0x40061a }),
  });
  const wheels = [];
  for (const [side, z, front] of [[1, FRONT_Z, true], [-1, FRONT_Z, true], [1, REAR_Z, false], [-1, REAR_Z, false]]) {
    const w = makeWheel(parts, side, front);
    w.pivot.position.set(side * TRACK, WHEEL_R, z);
    w.front = front;
    root.add(w.pivot);
    wheels.push(w);
  }

  let paintIndex = 0;
  let flameTime = 0;
  let lastThrottle = 0;
  const api = {
    root, body, wheels, beam,
    onBackfire: null,
    setPaint(i) {
      paintIndex = (i + PAINTS.length) % PAINTS.length;
      paint.color.set(PAINTS[paintIndex].color);
      return PAINTS[paintIndex].name;
    },
    get paintIndex() { return paintIndex; },
    update(car, dt) {
      root.position.set(car.x, 0, car.z);
      root.rotation.y = car.h;
      // Body roll from lateral load, pitch from acceleration.
      const lat = car.r * car.u;
      body.rotation.z = THREE.MathUtils.damp(body.rotation.z, THREE.MathUtils.clamp(lat * 0.006, -0.07, 0.07), 8, dt);
      body.rotation.x = THREE.MathUtils.damp(body.rotation.x, THREE.MathUtils.clamp(-car.ax * 0.006, -0.05, 0.05), 8, dt);
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
  return api;
}
