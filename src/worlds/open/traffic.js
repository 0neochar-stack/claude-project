// Traffic: cars driving in their lanes around the player, keeping their distance from each other and from
// you, slowing for cross traffic, and getting knocked aside if you hit them. They appear out of sight
// ahead or behind and leave once far away.
import * as THREE from 'three';
import { carLowGeometry } from '../../car.js';
import { CARS } from '../../garage.js';

// Lane centres from the road's centre line, for each direction (right-hand traffic).
const LANES = { street: [1.9], boulevard: [3.4, 6.9], coast: [2.5], highway: [2.7, 6.3], village: [1.9], touge: [2.0], ridge: [2.3] };
const PAINTS = [0xf2f2f2, 0x111214, 0x9a9ea4, 0x5a5e66, 0x1c2a48, 0x7a1a1a, 0xc8b89a, 0x2a4a3a, 0xe8e8e8, 0x2a2a2e];

export class Traffic {
  constructor(net, preset, groundAt) {
    this.net = net;
    this.groundAt = groundAt;
    this.group = new THREE.Group();
    this.max = preset.traffic;
    this.cars = [];
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.32 });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.roads = net.roads.filter((r) => LANES[r.kind] && r.length > 200);
    this.totalLen = this.roads.reduce((a, r) => a + r.length, 0);
    this.pool = CARS.filter((c) => c.look.body);
    this.spawnTimer = 0;
    this.tmp = new THREE.Vector3();
  }

  // Position on a road at distance s with lateral offset lat (+ left), and the tangent.
  sample(road, s, out) {
    const S = road.samples;
    const f = Math.max(0, Math.min(S.length - 1.001, s / 3));
    const i = Math.floor(f), t = f - i;
    const a = S[i], b = S[i + 1];
    out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
    out.tx = a.tx + (b.tx - a.tx) * t; out.tz = a.tz + (b.tz - a.tz) * t;
    const L = Math.hypot(out.tx, out.tz) || 1;
    out.tx /= L; out.tz /= L;
    return out;
  }

  spawn(player) {
    for (let tries = 0; tries < 12; tries++) {
      let pick = Math.random() * this.totalLen, road = this.roads[0];
      for (const r of this.roads) { if (pick < r.length) { road = r; break; } pick -= r.length; }
      // Prefer roads near the player: sample a spot and check the distance.
      const s = 10 + Math.random() * (road.length - 20);
      const p = this.sample(road, s, {});
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < 110 || d > 380) continue;
      // Out of the player's view cone if close-ish.
      const fx = Math.sin(player.h), fz = Math.cos(player.h);
      if (d < 200 && ((p.x - player.x) * fx + (p.z - player.z) * fz) / d > 0.5) continue;
      const lanes = LANES[road.kind];
      const lane = lanes[Math.floor(Math.random() * lanes.length)];
      const dir = Math.random() < 0.5 ? 1 : -1;
      if (this.cars.some((c) => c.road === road && c.dir === dir && Math.abs(c.s - s) < 25)) continue;
      const def = this.pool[Math.floor(Math.random() * this.pool.length)];
      const geo = carLowGeometry(def.look, PAINTS[Math.floor(Math.random() * PAINTS.length)]);
      const body = new THREE.Mesh(geo.body, this.bodyMat);
      body.castShadow = true;
      const lights = new THREE.Mesh(geo.lights, this.lightMat);
      const root = new THREE.Group();
      root.add(body, lights);
      this.group.add(root);
      const v = road.speed * (0.8 + Math.random() * 0.3);
      this.cars.push({ road, s, dir, lane, v, vt: v, root, x: p.x, z: p.z, h: 0, wreck: 0, wx: 0, wz: 0, wr: 0, len: geo.length, wid: geo.width });
      return;
    }
  }

  reset() {
    for (const c of this.cars) c.root.removeFromParent();
    this.cars.length = 0;
  }

  update(dt, player, cam, night) {
    // Keep the count up, drop cars that are far behind us.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.cars.length < this.max) { this.spawnTimer = 0.25; this.spawn(player); }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d > 460 || (c.wreck <= 0 && (c.s < 2 || c.s > c.road.length - 2))) { c.root.removeFromParent(); this.cars.splice(i, 1); }
    }
    this.lightMat.color.setScalar(0.4 + night * 2.4);
    const p = {};
    const fwd = { x: 0, z: 0 };
    for (const c of this.cars) {
      if (c.wreck > 0) {
        // Knocked loose: slide and spin to a stop, then drive off again.
        c.wreck -= dt;
        c.x += c.wx * dt; c.z += c.wz * dt; c.h += c.wr * dt;
        const k = Math.exp(-dt * 1.6);
        c.wx *= k; c.wz *= k; c.wr *= k;
        if (c.wreck <= 0) {
          // Rejoin the lane from wherever it ended up.
          let best = c.s, bd = Infinity;
          for (let s = Math.max(0, c.s - 30); s < Math.min(c.road.length, c.s + 30); s += 3) { this.sample(c.road, s, p); const dd = Math.hypot(p.x - c.x, p.z - c.z); if (dd < bd) { bd = dd; best = s; } }
          c.s = best;
          c.v = 0;
        }
      } else {
        // Look ahead for anything in the way: other traffic and the player.
        fwd.x = Math.sin(c.h); fwd.z = Math.cos(c.h);
        let gap = Infinity;
        const look = (ox, oz, wide) => {
          const dx = ox - c.x, dz = oz - c.z;
          const ahead = dx * fwd.x + dz * fwd.z, side = Math.abs(dx * fwd.z - dz * fwd.x);
          if (ahead > 0 && ahead < 45 && side < wide) gap = Math.min(gap, ahead);
        };
        for (const o of this.cars) if (o !== c) look(o.x, o.z, o.road === c.road && o.dir === c.dir ? 1.8 : 2.6);
        look(player.x, player.z, 2.4);
        const want = gap < Infinity ? Math.max(0, Math.min(c.vt, (gap - 7) * 0.9)) : c.vt;
        c.v += Math.max(-9 * dt, Math.min(2.6 * dt, want - c.v));
        c.s += c.dir * c.v * dt;
        this.sample(c.road, c.s, p);
        const lat = -c.lane * c.dir;
        c.x = p.x - p.tz * lat;
        c.z = p.z + p.tx * lat;
        c.h = Math.atan2(p.tx * c.dir, p.tz * c.dir);
      }
      const y = this.groundAt(c.x, c.z);
      c.root.position.set(c.x, y, c.z);
      c.root.rotation.y = c.h;
      c.root.visible = Math.hypot(c.x - cam.x, c.z - cam.z) < 420;
    }
  }

  // Player against traffic: each traffic car is a box; the player's hull is two circles.
  collide(car) {
    let impact = 0;
    const sh = Math.sin(car.h), ch = Math.cos(car.h);
    for (const c of this.cars) {
      if (Math.abs(c.x - car.x) > 7 || Math.abs(c.z - car.z) > 7) continue;
      const ca = Math.cos(c.h), sa = Math.sin(c.h);
      for (const o of [1.3, -1.3]) {
        const px = sh * o, pz = ch * o;
        const hx = car.x + px, hz = car.z + pz;
        // Into the traffic car's frame (x right, z forward).
        const dx = hx - c.x, dz = hz - c.z;
        const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
        const ex = c.wid / 2, ez = c.len / 2, r = 1.0;
        const qx = Math.max(-ex, Math.min(ex, lx)), qz = Math.max(-ez, Math.min(ez, lz));
        let nx = lx - qx, nz = lz - qz, d = Math.hypot(nx, nz);
        if (d >= r) continue;
        if (d < 1e-4) { nx = lx >= 0 ? 1 : -1; nz = 0; d = 0; } else { nx /= d; nz /= d; }
        const wx = nx * ca + nz * sa, wz = -nx * sa + nz * ca;
        const pen = r - d;
        car.x += wx * pen; car.z += wz * pen;
        const tv = c.wreck > 0 ? { x: c.wx, z: c.wz } : { x: Math.sin(c.h) * c.v, z: Math.cos(c.h) * c.v };
        const vpx = car.vx + car.r * pz - tv.x, vpz = car.vz - car.r * px - tv.z;
        const vn = vpx * wx + vpz * wz;
        if (vn >= 0) continue;
        impact = Math.max(impact, -vn);
        const m = car.spec.mass, I = car.spec.inertia, M = 1400;
        const rn = pz * wx - px * wz;
        const j = (-(1 + 0.3) * vn) / (1 / m + (rn * rn) / I + 1 / M);
        car.applyImpulse(px, pz, wx * j, wz * j);
        // The traffic car gets the opposite shove and some spin.
        if (c.wreck <= 0) { c.wx = tv.x; c.wz = tv.z; c.wr = 0; }
        c.wx -= (wx * j) / M; c.wz -= (wz * j) / M;
        c.wr += (Math.random() - 0.5) * Math.min(3, -vn * 0.25);
        c.wreck = 6;
      }
    }
    return impact;
  }
}
