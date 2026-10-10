// John Doe: the open world's legend. A fully built S15 that never crashes and never vanishes - he drives a
// real route through the road network, turning at junctions (heading your way when he's far off), and
// he's always out there flat out.
//
// His driving is calculated, not random: straight on the straights, and every corner gets a proper drift -
// a flick the other way to load the car up, then an angle sized to how hard the corner turns, held to the
// apex and straightened on the exit. In the neighbourhoods he links manji swings. And he messes with you:
// rams your rear quarter, slides across your nose in a big lazy drift, and if you stop, he circles you
// in a donut before blasting off.
//
// He's driven by script rather than the tyre physics, so he can't lose it. Smoke and skid marks come from
// how far he's sideways.
import * as THREE from 'three';
import { buildCar } from '../../car.js';
import { radialTexture } from '../../fx.js';
import { CARS, buildSpec } from '../../garage.js';
import { roadQuery } from './layout.js';

const LOOK = { ...(CARS.find((c) => c.id === 's15') || CARS[0]).look, paint: 1, neon: 2, rims: 3, wing: 2 };
const TAU = Math.PI * 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GRIP = 20; // m/s² of cornering he can pull: far more than anyone else on the road

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

// A quadratic Bézier from p0 through control p1 to p2: position and heading at t.
function bez(c, t, out) {
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
  out.x = a * c.p0.x + b * c.p1.x + d * c.p2.x;
  out.z = a * c.p0.z + b * c.p1.z + d * c.p2.z;
  const tx = 2 * (1 - t) * (c.p1.x - c.p0.x) + 2 * t * (c.p2.x - c.p1.x);
  const tz = 2 * (1 - t) * (c.p1.z - c.p0.z) + 2 * t * (c.p2.z - c.p1.z);
  out.h = Math.atan2(tx, tz);
  return out;
}

export class JohnDoe {
  constructor(net, groundAt, envMap, headlights) {
    this.net = net;
    this.groundAt = groundAt;
    this.roads = net.roads.filter((r) => r.length > 60 && r.kind !== 'pier');
    this.buildJunctions();
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
    this.drift = 0;
    this.extra = 0;
    this.lat = 0; this.latV = 0; this.targetLat = 0;
    this.v = 20;
    this.travel = 0;
    this.omega = 0;
    this.smoke = [0, 0];
    this.plan = null; // the next junction and what he'll do there
    this.curve = null; // a turn, merge or approach in progress
    this.manjiIn = 6;
    this.harassIn = 8;
    this.p = {}; this.q = {}; this.b = {};
  }

  // Where roads meet: for each road, the places another road crosses or ends on it.
  buildJunctions() {
    const C = 6, grid = new Map(), key = (x, z) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
    this.roads.forEach((r, ri) => r.samples.forEach((p, i) => {
      const k = key(p.x, p.z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(ri, i);
    }));
    this.junctions = this.roads.map(() => []);
    this.roads.forEach((A, ai) => {
      const found = new Map(); // other road index -> [{sA, sB, d}]
      A.samples.forEach((p) => {
        const cx = Math.floor(p.x / C), cz = Math.floor(p.z / C);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const l = grid.get(`${cx + a},${cz + b}`);
          if (!l) continue;
          for (let k = 0; k < l.length; k += 2) {
            const bi = l[k];
            if (bi === ai) continue;
            const q = this.roads[bi].samples[l[k + 1]];
            const d = Math.hypot(q.x - p.x, q.z - p.z);
            if (d > 3.4) continue;
            if (!found.has(bi)) found.set(bi, []);
            found.get(bi).push({ sA: p.s, sB: q.s, d });
          }
        }
      });
      for (const [bi, list] of found) {
        list.sort((u, w) => u.sA - w.sA);
        let group = [];
        const flush = () => { if (group.length) { const best = group.reduce((m, g) => (g.d < m.d ? g : m)); this.junctions[ai].push({ s: best.sA, road: this.roads[bi], sB: best.sB }); } group = []; };
        for (const c of list) { if (group.length && c.sA - group[group.length - 1].sA > 20) flush(); group.push(c); }
        flush();
      }
      this.junctions[ai].sort((u, w) => u.s - w.s);
    });
    this.roadIndex = new Map(this.roads.map((r, i) => [r, i]));
    // Route graph: nodes at every junction and road end, edges along the roads and across junctions.
    this.nodes = [];
    this.byRoad = this.roads.map(() => []);
    const nodeAt = (ri, sv) => {
      const list = this.byRoad[ri];
      let n = list.find((m) => Math.abs(m.s - sv) < 10);
      if (!n) { n = { id: this.nodes.length, ri, s: sv, adj: [] }; this.nodes.push(n); list.push(n); }
      return n;
    };
    this.roads.forEach((r, ri) => { nodeAt(ri, 0); nodeAt(ri, r.length); });
    this.roads.forEach((r, ri) => {
      for (const j of this.junctions[ri]) {
        const a = nodeAt(ri, j.s), b = nodeAt(this.roadIndex.get(j.road), j.sB);
        a.adj.push([b, 0]); b.adj.push([a, 0]);
      }
    });
    this.byRoad.forEach((list) => {
      list.sort((u, w) => u.s - w.s);
      for (let i = 0; i + 1 < list.length; i++) { const L = list[i + 1].s - list[i].s; list[i].adj.push([list[i + 1], L]); list[i + 1].adj.push([list[i], L]); }
    });
    this.dist = new Float64Array(this.nodes.length).fill(Infinity);
    this.routeIn = 0;
  }

