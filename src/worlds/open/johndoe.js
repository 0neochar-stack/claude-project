// John Doe: the open world's legend. A fully built S15 that never crashes, always somewhere near you,
// flat out everywhere: huge angle through every corner, 360s down the straights, manji swinging and
// donuts in the neighbourhoods, weaving through traffic and cutting across into the other lane, and a
// handbrake 180 at the end of a road. His name floats over the car.
//
// He is driven by script rather than by the tyre physics, so he can't lose it: the path follows the
// road (plus his weaving offset) and the body is swung round it by the drift angle. Smoke and skid
// marks come from how far he's sideways.
import * as THREE from 'three';
import { buildCar } from '../../car.js';
import { radialTexture } from '../../fx.js';
import { CARS, buildSpec } from '../../garage.js';

const LOOK = { ...(CARS.find((c) => c.id === 's15') || CARS[0]).look, paint: 1, neon: 2, rims: 3, wing: 2 };
const TAU = Math.PI * 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function nameTag() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(8, 6, 16, 0.72)';
  g.beginPath(); g.roundRect(18, 22, 476, 84, 42); g.fill();
  g.strokeStyle = '#ff3fa4'; g.lineWidth = 5; g.stroke();
  g.font = 'italic 800 62px "Saira Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ff3fa4'; g.shadowBlur = 18;
  g.fillStyle = '#ffffff';
  g.fillText('JOHN DOE', 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
  s.renderOrder = 999;
  s.scale.set(3.6, 0.9, 1);
  return s;
}

export class JohnDoe {
  constructor(net, groundAt, envMap, headlights) {
    this.net = net;
    this.groundAt = groundAt;
    this.roads = net.roads.filter((r) => r.length > 150 && r.kind !== 'pier');
    this.view = buildCar(envMap, radialTexture(), LOOK);
    this.view.setLights(headlights);
    this.root = new THREE.Group();
    this.root.add(this.view.root);
    this.tag = nameTag();
    this.root.add(this.tag);
    // The state the car model reads (the same fields the real physics fills in).
    this.car = {
      x: 0, z: 0, h: 0, vx: 0, vz: 0, speed: 0, u: 0, steer: 0, ax: 0, ay: 0, r: 0, rpm: 6500, gear: 3,
      driveThrottle: 1, braking: 0, handbrake: false, shiftTimer: 0, wheelSpinAngle: 0, grip: 1,
      slip: new Float64Array(4), spec: buildSpec('s15', { engine: 3, tyres: 3 }, 'turbo'),
    };
    this.road = null;
    this.mode = 'run';
    this.modeT = 0;
    this.trickIn = 3;
    this.drift = 0;
    this.extra = 0; // spin added on top of the drift (360s, 180s)
    this.lat = 0; this.latV = 0; this.targetLat = 0;
    this.v = 20;
    this.smoke = [0, 0];
    this.p = {};
    this.q = {};
  }

  // Position on a road at distance s, with the unit tangent.
  sample(road, s, out) {
    const S = road.samples;
    const f = clamp(s / 3, 0, S.length - 1.001);
    const i = Math.floor(f), t = f - i, a = S[i], b = S[i + 1];
    out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
    out.tx = a.tx + (b.tx - a.tx) * t; out.tz = a.tz + (b.tz - a.tz) * t;
    const L = Math.hypot(out.tx, out.tz) || 1;
    out.tx /= L; out.tz /= L;
    return out;
  }

