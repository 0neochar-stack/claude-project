// Police. At night, banked drift chains build heat; past the threshold a cruiser is dispatched and chases
// you with the same car physics you drive. Stop near it and you are busted (a fine); get far enough away
// for long enough and you have evaded (a bonus). Sirens, flashing light bar, blips on the minimap.
import * as THREE from 'three';
import { CarBody } from '../../physics.js';
import { buildSpec } from '../../garage.js';
import { carLowGeometry } from '../../car.js';
import { roadQuery, smooth } from './layout.js';

const THRESHOLD = 25000; // night drift points for full heat
const G = 9.81;

export class Police {
  constructor(net, groundAt, sound) {
    this.net = net;
    this.groundAt = groundAt;
    this.sound = sound;
    this.group = new THREE.Group();
    this.heat = 0;
    this.state = 'calm'; // calm | chase | busting
    this.cops = [];
    this.timer = 0;
    this.bustTimer = 0;
    this.lostTimer = 0;
    this.msg = null;
    const geo = carLowGeometry({ body: 'v37', scale: [1.02, 0.97, 1.05], police: true }, 0x111111);
    this.geo = geo;
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.3 });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.red = new THREE.MeshBasicMaterial({ color: 0xff1020 });
    this.blue = new THREE.MeshBasicMaterial({ color: 0x1a50ff });
  }

  makeCop(x, z, h) {
    const car = new CarBody(buildSpec('v37', { engine: 3, tyres: 3 }, 'turbo'));
    car.assist = 1;
    car.reset(x, z, h);
    car.launch(14, 2);
    const root = new THREE.Group();
    const body = new THREE.Mesh(this.geo.body, this.bodyMat);
    body.castShadow = true;
    root.add(body, new THREE.Mesh(this.geo.lights, this.lightMat));
    const top = this.geo.roof + 0.06;
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.26), this.red);
    r.position.set(0.32, top, -0.35);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.26), this.blue);
    b.position.set(-0.32, top, -0.35);
    root.add(r, b);
    this.group.add(root);
    return { car, root, r, b, stuck: 0, reverse: 0 };
  }

  // Night drifting builds heat.
  onDrift(points, night) {
    if (night < 0.6 || this.state !== 'calm') return;
    this.heat += points / THRESHOLD;
    if (this.heat >= 1) this.msg = { text: 'Heat is up · police on the way', kind: 'cop' };
  }

  reset() {
    for (const c of this.cops) c.root.removeFromParent();
    this.cops.length = 0;
    this.state = 'calm';
    this.heat = 0;
    this.sound.setAmbience({ siren: 0 });
  }

  // Somewhere on a road 150-260 m from the player, behind them if possible.
  dispatch(player) {
    const fx = Math.sin(player.h), fz = Math.cos(player.h);
    let best = null;
    for (const r of this.net.roads) for (let i = 0; i < r.samples.length; i += 6) {
      const p = r.samples[i];
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
      if (d < 150 || d > 260) continue;
      const behind = -(dx * fx + dz * fz) / d;
      const score = behind + Math.random() * 0.3;
      if (!best || score > best.score) best = { score, p, r };
    }
    if (!best) return false;
    const h = Math.atan2(player.x - best.p.x, player.z - best.p.z);
    this.cops.push(this.makeCop(best.p.x, best.p.z, h));
    return true;
  }

  update(dt, player, ctx, night, collideStatic) {
    const { hud, profile } = ctx;
    // Heat cools slowly when nothing is happening.
    if (this.state === 'calm') {
      this.heat = Math.max(0, this.heat - dt * 0.004);
      if (this.heat >= 1 && night > 0.5) {
        if (this.dispatch(player)) {
          this.state = 'chase';
          this.lostTimer = 0;
          this.bustTimer = 0;
          hud.banner('Police pursuit', 'cop');
        }
      }
    }
    if (this.msg) { hud.toast(this.msg.text); this.msg = null; }
    let nearest = Infinity;
    for (const cop of this.cops) {
      const c = cop.car;
      // Aim a little ahead of where the player is going.
      const lead = Math.min(1.2, Math.hypot(c.x - player.x, c.z - player.z) / 40);
      const tx = player.x + player.vx * lead, tz = player.z + player.vz * lead;
      const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(player.x - c.x, player.z - c.z);
      nearest = Math.min(nearest, dist);
      const want = Math.atan2(dx, dz);
      let diff = Math.atan2(Math.sin(want - c.h), Math.cos(want - c.h));
      const input = { throttle: 1, brake: 0, steer: 0, handbrake: false, clutch: false };
      if (cop.reverse > 0) {
        cop.reverse -= dt;
        input.throttle = 0; input.brake = 1; input.steer = -Math.sign(diff);
      } else {
        input.steer = Math.max(-1, Math.min(1, diff * 2.4));
        // Close in, then match the player's speed rather than ramming at full tilt.
        const closing = dist < 14 ? Math.max(0, (dist - 5) / 9) : 1;
        input.throttle = Math.abs(diff) > 1.6 ? 0.4 : closing;
        if (dist < 9 && c.speed > player.speed + 3) input.brake = 0.6;
        input.handbrake = Math.abs(diff) > 1.3 && c.speed > 14;
      }
      // Stuck against something: back up and try again.
      if (c.speed < 1.2 && dist > 15) cop.stuck += dt; else cop.stuck = 0;
      if (cop.stuck > 1.6) { cop.reverse = 1.4; cop.stuck = 0; }
      // Same physics as the player: slope, surface, walls.
      const STEP = 1 / 60;
      for (let t = 0; t < dt - 1e-6; t += STEP) {
        const h = Math.min(STEP, dt - t);
        const gx = (this.groundAt(c.x + 1, c.z) - this.groundAt(c.x - 1, c.z)) / 2, gz = (this.groundAt(c.x, c.z + 1) - this.groundAt(c.x, c.z - 1)) / 2;
        const k = G / (1 + gx * gx + gz * gz);
        c.gx = -gx * k; c.gz = -gz * k;
        c.step(h, input);
        collideStatic(c);
      }
      // Way behind and out of sight: catch up off-screen.
      if (dist > 320) this.teleportBehind(cop, player);
      const y = this.groundAt(c.x, c.z);
      cop.root.position.set(c.x, y, c.z);
      cop.root.rotation.y = c.h;
      const flash = Math.floor(performance.now() / 130) % 2;
      cop.r.material.color.setRGB(flash ? 6 : 0.4, 0.05, 0.1);
      cop.b.material.color.setRGB(0.05, 0.25, flash ? 0.4 : 6);
    }
    this.lightMat.color.setScalar(0.5 + night * 2.2);
    if (this.state === 'chase') {
      // Busted: stopped next to a cruiser. Evaded: well clear for long enough.
      if (nearest < 9 && player.speed < 2.5) this.bustTimer += dt; else this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
      if (nearest > 230) this.lostTimer += dt; else this.lostTimer = Math.max(0, this.lostTimer - dt);
      if (this.bustTimer > 2.5) {
        const fine = Math.min(profile.credits, 1500);
        profile.credits -= fine;
        profile.save();
        hud.banner(`Busted  −${fine.toLocaleString('en-US')} CR`, 'busted');
        this.reset();
      } else if (this.lostTimer > 9) {
        const bonus = profile.earn(15000);
        hud.banner(`Evaded  +${bonus.toLocaleString('en-US')} CR`, 'evade');
        this.reset();
      }
    }
    hud.setHeat({
      level: this.state === 'chase' ? Math.min(1, this.lostTimer / 9) : Math.min(1, this.heat),
      state: this.state === 'chase' ? (this.bustTimer > 0.5 ? 'busting' : this.lostTimer > 1 ? 'evading' : 'chase') : 'calm',
      note: this.state === 'chase' ? (this.bustTimer > 0.5 ? 'Pull away!' : `${Math.round(nearest)} m`) : night > 0.5 ? 'Night patrol' : 'Day: no patrols',
    });
    this.nearest = nearest;
  }

  teleportBehind(cop, player) {
    const fx = Math.sin(player.h), fz = Math.cos(player.h);
    const q = {};
    const x = player.x - fx * 140, z = player.z - fz * 140;
    roadQuery(this.net, x, z, q);
    if (!q.road) return;
    cop.car.reset(q.x, q.z, Math.atan2(player.x - q.x, player.z - q.z));
    cop.car.launch(Math.max(15, player.speed), 3);
  }

  // Cruisers against the player: two circles each, with an even shove both ways (PIT moves work).
  collide(car) {
    let impact = 0;
    for (const cop of this.cops) {
      const c = cop.car;
      if (Math.abs(c.x - car.x) > 7 || Math.abs(c.z - car.z) > 7) continue;
      const s1 = Math.sin(car.h), c1 = Math.cos(car.h), s2 = Math.sin(c.h), c2 = Math.cos(c.h);
      for (const o1 of [1.3, -1.3]) for (const o2 of [1.3, -1.3]) {
        const ax = car.x + s1 * o1, az = car.z + c1 * o1, bx = c.x + s2 * o2, bz = c.z + c2 * o2;
        const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz);
        if (d >= 2 || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, pen = 2 - d;
        car.x += nx * pen / 2; car.z += nz * pen / 2; c.x -= nx * pen / 2; c.z -= nz * pen / 2;
        const p1x = s1 * o1, p1z = c1 * o1, p2x = s2 * o2, p2z = c2 * o2;
        const va = { x: car.vx + car.r * p1z, z: car.vz - car.r * p1x }, vb = { x: c.vx + c.r * p2z, z: c.vz - c.r * p2x };
        const vn = (va.x - vb.x) * nx + (va.z - vb.z) * nz;
        if (vn >= 0) continue;
        impact = Math.max(impact, -vn);
        const ra = p1z * nx - p1x * nz, rb = p2z * nx - p2x * nz;
        const j = (-(1.25) * vn) / (1 / car.spec.mass + 1 / c.spec.mass + ra * ra / car.spec.inertia + rb * rb / c.spec.inertia);
        car.applyImpulse(p1x, p1z, nx * j, nz * j);
        c.applyImpulse(p2x, p2z, -nx * j, -nz * j);
      }
    }
    return impact;
  }

  sirenLevel(player) {
    if (!this.cops.length) return 0;
    return 1 - smooth(25, 320, this.nearest ?? Infinity);
  }

  drawMinimap(g, car, W, pxPerM) {
    const flash = Math.floor(performance.now() / 200) % 2;
    for (const cop of this.cops) {
      const dx = cop.car.x - car.x, dz = cop.car.z - car.z;
      // Rotate into the car's frame: forward is up on the map.
      const ch = Math.cos(car.h), sh = Math.sin(car.h);
      const right = dx * -ch + dz * sh, fwd = dx * sh + dz * ch;
      const px = W / 2 + right * pxPerM, py = W / 2 - fwd * pxPerM;
      const x = Math.max(8, Math.min(W - 8, px)), y = Math.max(8, Math.min(W - 8, py));
      g.fillStyle = flash ? '#ff3b4e' : '#3b8bff';
      g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
    }
  }
}
