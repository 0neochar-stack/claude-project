// Places the street furniture, facade details and rooftop set pieces from props.js around the city.
// Sidewalk props are reserved on a per-edge occupancy line so nothing overlaps; everything is static-batched.
import * as THREE from 'three';
import { BLOCKS, ROADS, HALF, CURB, PLAZA_AREA } from './world.js';
import { buildModels, Batcher, propMaterials } from './props.js';

const SIDEWALK = 4.5;
const FACE_N = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };

// Intervals already taken along a line, per zone.
class Line {
  constructor() { this.zones = new Map(); }
  free(zone, t, half) {
    const list = this.zones.get(zone) || [];
    return !list.some(([a, b]) => t + half > a && t - half < b);
  }
  take(zone, t, half) {
    if (!this.free(zone, t, half)) return false;
    if (!this.zones.has(zone)) this.zones.set(zone, []);
    this.zones.get(zone).push([t - half, t + half]);
    return true;
  }
}

export function buildCityProps(group, plan, rand, glowAtlas, propAtlas) {
  const range = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const chance = (p) => rand() < p;
  const M = buildModels(glowAtlas, propAtlas);
  const B = new Batcher();
  const tint = (h, s, l) => new THREE.Color().setHSL(h, s, l);
  const placed = new Map();
  const put = (name, model, x, y, z, ry = 0, scale = 1, t = null) => {
    B.add(model, x, y, z, ry, scale, t);
    placed.set(name, (placed.get(name) || 0) + 1);
  };
  const steam = [];
  const inLot = (x, z, m = 0) => x > PLAZA_AREA.x0 - m && x < PLAZA_AREA.x1 + m && z > PLAZA_AREA.z0 - m && z < PLAZA_AREA.z1 + m;

  // ---------- block edges: the curb side of every sidewalk ----------
  const edges = [];
  for (const b of BLOCKS) {
    if (b.plaza) continue;
    for (const f of ['s', 'n', 'w', 'e']) {
      const [nx, nz] = FACE_N[f];
      const alongX = nz !== 0;
      const lo = alongX ? b.x0 : b.z0, hi = alongX ? b.x1 : b.z1;
      const c = nx ? (nx > 0 ? b.x1 : b.x0) : (nz > 0 ? b.z1 : b.z0);
      // The road on the far side of this curb.
      const road = ROADS.find((r) => Math.abs((nx + nz > 0 ? r.lo : r.hi) - c) < 0.5);
      if (!road) continue;
      const across = alongX ? (nz > 0 ? 1 : -1) : (nx > 0 ? 1 : -1);
      const facingLot = alongX ? inLot((lo + hi) / 2, c + nz * road.w / 2) : inLot(c + nx * road.w / 2, (lo + hi) / 2);
      edges.push({ b, f, nx, nz, alongX, lo, hi, c, road, across, line: new Line(), avenue: road.w >= 22, facingLot });
    }
  }
  // World position at distance t along the edge and d in from the curb; ry turns a model's +z toward the road.
  const at = (e, t, d) => (e.alongX ? [t, e.c - e.nz * d] : [e.c - e.nx * d, t]);
  const faceRoad = (e) => Math.atan2(e.nx, e.nz);
  const alongRoad = (e, s = 1) => (e.alongX ? Math.atan2(s, 0) : Math.atan2(0, s));

  for (const e of edges) {
    const { lo, hi, line } = e;
    const mid = (lo + hi) / 2;
    // Existing lamps and utility poles already stand at these spots on the curb line.
    for (const t of [lo + 12, mid, hi - 12]) line.take('curb', t, 0.9);
    if (!e.avenue) for (const t of [lo + 5, lo + 29, lo + 53]) line.take('curb', t, 0.7);
    line.take('curb', lo + 2.5, 2.5);
    line.take('curb', hi - 2.5, 2.5);

    // Bus stop on some avenue edges: shelter set back, pole at the curb, guard rail breaks here.
    let bus = null;
    if (e.avenue && chance(0.45)) {
      const t = mid + range(-14, 14);
      if (line.take('mid', t, 2.2) && line.take('curb', t + 2.7, 0.5)) {
        bus = t;
        const [x, z] = at(e, t, 2.3);
        put('bus shelter', M[`busShelter${Math.floor(rand() * 8)}`], x, CURB, z, faceRoad(e));
        const [px, pz] = at(e, t + 2.7, 0.6);
        put('bus stop pole', M.busPole, px, CURB, pz, faceRoad(e) + Math.PI / 2);
        const [bx, bz] = at(e, t - 3.4, 2.4);
        if (line.take('mid', t - 3.4, 0.6)) put('recycling bins', M.recycling, bx, CURB, bz, faceRoad(e), 0.8);
      }
    }
    // Guard rails along some avenues, broken at the bus stop.
    if (e.avenue && chance(0.4)) {
      for (let t = lo + 6; t < hi - 6; t += 2) {
        if (bus !== null && Math.abs(t - bus) < 4) continue;
        const [x, z] = at(e, t + 1, 0.3);
        put('guard rail', M.guardRail, x, CURB, z, e.alongX ? 0 : Math.PI / 2);
      }
    }
    // Trees along avenues, some strung with lights.
    if (e.avenue && !e.facingLot) {
      for (let t = lo + 7; t < hi - 6; t += range(9, 13)) {
        if (!line.take('curb', t, 1.2)) continue;
        const [x, z] = at(e, t, 1.1);
        put('street tree', chance(0.3) ? M.treeLit : M.tree, x, CURB, z, rand() * 6, range(0.85, 1.15), tint(0.33, 0.25, range(0.3, 0.55)));
      }
    }
    // Road signs facing the traffic.
    const signs = e.avenue ? ['signSpeed', 'signNoParking', 'signCrossing'] : ['signSpeed', 'signNoParking', 'signCrossing', 'signStop'];
    for (let k = 0; k < (chance(0.5) ? 2 : 1); k++) {
      const name = pick(signs);
      const t = name === 'signCrossing' || name === 'signStop' ? (chance(0.5) ? lo + 6 : hi - 6) : range(lo + 7, hi - 7);
      if (!line.take('curb', t, 0.4)) continue;
      const [x, z] = at(e, t, 0.55);
      // Face oncoming traffic: on the right-hand curb of the road (driving on the left), traffic comes toward -t.
      put('road sign', M[name], x, CURB, z, alongRoad(e, t < mid ? -1 : 1));
    }
    if (chance(0.45)) {
      const t = range(lo + 7, hi - 7);
      if (line.take('curb', t, 0.4)) { const [x, z] = at(e, t, 0.6); put('fire hydrant', M.hydrant, x, CURB, z, rand() * 6); }
    }
    if (e.avenue && chance(0.35)) {
      const t0 = range(lo + 10, hi - 26);
      for (let k = 0; k < 3; k++) {
        if (!line.take('curb', t0 + k * 6, 0.3)) continue;
        const [x, z] = at(e, t0 + k * 6, 0.5);
        put('parking meter', M.meter, x, CURB, z, faceRoad(e));
      }
    }
    if (!e.avenue && chance(0.55)) {
      const t = chance(0.5) ? lo + 5.5 : hi - 5.5;
      if (line.take('curb', t, 0.5)) { const [x, z] = at(e, t, 0.5); put('traffic mirror', M.trafficMirror, x, CURB, z, alongRoad(e, t < mid ? 1 : -1) + 0.5); }
    }
    if (chance(0.45)) {
      const t = chance(0.5) ? lo + 6.5 : hi - 6.5;
      if (line.take('curb', t, 0.5)) { const [x, z] = at(e, t, 0.6); put('street name sign', M[`streetName${Math.floor(rand() * 4)}`], x, CURB, z, faceRoad(e) + Math.PI / 2); }
    }
    if (!e.avenue && chance(0.35)) {
      const t = range(lo + 9, hi - 12);
      if (line.take('curb', t + 1, 1.8)) {
        const [x, z] = at(e, t, 1.6);
        put('bike rack', M.bikeRack, x, CURB, z, e.alongX ? Math.PI / 2 : 0);
        for (let k = 0; k < 4; k++) {
          if (chance(0.25)) continue;
          const [bx, bz] = at(e, t + k * 0.7, 1.6);
          put('bicycle', M[`bicycle${Math.floor(rand() * 4)}`], bx, CURB, bz, faceRoad(e) + Math.PI / 2 + range(-0.08, 0.08));
        }
      }
    }
    // Middle of the pavement: ad lightboxes, benches, phone booths, cabinets, food stalls.
    if (e.avenue && chance(0.45)) {
      const t = range(lo + 8, hi - 8);
      if (line.take('mid', t, 0.8)) { const [x, z] = at(e, t, 1.9); put('ad lightbox', M[`adBox${Math.floor(rand() * 8)}`], x, CURB, z, alongRoad(e)); }
    }
    if (chance(0.3)) {
      const t = range(lo + 8, hi - 8);
      if (line.take('mid', t, 1.1)) { const [x, z] = at(e, t, 2.0); put('bench', M.bench, x, CURB, z, faceRoad(e)); }
    }
    if (chance(0.15)) {
      const t = range(lo + 8, hi - 8);
      if (line.take('mid', t, 0.6)) { const [x, z] = at(e, t, 2.0); put('phone booth', M.phoneBooth, x, CURB, z, faceRoad(e)); }
    }
    if (chance(0.4)) {
      const t = range(lo + 8, hi - 8);
      if (line.take('mid', t, 0.6)) { const [x, z] = at(e, t, 1.8); put('electrical cabinet', M.cabinet, x, CURB, z, faceRoad(e)); }
    }
    if (!e.avenue && chance(0.16)) {
      const t = range(lo + 10, hi - 10);
      if (line.take('mid', t, 1.6)) { const [x, z] = at(e, t, 2.4); put('yatai food stall', M.yatai, x, CURB, z, faceRoad(e)); steam.push({ x, z }); }
    }
    // Storm drains on the road along the curb.
    for (let t = lo + 8; t < hi - 8; t += range(12, 20)) {
      const [x, z] = at(e, t, -0.3);
      put('storm drain', M.drain, x, 0, z, e.alongX ? 0 : Math.PI / 2);
    }
  }

  // ---------- building faces: shopfronts at street level, details up the walls ----------
  const cityB = plan.filter((b) => !b.tier && Math.abs((b.x0 + b.x1) / 2) < HALF && Math.abs((b.z0 + b.z1) / 2) < HALF);
  for (const b of cityB) {
    const seed = ((((b.x0 + b.x1) / 2) * 0.137 + ((b.z0 + b.z1) / 2) * 0.719) % 1 + 1) % 1;
    const cell = 2.3 + seed * 1.4;
    for (const f of b.faces) {
      const [nx, nz] = FACE_N[f];
      const alongX = nz !== 0;
      const lo = alongX ? b.x0 : b.z0, hi = alongX ? b.x1 : b.z1;
      const wall = nx ? (nx > 0 ? b.x1 : b.x0) : (nz > 0 ? b.z1 : b.z0);
      const ry = Math.atan2(nx, nz);
      const pos = (t, out) => (alongX ? [t, wall + nz * out] : [wall + nx * out, t]);
      const line = new Line();
      // Is the street in front a side street?
      const front = alongX ? wall + nz * (SIDEWALK + 5) : wall + nx * (SIDEWALK + 5);
      const road = ROADS.find((r) => front > r.lo && front < r.hi);
      const side = !road || road.w < 22;

      if (b.construction) {
        // Hoarding along the pavement and scaffolding up the wall.
        for (let t = lo + 2; t < hi - 2; t += 4) { const [x, z] = pos(t, 2.6); put('construction hoarding', M.hoarding, x, CURB, z, ry); }
        for (let t = lo + 3; t < hi - 3; t += 9) { const [x, z] = pos(t, 3.3); put('water barrier', M.waterBarrier, x, CURB, z, ry); }
        const [sx, sz] = pos((lo + hi) / 2, 0);
        put('scaffolding', scaffold(hi - lo, b.h), sx, CURB, sz, ry);
        continue;
      }
      // Shopfront modules (the facade shader draws one every 6.5 m): shutters, awnings, noren, lanterns, menus.
      for (let m = Math.ceil(lo / 6.5); (m + 1) * 6.5 <= hi; m++) {
        const t = (m + 0.5) * 6.5;
        const [x, z] = pos(t, 0);
        const r = rand();
        if (r < 0.14) { put('roller shutter', M[`shutter${Math.floor(rand() * 2)}`], x, CURB, z, ry); continue; }
        if (r < 0.4) put('shop awning', M[`awning${Math.floor(rand() * 3)}`], x, CURB, z, ry);
        else if (side && r < 0.52) put('noren doorway', M.noren, x, CURB, z, ry);
        else if (r < 0.62) { const [lx, lz] = pos(t, 0.4); put('paper lanterns', M.lanterns, lx, CURB + 0.3, lz, ry); }
        if (chance(0.22) && line.take('front', t + 2, 0.4)) { const [ax, az] = pos(t + 2, 1.6); put('menu board', M[`aFrame${Math.floor(rand() * 2)}`], ax, CURB, az, ry + range(-0.3, 0.3)); }
        // Projecting box sign above the shop.
        if (chance(0.28) && b.h > 9) { const [sx, sz] = pos(t - 2.6, 0); put('box sign', M[`boxSign${Math.floor(rand() * 8)}`], sx, CURB + range(5.2, 9), sz, ry); }
      }
      // Against the wall: vending machines, bins, post boxes, crates, dumpsters, bikes and scooters, meters.
      const wallItems = [
        [0.55, 'vending', () => { const n = 1 + Math.floor(rand() * 3); const t = range(lo + 2, hi - 2 - n * 1.05); if (!line.take('wall', t + n * 0.5, n * 0.55)) return; for (let k = 0; k < n; k++) { const [x, z] = pos(t + k * 1.05, 0.42); put('vending machine', M[`vending${Math.floor(rand() * 3)}`], x, CURB, z, ry); } }],
        [0.2, 'ticket', () => one('ticket machine', M.ticketMachine, 0.3, 0.4)],
        [0.25, 'recycling', () => one('recycling bins', M.recycling, 0.3, 0.9)],
        [0.18, 'post', () => one('post box', M.postBox, 0.35, 0.3)],
        [0.25, 'crates', () => one('crates', M.crates, 0.45, 1.3)],
        [0.25, 'cardboard', () => one('cardboard boxes', M.cardboard, 0.35, 0.7)],
        [side ? 0.3 : 0.08, 'dumpster', () => one('dumpster', M.dumpster, 0.55, 1.0)],
        [side ? 0.0 : 0.4, 'planter', () => { for (let k = 0; k < 3; k++) one('planter', M.planter, 0.45, 0.9); }],
        [side ? 0.35 : 0.1, 'gas', () => one('gas meters', M.gasMeters, 0, 0.6)],
        [side ? 0.4 : 0.15, 'bikes', () => { const n = 2 + Math.floor(rand() * 4); const t = range(lo + 2, hi - 2 - n * 0.7); if (!line.take('wall', t + n * 0.35, n * 0.4)) return; for (let k = 0; k < n; k++) { const [x, z] = pos(t + k * 0.7, 0.5); put('bicycle', M[`bicycle${Math.floor(rand() * 4)}`], x, CURB, z, ry + Math.PI / 2 + range(-0.1, 0.1)); } }],
        [side ? 0.35 : 0.1, 'scooters', () => { const n = 1 + Math.floor(rand() * 3); const t = range(lo + 2, hi - 2 - n * 0.9); if (!line.take('wall', t + n * 0.45, n * 0.5)) return; for (let k = 0; k < n; k++) { const [x, z] = pos(t + k * 0.9, 0.8); put('scooter', M[`scooter${Math.floor(rand() * 3)}`], x, CURB, z, ry + Math.PI / 2 + range(-0.15, 0.15)); } }],
      ];
      function one(name, model, out, half) {
        const t = range(lo + 1.5, hi - 1.5);
        if (!line.take('wall', t, half)) return;
        const [x, z] = pos(t, out);
        put(name, model, x, CURB, z, ry);
      }
      for (const [p, , fn] of wallItems) if (chance(p)) fn();

      // Up the wall.
      if (chance(0.6)) { const [x, z] = pos(chance(0.5) ? lo + 0.4 : hi - 0.4, 0); put('drainpipe', M.drainpipe, x, CURB, z, ry, [1, b.h, 1]); }
      const floors = Math.min(Math.floor(b.h / 3.4) - 1, 14);
      if (b.balconies) {
        for (let k = 2; k <= floors; k++) {
          for (let i = Math.ceil(lo / cell); (i + 2) * cell < hi; i += 3) {
            const t = (i + 1) * cell;
            const r = rand();
            const model = r < 0.18 ? M.balconyLaundry : r < 0.34 ? M.balconyPlant : M.balcony;
            const [x, z] = pos(t, 0);
            put('balcony', model, x, CURB + k * 3.4 + 0.05, z, ry);
            if (chance(0.08)) { const [sx, sz] = pos(t + 0.8, 0.6); put('satellite dish', M.satellite, sx, CURB + k * 3.4 + 0.15, sz, ry + range(-0.5, 0.5)); }
          }
        }
      }
      if (b.fireEscape === f) {
        const t = (lo + hi) / 2 + range(-3, 3);
        for (let k = 1; k <= floors; k++) { const [x, z] = pos(t, 0); put('fire escape', M.fireEscape, x, CURB + k * 3.4, z, ry); }
      }
    }
  }

  // ---------- rooftops ----------
  for (const b of plan) {
    if (!b.roof) continue;
    const top = CURB + (b.y0 || 0) + b.h;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (b.roof === 'billboard') {
      const f = b.faces[0];
      const [nx, nz] = FACE_N[f];
      const x = nx ? (nx > 0 ? b.x1 - 3 : b.x0 + 3) : cx, z = nz ? (nz > 0 ? b.z1 - 3 : b.z0 + 3) : cz;
      put('rooftop billboard', M[`billboard${Math.floor(rand() * 6)}`], x, top, z, Math.atan2(nx, nz));
    } else if (b.roof === 'helipad') put('helipad', M.helipad, cx, top, cz);
    else if (b.roof === 'garden') put('rooftop garden', M.roofGarden, cx, top, cz, rand() < 0.5 ? 0 : Math.PI / 2);
    else if (b.roof === 'cooling') put('cooling tower', M.coolingTower, cx + range(-2, 2), top, cz + range(-2, 2));
    else if (b.roof === 'crane') put('tower crane', M.crane, cx, top, cz, rand() * 6);
  }

  // ---------- across the roads: neon arches, lantern strings, direction gantries ----------
  const segs = [];
  for (const road of ROADS) {
    for (const blk of BLOCKS.filter((b) => b.j === 0)) {
      for (const alongZ of [true, false]) segs.push({ road, lo: blk.x0, hi: blk.x1, alongZ });
    }
  }
  const segAt = (s, t, o) => (s.alongZ ? [s.road.c + o, t] : [t, s.road.c + o]);
  const segLot = (s) => (s.alongZ ? inLot(s.road.c, (s.lo + s.hi) / 2, 2) : inLot((s.lo + s.hi) / 2, s.road.c, 2));
  let arches = 0;
  for (const s of segs) {
    if (segLot(s)) continue;
    const w = s.road.w;
    const ry = s.alongZ ? 0 : Math.PI / 2;
    if (w < 22 && arches < 8 && chance(0.18)) {
      const [x, z] = segAt(s, s.lo + 6, 0);
      put('neon arch', archModel(w), x, CURB, z, ry);
      arches++;
    }
    if (w < 22 && chance(0.28)) {
      for (const t of [s.lo + 20, (s.lo + s.hi) / 2 + 4, s.hi - 20]) { const [x, z] = segAt(s, t, 0); put('lantern string', lanternString(w), x, 0, z, ry); }
    }
    if (w >= 30 && chance(0.35)) {
      const [x, z] = segAt(s, (s.lo + s.hi) / 2, 0);
      put('direction gantry', gantryModel(w), x, CURB, z, ry + (chance(0.5) ? Math.PI : 0));
    }
  }

  const meshes = B.build(group, propMaterials(glowAtlas.tex, propAtlas.tex));
  return { meshes, placed, steam };

  // ---------- models made to measure ----------
  function archModel(w) { return (archModel.c ||= {})[w] ||= M.archFor(w, Math.floor(rand() * 16)); }
  function gantryModel(w) { return (gantryModel.c ||= {})[w] ||= M.gantryFor(w, Math.floor(rand() * 2)); }
  function lanternString(w) {
    return (lanternString.c ||= {})[w] ||= (() => {
      const parts = [];
      const span = w + 2;
      const n = Math.floor(span / 1.3);
      const lineGeo = [];
      for (let k = 0; k <= n; k++) {
        const x = -span / 2 + (k / n) * span;
        const y = 6.6 - 0.9 * 4 * (k / n) * (1 - k / n);
        // One paper lantern (the first part of the pair model), recentred, shrunk and hung under the wire.
        if (k > 0 && k < n) { const p = M.lanterns[0]; parts.push({ ...p, geo: p.geo.clone().translate(0.5, -2.6, 0).scale(0.7, 0.6, 0.7).translate(x, y - 0.25, 0) }); }
        lineGeo.push([x, y + 0.05]);
      }
      // The wire itself, as thin boxes between the points.
      for (let k = 0; k < lineGeo.length - 1; k++) {
        const [x0, y0] = lineGeo[k], [x1, y1] = lineGeo[k + 1];
        const g = new THREE.BoxGeometry(Math.hypot(x1 - x0, y1 - y0), 0.02, 0.02).rotateZ(Math.atan2(y1 - y0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
        parts.push({ geo: g, cls: 'matte', color: new THREE.Color(0x0a0a0a), uv: null });
      }
      return parts;
    })();
  }
  // Scaffolding up one face: standards, ledgers, planks and a green debris net.
  function scaffold(len, h) {
    const parts = [];
    const steel = new THREE.Color(0x8d939c), plank = new THREE.Color(0x6b4a32), net = new THREE.Color(0x3fb06a);
    const add = (geo, cls, color) => parts.push({ geo, cls, color, uv: null });
    const top = Math.min(h + 2, 48);
    for (let x = -len / 2 + 0.5; x <= len / 2 - 0.5; x += 2.4) {
      for (const z of [0.4, 1.6]) add(new THREE.BoxGeometry(0.06, top, 0.06).translate(x, top / 2, z), 'metal', steel);
    }
    for (let y = 2; y < top; y += 2) {
      for (const z of [0.4, 1.6]) add(new THREE.BoxGeometry(len - 1, 0.05, 0.05).translate(0, y, z), 'metal', steel);
      add(new THREE.BoxGeometry(len - 1, 0.05, 1.2).translate(0, y - 0.03, 1.0), 'matte', plank);
    }
    add(new THREE.PlaneGeometry(len - 0.6, top).translate(0, top / 2, 1.7), 'glass', net);
    for (const p of parts) if (!p.geo.index) p.geo.setIndex([...Array(p.geo.attributes.position.count).keys()]);
    return parts;
  }
}
