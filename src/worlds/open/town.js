// Everything built by people: Vista Del Mar's houses, shops, car meet, gas station and downtown; the
// beach; the sign on the hill; Sakura Village with its machiya, lanterns, vending machines, poles and wires,
// torii and pagoda; and the summit lookout. Batched per 400 m area by material. Also returns parked cars,
// trash cans to knock over, yard trees, colliders and extra lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF, heightAt, roadQuery, rng, clamp, PCH_Z, BOULEVARD_Z, LOTS, inLot } from './layout.js';
import { Builder, makeTextures, atlasTexture, signTexture, CELLS, SIGNS } from './builder.js';
import { carLowGeometry, PAINTS, contactShadowTexture } from '../../car.js';
import { CARS } from '../../garage.js';

const AREA = 400;
const AVES = [-1820, -1660, -1500, -1340, -1180, -1020, -860, -700];
const RES_STREETS = [-1420, -1260, -1100, -780, -620, -460];

export function buildTown(net, heights, preset, assets = new Map()) {
  const group = new THREE.Group();
  const R = rng(777);
  const T = makeTextures();
  const atlas = atlasTexture(false), atlasLit = atlasTexture(true), signs = signTexture();
  const night = { value: 0 };
  const mats = {
    stucco: new THREE.MeshStandardMaterial({ map: T.stucco, vertexColors: true, roughness: 0.92 }),
    siding: new THREE.MeshStandardMaterial({ map: T.siding, vertexColors: true, roughness: 0.85 }),
    boards: new THREE.MeshStandardMaterial({ map: T.boards, vertexColors: true, roughness: 0.9 }),
    terracotta: new THREE.MeshStandardMaterial({ map: T.terracotta, vertexColors: true, roughness: 0.8 }),
    shingle: new THREE.MeshStandardMaterial({ map: T.shingle, vertexColors: true, roughness: 0.95 }),
    kawara: new THREE.MeshStandardMaterial({ map: T.kawara, vertexColors: true, roughness: 0.6, metalness: 0.2 }),
    gravel: new THREE.MeshStandardMaterial({ map: T.gravel, vertexColors: true, roughness: 1 }),
    concrete: new THREE.MeshStandardMaterial({ map: T.concrete, vertexColors: true, roughness: 0.95 }),
    lot: new THREE.MeshStandardMaterial({ map: T.lot, vertexColors: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7 }),
    tower: new THREE.MeshStandardMaterial({ map: T.glassTower, emissiveMap: T.glassTowerLit, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.15, metalness: 0.6 }),
    win: new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.25, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    winLit: new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlasLit, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.25, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    glowAtlas: new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlasLit, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    sign: new THREE.MeshStandardMaterial({ map: signs, emissiveMap: signs, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    hedge: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    letters: null,
    wire: new THREE.LineBasicMaterial({ color: 0x1a1a1a }),
  };
  const builders = new Map();
  const B = (x, z) => {
    const k = `${Math.floor((x + HALF) / AREA)},${Math.floor((z + HALF) / AREA)}`;
    let b = builders.get(k);
    if (!b) builders.set(k, (b = new Builder()));
    return b;
  };
  const colliders = [];
  const bins = [];
  const yardTrees = [];
  const sakuraSpots = [];
  const mailboxes = []; // curbside mailboxes, as downloaded models (decor.js) when there is one
  let toriiSpot = null, pagodaSpot = null;
  const lamps = [];
  const parked = [];
  const paved = [];
  const box = (x, z, w, d, rot, tall = true) => colliders.push({ type: 'box', x, z, hx: w / 2, hz: d / 2, a: rot, tall });
  const circle = (x, z, r) => colliders.push({ type: 'circle', x, z, r });
  const ground = (x, z) => heightAt(heights, x, z);
  const q = {};
  const clearOfRoads = (x, z, pad) => { roadQuery(net, x, z, q); return !q.road || q.d > q.road.hw + (q.road.sidewalk || q.road.gutter || 0) + pad; };
  // Local frame helper: point at (along, lat) in a building's frame: right = (cos, -sin), front = (sin, cos).
  const at = (cx, cz, rot, x, z) => ({ x: cx + x * Math.cos(rot) + z * Math.sin(rot), z: cz - x * Math.sin(rot) + z * Math.cos(rot) });
  const lookPool = CARS.filter((c) => c.look.body || c.id === 'ronin' || c.id === 'kaze');
  const parkCar = (x, z, rot, def = lookPool[Math.floor(R() * lookPool.length)], paint = PAINTS[Math.floor(R() * PAINTS.length)].color) => {
    parked.push({ x, z, rot, look: def.look, paint, y: ground(x, z) });
    box(x, z, 1.9, 4.5, rot, false);
  };

  // ---------- houses ----------
  const SPANISH = [0xf3e9d8, 0xf0d8c0, 0xe9e2d0, 0xf2c9b1, 0xdfe6d8, 0xf5e6c8];
  const RANCH = [0xc9d3d9, 0xd7cfbf, 0xe8e4da, 0xb8c4b0, 0xd9c8b0];
  const MODERN = [0xf4f4f2, 0x3a3a3e, 0xd9d4cc, 0xe6e6e6];
  const BIN_COLORS = [0x1a1a1c, 0x1d4fa8, 0x2f6a2a];
  function house(cx, cz, rot, w, d, style, stories, lot) {
    const b = B(cx, cz);
    const g = Math.min(ground(cx, cz), ...[[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => { const p = at(cx, cz, rot, x, z); return ground(p.x, p.z); }));
    const y0 = g + 0.35;
    const H = stories * 3.0;
    const wallMat = style === 'ranch' ? 'siding' : 'stucco';
    const color = style === 'spanish' ? SPANISH[Math.floor(R() * SPANISH.length)] : style === 'ranch' ? RANCH[Math.floor(R() * RANCH.length)] : MODERN[Math.floor(R() * MODERN.length)];
    b.box(cx, g - 1.2, cz, w + 0.3, 1.55, d + 0.3, rot, 'concrete', 0xb0aca4);
    b.box(cx, y0, cz, w, H, d, rot, { side: wallMat }, color);
    if (style === 'modern') {
      b.box(cx, y0 + H, cz, w + 0.2, 0.5, d + 0.2, rot, { side: 'stucco', top: 'gravel' }, color);
      // A second-floor box pushed forward for that architect look.
      if (stories === 1 && R() < 0.5) b.box(at(cx, cz, rot, -w * 0.18, d * 0.1).x, y0 + H, at(cx, cz, rot, -w * 0.18, d * 0.1).z, w * 0.55, 2.8, d * 0.7, rot, { side: 'stucco', top: 'gravel' }, MODERN[(MODERN.indexOf(color) + 1) % MODERN.length]);
    } else {
      b.roof(style === 'spanish' ? 'terracotta' : 'shingle', cx, y0 + H, cz, w, d, rot, style === 'spanish' ? 1.6 : 1.3, style === 'spanish' ? 0.45 : 0.65, 'hip', 0xffffff);
      if (R() < 0.35) { const p = at(cx, cz, rot, w * 0.3, -d * 0.2); b.box(p.x, y0 + H, p.z, 0.9, 2.4, 0.9, rot, { side: wallMat, top: 'concrete' }, color); }
    }
    // Front: garage on one side, door, windows.
    const front = d / 2 + 0.03;
    const gSide = R() < 0.5 ? -1 : 1;
    const fx = (x) => at(cx, cz, rot, x, front);
    const gx = gSide * (w / 2 - 2.0);
    let p = fx(gx);
    b.decal('win', p.x, y0 + 1.2, p.z, 3.0, 2.3, rot, CELLS.garage, 0xffffff);
    p = fx(-gSide * 0.5);
    b.decal('win', p.x, y0 + 1.1, p.z, 1.1, 2.2, rot, CELLS.door);
    // Porch light.
    p = at(cx, cz, rot, -gSide * 0.5 + 0.8, front + 0.05);
    b.box(p.x, y0 + 2.0, p.z, 0.16, 0.24, 0.1, rot, 'glow', 0xffd9a0);
    for (let s = 0; s < stories; s++) {
      const wy = y0 + 1.6 + s * 3.0;
      const xs = [];
      for (let x = -w / 2 + 1.4; x < w / 2 - 1.2; x += 2.6) {
        if (s === 0 && (Math.abs(x - gx) < 2.2 || Math.abs(x + gSide * 0.5) < 1.3)) continue;
        xs.push(x);
      }
      for (const x of xs) {
        p = fx(x);
        const lit = R() < 0.45;
        b.decal(lit ? 'winLit' : 'win', p.x, wy, p.z, style === 'modern' ? 2.2 : 1.5, style === 'modern' ? 1.9 : 1.4, rot, style === 'modern' ? CELLS.picture : style === 'spanish' && R() < 0.4 ? CELLS.arch : R() < 0.5 ? CELLS.win : CELLS.win2);
      }
      // Sides and back.
      for (const [face, len, frot] of [[w / 2 + 0.03, d, rot + Math.PI / 2], [-w / 2 - 0.03, d, rot - Math.PI / 2], [-d / 2 - 0.03, w, rot + Math.PI]]) {
        const n = Math.max(1, Math.floor(len / 4));
        for (let k = 0; k < n; k++) {
          const off = -len / 2 + (len / n) * (k + 0.5);
          const q2 = frot === rot + Math.PI ? at(cx, cz, rot, -off, face) : at(cx, cz, rot, face, off * (frot > rot ? -1 : 1));
          const lit = R() < 0.35;
          b.decal(lit ? 'winLit' : 'win', q2.x, wy, q2.z, 1.3, 1.3, frot, R() < 0.5 ? CELLS.win : CELLS.win2);
        }
      }
    }
    // Hedge and a yard tree.
    p = at(cx, cz, rot, -gSide * (w / 4), d / 2 + 1.0);
    b.box(p.x, ground(p.x, p.z) - 0.2, p.z, w * 0.4, 1.1, 0.8, rot, 'hedge', 0x3a5a2a);
    if (R() < 0.55) {
      p = at(cx, cz, rot, -gSide * (w / 2 + 1.5), d / 2 + 4);
      yardTrees.push({ kind: R() < 0.55 ? 'palm' : 'oak', x: p.x, z: p.z, s: 0.6 + R() * 0.3 });
    }
    box(cx, cz, w + 0.4, d + 0.4, rot);
    return { gx, gSide, y0 };
  }

  // Houses along the residential streets and beach houses along the coast road.
  const lineOfHouses = (roadZ, side, x0, x1, kind, roadW, roadSide) => {
    const hw = roadW / 2, walk = 3.2;
    for (let x = x0; x < x1 - 16; x += 19 + R() * 2) {
      const style = kind === 'beach' ? (R() < 0.6 ? 'modern' : 'spanish') : R() < 0.45 ? 'spanish' : R() < 0.55 ? 'ranch' : 'modern';
      const w = 11 + R() * 4, d = 9 + R() * 3;
      const set = 6 + R() * 3;
      const cz = roadZ + side * (hw + walk + set + d / 2), cx = x + w / 2 + 1;
      const rot = side > 0 ? Math.PI : 0;
      if (!clearOfRoads(cx, cz, set * 0.6)) continue;
      const stories = style === 'ranch' ? 1 : R() < 0.35 ? 2 : 1;
      const h = house(cx, cz, rot, w, d, style, stories);
      // Driveway from the garage to the street.
      const dg = at(cx, cz, rot, h.gx, d / 2);
      const curbZ = roadZ + side * hw;
      const b = B(cx, cz);
      const dy = ground(dg.x, dg.z) + 0.04;
      b.planar('concrete', [new THREE.Vector3(dg.x - 1.7, dy, dg.z), new THREE.Vector3(dg.x + 1.7, dy, dg.z), new THREE.Vector3(dg.x + 1.7, ground(dg.x, curbZ) + 0.2, curbZ + side * 0.02), new THREE.Vector3(dg.x - 1.7, ground(dg.x, curbZ) + 0.2, curbZ + side * 0.02)].map((v, i, arr) => (side < 0 ? arr[[1, 0, 3, 2][i]] : v)), 0xd0ccc4, 3);
      if (R() < 0.35) parkCar(dg.x, cz - side * (d / 2 + 3.4), side > 0 ? Math.PI : 0);
      // Trash day: two or three cans in the gutter by the curb, next to the driveway.
      if (kind !== 'beach' || R() < 0.5) {
        const n = 2 + (R() < 0.4 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const bx = dg.x + (h.gSide < 0 ? 2.6 : -2.6) + k * 0.85 * (h.gSide < 0 ? 1 : -1);
          bins.push({ x: bx, z: roadZ + side * (hw - 0.55), rot: (side > 0 ? 0 : Math.PI) + (R() - 0.5) * 0.3, color: BIN_COLORS[k % 3] });
        }
      }
      // Mailbox at the sidewalk.
      const mb = at(cx, cz, rot, h.gx + (h.gSide < 0 ? 2.2 : -2.2), d / 2 + set - 0.4);
      if (assets.has('mailbox')) mailboxes.push({ x: mb.x, z: mb.z, rot });
      else {
        b.box(mb.x, ground(mb.x, mb.z), mb.z, 0.08, 1.0, 0.08, rot, 'metal', 0x303034);
        b.box(mb.x, ground(mb.x, mb.z) + 1.0, mb.z, 0.25, 0.25, 0.45, rot, 'metal', 0x2a2a2e);
      }
      // Now and then a car parked at the curb.
      if (kind !== 'beach' && R() < 0.14) {
        const px = cx + (R() - 0.5) * 6;
        // Parked with the traffic: on the north side of an east-west street that means facing east.
        parkCar(px, roadZ + roadSide * side * (hw - 1.3), side > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  };
  for (const z of RES_STREETS) {
    for (let i = 0; i < 4; i++) for (const side of [1, -1]) lineOfHouses(z, side, AVES[i] + 22, AVES[i + 1] - 6, 'street', 10, 1);
    // East of the residential area the side streets have houses too, away from the downtown blocks.
    if (z < -900) for (let i = 4; i < 7; i++) for (const side of [1, -1]) lineOfHouses(z, side, AVES[i] + 22, AVES[i + 1] - 6, 'street', 10, 1);
  }
  for (let i = 0; i < 7; i++) lineOfHouses(PCH_Z, 1, AVES[i] + 24, AVES[i + 1] - 8, 'beach', 12, 1);

  // ---------- the boulevard strip ----------
  const shopRow = (z, side, x0, x1) => {
    for (let x = x0; x < x1 - 10; ) {
      const w = 12 + Math.floor(R() * 3) * 4, d = 14 + R() * 4, h = 4.5 + (R() < 0.3 ? 3.5 : 0);
      const cx = x + w / 2, cz = z + side * (9 + 3.6 + 0.3 + d / 2);
      x += w + 0.4;
      if (!clearOfRoads(cx, cz, 0.2) || LOTS.some((l) => inLot(l, cx, cz, 8))) continue;
      const rot = side > 0 ? Math.PI : 0;
      const b = B(cx, cz);
      const g = Math.min(ground(cx, cz), ground(cx - w / 2, cz), ground(cx + w / 2, cz)) - 0.6;
      const col = [0xe8dcc8, 0xd8c8b0, 0xc8d4dc, 0xf0e4d0, 0xb8a898, 0xe0d0e0][Math.floor(R() * 6)];
      b.box(cx, g, cz, w, h + 0.6, d, rot, { side: 'stucco', top: 'gravel' }, col);
      b.box(cx, g + h + 0.6, cz, w + 0.1, 0.8, d + 0.1, rot, 'stucco', col);
      const f = at(cx, cz, rot, 0, d / 2 + 0.04);
      const y = g + 0.6;
      b.decal('winLit', f.x, y + 1.6, f.z, w - 1.2, 3.2, rot, CELLS.shopfront);
      const sIdx = Math.floor(R() * 12);
      signDecal(b, f.x, y + 4.3, f.z, Math.min(w - 2, 8), 1.4, rot, sIdx);
      // Awning.
      const aw = at(cx, cz, rot, 0, d / 2 + 0.8);
      b.box(aw.x, y + 3.25, aw.z, w - 1, 0.18, 1.6, rot, 'trim', [0xc0302a, 0x2a5aa0, 0x2a8a5a, 0xd09a2a][Math.floor(R() * 4)]);
      if (h > 6) for (let k = -1; k <= 1; k++) { const p = at(cx, cz, rot, k * w * 0.3, d / 2 + 0.04); b.decal(R() < 0.5 ? 'winLit' : 'win', p.x, y + 6.0, p.z, 2.4, 1.6, rot, CELLS.win2); }
      box(cx, cz, w, d, rot);
    }
  };
  const signDecal = (b, x, y, z, w, h, rot, idx) => {
    // Sign sheet: 2 columns of 512 px, 8 rows of 128 px.
    const c = Math.cos(rot), s = Math.sin(rot), rx = c, rz = -s;
    const u0 = (idx % 2) * 0.5, v1 = 1 - Math.floor(idx / 2) * 0.125;
    b.quad('sign', new THREE.Vector3(x - rx * w / 2, y - h / 2, z - rz * w / 2), new THREE.Vector3(x + rx * w / 2, y - h / 2, z + rz * w / 2),
      new THREE.Vector3(x + rx * w / 2, y + h / 2, z + rz * w / 2), new THREE.Vector3(x - rx * w / 2, y + h / 2, z - rz * w / 2),
      [[u0, v1 - 0.125], [u0 + 0.5, v1 - 0.125], [u0 + 0.5, v1], [u0, v1]]);
  };
  for (let i = 0; i < 7; i++) for (const side of [1, -1]) shopRow(BOULEVARD_Z, side, AVES[i] + 16, AVES[i + 1] - 12);
  shopRow(BOULEVARD_Z, 1, -1900, AVES[0] - 12);
  shopRow(BOULEVARD_Z, -1, -1900, AVES[0] - 12);

  // ---------- the car meet: strip mall and lot ----------
  const meet = LOTS.find((l) => l.id === 'meet');
  {
    const b = B((meet.x0 + meet.x1) / 2, (meet.z0 + meet.z1) / 2);
    const y = meet.y + 0.03;
    lotSurface(b, meet, y);
    paved.push(meet);
    // Stall lines: a double row down the middle and a row along the shops.
    const stall = (x, z0, z1) => b.planar('paint', [new THREE.Vector3(x - 0.06, y + 0.01, z1), new THREE.Vector3(x + 0.06, y + 0.01, z1), new THREE.Vector3(x + 0.06, y + 0.01, z0), new THREE.Vector3(x - 0.06, y + 0.01, z0)]);
    for (let x = meet.x0 + 8; x <= meet.x1 - 8; x += 2.8) {
      stall(x, -852, -846.5);
      if (x < meet.x0 + 52 || x > meet.x1 - 52) { stall(x, -896, -890.5); stall(x, -890.5, -885); }
    }
    // Strip mall along the back.
    const mz0 = meet.z1, mz1 = meet.z1 + 20, mw = meet.x1 - meet.x0;
    const cx = (meet.x0 + meet.x1) / 2, cz = (mz0 + mz1) / 2;
    b.box(cx, y - 0.5, cz, mw, 6.5, 20, Math.PI, { side: 'stucco', top: 'gravel' }, 0xeadfcc);
    b.box(cx, y + 6, cz, mw + 0.2, 1.0, 20.2, Math.PI, 'stucco', 0xd4b48a);
    const names = [0, 2, 3, 4, 5, 6, 7, 15];
    names.forEach((sIdx, k) => {
      const sx = meet.x0 + (mw / names.length) * (k + 0.5);
      b.decal('winLit', sx, y + 1.7, mz0 - 0.04, mw / names.length - 2, 3.3, Math.PI, CELLS.shopfront);
      signDecal(b, sx, y + 4.8, mz0 - 0.05, mw / names.length - 4, 1.5, Math.PI, sIdx);
      b.box(sx, y + 3.35, mz0 - 0.9, mw / names.length - 1.2, 0.16, 1.8, Math.PI, 'trim', [0xc0302a, 0x2a5aa0, 0x2a8a5a, 0xd09a2a][k % 4]);
    });
    box(cx, cz, mw, 20, 0);
    for (const [x, z] of [[meet.x0 + 10, -900], [meet.x1 - 10, -900], [meet.x0 + 10, -858], [meet.x1 - 10, -858]]) lamps.push({ x, y: meet.y, z, style: 'lot', nx: 0, nz: -1 });
    // The meet itself: tuner cars nose-in on the stalls.
    const meetCars = ['z33', 's15', 's13', 'v35', 'v37', 'jzx100', 'xe10', 'b8', 'z30', 'kaze', 'ronin', 'z33', 's15', 'v35'];
    const brights = [0xff2a5a, 0x2ad4ff, 0xffd12a, 0x8a3aff, 0xf2f2f2, 0x111111, 0xff7a1a, 0x3aff8a];
    meetCars.forEach((id, k) => {
      const def = CARS.find((c) => c.id === id) || CARS[0];
      const row = k % 2, n = Math.floor(k / 2) * 2 + row, x = n < 8 ? meet.x0 + 9.4 + 2.8 * n * 1.5 : meet.x1 - 9.4 - 2.8 * (n - 8) * 1.5;
      parkCar(x, row ? -893.3 : -887.7, row ? Math.PI : 0, def, brights[k % brights.length]);
    });
  }

  // ---------- gas station ----------
  const gas = LOTS.find((l) => l.id === 'gas');
  {
    const b = B((gas.x0 + gas.x1) / 2, (gas.z0 + gas.z1) / 2);
    const y = gas.y + 0.03;
    lotSurface(b, gas, y);
    paved.push(gas);
    const cx = (gas.x0 + gas.x1) / 2, cz = gas.z1 - 16;
    // Canopy on four columns, lit underneath.
    b.box(cx, y + 5.2, cz, 28, 0.9, 13, 0, { side: 'trim', top: 'metal' }, 0xe8e8ea);
    b.planar('glow', [new THREE.Vector3(cx - 13, y + 5.19, cz + 6), new THREE.Vector3(cx + 13, y + 5.19, cz + 6), new THREE.Vector3(cx + 13, y + 5.19, cz - 6), new THREE.Vector3(cx - 13, y + 5.19, cz - 6)].reverse(), 0xfff6e8);
    b.box(cx, y + 5.0, cz, 28.1, 0.25, 13.1, 0, 'trim', 0xd02020);
    for (const [dx, dz] of [[-11, -4], [11, -4], [-11, 4], [11, 4]]) { b.box(cx + dx, y, cz + dz, 0.5, 5.2, 0.5, 0, 'trim', 0xe0e0e0); circle(cx + dx, cz + dz, 0.4); }
    for (const dx of [-6, 6]) for (const dz of [-1.5, 1.5]) {
      b.box(cx + dx, y, cz + dz, 1.2, 0.2, 3.2, 0, 'concrete', 0xc8c4bc);
      b.box(cx + dx, y + 0.2, cz + dz, 0.6, 1.6, 0.9, 0, 'trim', 0xf0f0f0);
      b.decal('glowAtlas', cx + dx, y + 1.3, cz + dz + 0.46, 0.4, 0.3, 0, CELLS.vending);
      box(cx + dx, cz + dz, 1.2, 3.2, 0, false);
    }
    // Store at the back.
    const sz = gas.z0 + 7;
    b.box(cx, y - 0.4, sz, 22, 4.6, 12, 0, { side: 'stucco', top: 'gravel' }, 0xf0f0ec);
    b.decal('winLit', cx, y + 1.5, sz + 6.04, 16, 2.8, 0, CELLS.shopfront);
    signDecal(b, cx, y + 3.4, sz + 6.05, 8, 1.2, 0, 9);
    box(cx, sz, 22, 12, 0);
    // Price pylon.
    const px = gas.x1 - 3, pz = gas.z1 - 2;
    b.box(px, y, pz, 0.6, 6, 0.6, 0, 'metal', 0x606064);
    b.box(px, y + 6, pz, 3.2, 3, 0.5, 0, 'trim', 0xd02020);
    signDecal(b, px, y + 7.5, pz + 0.27, 2.8, 1.4, 0, 9);
    circle(px, pz, 0.5);
    parkCar(cx - 6, cz - 3.6, Math.PI / 2);
  }

  // ---------- donut stand with the giant donut ----------
  {
    const cx = -836, cz = -918;
    const b = B(cx, cz);
    const g = ground(cx, cz);
    b.box(cx, g - 0.3, cz, 14, 4.2, 10, Math.PI, { side: 'stucco', top: 'gravel' }, 0xfff4e4);
    b.decal('winLit', cx, g + 1.4, cz - 5.04, 12, 2.6, Math.PI, CELLS.shopfront);
    signDecal(b, cx, g + 3.3, cz - 5.05, 8, 1.2, Math.PI, 1);
    box(cx, cz, 14, 10, 0);
    const donut = new THREE.Mesh(new THREE.TorusGeometry(3.4, 1.4, 14, 32), new THREE.MeshStandardMaterial({ color: 0xc88a4a, roughness: 0.7 }));
    donut.position.set(cx, g + 8.6, cz);
    const icing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 1.42, 14, 32, Math.PI * 2), new THREE.MeshStandardMaterial({ color: 0xff7ab0, roughness: 0.5, emissive: 0xff3a8a, emissiveIntensity: 0 }));
    icing.scale.set(1, 1, 0.55);
    icing.position.set(cx, g + 8.6, cz + 0.6);
    group.add(donut, icing);
    mats.icing = icing.material;
  }

  // ---------- downtown ----------
  for (const [z0, z1] of [[-768, -632], [-608, -472]]) for (const [x0, x1] of [[-848, -712], [-1008, -872]]) {
    for (const fx of [0.27, 0.73]) for (const fz of [0.27, 0.73]) {
      if (R() < 0.15) continue;
      const cx = x0 + (x1 - x0) * fx, cz = z0 + (z1 - z0) * fz;
      const w = 30 + R() * 18, d = 30 + R() * 18;
      const h = (x0 > -900 ? 45 : 22) + R() * (x0 > -900 ? 70 : 30);
      const b = B(cx, cz);
      const g = ground(cx, cz) - 0.5;
      b.box(cx, g, cz, w, h, d, 0, { side: 'tower', top: 'gravel' }, [0xffffff, 0xd8e4f0, 0xf0e8d8][Math.floor(R() * 3)], [12, 38]);
      b.box(cx, g + h, cz, w * 0.4, 4, d * 0.4, 0, { side: 'metal', top: 'gravel' }, 0x8a8c90);
      b.box(cx + w * 0.15, g + h + 4, cz, 0.3, 6, 0.3, 0, 'metal', 0x8a8c90);
      b.box(cx + w * 0.15, g + h + 10, cz, 0.6, 0.6, 0.6, 0, 'glow', 0xff2020);
      // Ground floor lobby.
      for (const [face, rot] of [[d / 2 + 0.05, 0], [-d / 2 - 0.05, Math.PI]]) b.decal('winLit', cx, g + 2.4, cz + face, w * 0.8, 3.2, rot, CELLS.shopfront);
      box(cx, cz, w, d, 0);
    }
  }

  // ---------- beach ----------
  for (let x = -1880; x < 200; x += 260) {
    let z = -1650;
    while (z > -1700 && ground(x, z) > 1.2) z -= 2;
    z += 10;
    const b = B(x, z);
    const g = ground(x, z);
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) b.box(x + dx, g - 0.3, z + dz, 0.2, 2.6, 0.2, 0, 'trim', 0xe8e8e8);
    b.box(x, g + 2.3, z, 3.2, 2.4, 3.2, 0, 'siding', [0x5ab0e0, 0xf0e8d8, 0xe85a5a][Math.floor(R() * 3)]);
    b.roof('shingle', x, g + 4.7, z, 3.2, 3.2, 0, 0.8, 0.3, 'hip', 0xffffff);
    b.box(x, g + 1.0, z - 2.6, 1.0, 0.12, 2.6, 0, 'trim', 0xe8e8e8);
    box(x, z, 3.2, 3.2, 0, false);
  }

  // ---------- the sign on the hill ----------
  {
    const text = 'VISTA DEL MAR';
    const cv = document.createElement('canvas');
    cv.width = 2048; cv.height = 256;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 2048, 256);
    g.fillStyle = '#ffffff';
    g.font = 'bold 230px "Arial Black", Impact, sans-serif';
    g.textBaseline = 'middle';
    const letters = [...text];
    const step = 2048 / letters.length;
    letters.forEach((ch, i) => { g.textAlign = 'center'; g.fillText(ch, step * (i + 0.5), 136); });
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    mats.letters = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0 });
    const b = B(-1250, 100);
    letters.forEach((ch, i) => {
      if (ch === ' ') return;
      const x = -1080 - i * 30; // facing north from town, +x is on the viewer's left
      let z = -20;
      while (z < 280 && ground(x, z) < 62) z += 3;
      const y = ground(x, z);
      const u0 = i / letters.length, u1 = (i + 1) / letters.length;
      b.quad('letters', new THREE.Vector3(x + 12, y - 1, z), new THREE.Vector3(x - 12, y - 1, z), new THREE.Vector3(x - 12, y + 16, z), new THREE.Vector3(x + 12, y + 16, z), [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
      for (const dx of [-5, 0, 5]) b.box(x + dx, y - 1, z + 1.2, 0.25, 12, 0.25, 0, 'metal', 0x606060);
    });
  }

  // ---------- Sakura Village ----------
  const vmain = net.byId.vmain, vside = net.byId.vside, touge = net.byId.touge;
  const machiya = (cx, cz, rot, w, d, shop) => {
    const b = B(cx, cz);
    const g = Math.min(ground(cx, cz), ...[[-w / 2, d / 2], [w / 2, d / 2]].map(([x, z]) => { const p = at(cx, cz, rot, x, z); return ground(p.x, p.z); })) - 0.3;
    const wood = [0x8a6a50, 0x7a5a42, 0x9a7a5a, 0x6a4c36][Math.floor(R() * 4)];
    b.box(cx, g, cz, w, 3.2, d, rot, 'boards', wood);
    b.box(cx, g + 3.2, cz, w, 2.8, d, rot, { side: R() < 0.5 ? 'stucco' : 'boards' }, R() < 0.5 ? 0xf0ece0 : wood);
    // Pent roof between floors on the street side, and the main gable roof.
    const pf = at(cx, cz, rot, 0, d / 2 + 0.6);
    b.box(pf.x, g + 3.0, pf.z, w + 0.2, 0.25, 1.4, rot, { side: 'trim', top: 'kawara' }, 0x2a2e34);
    b.gableMat = 'boards';
    b.roof('kawara', cx, g + 6.0, cz, w, d, rot, 2.2, 0.7, 'gable', 0xffffff);
    const f = at(cx, cz, rot, 0, d / 2 + 0.04);
    if (shop) {
      b.decal('winLit', f.x, g + 1.45, f.z, w - 1.6, 2.6, rot, CELLS.slide);
      const n = at(cx, cz, rot, 0, d / 2 + 0.25);
      b.decal('win', n.x, g + 2.35, n.z, Math.min(3.2, w - 2), 1.1, rot, CELLS.noren);
      for (const s of [-1, 1]) {
        const l = at(cx, cz, rot, s * (w / 2 - 0.8), d / 2 + 0.45);
        lanternAt(b, l.x, g + 2.3, l.z, rot);
      }
      signDecal(b, f.x, g + 4.6, at(cx, cz, rot, 0, d / 2 + 0.06).z, Math.min(w - 2, 5), 1.0, rot, 12 + Math.floor(R() * 3));
    } else {
      b.decal(R() < 0.5 ? 'winLit' : 'win', f.x, g + 1.45, f.z, w - 2, 2.4, rot, CELLS.slide);
    }
    for (let k = -1; k <= 1; k += 2) { const p = at(cx, cz, rot, k * w * 0.25, d / 2 + 0.04); b.decal(R() < 0.6 ? 'winLit' : 'win', p.x, g + 4.6, p.z, w * 0.35, 1.6, rot, CELLS.shoji); }
    box(cx, cz, w, d, rot);
  };
  const lanternAt = (b, x, y, z, rot) => {
    // Two crossed cards make a round-looking paper lantern.
    for (const r of [rot, rot + Math.PI / 2]) b.decal('glowAtlas', x, y, z, 0.55, 0.75, r, CELLS.lantern);
    for (const r of [rot + Math.PI, rot - Math.PI / 2]) b.decal('glowAtlas', x, y, z, 0.55, 0.75, r, CELLS.lantern);
  };
  const villageRow = (road, side) => {
    for (let s = 14; s < road.length - 12; ) {
      const w = 7.5 + R() * 3.5, d = 10 + R() * 2;
      const p = road.samples[Math.min(road.samples.length - 1, Math.round((s + w / 2) / 3))];
      s += w + 0.6;
      const off = road.hw + road.gutter + 1.3 + d / 2;
      const cx = p.x - p.tz * off * side, cz = p.z + p.tx * off * side;
      // Front faces the road.
      const rot = Math.atan2(p.tz * side, -p.tx * side);
      const fr = at(cx, cz, rot, 0, d / 2), bk = at(cx, cz, rot, 0, -d / 2);
      if (!clearOfRoads(cx, cz, 0.6) || !clearOfRoads(fr.x, fr.z, 0.3) || !clearOfRoads(bk.x, bk.z, 0.6)) continue;
      machiya(cx, cz, rot, w, d, R() < 0.45);
      if (R() < 0.18) {
        const vm = at(cx, cz, rot, w / 2 + 0.7, d / 2 - 0.2);
        const bb = B(vm.x, vm.z);
        const gg = ground(vm.x, vm.z);
        bb.box(vm.x, gg, vm.z, 1.0, 1.85, 0.8, rot, 'trim', 0xe8eef4);
        const fv = at(vm.x, vm.z, rot, 0, 0.41);
        bb.decal('glowAtlas', fv.x, gg + 0.95, fv.z, 0.95, 1.8, rot, CELLS.vending);
        box(vm.x, vm.z, 1.0, 0.8, rot, false);
      }
    }
  };
  for (const side of [1, -1]) { villageRow(vmain, side); villageRow(vside, side); }
  // Utility poles with sagging wires along the village streets.
  const wires = [];
  for (const road of [vmain, vside]) for (const side of [1, -1]) {
    let prev = null;
    for (let s = 6; s < road.length; s += 28) {
      const p = road.samples[Math.min(road.samples.length - 1, Math.round(s / 3))];
      const off = road.hw + road.gutter + 0.55;
      const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
      roadQuery(net, x, z, q);
      if (q.road && q.road !== road && q.d < q.road.hw + 1.5) { prev = null; continue; }
      const b = B(x, z);
      const g = ground(x, z);
      b.box(x, g, z, 0.32, 9.5, 0.32, 0, 'concrete', 0x9a9890);
      const arm = Math.atan2(p.tz, -p.tx);
      b.box(x, g + 8.6, z, 1.8, 0.14, 0.14, arm, 'metal', 0x3a3a3a);
      if (R() < 0.3) b.box(x + 0.35, g + 6.8, z, 0.5, 0.8, 0.5, 0, 'metal', 0x6a6c70);
      circle(x, z, 0.25);
      const top = [-0.8, 0, 0.8].map((o) => new THREE.Vector3(x + Math.cos(arm) * o, g + 8.7, z - Math.sin(arm) * o));
      if (prev) for (let k = 0; k < 3; k++) {
        const a = prev[k], c = top[k];
        for (let t = 0; t < 8; t++) {
          const f0 = t / 8, f1 = (t + 1) / 8;
          const s0 = 4 * f0 * (1 - f0) * 0.6, s1 = 4 * f1 * (1 - f1) * 0.6;
          wires.push(a.x + (c.x - a.x) * f0, a.y + (c.y - a.y) * f0 - s0, a.z + (c.z - a.z) * f0, a.x + (c.x - a.x) * f1, a.y + (c.y - a.y) * f1 - s1, a.z + (c.z - a.z) * f1);
        }
      }
      prev = top;
    }
  }
  if (wires.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    group.add(new THREE.LineSegments(wg, mats.wire));
  }
  // Village street lanterns hung between houses at dusk come from lamps.js ('lantern' style).
  // Torii over the road at the start of the touge.
  {
    const p = touge.samples[Math.round(60 / 3)];
    const nx = -p.tz, nz = p.tx;
    const half = touge.hw + touge.gutter + 1.3;
    const b = B(p.x, p.z);
    const red = 0xc8301e;
    const y = p.y;
    const legs = [-1, 1].map((s) => ({ x: p.x + nx * half * s, z: p.z + nz * half * s }));
    for (const l of legs) {
      b.box(l.x, ground(l.x, l.z) - 0.5, l.z, 0.7, 8.6, 0.7, 0, 'trim', red);
      b.box(l.x, ground(l.x, l.z) - 0.5, l.z, 1.0, 0.9, 1.0, 0, 'trim', 0x1a1a1a);
      circle(l.x, l.z, 0.5);
    }
    const rot = Math.atan2(-p.tx, -p.tz);
    b.box(p.x, y + 6.3, p.z, half * 2 + 1.2, 0.5, 0.5, rot, 'trim', red);
    b.box(p.x, y + 7.6, p.z, half * 2 + 3.4, 0.5, 0.8, rot, 'trim', red);
    b.box(p.x, y + 8.1, p.z, half * 2 + 4.0, 0.35, 1.0, rot, 'trim', 0x1a1a1a);
    b.box(p.x, y + 6.8, p.z, 0.5, 0.8, 0.5, rot, 'trim', red);
    // Stone lanterns either side.
    for (const s of [-1, 1]) {
      const sx = p.x + nx * (half + 2.2) * s + p.tx * 4, sz = p.z + nz * (half + 2.2) * s + p.tz * 4;
      const g = ground(sx, sz);
      b.box(sx, g, sz, 0.6, 1.2, 0.6, 0, 'concrete', 0x9a988e);
      b.box(sx, g + 1.2, sz, 0.8, 0.6, 0.8, 0, 'concrete', 0x9a988e);
      b.box(sx, g + 1.35, sz, 0.5, 0.3, 0.5, 0, 'glow', 0xffc070);
      b.roof('concrete', sx, g + 1.8, sz, 0.8, 0.8, 0, 0.35, 0.25, 'hip', 0x9a988e);
      circle(sx, sz, 0.45);
    }
    for (let k = 0; k < 6; k++) sakuraSpots.push({ x: p.x + nx * (half + 5 + k * 1.5) * (k % 2 ? 1 : -1) - p.tx * (k * 3), z: p.z + nz * (half + 5 + k * 1.5) * (k % 2 ? 1 : -1) - p.tz * (k * 3), s: 1 });
  }
  // Pagoda on the hillside above the village, with a little hall.
  {
    const cx = 1352, cz = 742;
    const b = B(cx, cz);
    const g = ground(cx, cz) - 0.4;
    let y = g, size = 8;
    b.box(cx, g - 0.6, cz, 11, 1.4, 11, 0, 'concrete', 0x8a887e);
    // The downloaded pagoda goes on the plinth when it loaded (decor.js); otherwise build one.
    if (assets.has('pagoda')) pagodaSpot = { x: cx, z: cz, y: g + 0.1 };
    else for (let tier = 0; tier < 5; tier++) {
      const h = tier === 0 ? 3.6 : 2.6;
      b.box(cx, y + 0.8, cz, size, h, size, 0, 'boards', 0xb03a22);
      b.decal('win', cx, y + 0.8 + h / 2, cz + size / 2 + 0.03, size * 0.4, h * 0.6, 0, CELLS.slide);
      y += 0.8 + h;
      b.roof('kawara', cx, y, cz, size, size, 0, 1.0, 1.6, 'hip', 0xffffff);
      y += 0.4;
      size *= 0.84;
    }
    if (!pagodaSpot) b.box(cx, y + 0.6, cz, 0.3, 7, 0.3, 0, 'metal', 0x9a7a3a);
    if (!pagodaSpot) for (let k = 0; k < 7; k++) b.box(cx, y + 1.6 + k * 0.7, cz, 0.9 - k * 0.07, 0.12, 0.9 - k * 0.07, 0, 'metal', 0xb08a3a);
    box(cx, cz, 11, 11, 0);
    // Hall.
    const hx = cx - 24, hz = cz + 4;
    const hg = ground(hx, hz) - 0.3;
    b.box(hx, hg - 0.8, hz, 14, 1.6, 10, 0, 'concrete', 0x8a887e);
    b.box(hx, hg + 0.8, hz, 12, 4, 8, 0, 'boards', 0x9a7a5a);
    for (const dx of [-5.5, -2, 2, 5.5]) b.box(hx + dx, hg + 0.8, hz + 4.4, 0.4, 4, 0.4, 0, 'trim', 0xc8301e);
    b.gableMat = 'boards';
    b.roof('kawara', hx, hg + 4.8, hz, 12, 8, 0, 3.2, 2.0, 'gable', 0xffffff);
    b.decal('winLit', hx, hg + 2.4, hz + 4.04, 8, 3, 0, CELLS.shoji);
    box(hx, hz, 14, 10, 0);
    toriiSpot = { x: hx, z: hz + 13, rot: 0 };
    for (let k = 0; k < 8; k++) sakuraSpots.push({ x: cx - 30 + R() * 50, z: cz - 14 + R() * 30, s: 0.9 + R() * 0.3 });
  }

  // ---------- summit lookout ----------
  const summit = LOTS.find((l) => l.id === 'summit');
  {
    const b = B(summit.x, summit.z);
    const y = summit.y + 0.03;
    lotSurface(b, summit, y);
    paved.push(summit);
    // Railing around the rim, leaving the road openings.
    const N = 64;
    let run = [];
    const flushRail = () => {
      if (run.length > 1) for (let k = 0; k < run.length - 1; k++) {
        const a = run[k], c = run[k + 1];
        rail(b, a, c, y);
        colliders.push({ type: 'seg', ax: a.x, az: a.z, bx: c.x, bz: c.z, thick: 0.12 });
      }
      run = [];
    };
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2;
      const x = summit.x + Math.cos(a) * (summit.r - 1.5), z = summit.z + Math.sin(a) * (summit.r - 1.5);
      roadQuery(net, x, z, q);
      if (q.road && q.d < q.road.hw + 5) { flushRail(); continue; }
      run.push({ x, z });
    }
    flushRail();
    // Rest house with vending machines, benches, coin binoculars.
    const hx = summit.x + 4, hz = summit.z - 30;
    b.box(hx, y - 0.2, hz, 12, 3.4, 6, 0, { side: 'stucco', top: 'gravel' }, 0xe8e4dc);
    b.box(hx, y + 3.2, hz, 13, 0.3, 7.2, 0, 'trim', 0x3a3a3e);
    for (let k = 0; k < 4; k++) {
      const vx = hx - 4.5 + k * 1.15;
      b.box(vx, y, hz + 3.4, 1.0, 1.85, 0.8, 0, 'trim', k % 2 ? 0xd8202a : 0xe8eef4);
      b.decal('glowAtlas', vx, y + 0.95, hz + 3.81, 0.95, 1.8, 0, CELLS.vending);
    }
    b.decal('winLit', hx + 3, y + 1.4, hz + 3.04, 4, 2.4, 0, CELLS.shopfront);
    box(hx, hz, 12, 7, 0);
    for (const [bx, bz, r] of [[summit.x - 20, summit.z + 34, 0], [summit.x + 24, summit.z + 30, 0.6], [summit.x - 34, summit.z - 14, -1.2]]) {
      b.box(bx, y, bz, 2.2, 0.45, 0.6, r, 'boards', 0x8a6a4a);
      b.box(bx, y + 0.45, bz, 2.2, 0.08, 0.5, r, 'boards', 0x8a6a4a);
    }
    for (const a of [0.9, 2.3, 4.2]) {
      const bx = summit.x + Math.cos(a) * (summit.r - 4), bz = summit.z + Math.sin(a) * (summit.r - 4);
      b.box(bx, y, bz, 0.15, 1.2, 0.15, 0, 'metal', 0x4a6a8a);
      b.box(bx, y + 1.2, bz, 0.5, 0.35, 0.7, a, 'metal', 0x4a6a8a);
    }
    // Late-night regulars.
    const jdm = ['s13', 's15', 'jzx100', 'kaze', 'z33', 'xe10', 'z30'];
    jdm.forEach((id, k) => {
      const a = -0.6 + k * 0.32;
      const px = summit.x + Math.cos(a) * (summit.r - 9), pz = summit.z + Math.sin(a) * (summit.r - 9);
      parkCar(px, pz, Math.atan2(summit.x - px, summit.z - pz), CARS.find((c) => c.id === id));
    });
    for (let k = 0; k < 6; k++) { const a = k * 1.05 + 0.3; sakuraSpots.push({ x: summit.x + Math.cos(a) * (summit.r + 6), z: summit.z + Math.sin(a) * (summit.r + 6), s: 1.1 }); }
    for (const a of [0.4, 2.0, 3.6, 5.2]) lamps.push({ x: summit.x + Math.cos(a) * (summit.r - 3), y: summit.y, z: summit.z + Math.sin(a) * (summit.r - 3), style: 'lot', nx: -Math.cos(a), nz: -Math.sin(a) });
  }
  // Hairpin lookout.
  const look = LOTS.find((l) => l.id === 'lookout');
  {
    const b = B((look.x0 + look.x1) / 2, (look.z0 + look.z1) / 2);
    const y = look.y + 0.03;
    lotSurface(b, look, y);
    paved.push(look);
    const pts = [{ x: look.x0 + 1, z: look.z1 - 1 }, { x: look.x0 + 1, z: look.z0 + 1 }, { x: look.x1 - 6, z: look.z0 + 1 }];
    for (let k = 0; k < pts.length - 1; k++) { rail(b, pts[k], pts[k + 1], y); colliders.push({ type: 'seg', ax: pts[k].x, az: pts[k].z, bx: pts[k + 1].x, bz: pts[k + 1].z, thick: 0.12 }); }
    b.box(look.x0 + 6, y, look.z0 + 6, 2.2, 0.45, 0.6, 0.8, 'boards', 0x8a6a4a);
    sakuraSpots.push({ x: look.x0 + 4, z: look.z1 - 6, s: 1.2 });
    lamps.push({ x: look.x1 - 4, y: look.y, z: look.z0 + 3, style: 'lot', nx: 0, nz: 1 });
  }

  // ---------- parked cars, merged ----------
  const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.32 });
  const aoMat = new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const carLights = new THREE.MeshBasicMaterial({ vertexColors: true });
  const byArea = new Map();
  for (const c of parked) {
    const k = `${Math.floor((c.x + HALF) / AREA)},${Math.floor((c.z + HALF) / AREA)}`;
    (byArea.get(k) || byArea.set(k, []).get(k)).push(c);
  }
  const m4 = new THREE.Matrix4();
  const parkedMeshes = [];
  for (const [k, list] of byArea) {
    const bodies = [];
    for (const c of list) {
      const geo = carLowGeometry(c.look, c.paint);
      m4.makeRotationY(c.rot).setPosition(c.x, c.y + 0.02, c.z);
      bodies.push(geo.body.clone().applyMatrix4(m4));
    }
    const mesh = new THREE.Mesh(mergeGeometries(bodies), carMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Contact shadows under the parked cars, merged too.
    const blobs = list.map((c) => new THREE.PlaneGeometry(2.3, 5.1).rotateX(-Math.PI / 2).rotateY(c.rot).translate(c.x, c.y + 0.05, c.z));
    const ao = new THREE.Mesh(mergeGeometries(blobs), aoMat);
    ao.renderOrder = 1;
    mesh.add(ao);
    const [ax, az] = k.split(',').map(Number);
    parkedMeshes.push({ mesh, x: -HALF + (ax + 0.5) * AREA, z: -HALF + (az + 0.5) * AREA });
  }
  void carLights;

  // ---------- build ----------
  // One group per area so whole neighbourhoods drop out of the draw list past the fog.
  const areas = [];
  for (const [k, b] of builders) {
    const [ax, az] = k.split(',').map(Number);
    const g = new THREE.Group(), detail = new THREE.Group();
    const meshes = b.build(mats, g);
    const small = new Set([mats.win, mats.trim, mats.metal, mats.hedge, mats.paint, mats.glowAtlas]);
    for (const m of meshes) {
      if (m.material === mats.glow || m.material.isMeshBasicMaterial) { m.castShadow = false; m.receiveShadow = false; }
      if (small.has(m.material)) { m.castShadow = false; detail.add(m); }
    }
    group.add(g, detail);
    const cx = -HALF + (ax + 0.5) * AREA, cz = -HALF + (az + 0.5) * AREA;
    areas.push({ g, x: cx, z: cz });
    areas.push({ g: detail, x: cx, z: cz, detail: true });
  }
  for (const pc of parkedMeshes) {
    const g = new THREE.Group();
    g.add(pc.mesh);
    group.add(g);
    areas.push({ g, x: pc.x, z: pc.z, cars: true });
  }
  const cullDist = Math.min(preset.far * 0.9, 1900);

  const spawn = { x: (meet.x0 + meet.x1) / 2, z: -872, heading: Math.PI };
  return {
    group,
    colliders,
    bins,
    yardTrees,
    sakuraSpots,
    mailboxes,
    toriiSpot,
    pagodaSpot,
    lamps,
    paved,
    spawn,
    setNight(n) {
      mats.winLit.emissiveIntensity = n * 0.45;
      mats.tower.emissiveIntensity = n * 0.45;
      mats.sign.emissiveIntensity = 0.2 + n * 1.1;
      mats.glowAtlas.emissiveIntensity = 0.35 + n * 0.7;
      if (mats.letters) mats.letters.emissiveIntensity = n * 0.3;
      if (mats.icing) mats.icing.emissiveIntensity = n * 0.3;
      mats.glow.color.setScalar(0.3 + n * 1.3);
    },
    update(t, cam) {
      for (const a of areas) {
        const d = Math.hypot(a.x - cam.x, a.z - cam.z);
        a.g.visible = d < (a.cars ? 650 : a.detail ? 750 : cullDist);
      }
    },
  };

  // Asphalt over a lot, following its outline.
  function lotSurface(b, lot, y) {
    if (lot.shape === 'circle') {
      const N = 40;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
        b.planar('lot', [new THREE.Vector3(lot.x, y, lot.z), new THREE.Vector3(lot.x + Math.cos(a1) * lot.r, y, lot.z + Math.sin(a1) * lot.r), new THREE.Vector3(lot.x + Math.cos(a0) * lot.r, y, lot.z + Math.sin(a0) * lot.r)], 0xffffff, 6);
      }
    } else {
      b.planar('lot', [new THREE.Vector3(lot.x0, y, lot.z1), new THREE.Vector3(lot.x1, y, lot.z1), new THREE.Vector3(lot.x1, y, lot.z0), new THREE.Vector3(lot.x0, y, lot.z0)], 0xffffff, 6);
    }
  }
  // A two-rail metal fence between two points.
  function rail(b, a, c, y) {
    const len = Math.hypot(c.x - a.x, c.z - a.z), rot = Math.atan2(-(c.z - a.z), c.x - a.x);
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
    b.box(mx, y + 0.95, mz, len, 0.08, 0.08, rot, 'metal', 0xb8bcc0);
    b.box(mx, y + 0.5, mz, len, 0.06, 0.06, rot, 'metal', 0xb8bcc0);
    b.box(a.x, y, a.z, 0.08, 1.0, 0.08, 0, 'metal', 0x9a9ea2);
  }
}
void clamp;
void SIGNS;
