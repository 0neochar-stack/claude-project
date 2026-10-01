// Street and rooftop detail for the city: everything is instanced or merged, so thousands of props cost a few
// draw calls. Small props skip the wet-road reflection pass (LAYER_MAIN_ONLY); lit ones stay in it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, ROADS, HALF, CURB, PLAZA_AREA, PILLARS } from './world.js';
import { LAYER_MAIN_ONLY } from './wet.js';

const SIDEWALK = 4.5;
const FACE_N = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };

// One instanced mesh from a list of placements { x, y, z, ry, sx, sy, sz, color }.
function instanced(geo, mat, items, { layer = 0, colors = false } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.ry || 0);
    m.compose(p.set(it.x, it.y || 0, it.z), q, s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1));
    mesh.setMatrixAt(i, m);
    if (colors) mesh.setColorAt(i, c.set(it.color ?? 0xffffff).multiplyScalar(it.k ?? 1));
  });
  mesh.computeBoundingSphere();
  if (layer) mesh.layers.set(layer);
  return mesh;
}

const metal = () => new THREE.MeshStandardMaterial({ color: 0x24252e, roughness: 0.55, metalness: 0.6 });

export function buildCityDetail(group, plan, rand) {
  const range = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const add = (o) => o && group.add(o);
  const cityBuildings = plan.filter((b) => !b.tier && Math.abs((b.x0 + b.x1) / 2) < HALF && Math.abs((b.z0 + b.z1) / 2) < HALF);

  // ---------- rooftops ----------
  const parapets = [], hvac = [], tanks = [], masts = [], beacons = [], fans = [];
  for (const b of plan) {
    const top = CURB + (b.y0 || 0) + b.h;
    const w = b.x1 - b.x0, d = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (!b.covered) {
      parapets.push({ x: cx, y: top + 0.45, z: b.z0 + 0.15, sx: w, sy: 0.9, sz: 0.3 });
      parapets.push({ x: cx, y: top + 0.45, z: b.z1 - 0.15, sx: w, sy: 0.9, sz: 0.3 });
      parapets.push({ x: b.x0 + 0.15, y: top + 0.45, z: cz, sx: 0.3, sy: 0.9, sz: d - 0.6 });
      parapets.push({ x: b.x1 - 0.15, y: top + 0.45, z: cz, sx: 0.3, sy: 0.9, sz: d - 0.6 });
      const n = Math.floor(range(1, 5));
      for (let k = 0; k < n; k++) {
        const sx = range(1.6, 3.6), sz = range(1.2, 2.6), sy = range(0.9, 1.8);
        const x = range(b.x0 + 1.5 + sx / 2, b.x1 - 1.5 - sx / 2), z = range(b.z0 + 1.5 + sz / 2, b.z1 - 1.5 - sz / 2);
        if (!(x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) continue;
        hvac.push({ x, y: top + sy / 2, z, sx, sy, sz, ry: rand() < 0.5 ? 0 : Math.PI / 2 });
        fans.push({ x, y: top + sy + 0.01, z, sx: Math.min(sx, sz) * 0.35, sy: 1, sz: Math.min(sx, sz) * 0.35 });
      }
      if (rand() < 0.35 && w > 8 && d > 8) tanks.push({ x: range(b.x0 + 3, b.x1 - 3), y: top, z: range(b.z0 + 3, b.z1 - 3), sx: 1, sy: range(0.8, 1.3), sz: 1, ry: rand() * 6 });
      if (b.h > 70 && rand() < 0.7) {
        const mh = range(8, 22);
        const mx = cx + range(-w / 4, w / 4), mz = cz + range(-d / 4, d / 4);
        masts.push({ x: mx, y: top + mh / 2, z: mz, sx: 1, sy: mh, sz: 1 });
        beacons.push({ x: mx, y: top + mh + 0.3, z: mz });
      }
    }
  }
  const concrete = new THREE.MeshStandardMaterial({ color: 0x1d1b25, roughness: 0.9 });
  add(instanced(new THREE.BoxGeometry(1, 1, 1), concrete, parapets, { layer: LAYER_MAIN_ONLY }));
  const unitMat = new THREE.MeshStandardMaterial({ color: 0x3a3b44, roughness: 0.6, metalness: 0.4 });
  add(instanced(new THREE.BoxGeometry(1, 1, 1), unitMat, hvac, { layer: LAYER_MAIN_ONLY }));
  add(instanced(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 14), new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.8 }), fans, { layer: LAYER_MAIN_ONLY }));
  {
    // Wooden water tank on steel legs with a conical cap.
    const parts = [new THREE.CylinderGeometry(1.5, 1.5, 3, 16).translate(0, 4.5, 0), new THREE.ConeGeometry(1.65, 1, 16).translate(0, 6.5, 0)];
    for (const [lx, lz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) parts.push(new THREE.CylinderGeometry(0.08, 0.08, 3, 5).translate(lx, 1.5, lz));
    add(instanced(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0x3b2a26, roughness: 0.9 }), tanks, { layer: LAYER_MAIN_ONLY }));
  }
  {
    const lattice = [new THREE.CylinderGeometry(0.06, 0.12, 1, 5)];
    for (let k = 0; k < 6; k++) lattice.push(new THREE.BoxGeometry(0.9 - k * 0.12, 0.03, 0.03).translate(0, -0.4 + k * 0.15, 0));
    add(instanced(mergeGeometries(lattice), metal(), masts, { layer: LAYER_MAIN_ONLY }));
  }
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1) });
  add(instanced(new THREE.SphereGeometry(0.28, 8, 6), beaconMat, beacons));

  // ---------- facades: AC units under the windows on street-facing walls ----------
  const acs = [], acFronts = [];
  for (const b of cityBuildings) {
    const seed = (((b.x0 + b.x1) / 2) * 0.137 + ((b.z0 + b.z1) / 2) * 0.719) % 1;
    const cell = 2.3 + (seed < 0 ? seed + 1 : seed) * 1.4;
    const top = Math.min(b.h, 45);
    for (const f of b.faces) {
      const [nx, nz] = FACE_N[f];
      const lo = nx ? b.z0 : b.x0, hi = nx ? b.z1 : b.x1;
      const wall = nx ? (nx > 0 ? b.x1 : b.x0) : (nz > 0 ? b.z1 : b.z0);
      for (let i = Math.ceil(lo / cell); (i + 1) * cell < hi; i++) {
        for (let k = 2; k * 3.4 + 3 < top; k++) {
          if (rand() > 0.13) continue;
          const along = (i + 0.5) * cell + (rand() < 0.5 ? -0.45 : 0.45);
          const y = CURB + k * 3.4 + 0.42;
          const out = wall + (nx || nz) * 0.24;
          const it = nx ? { x: out, y, z: along, ry: nx > 0 ? Math.PI / 2 : -Math.PI / 2 } : { x: along, y, z: out, ry: nz > 0 ? 0 : Math.PI };
          acs.push(it);
          acFronts.push({ ...it, x: it.x + nx * 0.18, z: it.z + nz * 0.18 });
        }
      }
    }
  }
  add(instanced(new THREE.BoxGeometry(0.8, 0.55, 0.36), new THREE.MeshStandardMaterial({ color: 0x8c8f99, roughness: 0.6, metalness: 0.3 }), acs, { layer: LAYER_MAIN_ONLY }));
  add(instanced(new THREE.CircleGeometry(0.2, 12).translate(0.12, 0, 0), new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.8 }), acFronts, { layer: LAYER_MAIN_ONLY }));

  // ---------- street level ----------
  const vendBodies = [], vendFronts = [], bins = [], bags = [], bollards = [];
  const VEND = [0xff4fd8, 0x3ff0ff, 0xffffff, 0xff8a2b, 0x7dff6a];
  for (const b of cityBuildings) {
    for (const f of b.faces) {
      if (rand() < 0.45) continue;
      const [nx, nz] = FACE_N[f];
      const lo = nx ? b.z0 : b.x0, hi = nx ? b.z1 : b.x1;
      const wall = nx ? (nx > 0 ? b.x1 : b.x0) : (nz > 0 ? b.z1 : b.z0);
      const n = rand() < 0.5 ? 2 : 3;
      const start = range(lo + 2, hi - 2 - n * 1.05);
      const color = pick(VEND);
      for (let k = 0; k < n; k++) {
        const along = start + k * 1.05;
        const out = wall + (nx || nz) * 0.42;
        const it = nx ? { x: out, y: CURB + 0.95, z: along, ry: nx > 0 ? Math.PI / 2 : -Math.PI / 2 } : { x: along, y: CURB + 0.95, z: out, ry: nz > 0 ? 0 : Math.PI };
        vendBodies.push(it);
        vendFronts.push({ ...it, x: it.x + nx * 0.41, z: it.z + nz * 0.41, color: k === 1 && rand() < 0.5 ? pick(VEND) : color, k: 1.6 });
      }
      // Bins and a pile of rubbish bags further along the wall.
      const t = range(lo + 2, hi - 2);
      const out = wall + (nx || nz) * 0.55;
      const at = (dt, extra = {}) => (nx ? { x: out, z: t + dt, ...extra } : { x: t + dt, z: out, ...extra });
      bins.push(at(0, { y: CURB + 0.55, ry: rand() }));
      for (let k = 0; k < 4; k++) bags.push(at(0.8 + k * 0.4 + range(-0.1, 0.1), { y: CURB + 0.25 + (k === 3 ? 0.35 : 0), sx: range(0.8, 1.1), sy: range(0.7, 1), sz: range(0.8, 1.1), ry: rand() * 6 }));
    }
  }
  const vendGeo = new THREE.BoxGeometry(0.98, 1.9, 0.8);
  add(instanced(vendGeo, new THREE.MeshStandardMaterial({ color: 0xd9dbe2, roughness: 0.4, metalness: 0.2 }), vendBodies, { layer: LAYER_MAIN_ONLY }));
  add(instanced(new THREE.PlaneGeometry(0.82, 1.3).translate(0, 0.18, 0), new THREE.MeshBasicMaterial(), vendFronts, { colors: true }));
  add(instanced(new THREE.CylinderGeometry(0.32, 0.28, 1.1, 10), new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 0.7 }), bins, { layer: LAYER_MAIN_ONLY }));
  add(instanced(new THREE.IcosahedronGeometry(0.32, 0), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.35, metalness: 0.1 }), bags, { layer: LAYER_MAIN_ONLY }));

  // ---------- intersections: traffic lights, bollards, curb stones ----------
  const poles = [], heads = [], lamps = [];
  const lampItems = [];
  for (const rx of ROADS) {
    for (const rz of ROADS) {
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const x = rx.c + sx * (rx.w / 2 + 0.7), z = rz.c + sz * (rz.w / 2 + 0.7);
        if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) continue;
        if (x > PLAZA_AREA.x0 - 1 && x < PLAZA_AREA.x1 + 1 && z > PLAZA_AREA.z0 - 1 && z < PLAZA_AREA.z1 + 1) continue;
        // Alternate corners face traffic on the x roads and the z roads.
        const alongZ = sx * sz > 0;
        const ry = alongZ ? (sz > 0 ? Math.PI : 0) : (sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        const reach = (alongZ ? rx.w : rz.w) * 0.42;
        poles.push({ x, y: CURB, z, ry });
        // The signal head hangs over the road, at the end of the arm (arm points across the road it controls).
        const hx = alongZ ? x - sx * reach : x, hz = alongZ ? z : z - sz * reach;
        heads.push({ x: hx, y: CURB + 6.2, z: hz, ry });
        lampItems.push({ x: hx, z: hz, ry, alongZ });
        for (const off of [-1.4, 1.4]) bollards.push(alongZ ? { x, y: CURB + 0.45, z: z + off * sz * -1 } : { x: x + off * sx * -1, y: CURB + 0.45, z });
      }
    }
  }
  {
    // Pole with an arm that reaches out over the road (along local -x after rotation), built in local space.
    const g = [new THREE.CylinderGeometry(0.1, 0.13, 6.6, 8).translate(0, 3.3, 0)];
    add(instanced(mergeGeometries(g), metal(), poles, { layer: LAYER_MAIN_ONLY }));
    const arms = poles.map((p, i) => {
      const h = heads[i];
      const dx = h.x - p.x, dz = h.z - p.z, len = Math.hypot(dx, dz);
      return { x: (p.x + h.x) / 2, y: CURB + 6.45, z: (p.z + h.z) / 2, sx: len, sy: 1, sz: 1, ry: Math.atan2(-dz, dx) };
    });
    add(instanced(new THREE.BoxGeometry(1, 0.12, 0.12), metal(), arms, { layer: LAYER_MAIN_ONLY }));
    add(instanced(new THREE.BoxGeometry(0.42, 1.15, 0.36), new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.6 }), heads));
  }
  // Three lenses per head, all in one instanced mesh; colours cycle in update().
  const lensItems = [];
  for (const h of lampItems) {
    const fx = Math.sin(h.ry), fz = Math.cos(h.ry);
    for (let k = 0; k < 3; k++) lensItems.push({ x: h.x + fx * 0.19, y: CURB + 6.55 - k * 0.35, z: h.z + fz * 0.19, ry: h.ry, phase: h.alongZ ? 0 : 1, slot: k, color: 0x111111 });
  }
  const lensMesh = instanced(new THREE.CircleGeometry(0.12, 14), new THREE.MeshBasicMaterial(), lensItems, { colors: true });
  add(lensMesh);
  add(instanced(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x2b2a33, roughness: 0.5, metalness: 0.5 }), bollards, { layer: LAYER_MAIN_ONLY }));
  const bands = bollards.map((b) => ({ ...b, y: b.y + 0.3 }));
  add(instanced(new THREE.CylinderGeometry(0.105, 0.105, 0.08, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.3) }), bands));

  // Light granite curb stones along every block edge.
  const curbs = [];
  for (const b of BLOCKS) {
    if (b.plaza) continue;
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    curbs.push({ x: (b.x0 + b.x1) / 2, y: CURB / 2 + 0.005, z: b.z0 + 0.15, sx: w, sy: CURB + 0.01, sz: 0.3 });
    curbs.push({ x: (b.x0 + b.x1) / 2, y: CURB / 2 + 0.005, z: b.z1 - 0.15, sx: w, sy: CURB + 0.01, sz: 0.3 });
    curbs.push({ x: b.x0 + 0.15, y: CURB / 2 + 0.005, z: (b.z0 + b.z1) / 2, sx: 0.3, sy: CURB + 0.01, sz: d - 0.6 });
    curbs.push({ x: b.x1 - 0.15, y: CURB / 2 + 0.005, z: (b.z0 + b.z1) / 2, sx: 0.3, sy: CURB + 0.01, sz: d - 0.6 });
  }
  add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x6d6a76, roughness: 0.55 }), curbs));

  // ---------- side streets: wooden utility poles and sagging power lines ----------
  const upoles = [], cables = [];
  const ranges = BLOCKS.filter((b) => b.j === 0).map((b) => [b.x0, b.x1]);
  const sag = (a, b2, droop) => {
    const seg = 8;
    for (let k = 0; k < seg; k++) {
      const t0 = k / seg, t1 = (k + 1) / seg;
      const p = (t) => [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t - droop * 4 * t * (1 - t), a[2] + (b2[2] - a[2]) * t];
      cables.push(...p(t0), ...p(t1));
    }
  };
  for (const road of ROADS.filter((r) => r.w <= 22)) {
    for (const alongZ of [true, false]) {
      for (const [lo, hi] of ranges) {
        const mid = (lo + hi) / 2;
        const inLot = alongZ ? road.c > PLAZA_AREA.x0 && road.c < PLAZA_AREA.x1 && mid > PLAZA_AREA.z0 && mid < PLAZA_AREA.z1
          : mid > PLAZA_AREA.x0 && mid < PLAZA_AREA.x1 && road.c > PLAZA_AREA.z0 && road.c < PLAZA_AREA.z1;
        if (inLot) continue;
        const side = rand() < 0.5 ? 1 : -1;
        const off = road.c + side * (road.w / 2 + 0.45);
        const ts = [lo + 5, lo + 29, lo + 53, hi - 3];
        const tops = ts.map((t) => (alongZ ? [off, CURB + 8.6, t] : [t, CURB + 8.6, off]));
        tops.forEach((tp, k) => {
          if (k < 3) upoles.push({ x: tp[0], y: CURB, z: tp[2], ry: alongZ ? 0 : Math.PI / 2 });
        });
        for (let k = 0; k < 2; k++) {
          for (const dy of [0, -0.6, -1.2]) {
            for (const lat of [-0.7, 0.7]) {
              const a = tops[k], c = tops[k + 1];
              const shift = (p) => (alongZ ? [p[0] + lat, p[1] + dy, p[2]] : [p[0], p[1] + dy, p[2] + lat]);
              sag(shift(a), shift(c), 0.5 + rand() * 0.4);
            }
          }
          // A drop line across the street to the far side.
          if (rand() < 0.5) {
            const a = tops[k];
            const far = alongZ ? [road.c - side * (road.w / 2 + 4.5), CURB + 6.5, a[2] + 2] : [a[0] + 2, CURB + 6.5, road.c - side * (road.w / 2 + 4.5)];
            sag([a[0], a[1] - 1.2, a[2]], far, 0.9);
          }
        }
      }
    }
  }
  {
    const g = [new THREE.CylinderGeometry(0.13, 0.17, 9.2, 7).translate(0, 4.6, 0)];
    g.push(new THREE.BoxGeometry(1.8, 0.1, 0.12).translate(0, 8.6, 0), new THREE.BoxGeometry(1.4, 0.1, 0.12).translate(0, 8.0, 0));
    g.push(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 8).translate(0.35, 7.2, 0.18)); // transformer can
    add(instanced(mergeGeometries(g), new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.9 }), upoles, { layer: LAYER_MAIN_ONLY }));
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
    const wire = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x07060a }));
    wire.layers.set(LAYER_MAIN_ONLY);
    add(wire);
  }

  // ---------- road: manhole covers, some of them steaming ----------
  const holes = [], steam = [];
  for (const road of ROADS) {
    for (const [lo, hi] of ranges) {
      for (const alongZ of [true, false]) {
        if (rand() < 0.4) continue;
        const t = range(lo + 8, hi - 8), o = road.c + range(-road.w / 4, road.w / 4);
        const x = alongZ ? o : t, z = alongZ ? t : o;
        if (x > PLAZA_AREA.x0 && x < PLAZA_AREA.x1 && z > PLAZA_AREA.z0 && z < PLAZA_AREA.z1) continue;
        holes.push({ x, y: 0.016, z, ry: rand() * 6 });
        if (rand() < 0.3) steam.push({ x, z });
      }
    }
  }
  {
    const tex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      g.fillStyle = '#16151b';
      g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#3a3842';
      g.lineWidth = 3;
      for (let r = 14; r < 60; r += 9) { g.beginPath(); g.arc(64, 64, r, 0, Math.PI * 2); g.stroke(); }
      for (let a = 0; a < 8; a++) { g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a * 0.785) * 60, 64 + Math.sin(a * 0.785) * 60); g.stroke(); }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.6, transparent: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -3 });
    const geo = new THREE.CircleGeometry(0.75, 20).rotateX(-Math.PI / 2);
    add(instanced(geo, mat, holes, { layer: LAYER_MAIN_ONLY }));
  }

  // ---------- drift lot: tyre walls around the pylons and the edges, floodlight towers ----------
  const tyres = [], floods = [], floodHeads = [];
  // Tyres hug the pylons, inside the pylon's own collision ring, so nothing here can be driven through.
  for (const p of PILLARS) {
    const r = p.r + 0.36;
    const n = Math.round((Math.PI * 2 * r) / 0.75);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      for (let h = 0; h < 3; h++) tyres.push({ x: p.x + Math.cos(a) * r, y: 0.13 + h * 0.25, z: p.z + Math.sin(a) * r, ry: a });
    }
  }
  for (const [x, z] of [[PLAZA_AREA.x0 + 4, PLAZA_AREA.z0 + 4], [PLAZA_AREA.x1 - 4, PLAZA_AREA.z0 + 4], [PLAZA_AREA.x0 + 4, PLAZA_AREA.z1 - 4], [PLAZA_AREA.x1 - 4, PLAZA_AREA.z1 - 4]]) {
    floods.push({ x, y: 0, z });
    floodHeads.push({ x, y: 16, z, ry: Math.atan2((PLAZA_AREA.x0 + PLAZA_AREA.x1) / 2 - x, (PLAZA_AREA.z0 + PLAZA_AREA.z1) / 2 - z) });
  }
  add(instanced(new THREE.TorusGeometry(0.3, 0.11, 4, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.85 }), tyres, { layer: LAYER_MAIN_ONLY }));
  {
    const tower = [new THREE.CylinderGeometry(0.18, 0.28, 16, 8).translate(0, 8, 0)];
    for (let k = 1; k < 8; k++) tower.push(new THREE.BoxGeometry(0.7, 0.05, 0.05).translate(0, k * 2, 0));
    add(instanced(mergeGeometries(tower), metal(), floods, { layer: LAYER_MAIN_ONLY }));
    const head = [];
    for (const x of [-1, 0, 1]) for (const y of [0, 0.7]) head.push(new THREE.PlaneGeometry(0.6, 0.5).translate(x * 0.7, y, 0.2));
    add(instanced(mergeGeometries(head), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 4.6) }), floodHeads));
  }

  // Traffic light cycle: one direction green while the cross road holds red, with an amber step.
  const c = new THREE.Color();
  const RED = new THREE.Color(3.2, 0.1, 0.08), AMBER = new THREE.Color(3, 1.4, 0.05), GREEN = new THREE.Color(0.1, 3, 0.9), OFF = new THREE.Color(0.06, 0.06, 0.07);
  let lastState = -1;
  return {
    steam,
    update(t) {
      // 12 s cycle: 0-5 x-roads green, 5-6 amber, 6-11 z-roads green, 11-12 amber.
      const cyc = t % 12;
      const state = cyc < 5 ? 0 : cyc < 6 ? 1 : cyc < 11 ? 2 : 3;
      beaconMat.color.setRGB(Math.sin(t * 2.4) > 0.6 ? 3.5 : 0.25, 0.08, 0.05);
      if (state === lastState || !lensMesh) return;
      lastState = state;
      lensItems.forEach((l, i) => {
        const go = l.phase === 0 ? state === 0 : state === 2;
        const amber = l.phase === 0 ? state === 1 : state === 3;
        const lit = go ? 2 : amber ? 1 : 0;
        lensMesh.setColorAt(i, l.slot === lit ? (lit === 2 ? GREEN : lit === 1 ? AMBER : RED) : OFF);
      });
      lensMesh.instanceColor.needsUpdate = true;
      void c;
    },
  };
}