  // Road distance from every node to the player (Dijkstra from where they are).
  route(player) {
    roadQuery(this.net, player.x, player.z, this.b);
    const ri = this.b.road ? this.roadIndex.get(this.b.road) : undefined;
    const D = this.dist.fill(Infinity);
    this.target = null;
    if (ri === undefined) return;
    const s0 = this.b.s;
    this.target = { ri, s: s0 };
    const open = [];
    for (const n of this.byRoad[ri]) { D[n.id] = Math.abs(n.s - s0); open.push(n); }
    const done = new Uint8Array(this.nodes.length);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (D[open[i].id] < D[open[bi].id]) bi = i;
      const n = open[bi];
      open.splice(bi, 1);
      if (done[n.id]) continue;
      done[n.id] = 1;
      for (const [m, w] of n.adj) if (D[n.id] + w < D[m.id]) { D[m.id] = D[n.id] + w; open.push(m); }
    }
  }

  // Road distance to the player going from (road, s) in direction dir.
  costFrom(road, s, dir) {
    const ri = this.roadIndex.get(road);
    if (this.target && this.target.ri === ri && (this.target.s - s) * dir >= 0) return Math.abs(this.target.s - s);
    let best = Infinity;
    for (const n of this.byRoad[ri]) {
      const ds = (n.s - s) * dir;
      if (ds < 1) continue;
      best = Math.min(best, ds + this.dist[n.id]);
      break; // the first node ahead decides (nodes are sorted by s for dir > 0)
    }
    if (dir < 0) {
      best = Infinity;
      for (let i = this.byRoad[ri].length - 1; i >= 0; i--) { const n = this.byRoad[ri][i]; const ds = s - n.s; if (ds < 1) continue; best = ds + this.dist[n.id]; break; }
    }
    return best;
  }

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

  // A point on a road with a lateral offset (+ is to the right of the direction of travel).
  at(road, s, dir, lat, out) {
    const p = this.sample(road, s, out);
    out.x = p.x - p.tz * lat * dir; out.z = p.z + p.tx * lat * dir;
    out.h = Math.atan2(p.tx * dir, p.tz * dir);
    return out;
  }

  // First placement only: on a road a little way from the player.
  place(player) {
    for (let tries = 0; tries < 60; tries++) {
      const road = this.roads[Math.floor(Math.random() * this.roads.length)];
      if (road.length < 150) continue;
      const s = 40 + Math.random() * (road.length - 80);
      const p = this.sample(road, s, this.p);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < 120 || d > 320) continue;
      this.road = road; this.s = s;
      this.dir = (player.x - p.x) * p.tx + (player.z - p.z) * p.tz > 0 ? 1 : -1;
      this.v = road.speed * 1.5;
      this.lat = this.targetLat = road.hw * 0.3; this.latV = 0;
      this.mode = 'run'; this.plan = null; this.curve = null;
      this.travel = Math.atan2(p.tx * this.dir, p.tz * this.dir);
      const q = this.at(road, s, this.dir, this.lat, this.q);
      this.car.x = q.x; this.car.z = q.z; this.car.h = q.h;
      return true;
    }
    return false;
  }

  // Turn round: the lateral offset is relative to the direction, so it flips too (no sideways jump).
  flip() {
    this.dir = -this.dir;
    this.lat = -this.lat; this.targetLat = -this.targetLat; this.latV = -this.latV;
  }

  // Pick what to do at the next junction ahead: carry on, or turn onto the other road either way.
  planNext(player) {
    const ai = this.roadIndex.get(this.road);
    const ahead = this.junctions[ai].filter((j) => (j.s - this.s) * this.dir > 6).sort((u, w) => (u.s - this.s) * this.dir - (w.s - this.s) * this.dir);
    const j = ahead[0];
    const endS = this.dir > 0 ? this.road.length : 0;
    if (!j) return { kind: 'end', s: endS - this.dir * (25 + this.v * 0.8) };
    const opts = [];
    const roomA = this.dir > 0 ? this.road.length - j.s : j.s;
    if (roomA > 45) opts.push({ kind: 'straight' });
    // Every road meeting here (three or four can share one point), either way along it.
    for (const jj of ahead.filter((x) => Math.abs(x.s - j.s) < 12)) {
      for (const d2 of [1, -1]) {
        const room = d2 > 0 ? jj.road.length - jj.sB : jj.sB;
        if (room > 45) opts.push({ kind: 'turn', road: jj.road, dir: d2, sB: jj.sB, j: jj });
      }
    }
    if (!opts.length) return { kind: 'end', s: endS - this.dir * (25 + this.v * 0.8) };
    const dPlayer = Math.hypot(player.x - this.car.x, player.z - this.car.z);
    let pick;
    if (dPlayer > 120 && this.target) {
      // Head for the player: the exit with the shortest road distance to them.
      const cost = (o) => (o.kind === 'turn' ? this.costFrom(o.road, o.sB, o.dir) : this.costFrom(this.road, j.s, this.dir)) + Math.random() * 15;
      pick = opts.reduce((m, o) => (cost(o) < cost(m) ? o : m));
    } else {
      const turns = opts.filter((o) => o.kind === 'turn');
      pick = turns.length && (Math.random() < 0.6 || !opts.some((o) => o.kind === 'straight')) ? turns[Math.floor(Math.random() * turns.length)] : opts.find((o) => o.kind === 'straight') || opts[0];
    }
    return { j, ...pick };
  }

  // Lay out a turn onto another road as a curve through the junction.
  startTurn(plan) {
    const c = this.car;
    const Lout = 14;
    const lane = plan.road.hw * 0.35;
    const p1 = this.sample(this.road, plan.j.s, this.p);
    const p2 = this.at(plan.road, plan.sB + plan.dir * Lout, plan.dir, lane, this.q);
    const curve = { p0: { x: c.x, z: c.z }, p1: { x: p1.x, z: p1.z }, p2: { x: p2.x, z: p2.z }, t: 0 };
    curve.len = Math.hypot(curve.p1.x - c.x, curve.p1.z - c.z) + Math.hypot(p2.x - curve.p1.x, p2.z - curve.p1.z);
    curve.end = { road: plan.road, dir: plan.dir, s: plan.sB + plan.dir * Lout, lat: lane };
    this.curve = curve;
  }

  // A curve from wherever he is back onto his road (after circling the player).
  startMerge() {
    const c = this.car;
    roadQuery(this.net, c.x, c.z, this.b);
    const road = this.b.road && this.roadIndex.has(this.b.road) ? this.b.road : this.road;
    const near = this.b.road === road ? this.b.s : this.s;
    const tx = this.b.road === road ? this.b.tx : 1, tz = this.b.road === road ? this.b.tz : 0;
    const dir = Math.sin(c.h) * tx + Math.cos(c.h) * tz >= 0 ? 1 : -1;
    const s2 = clamp(near + dir * 25, 30, road.length - 30);
    const p2 = this.at(road, s2, dir, road.hw * 0.35, this.q);
    const mid = { x: c.x + Math.sin(c.h) * 10, z: c.z + Math.cos(c.h) * 10 };
    this.curve = { p0: { x: c.x, z: c.z }, p1: mid, p2: { x: p2.x, z: p2.z }, t: 0, len: Math.hypot(mid.x - c.x, mid.z - c.z) + Math.hypot(p2.x - mid.x, p2.z - mid.z), end: { road, dir, s: s2, lat: road.hw * 0.35 } };
  }

  update(dt, player, cam, traffic, fx) {
    dt = Math.min(dt, 0.05);
    if (!this.road && !this.place(player)) return;
    const c = this.car;
    const road = this.road;
    const dPlayer = Math.hypot(c.x - player.x, c.z - player.z);
    const street = road.kind === 'street' || road.kind === 'boulevard' || road.kind === 'village';
    this.modeT += dt;
    this.manjiIn -= dt;
    this.harassIn -= dt;

    // Refresh the road distances to the player every couple of seconds.
    this.routeIn -= dt;
    if (this.routeIn <= 0) { this.routeIn = 2; this.route(player); }
    // Where the player is relative to his road.
    roadQuery(this.net, player.x, player.z, this.b);
    const onMyRoad = this.b.road === road && Math.abs(this.b.lat) < road.hw + 2;
    const pAhead = onMyRoad ? (this.b.s - this.s) * this.dir : Infinity;
    const pLat = onMyRoad ? this.b.lat * this.dir : 0;
    const pSameWay = (player.vx * Math.sin(this.travel) + player.vz * Math.cos(this.travel)) > 2;

    // ---- choosing what to do ----
    if (this.mode === 'run' && !this.curve) {
      if (this.harassIn <= 0 && dPlayer < 140) {
        if (player.speed < 2) { this.mode = 'circle'; this.modeT = 0; this.circle = null; }
        else if (onMyRoad && pAhead > 6 && pAhead < 45 && pSameWay) { this.mode = 'bump'; this.modeT = 0; this.hit = false; this.bumpSide = Math.random() < 0.5 ? -1 : 1; }
        else if (onMyRoad && pAhead < -4 && pAhead > -40 && pSameWay) { this.mode = 'showoff'; this.modeT = 0; }
        if (this.mode !== 'run') this.harassIn = 18 + Math.random() * 12;
      }
      // The way to the player is back the way he came: swing it round with a 180.
      this.turnIn = (this.turnIn ?? 4) - dt;
      if (this.mode === 'run' && dPlayer > 150 && this.turnIn <= 0 && this.target) {
        const ahead = this.costFrom(road, this.s, this.dir), back = this.costFrom(road, this.s, -this.dir);
        if (back + 60 < ahead) { this.mode = 'jturn'; this.modeT = 0; this.jSide = Math.random() < 0.5 ? 1 : -1; this.turnIn = 8; this.plan = null; }
      }
      if (this.mode === 'run' && this.manjiIn <= 0 && Math.random() < dt * (street ? 1.5 : 0.5)) { this.mode = 'manji'; this.modeT = 0; this.manjiIn = 5 + Math.random() * 5; }
    }
    if (this.mode === 'bump' && (this.hit || this.modeT > 5 || !onMyRoad)) { this.mode = this.hit ? 'showoff' : 'run'; this.modeT = 0; }
    if (this.mode === 'showoff' && this.modeT > 4.5) { this.mode = 'run'; }
    if (this.mode === 'manji' && this.modeT > 4) { this.mode = 'run'; }

    // ---- speed ----
    const far = dPlayer > 300;
    let vWant = Math.min(road.speed * (street ? 2.1 : 2.5) * (far ? 1.35 : 1), far ? 62 : 50);
    if (!this.plan && !this.curve) this.plan = this.planNext(player);
    const plan = this.plan;
    // Brake for the turn ahead so it's taken at the speed his grip allows (superhuman, but not infinite).
    if (plan && !this.curve) {
      const hIn = this.travel;
      let hOut = hIn;
      if (plan.kind === 'turn') { const e = this.at(plan.road, plan.sB + plan.dir * 14, plan.dir, 0, this.q); hOut = e.h; }
      const ang = Math.abs(wrap(hOut - hIn));
      plan.turnSign = Math.sign(wrap(hOut - hIn));
      const R = ang > 0.15 ? 14 / Math.tan(Math.min(1.45, ang / 2)) : 200;
      const vTurn = clamp(Math.sqrt(GRIP * R), 10, 48);
      const dist = plan.kind === 'end' ? Math.abs(plan.s - this.s) : Math.abs(plan.j.s - this.s) - 14;
      if (plan.kind !== 'straight') vWant = Math.min(vWant, Math.sqrt(vTurn * vTurn + 2 * 15 * Math.max(0, dist)));
      plan.timeTo = Math.max(0, dist) / Math.max(5, this.v);
    }
    if (this.mode === 'bump') vWant = Math.max(8, player.speed + 7);
    if (this.mode === 'showoff') vWant = Math.max(10, player.speed + 1.5);
    if (this.mode === 'jturn') vWant = 7;
    this.v += clamp(vWant - this.v, -16 * dt, 8 * dt);

    // ---- lateral line: weave through traffic, line up on the player for a bump ----
    const hw = road.hw - 1.2;
    // On divided roads he keeps to his own side of the barrier or median.
    const lo = road.barrier || road.median ? 1.4 : -hw;
    const fit = (v) => clamp(v, lo, hw);
    if (this.mode === 'jturn' && lo > 0) this.targetLat = -(lo + 2); // a 180 across the median into the other carriageway
    else if (this.mode === 'bump') this.targetLat = fit(pLat + this.bumpSide * 0.7);
    else if (this.mode === 'showoff') this.targetLat = fit(lo > 0 ? (lo + hw) / 2 + Math.sin(this.modeT * 1.4) * (hw - lo) * 0.45 : Math.sin(this.modeT * 1.4) * hw * 0.85);
    else {
      const threats = [];
      const f = this.sample(road, this.s, this.p);
      const see = (ox, oz) => {
        const dx = ox - c.x, dz = oz - c.z;
        const ah = (dx * f.tx + dz * f.tz) * this.dir;
        if (ah < -4 || ah > 50) return;
        threats.push((dx * -f.tz + dz * f.tx) * this.dir);
      };
      for (const o of traffic.cars) see(o.x, o.z);
      see(player.x, player.z);
      if (threats.length) {
        let best = this.targetLat, room0 = -1;
        for (let t = lo; t <= hw + 1e-6; t += Math.max(0.5, (hw - lo) / 6)) {
          const room = Math.min(...threats.map((l) => Math.abs(l - t)));
          if (room > room0 + 0.4) { room0 = room; best = t; }
        }
        this.targetLat = best;
      } else this.targetLat = fit(road.hw * 0.35); // his own lane, mostly
    }
    const crossing = this.mode === 'jturn' && lo > 0;
    this.latV += ((this.targetLat - this.lat) * (crossing ? 22 : 8) - this.latV * (crossing ? 9 : 5)) * dt;
    this.lat = clamp(this.lat + this.latV * dt, lo > 0 && !crossing ? lo - 0.3 : -road.hw, road.hw);

    // ---- path ----
    let px, pz, travel;
    if (this.mode === 'circle') {
      // A donut round the stopped player: closes in, two laps at full lock, then merges back onto the road.
      if (!this.circle) this.circle = { a: 0, r: 0, w: Math.random() < 0.5 ? 1 : -1, turned: 0, phase: 'in' };
      const C = this.circle;
      if (C.phase === 'in') {
        // Drive straight at them, aiming just off to one side, until close enough to swing round.
        const ax = player.x + Math.cos(this.travel) * 6 * C.w, az = player.z - Math.sin(this.travel) * 6 * C.w;
        const dx = ax - c.x, dz = az - c.z, L = Math.hypot(dx, dz) || 1;
        const step = Math.min(L, this.v * dt);
        px = c.x + (dx / L) * step; pz = c.z + (dz / L) * step;
        travel = Math.atan2(dx, dz);
        this.v = Math.max(14, Math.min(this.v, 28));
        if (Math.hypot(px - player.x, pz - player.z) < 11) { C.phase = 'round'; C.a = Math.atan2(px - player.x, pz - player.z); C.r = Math.hypot(px - player.x, pz - player.z); }
      } else {
        // Two laps at full lock round them, the radius closing in gently.
        C.r += clamp(6.5 - C.r, -2 * dt, 2 * dt);
        const w = C.w * Math.max(1.2, this.v / C.r);
        C.a += w * dt; C.turned += Math.abs(w * dt);
        px = player.x + Math.sin(C.a) * C.r; pz = player.z + Math.cos(C.a) * C.r;
        travel = C.a + C.w * Math.PI / 2;
        this.v = Math.max(this.v - 10 * dt, 11);
      }
      if (C.turned > TAU * 2.2 || player.speed > 6 || this.modeT > 20) { this.mode = 'run'; this.circle = null; this.travel = travel; this.drift = C.w * 1.0; this.startMerge(); }
    } else if (this.curve) {
      const cv = this.curve;
      cv.t = Math.min(1, cv.t + (this.v * dt) / Math.max(5, cv.len));
      const b = bez(cv, cv.t, this.p);
      px = b.x; pz = b.z; travel = b.h;
      if (cv.t >= 1) {
        this.road = cv.end.road; this.dir = cv.end.dir; this.s = cv.end.s; this.lat = this.targetLat = cv.end.lat; this.latV = 0;
        this.curve = null; this.plan = null;
      }
    } else {
      // In a 180 the car pivots more than it travels.
      this.s += this.dir * this.v * dt * (this.mode === 'jturn' ? 0.35 : 1);
      const pt = this.at(road, this.s, this.dir, this.lat, this.p);
      px = pt.x; pz = pt.z;
      travel = pt.h + Math.atan2(-this.latV, Math.max(4, this.v)) * 0.6;
      // Into the junction's curve, or a handbrake 180 at a dead end.
      if (plan) {
        if (plan.kind === 'turn' && (plan.j.s - this.s) * this.dir <= 14) this.startTurn(plan);
        else if (plan.kind === 'straight' && (plan.j.s - this.s) * this.dir <= 0) this.plan = null;
        else if (plan.kind === 'end' && (plan.s - this.s) * this.dir <= 0 && this.mode !== 'jturn') { this.mode = 'jturn'; this.modeT = 0; this.jSide = Math.random() < 0.5 ? 1 : -1; }
      }
      if (this.mode === 'jturn') {
        this.extra = Math.min(1, this.modeT / 1.2) * Math.PI * this.jSide;
        if (this.modeT >= 1.2) { this.flip(); this.extra = 0; this.mode = 'run'; this.plan = null; travel += Math.PI; }
      }
      if (this.s < 2 || this.s > road.length - 2) {
        this.s = clamp(this.s, 3, road.length - 3);
        if (this.mode !== 'jturn') { this.mode = 'jturn'; this.modeT = 0; this.jSide = Math.random() < 0.5 ? 1 : -1; }
      }
    }

    // ---- the drift: sized to how fast the path turns, with a flick before each corner ----
    const dTravel = wrap(travel - this.travel);
    this.travel = travel;
    const omega = dTravel / dt;
    this.omega += (omega - this.omega) * Math.min(1, dt * 6);
    const w = this.omega;
    // Angle grows with how fast the path turns: about 20 degrees through a sweeper, 50 in a bend, 80+ in
    // a junction turn.
    let target = Math.sign(w) * Math.min(1.45, Math.sqrt(Math.abs(w)) * 1.3);
    if (Math.abs(w) < 0.03) target = 0; // straight means straight
    if (plan && plan.kind === 'turn' && !this.curve && plan.timeTo < 0.6 && plan.turnSign) target = -plan.turnSign * 0.55; // the flick
    if (this.mode === 'manji') target = Math.sign(Math.sin(this.modeT * 4.6)) * 1.15;
    if (this.mode === 'showoff') target = Math.cos(this.modeT * 1.4) * 1.4; // huge lazy swings across your nose
    if (this.mode === 'circle') target = (this.circle ? this.circle.w : 1) * 1.2;
    if (this.mode === 'bump') target = 0.15 * this.bumpSide;
    // Snaps in fast, unwinds slowly: he holds the angle out of every corner.
    const rate = this.mode === 'manji' ? 10 : Math.abs(target) > Math.abs(this.drift) ? 6 : 2.2;
    this.drift += (target - this.drift) * Math.min(1, dt * rate);

    // ---- the state the car model and the smoke read ----
    const prevH = c.h;
    c.vx = (px - c.x) / dt; c.vz = (pz - c.z) / dt;
    if (Math.hypot(c.vx, c.vz) > 90) { c.vx = Math.sin(travel) * this.v; c.vz = Math.cos(travel) * this.v; }
    c.x = px; c.z = pz;
    c.h = travel + this.drift + this.extra;
    c.r = wrap(c.h - prevH) / dt;
    c.speed = this.v;
    const side = Math.abs(Math.sin(this.drift + this.extra));
    c.u = this.v * Math.cos(this.drift);
    c.steer = clamp(-this.drift * 0.6, -0.65, 0.65); // opposite lock
    c.ay = clamp(this.v * w, -16, 16);
    c.ax = clamp((vWant - this.v) * 0.8, -8, 6);
    c.handbrake = this.mode === 'jturn' || (plan?.timeTo < 0.25 && plan?.kind === 'turn');
    c.braking = vWant < this.v - 2 ? 1 : 0;
    c.driveThrottle = c.braking ? 0 : 1;
    c.wheelSpinAngle += ((this.v * (1 + side * 0.6) + 4) / 0.33) * dt;
    c.rpm = 5800 + side * 1500 + Math.sin(performance.now() / 90) * 300;
    c.gear = this.v > 32 ? 4 : this.v > 20 ? 3 : 2;
    const slide = this.v * side;
    c.slip[2] = c.slip[3] = slide;

    const ground = { y: this.groundAt(c.x, c.z), pitch: 0, roll: 0 };
    this.view.update(c, dt, ground);
    const dc = Math.hypot(c.x - cam.x, c.z - cam.z);
    this.tag.position.set(c.x, ground.y + 2.5 + Math.min(4, dc * 0.012), c.z);
    this.tag.scale.set(3.6, 0.9, 1).multiplyScalar(clamp(dc / 45, 1, 5));

    // Smoke and marks off the rear tyres.
    if (fx && dc < 260) {
      const sh = Math.sin(c.h), ch = Math.cos(c.h), track = this.view.rearTrack, back = -this.view.rearZ;
      for (const s of [-1, 1]) {
        const wx = c.x + ch * s * track - sh * back, wz = c.z - sh * s * track - ch * back;
        const st = clamp((slide - 2) / 9, 0, 1);
        fx.skids?.mark(100 + s, wx, wz, st > 0.08 ? 0.22 + st * 0.45 : 0, fx.clock, 0.25, ground.y + 0.03);
        const kk = s > 0 ? 1 : 0;
        this.smoke[kk] += st * st * dt * (fx.rate || 60) * 1.8;
        while (this.smoke[kk] >= 1) {
          this.smoke[kk] -= 1;
          fx.particles.emit(wx, ground.y + 0.3, wz, c.vx * 0.3 + (Math.random() - 0.5) * 2.4, 0.4 + Math.random() * 0.6, c.vz * 0.3 + (Math.random() - 0.5) * 2.4, 1.0 + Math.random() * 0.4, 2.6, 2.2 + Math.random() * 1.4, 0.3);
        }
      }
    }
  }

  // The player against John Doe: he's solid and doesn't budge. A bump shoves you sideways with some spin.
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
        const k = this.mode === 'bump' ? 1.9 : 1.3;
        car.applyImpulse(ps * b, pc * b, -nx * rel * car.spec.mass * k, -nz * rel * car.spec.mass * k);
        this.hit = true;
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
