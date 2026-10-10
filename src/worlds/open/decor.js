// Downloaded models placed round the open world: street furniture in Vista Del Mar (hydrants, stop signs,
// traffic lights on the boulevard, mailboxes, bus stops, dumpsters and litter), a farm with grazing cattle
// off Route 7, a second pagoda and a lantern torii in Sakura Pass, and deer, stags and wolves in the
// mountains that bolt when a car comes close. Anything whose model didn't load is left out.
import * as THREE from 'three';
import { bakeStatic, makeAnimal, Scatter } from '../../models.js';
import { HALF, LA, PEAK, VILLAGE, BOULEVARD_Z, heightAt, roadQuery, rng, inLot } from './layout.js';

export function buildDecor(net, heights, assets, preset, extra = {}) {
  const group = new THREE.Group();
  const colliders = [];
  const R = rng(4242);
  const ground = (x, z) => heightAt(heights, x, z);
  const q = {};
  const roadAt = (x, z) => (roadQuery(net, x, z, q), q.road ? q : null);
  const clear = (x, z, pad) => { roadQuery(net, x, z, q); return (!q.road || q.d > q.road.hw + (q.road.sidewalk || q.road.gutter || q.road.shoulder || 0) + pad) && !net.lots.some((l) => inLot(l, x, z, pad)); };

  // Baked models, by key. opts as for bakeStatic.
  const baked = new Map();
  const model = (key, opts) => {
    if (!baked.has(key)) baked.set(key, assets.get(key) ? bakeStatic(assets.get(key), opts)[0] : null);
    return baked.get(key);
  };
  const props = new Scatter({ tile: 48, far: Math.min(preset.far * 0.35, 420), shadows: preset.shadows > 0 });
  const big = new Scatter({ tile: 128, far: Math.min(preset.far, 2400), shadows: preset.shadows > 0 });
  const circle = (x, z, r) => colliders.push({ type: 'circle', x, z, r });
  const box = (x, z, w, d, a, tall = true) => colliders.push({ type: 'box', x, z, hx: w / 2, hz: d / 2, a, tall });
  // Facing: models face +z; rot turns that toward (sin rot, cos rot).
  const face = (dx, dz) => Math.atan2(dx, dz);

  const M = {
    hydrant: model('hydrant', { height: 0.85 }),
    mailbox: model('mailbox', { height: 1.15, rotate: -Math.PI / 2 }),
    usps: model('usps', { height: 1.25 }),
    busStop: model('busStop', { height: 2.9 }),
    light: model('trafficLight', { height: 6.4 }),
    stop: model('stopSign', { height: 2.6 }),
    dumpster: model('dumpster', { length: 2.0 }),
    dumpsterB: model('dumpsterB', { length: 1.9 }),
    bag: model('trashBag', { height: 0.62 }),
    crate: model('crate', { height: 0.8, matte: true }),
    box: model('box', { height: 0.45, matte: true }),
    atm: model('atm', { height: 1.75 }),
    vending: model('vending', { height: 1.85 }),
    gasTank: model('gasTank', { height: 1.25 }),
    barrier: model('roadBarrier', { length: 2.2 }),
    cup: model('cup', { height: 0.16 }),
    can: model('can', { height: 0.12 }),
    bottle: model('bottle', { height: 0.3 }),
  };

  // ---------- Vista Del Mar streets ----------
  const streets = net.roads.filter((r) => r.kind === 'street');
  const blvd = net.byId.blvd;
  const crossings = [];
  for (const a of streets.filter((r) => r.id.startsWith('ave'))) {
    for (const b of [...streets.filter((r) => r.id.startsWith('st')), blvd]) {
      const x = a.samples[0].x, z = b.samples[0].z;
      const zs = a.samples.map((p) => p.z);
      const xs = b.samples.map((p) => p.x);
      if (z < Math.min(...zs) - 1 || z > Math.max(...zs) + 1 || x < Math.min(...xs) - 1 || x > Math.max(...xs) + 1) continue;
      crossings.push({ x, z, ave: a, cross: b });
    }
  }
  for (const c of crossings) {
    const y = ground(c.x, c.z);
    if (c.cross === blvd) {
      // Traffic lights: one per approach, pole on the near-right corner, arm out over the lanes.
      if (!M.light) continue;
      for (const [dx, dz, road, other] of [[1, 0, blvd, c.ave], [-1, 0, blvd, c.ave], [0, 1, c.ave, blvd], [0, -1, c.ave, blvd]]) {
        // Travelling along (dx, dz): right is (-dz, dx); the pole stands past the crossing street.
        const rx = -dz, rz = dx;
        const along = other.hw + (other.sidewalk || 0) * 0.5 + 0.6, side = road.hw + 1.0;
        const px = c.x + dx * along + rx * side, pz = c.z + dz * along + rz * side;
        const rot = face(-dx, -dz);
        // The pole is at the model's +x end; put that end on (px, pz).
        const off = M.light.size.x / 2 - 0.25;
        const ox = px - Math.cos(rot) * off, oz = pz + Math.sin(rot) * off;
        props.add(M.light, ox, ground(px, pz), oz, rot);
        circle(px, pz, 0.3);
      }
      // A blue mailbox and a bus stop on two of the corners.
      if (M.usps) { const mx = c.x + c.ave.hw + 2.2, mz = c.z + blvd.hw + 2.6; props.add(M.usps, mx, ground(mx, mz), mz, face(0, -1)); circle(mx, mz, 0.4); }
      if (M.busStop) { const bx = c.x - c.ave.hw - 9, bz = c.z - blvd.hw - 1.0; props.add(M.busStop, bx, ground(bx, bz), bz, face(0, 1)); circle(bx, bz, 0.2); }
    } else if (M.stop) {
      // Four-way stop: a sign on the near-right corner of each street approach.
      for (const [dx, dz, road, other] of [[1, 0, c.cross, c.ave], [-1, 0, c.cross, c.ave], [0, 1, c.ave, c.cross], [0, -1, c.ave, c.cross]]) {
        const rx = -dz, rz = dx;
        const back = -(other.hw + 1.4), side = road.hw + 1.1;
        const px = c.x + dx * back + rx * side, pz = c.z + dz * back + rz * side;
        props.add(M.stop, px, ground(px, pz), pz, face(-dx, -dz));
        circle(px, pz, 0.15);
      }
    }
    void y;
  }
  const nearCrossing = (x, z, d) => crossings.some((c) => Math.abs(c.x - x) < d && Math.abs(c.z - z) < d);
  // Hydrants along the sidewalks, one side then the other.
  if (M.hydrant) for (const r of [...streets, blvd]) {
    let side = 1;
    for (let s = 20; s < r.length - 10; s += 55 + R() * 20) {
      const p = r.samples[Math.round(s / 3)];
      side = -side;
      const off = r.hw + 0.55;
      const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
      if (nearCrossing(x, z, 16) || net.lots.some((l) => inLot(l, x, z, 2))) continue;
      props.add(M.hydrant, x, ground(x, z), z, R() * 6.28);
      circle(x, z, 0.25);
    }
  }
  // Curbside mailboxes at the houses (the town hands over where they go).
  if (M.mailbox) for (const m of extra.mailboxes || []) props.add(M.mailbox, m.x, ground(m.x, m.z), m.z, m.rot);

  // Behind the shops: dumpsters, bags and crates at the back corners of the lots, cans and cups on the
  // boulevard sidewalks.
  for (const lot of net.lots.filter((l) => l.shape === 'rect' && l.x1 < LA.x1 + 100)) {
    for (const [cx, k] of [[lot.x0 + 3, 1], [lot.x1 - 3, -1]]) {
      const cz = lot.z0 + 2.4, y = lot.y + 0.03;
      const d = R() < 0.5 ? M.dumpster : M.dumpsterB || M.dumpster;
      if (d) { props.add(d, cx + k * 1.4, y, cz, face(0, 1)); box(cx + k * 1.4, cz, d.size.x, d.size.z, 0, false); }
      if (M.bag) for (let i = 0; i < 3; i++) props.add(M.bag, cx + k * (3.2 + R() * 1.4), y, cz - 0.6 + R() * 1.2, R() * 6.28, 0.9 + R() * 0.3);
      if (M.crate) props.add(M.crate, cx + k * 4.4, y, cz + 1.2, R() * 0.4);
      if (M.box) for (let i = 0; i < 2; i++) props.add(M.box, cx + k * (5.2 + R()), y + i * 0.42, cz + 1.0, R() * 0.6);
    }
  }
  const gas = net.lots.find((l) => l.id === 'gas');
  if (gas) {
    const y = gas.y + 0.03, sz = gas.z0 + 13.6, cx = (gas.x0 + gas.x1) / 2;
    if (M.atm) { props.add(M.atm, cx + 8.6, y, sz, face(0, 1)); circle(cx + 8.6, sz, 0.4); }
    if (M.vending) for (const dx of [-9.4, -8.3]) { props.add(M.vending, cx + dx, y, sz + 0.1, face(0, 1)); }
    if (M.vending) box(cx - 8.85, sz + 0.1, 2.2, 0.9, 0);
    if (M.gasTank) { for (let i = 0; i < 3; i++) props.add(M.gasTank, gas.x0 + 2.2 + i * 1.1, y, gas.z0 + 2.2, R() * 6.28); box(gas.x0 + 3.3, gas.z0 + 2.2, 3.6, 1.4, 0); }
  }
  for (const r of [blvd]) {
    for (let s = 6; s < r.length - 6; s += 9 + R() * 14) {
      const p = r.samples[Math.round(s / 3)];
      const side = R() < 0.5 ? 1 : -1, off = r.hw + 0.8 + R() * (r.sidewalk - 1.2);
      const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
      const kind = [M.can, M.cup, M.bottle][Math.floor(R() * 3)];
      if (!kind) continue;
      // Lying on its side most of the time.
      props.add(kind, x, ground(x, z) + (kind === M.cup ? 0 : 0.0), z, R() * 6.28);
    }
  }
  // Roadworks on the coast road: a few striped barriers on the shoulder.
  if (M.barrier) {
    const r = net.byId.pch;
    for (const s of [420, 424, 428]) {
      const p = r.samples[Math.round(s / 3)];
      const off = r.hw + 0.6;
      const x = p.x - p.tz * off, z = p.z + p.tx * off;
      props.add(M.barrier, x, ground(x, z), z, face(p.tx, p.tz) + Math.PI / 2);
      circle(x, z, 0.5);
    }
  }

  // ---------- a farm off Route 7 ----------
  // Looks along the highway for a wide, flat, empty field, then lays out the yard facing the road.
  const farmhouse = model('farmhouse', { height: 8.2 }), barn = model('barn', { height: 9.5 }), silo = model('silo', { height: 13 });
  let pasture = null;
  if (barn || farmhouse || silo) {
    const hwy = net.byId.hwy;
    let best = null;
    for (let s = 150; s < hwy.length - 200; s += 25) {
      const p = hwy.samples[Math.round(s / 3)];
      for (const side of [1, -1]) {
        const cx = p.x - p.tz * 75 * side, cz = p.z + p.tx * 75 * side;
        if (Math.hypot(cx - PEAK.x, cz - PEAK.z) < 900 || Math.hypot(cx - VILLAGE.x, cz - VILLAGE.z) < VILLAGE.r + 120) continue;
        if (cx > LA.x0 - 120 && cx < LA.x1 + 160 && cz > LA.z0 - 120 && cz < LA.z1 + 160) continue;
        let lo = Infinity, hi = -Infinity, ok = true;
        for (let i = -3; i <= 3 && ok; i++) for (let j = -3; j <= 3; j++) {
          const x = cx + i * 12, z = cz + j * 12;
          if (!clear(x, z, 6)) { ok = false; break; }
          const h = ground(x, z);
          lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
        if (!ok || lo < 2) continue;
        const score = hi - lo + Math.abs(s - hwy.length * 0.45) * 0.004;
        if (!best || score < best.score) best = { score, cx, cz, toRoad: face(p.x - cx, p.z - cz) };
      }
    }
    if (best) {
      const { cx, cz, toRoad: rot } = best;
      const at = (ax, az) => ({ x: cx + ax * Math.cos(rot) + az * Math.sin(rot), z: cz - ax * Math.sin(rot) + az * Math.cos(rot) });
      // Footprint sinks to the lowest corner so nothing floats on the slope.
      const place = (m, ax, az, turn = 0) => {
        if (!m) return;
        const p = at(ax, az), r = rot + turn;
        let lo = Infinity;
        for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) lo = Math.min(lo, ground(p.x + (u * m.size.x / 2) * Math.cos(r) + (v * m.size.z / 2) * Math.sin(r), p.z - (u * m.size.x / 2) * Math.sin(r) + (v * m.size.z / 2) * Math.cos(r)));
        big.add(m, p.x, lo - 0.15, p.z, r);
        box(p.x, p.z, m.size.x, m.size.z, r);
      };
      place(farmhouse, -16, 14);
      place(barn, 14, -6, Math.PI / 2);
      place(silo, 28, -14, Math.PI / 2);
      const pc = at(4, -40);
      pasture = { x: pc.x, z: pc.z, rot, hx: 30, hz: 16 };
      // Post-and-rail fence round the pasture.
      const posts = [], rails = [];
      const corners = [[-30, -16], [30, -16], [30, 16], [-30, 16]].map(([u, v]) => at(4 + u, -40 + v));
      for (let k = 0; k < 4; k++) {
        const a = corners[k], b = corners[(k + 1) % 4];
        const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 3);
        for (let i = 0; i < n; i++) {
          const t0 = i / n, t1 = (i + 1) / n;
          const x0 = a.x + (b.x - a.x) * t0, z0 = a.z + (b.z - a.z) * t0, x1 = a.x + (b.x - a.x) * t1, z1 = a.z + (b.z - a.z) * t1;
          posts.push([x0, z0]);
          if (k === 0 && i === Math.floor(n / 2)) continue; // the gate
          rails.push([x0, z0, x1, z1]);
          colliders.push({ type: 'seg', ax: x0, az: z0, bx: x1, bz: z1, thick: 0.08, low: true });
        }
      }
      const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.95 });
      const postGeo = new THREE.BoxGeometry(0.14, 1.3, 0.14).translate(0, 0.55, 0);
      const pm = new THREE.InstancedMesh(postGeo, wood, posts.length);
      const m4 = new THREE.Matrix4();
      posts.forEach(([x, z], i) => pm.setMatrixAt(i, m4.makeTranslation(x, ground(x, z), z)));
      const railGeo = new THREE.BoxGeometry(0.06, 0.1, 1).translate(0, 0, 0.5);
      const rm = new THREE.InstancedMesh(railGeo, wood, rails.length * 2);
      const qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), ps = new THREE.Vector3();
      rails.forEach(([x0, z0, x1, z1], i) => {
        const L = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0), g = ground(x0, z0), g1 = ground(x1, z1);
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.atan2(g1 - g, L));
        for (const [k, h] of [[0, 0.55], [1, 1.0]]) rm.setMatrixAt(i * 2 + k, m4.compose(ps.set(x0, g + h, z0), qq.setFromAxisAngle(up, a).multiply(tilt), sc.set(1, 1, L)));
      });
      for (const im of [pm, rm]) { im.computeBoundingSphere(); im.castShadow = true; group.add(im); }
    }
  }

  // ---------- Sakura Pass: a second pagoda and a lantern torii ----------
  // The first free, level spot found spiralling out from (x, z).
  const site = (x, z, r, maxSlope = 2) => {
    for (let d = 0; d < 160; d += 6) for (let a = 0; a < 6.28; a += 0.5) {
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      let lo = Infinity, hi = -Infinity, ok = true;
      for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
        const sx = px + u * r, sz = pz + v * r;
        if (!clear(sx, sz, 3)) { ok = false; break; }
        const h = ground(sx, sz); lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (ok && hi - lo < maxSlope) return { x: px, z: pz, y: lo };
    }
    return null;
  };
  const pagodaB = model('pagodaB', { height: 15 });
  if (pagodaB) {
    const s = site(VILLAGE.x - 120, VILLAGE.z + 150, 7);
    if (s) { big.add(pagodaB, s.x, s.y - 0.2, s.z, R() * 6.28); box(s.x, s.z, pagodaB.size.x * 0.8, pagodaB.size.z * 0.8, 0); }
  }
  const pagoda = model('pagoda', { height: 26 });
  if (pagoda && extra.pagodaSpot) big.add(pagoda, extra.pagodaSpot.x, extra.pagodaSpot.y, extra.pagodaSpot.z, 0);
  const torii = model('torii', { height: 6.2 });
  if (torii && extra.toriiSpot) {
    const t = extra.toriiSpot;
    big.add(torii, t.x, ground(t.x, t.z) - 0.1, t.z, t.rot);
    for (const s of [-1, 1]) circle(t.x + Math.cos(t.rot) * s * torii.size.x * 0.36, t.z - Math.sin(t.rot) * s * torii.size.x * 0.36, 0.35);
  }

  group.add(props.build(), big.build());

  // ---------- animals ----------
  const animals = [];
  const spawnAnimal = (key, height, x, z, home, opts = {}) => {
    const g = assets.get(key);
    if (!g) return;
    const a = makeAnimal(g, height);
    a.object.position.set(x, ground(x, z), z);
    a.object.rotation.y = R() * 6.28;
    a.object.visible = false;
    group.add(a.object);
    animals.push({ ...a, key, home, h: a.object.rotation.y, state: 'idle', timer: R() * 4, speed: 0, flee: 0, shy: opts.shy ?? 28, run: opts.run ?? 9, walk: opts.walk ?? 1.2, active: false });
  };
  if (pasture) {
    const p = pasture;
    const inP = (u, v) => ({ x: p.x + u * Math.cos(p.rot) + v * Math.sin(p.rot), z: p.z - u * Math.sin(p.rot) + v * Math.cos(p.rot) });
    for (let i = 0; i < 5; i++) { const s = inP((R() - 0.5) * 44, (R() - 0.5) * 22); spawnAnimal(i === 0 ? 'bull' : 'cow', i === 0 ? 1.65 : 1.5, s.x, s.z, { pen: p }, { shy: 9, run: 4, walk: 0.8 }); }
  }
  // Deer and stags in clearings beside the mountain roads, wolves up on the ridge.
  for (const [id, n, kinds] of [['touge', 8, ['deer', 'deer', 'stag']], ['ridge', 5, ['deer', 'stag', 'wolf']], ['hwy', 3, ['deer']]]) {
    const r = net.byId[id];
    if (!r) continue;
    for (let i = 0; i < n; i++) {
      const s = r.length * (0.15 + 0.7 * (i + R() * 0.5) / n);
      const p = r.samples[Math.round(s / 3)];
      const side = R() < 0.5 ? 1 : -1, off = r.hw + 14 + R() * 25;
      const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
      if (!clear(x, z, 4) || ground(x, z) < 2) continue;
      const kind = kinds[Math.floor(R() * kinds.length)];
      spawnAnimal(kind, { deer: 1.45, stag: 2.1, wolf: 0.95 }[kind], x, z, { x, z, r: 30 });
    }
  }

  const tmp = new THREE.Vector3();
  const update = (t, dt, camera, car) => {
    const cam = camera.position;
    for (const a of animals) {
      const o = a.object;
      const dc = Math.hypot(o.position.x - cam.x, o.position.z - cam.z);
      o.visible = dc < 320;
      if (!o.visible) continue;
      // Spooked by a car close by and moving: run directly away for a few seconds.
      const dx = o.position.x - car.x, dz = o.position.z - car.z, d = Math.hypot(dx, dz);
      if (d < a.shy && car.speed > 2 && a.state !== 'flee') { a.state = 'flee'; a.timer = 3 + R() * 2; a.target = Math.atan2(dx, dz); a.play('Gallop', 0.2, 1.1); }
      a.timer -= dt;
      if (a.state === 'flee') {
        a.speed = a.run;
        if (a.timer <= 0) { a.state = 'idle'; a.timer = 2 + R() * 3; a.speed = 0; }
      } else if (a.timer <= 0) {
        // Wander: graze, look up, amble somewhere nearby.
        const roll = R();
        if (roll < 0.45) { a.state = 'eat'; a.timer = 4 + R() * 6; a.speed = 0; a.play('Eating'); }
        else if (roll < 0.7) { a.state = 'idle'; a.timer = 2 + R() * 4; a.speed = 0; a.play(a.has('Idle_2') && R() < 0.5 ? 'Idle_2' : 'Idle'); }
        else {
          a.state = 'walk'; a.timer = 3 + R() * 4; a.speed = a.walk; a.play('Walk', 0.35, 0.9);
          // Head back toward home if it has strayed.
          const hx = a.home.pen ? a.home.pen.x : a.home.x, hz = a.home.pen ? a.home.pen.z : a.home.z;
          const far = Math.hypot(o.position.x - hx, o.position.z - hz) > (a.home.r || 10);
          a.target = far ? Math.atan2(hx - o.position.x, hz - o.position.z) : R() * 6.28;
        }
      }
      if (a.state === 'idle' && !a.started) { a.started = true; a.play('Idle'); }
      if (a.speed > 0) {
        const dh = Math.atan2(Math.sin(a.target - a.h), Math.cos(a.target - a.h));
        a.h += dh * Math.min(1, dt * 4);
        let nx = o.position.x + Math.sin(a.h) * a.speed * dt, nz = o.position.z + Math.cos(a.h) * a.speed * dt;
        // Cattle stay in the pasture.
        const pen = a.home.pen;
        if (pen) {
          const u = (nx - pen.x) * Math.cos(pen.rot) - (nz - pen.z) * Math.sin(pen.rot), v = (nx - pen.x) * Math.sin(pen.rot) + (nz - pen.z) * Math.cos(pen.rot);
          if (Math.abs(u) > pen.hx - 2 || Math.abs(v) > pen.hz - 2) { nx = o.position.x; nz = o.position.z; a.target = Math.atan2(pen.x - nx, pen.z - nz); }
        }
        if (Math.abs(nx) > HALF - 20 || Math.abs(nz) > HALF - 20) { nx = o.position.x; nz = o.position.z; }
        o.position.x = nx; o.position.z = nz;
        o.rotation.y = a.h;
      }
      o.position.y = ground(o.position.x, o.position.z);
      if (dc < 160) a.mixer.update(dt);
    }
    void t; void tmp;
  };

  const cull = (camera) => { props.update(camera); big.update(camera); };
  return { group, colliders, update, cull, animals, debug: { props, big, pasture } };
}
void BOULEVARD_Z;