  // Somewhere on a road 120-300 m from the player, headed their way more often than not.
  respawn(player) {
    for (let tries = 0; tries < 40; tries++) {
      const road = this.roads[Math.floor(Math.random() * this.roads.length)];
      const s = 30 + Math.random() * (road.length - 60);
      const p = this.sample(road, s, this.p);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < 120 || d > 300) continue;
      this.road = road;
      this.s = s;
      // Toward the player when possible.
      this.dir = (player.x - p.x) * p.tx + (player.z - p.z) * p.tz > 0 ? 1 : -1;
      if (Math.random() < 0.25) this.dir = -this.dir;
      this.v = road.speed * 1.6;
      this.lat = this.targetLat = 0; this.latV = 0;
      this.mode = 'run'; this.extra = 0; this.trickIn = 1 + Math.random() * 3;
      return true;
    }
    return false;
  }

  // Road heading change per metre ahead (signed), for how hard to throw it sideways.
  curvature(road, s, dir) {
    const a = this.sample(road, s, this.p), ax = a.tx * dir, az = a.tz * dir;
    const b = this.sample(road, s + dir * 14, this.q);
    const h0 = Math.atan2(ax, az), h1 = Math.atan2(b.tx * dir, b.tz * dir);
    return wrap(h1 - h0) / 14;
  }

  update(dt, player, cam, traffic, fx) {
    dt = Math.min(dt, 0.05);
    const d0 = this.road ? Math.hypot(this.car.x - player.x, this.car.z - player.z) : Infinity;
    if (!this.road || d0 > 650) { if (!this.respawn(player)) return; }
    const road = this.road, c = this.car;
    const k = this.curvature(road, this.s, this.dir);
    const street = road.kind === 'street' || road.kind === 'boulevard' || road.kind === 'village';

    // Speed: very fast, easing only for the tightest bends (he has grip nobody else has).
    const vmax = Math.min(46, Math.sqrt(16 / Math.max(Math.abs(k), 1e-4)), road.speed * (street ? 1.9 : 2.3));
    if (this.mode === 'uturn') this.v = Math.max(6, this.v - 30 * dt);
    else this.v += clamp(vmax - this.v, -14 * dt, 7 * dt);

    // Weaving: the lateral spot with the most room ahead, other lane included. Cars and the player count.
    const hw = road.hw - 1.3;
    const fx0 = this.sample(road, this.s, this.p);
    const threats = [];
    const see = (ox, oz) => {
      const dx = ox - c.x, dz = oz - c.z;
      const ahead = (dx * fx0.tx + dz * fx0.tz) * this.dir;
      if (ahead < -4 || ahead > 45) return;
      const lat = dx * -fx0.tz + dz * fx0.tx; // + right of the road direction
      threats.push(lat * this.dir);
    };
    for (const o of traffic.cars) see(o.x, o.z);
    see(player.x, player.z);
    if (threats.length) {
      let best = this.targetLat, bestRoom = -1;
      for (let t = -hw; t <= hw + 1e-6; t += hw / 3) {
        const room = Math.min(...threats.map((l) => Math.abs(l - t)));
        if (room > bestRoom + 0.4) { bestRoom = room; best = t; }
      }
      this.targetLat = best;
    } else if (Math.random() < dt * 0.4) this.targetLat = (Math.random() - 0.5) * hw * (street ? 1.6 : 1.2);
    this.latV += ((this.targetLat - this.lat) * 9 - this.latV * 5) * dt;
    this.lat = clamp(this.lat + this.latV * dt, -hw - 0.5, hw + 0.5);

    // Tricks: 360s on straights, manji swinging in town, donuts, a 180 at the road's end.
    this.trickIn -= dt;
    const left = this.dir > 0 ? road.length - this.s : this.s;
    if (this.mode === 'run' && left < 12 + this.v * 1.1) { this.mode = 'uturn'; this.modeT = 0; }
    if (this.mode === 'run' && this.trickIn <= 0) {
      const roll = Math.random();
      if (street && roll < 0.22 && this.v < 30) { this.mode = 'donut'; this.modeT = 0; this.donut = null; }
      else if (street && roll < 0.6) { this.mode = 'manji'; this.modeT = 0; }
      else if (Math.abs(k) < 0.01 && this.v > 14) { this.mode = 'spin'; this.modeT = 0; this.spinDir = Math.random() < 0.5 ? 1 : -1; }
      this.trickIn = 3 + Math.random() * 5;
    }
    this.modeT += dt;

    // Drift angle: thrown into the bend (nose toward the inside), always a bit sideways on the straights.
    // On the straights he holds a steady slide one way, then flicks it over to the other side.
    this.styleT = (this.styleT ?? 0) - dt;
    if (this.styleT <= 0) { this.style = -(this.style || 1); this.styleT = 2.5 + Math.random() * 3; }
    let target = clamp(k * 900, -1.3, 1.3);
    if (Math.abs(target) < 0.45) target = this.style * (0.45 + 0.08 * Math.sin(this.modeT * 2.3));
    if (this.mode === 'manji') { target = Math.sign(Math.sin(this.modeT * 3.4)) * 0.95; if (this.modeT > 4) this.mode = 'run'; }
    this.drift += (target - this.drift) * Math.min(1, dt * (this.mode === 'manji' ? 6 : 3.5));
    if (this.mode === 'spin') {
      this.extra = this.spinDir * Math.min(1, this.modeT / 1.1) * TAU;
      if (this.modeT >= 1.1) { this.extra = 0; this.mode = 'run'; }
    }

    let px, pz, travel;
    if (this.mode === 'donut') {
      // Two laps round a point beside the road, sliding at 70 degrees, back where it started.
      const p = this.sample(road, this.s, this.p);
      if (!this.donut) {
        const side = Math.random() < 0.5 ? 1 : -1, R = 4.2;
        const nx = -p.tz * side, nz = p.tx * side;
        const sx = p.x - p.tz * this.lat, sz = p.z + p.tx * this.lat;
        this.donut = { cx: sx + nx * R, cz: sz + nz * R, R, a0: Math.atan2(sx - (sx + nx * R), sz - (sz + nz * R)), side };
      }
      const D = this.donut, w = 3.0 * D.side * this.dir;
      const a = D.a0 + w * this.modeT;
      px = D.cx + Math.sin(a) * D.R; pz = D.cz + Math.cos(a) * D.R;
      travel = a + Math.sign(w) * Math.PI / 2;
      this.drift = Math.sign(w) * 1.2;
      this.v = 13;
      if (this.modeT >= (2 * TAU) / Math.abs(w)) { this.mode = 'run'; this.donut = null; }
    } else {
      this.s += this.dir * this.v * dt;
      const p = this.sample(road, this.s, this.p);
      px = p.x - p.tz * this.lat * this.dir; pz = p.z + p.tx * this.lat * this.dir;
      travel = Math.atan2(p.tx * this.dir, p.tz * this.dir) + Math.atan2(-this.latV, Math.max(4, this.v)) * 0.6;
      if (this.mode === 'uturn') {
        this.extra = Math.min(1, this.modeT / 1.3) * Math.PI * (this.uturnSide ||= Math.random() < 0.5 ? 1 : -1);
        if (this.modeT >= 1.3) { this.dir = -this.dir; this.extra = 0; this.mode = 'run'; this.uturnSide = 0; }
      }
    }
    if (this.s < 1 || this.s > road.length - 1) this.respawn(player);

    // The state the car model and the smoke read.
    const prevH = c.h;
    c.vx = (px - c.x) / dt; c.vz = (pz - c.z) / dt;
    if (Math.hypot(c.vx, c.vz) > 80) { c.vx = Math.sin(travel) * this.v; c.vz = Math.cos(travel) * this.v; }
    c.x = px; c.z = pz;
    c.h = travel + this.drift + this.extra;
    c.r = wrap(c.h - prevH) / dt;
    c.speed = this.v;
    const side = Math.abs(Math.sin(this.drift + this.extra));
    c.u = this.v * Math.cos(this.drift);
    c.steer = clamp(-this.drift * 0.55, -0.6, 0.6); // opposite lock
    c.ay = clamp(this.v * this.v * k, -14, 14);
    c.ax = 0;
    c.handbrake = this.mode === 'uturn' || this.mode === 'spin';
    c.wheelSpinAngle += ((this.v * 1.35 + 6) / 0.33) * dt;
    c.rpm = 6400 + Math.sin(performance.now() / 90) * 500 + side * 800;
    c.gear = this.v > 30 ? 4 : 3;
    const slide = this.v * Math.max(side, this.mode === 'spin' || this.mode === 'donut' ? 0.9 : 0);
    c.slip[2] = c.slip[3] = slide;

    const ground = { y: this.groundAt(c.x, c.z), pitch: 0, roll: 0 };
    this.view.update(c, dt, ground);
    // Name over the car, readable from a distance.
    const dc = Math.hypot(c.x - cam.x, c.z - cam.z);
    this.tag.position.set(c.x, ground.y + 2.5 + Math.min(4, dc * 0.012), c.z);
    this.tag.scale.set(3.6, 0.9, 1).multiplyScalar(Math.max(1, dc / 45));
    this.root.visible = dc < 700;

    // Smoke and marks off the rear tyres.
    if (fx && dc < 260) {
      const sh = Math.sin(c.h), ch = Math.cos(c.h), track = this.view.rearTrack, back = -this.view.rearZ;
      for (const s of [-1, 1]) {
        const wx = c.x + ch * s * track - sh * back, wz = c.z - sh * s * track - ch * back;
        const st = clamp((slide - 2) / 9, 0, 1);
        fx.skids?.mark(100 + s, wx, wz, st > 0.08 ? 0.22 + st * 0.45 : 0, fx.clock, 0.25, ground.y + 0.03);
        const kk = s > 0 ? 1 : 0;
        this.smoke[kk] += st * st * dt * (fx.rate || 60);
        while (this.smoke[kk] >= 1) {
          this.smoke[kk] -= 1;
          fx.particles.emit(wx, ground.y + 0.3, wz, c.vx * 0.3 + (Math.random() - 0.5) * 2.4, 0.4 + Math.random() * 0.6, c.vz * 0.3 + (Math.random() - 0.5) * 2.4, 1.0 + Math.random() * 0.4, 2.6, 2.2 + Math.random() * 1.4, 0.3);
        }
      }
    }
  }

  // The player against John Doe: he is solid and doesn't budge; you bounce off.
  collide(car) {
    const c = this.car;
    if (!this.road || Math.abs(c.x - car.x) > 6 || Math.abs(c.z - car.z) > 6) return 0;
    let impact = 0;
    const hs = Math.sin(c.h), hc = Math.cos(c.h), ps = Math.sin(car.h), pc = Math.cos(car.h);
    for (const a of [1.2, -1.2]) for (const b of [1.3, -1.3]) {
      const jx = c.x + hs * a, jz = c.z + hc * a, px = car.x + ps * b, pz = car.z + pc * b;
      const dx = px - jx, dz = pz - jz, d = Math.hypot(dx, dz);
      if (d >= 2 || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, pen = 2 - d;
      car.x += nx * pen; car.z += nz * pen;
      const rel = (car.vx - c.vx) * nx + (car.vz - c.vz) * nz;
      if (rel < 0) {
        impact = Math.max(impact, -rel);
        car.applyImpulse(ps * b, pc * b, -nx * rel * car.spec.mass * 1.3, -nz * rel * car.spec.mass * 1.3);
      }
    }
    return impact;
  }

  drawMinimap(g, car, W, pxPerM) {
    if (!this.road) return;
    const dx = this.car.x - car.x, dz = this.car.z - car.z;
    const ch = Math.cos(car.h), sh = Math.sin(car.h);
    const right = dx * -ch + dz * sh, fwd = dx * sh + dz * ch;
    const x = clamp(W / 2 + right * pxPerM, 8, W - 8), y = clamp(W / 2 - fwd * pxPerM, 8, W - 8);
    g.fillStyle = '#ff3fa4';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill(); g.stroke();
    g.font = 'bold 10px sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center';
    g.fillText('JD', x, y - 9);
  }

  setLights(on) { this.view.setLights(on); }
  setEnvMap(t) { this.view.setEnvMap(t); }
  dispose() { this.view.dispose(); this.tag.material.map.dispose(); this.tag.material.dispose(); }
}
