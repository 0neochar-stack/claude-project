// The open world: builds the map in steps (reporting progress), then runs it — time of day, collisions,
// surfaces, the minimap — behind the same world interface as Neon Tokyo.
import * as THREE from 'three';
import { HALF, CELL, buildNetwork, bakeHeights, heightAt, roadQuery, crossSection, LA, VILLAGE, PEAK, clamp, smooth, inLot } from './layout.js';
import { buildTerrain } from './terrain.js';
import { buildRoads } from './roads.js';
import { Sky, skyEnvironment } from './sky.js';
import { buildWater, prepareWater } from './water.js';
import { buildNature } from './nature.js';
import { buildTown } from './town.js';
import { buildLamps } from './lamps.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';
import { Knockables } from './knockables.js';
import { buildLandmarks } from './landmarks.js';
import { disposeTree } from '../util.js';

const HULL = [{ o: 1.3, r: 1.0 }, { o: -1.3, r: 1.0 }];
const TIME_PRESETS = { day: 13.5, dusk: 17.75, night: 23.4 };

export async function createOpenWorld({ preset, sound, particles, settings, renderer, progress }) {
  const root = new THREE.Group();
  await progress(0.02, 'Surveying the roads…');
  const net = buildNetwork();
  await progress(0.08, 'Shaping the hills and the mountain…');
  const heights = bakeHeights(net);
  const site = prepareWater(net, heights);
  // Ground height: the road surface (with gutters and curbs) where there is one, otherwise the terrain.
  const q = {};
  function groundHeight(x, z) {
    roadQuery(net, x, z, q);
    if (q.road) {
      const cs = crossSection(q.road, q.lat);
      if (cs !== null) return q.y + 0.02 + cs;
    }
    return heightAt(heights, x, z);
  }
  const groundAt = groundHeight;
  await progress(0.25, 'Laying the ground…');
  const terrain = buildTerrain(heights, preset);
  root.add(terrain.group);
  await progress(0.36, 'Paving the streets…');
  const roads = buildRoads(net, heights, preset);
  root.add(roads.group);
  await progress(0.44, 'Filling the ocean and the waterfall…');
  const water = buildWater(net, heights, preset, site);
  root.add(water.group);
  await progress(0.5, 'Building the town and the village…');
  const town = buildTown(net, heights, preset);
  root.add(town.group);
  await progress(0.66, 'Planting palms, pines and cherry trees…');
  const nature = buildNature(net, heights, preset, { yardTrees: town.yardTrees, sakuraSpots: town.sakuraSpots, rocks: water.rocks });
  root.add(nature.group);
  const marks = buildLandmarks(net, heights);
  root.add(marks.group);
  await progress(0.8, 'Wiring the street lights…');
  const lamps = buildLamps(roads.lamps, town.lamps, preset, groundAt);
  root.add(lamps.group);
  await progress(0.86, 'Parking the cars…');
  const bins = new Knockables(town.bins, groundAt);
  root.add(bins.group);
  const traffic = new Traffic(net, preset, groundAt);
  root.add(traffic.group);
  const police = new Police(net, groundAt, sound);
  root.add(police.group);
  await progress(0.9, 'Lighting the sky…');

  // Sky, sun and the car's reflections for each mood.
  const far = preset.far;
  const sky = new Sky(Math.min(far * 0.9, 3800));
  root.add(sky.mesh, sky.sun, sky.sunTarget, sky.hemi, sky.moon);
  const shadows = preset.shadows > 0;
  if (shadows) {
    sky.sun.castShadow = true;
    sky.sun.shadow.mapSize.set(preset.shadows, preset.shadows);
    const c = sky.sun.shadow.camera;
    c.left = -55; c.right = 55; c.top = 55; c.bottom = -55; c.near = 10; c.far = 260;
    sky.sun.shadow.bias = -0.0004;
    sky.sun.shadow.normalBias = 0.6;
  }
  const envs = {
    day: skyEnvironment(renderer, 0x3d74c8, 0xcfe0ee, 0x4a4436, 0xfff2dd, new THREE.Vector3(0.4, 0.8, -0.3)),
    dusk: skyEnvironment(renderer, 0x2f3c8c, 0xff8a50, 0x2a2022, 0xff9a50, new THREE.Vector3(-0.9, 0.12, -0.3)),
    night: skyEnvironment(renderer, 0x050816, 0x1a2348, 0x08080c, 0x4060a0, new THREE.Vector3(-0.4, 0.45, -0.8)),
  };

  const env = {
    background: sky.background,
    fog: sky.fog,
    exposure: 1,
    bloom: { strength: 0.5, radius: 0.5, threshold: 0.9 },
    far,
    headlights: true,
    carEnv: envs.dusk,
    rain: 0,
    wet: 0,
    shadows,
  };

  // ---------- time of day ----------
  let hours = settings.timeOfDay === 'cycle' ? 17.3 : TIME_PRESETS[settings.timeOfDay];
  let mood = '';
  function applyTime() {
    sky.setTime(hours);
    const st = sky.state;
    env.exposure = st.exposure;
    env.headlights = st.night > 0.2;
    env.bloom.strength = 0.35 + st.night * 0.45;
    env.bloom.threshold = 0.92 - st.night * 0.12;
    sky.fog.near = 120 + (1 - st.night) * 200;
    sky.fog.far = far * (0.75 + (1 - st.night) * 0.25);
    const m = st.night > 0.6 ? 'night' : st.sunE < 0.22 ? 'dusk' : 'day';
    if (m !== mood) { mood = m; env.carEnv = envs[m]; env.sceneEnv = envs[m]; env.moodChanged = true; }
    lamps.setNight(st.night);
    town.setNight(st.night);
    water.setSun(sky.sunDir, st.night);
  }
  applyTime();

  // ---------- minimap ----------
  const MAP_PX = 2; // metres per pixel
  const mapImg = document.createElement('canvas');
  mapImg.width = mapImg.height = Math.ceil((HALF * 2) / MAP_PX);
  {
    const g = mapImg.getContext('2d');
    const S = mapImg.width;
    // Terrain shaded by height, sea in blue.
    const img = g.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = HALF - i * MAP_PX, z = HALF - j * MAP_PX; // matches the view: +z up, +x to the left
      const h = heightAt(heights, x, z);
      const k = (j * S + i) * 4;
      if (h < 0.2) { img.data[k] = 18; img.data[k + 1] = 40; img.data[k + 2] = 70; }
      else { const v = 26 + Math.min(60, h * 0.25); img.data[k] = v * 0.8; img.data[k + 1] = v; img.data[k + 2] = v * 0.85; }
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const colors = { street: '#8a86a8', boulevard: '#b4b0d0', coast: '#b4b0d0', highway: '#ffd35a', village: '#ff9ec4', touge: '#ff5fa8', ridge: '#7fe8ff' };
    for (const r of net.roads) {
      g.strokeStyle = colors[r.kind];
      g.lineWidth = Math.max(3, r.width / MAP_PX * 0.8);
      g.lineJoin = 'round';
      g.beginPath();
      r.samples.forEach((p, i) => { const X = (HALF - p.x) / MAP_PX, Y = (HALF - p.z) / MAP_PX; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.stroke();
    }
  }

  // ---------- collision ----------
  const CC = 32;
  const cells = new Map();
  const key = (cx, cz) => cx * 4096 + cz;
  const colliders = [...roads.segs.map((s) => ({ type: 'seg', ...s })), ...town.colliders, ...nature.colliders, ...lamps.colliders, ...marks.colliders];
  colliders.forEach((c, idx) => {
    let x0, x1, z0, z1;
    if (c.type === 'seg') { x0 = Math.min(c.ax, c.bx) - 2; x1 = Math.max(c.ax, c.bx) + 2; z0 = Math.min(c.az, c.bz) - 2; z1 = Math.max(c.az, c.bz) + 2; }
    else if (c.type === 'circle') { x0 = c.x - c.r - 2; x1 = c.x + c.r + 2; z0 = c.z - c.r - 2; z1 = c.z + c.r + 2; }
    else { const R = Math.hypot(c.hx, c.hz) + 2; x0 = c.x - R; x1 = c.x + R; z0 = c.z - R; z1 = c.z + R; }
    for (let cx = Math.floor(x0 / CC); cx <= Math.floor(x1 / CC); cx++) for (let cz = Math.floor(z0 / CC); cz <= Math.floor(z1 / CC); cz++) {
      const k = key(cx, cz);
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push(idx);
    }
  });
  const hits = [];
  function contacts(cx, cz, rad, y) {
    hits.length = 0;
    const list = cells.get(key(Math.floor(cx / CC), Math.floor(cz / CC)));
    if (list) for (const idx of list) {
      const c = colliders[idx];
      if (c.type === 'seg') {
        const dx = c.bx - c.ax, dz = c.bz - c.az, L2 = dx * dx + dz * dz || 1;
        const t = clamp(((cx - c.ax) * dx + (cz - c.az) * dz) / L2, 0, 1);
        const px = c.ax + dx * t, pz = c.az + dz * t;
        let nx = cx - px, nz = cz - pz;
        const d = Math.hypot(nx, nz), r = rad + (c.thick || 0.1);
        if (d >= r || d < 1e-5) continue;
        hits.push({ nx: nx / d, nz: nz / d, pen: r - d, soft: c.curb || c.low });
      } else if (c.type === 'circle') {
        const nx = cx - c.x, nz = cz - c.z, d = Math.hypot(nx, nz);
        if (d >= c.r + rad || d < 1e-5) continue;
        hits.push({ nx: nx / d, nz: nz / d, pen: c.r + rad - d });
      } else {
        // Oriented box: into its frame, nearest point, back out.
        const ca = Math.cos(c.a), sa = Math.sin(c.a);
        const lx = (cx - c.x) * ca - (cz - c.z) * sa, lz = (cx - c.x) * sa + (cz - c.z) * ca;
        const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
        let dx = lx - qx, dz = lz - qz, d = Math.hypot(dx, dz);
        let nxl, nzl, pen;
        if (d < 1e-5) {
          const f = [[c.hx - lx, 1, 0], [lx + c.hx, -1, 0], [c.hz - lz, 0, 1], [lz + c.hz, 0, -1]].sort((a, b) => a[0] - b[0])[0];
          nxl = f[1]; nzl = f[2]; pen = f[0] + rad;
        } else { if (d >= rad) continue; nxl = dx / d; nzl = dz / d; pen = rad - d; }
        hits.push({ nx: nxl * ca + nzl * sa, nz: -nxl * sa + nzl * ca, pen });
      }
    }
    // Steep ground acts as a wall: rock faces in the cuts, and the edge of the map.
    const gx = heightAt(heights, cx + 1.5, cz) - heightAt(heights, cx - 1.5, cz);
    const gz = heightAt(heights, cx, cz + 1.5) - heightAt(heights, cx, cz - 1.5);
    const steep = Math.hypot(gx, gz) / 3;
    if (steep > 1.05 && heightAt(heights, cx, cz) > y + 0.7) {
      const L = Math.hypot(gx, gz);
      hits.push({ nx: -gx / L, nz: -gz / L, pen: Math.min(0.5, (steep - 1.05) * 0.6 + 0.05), soft: true });
    }
    const lim = HALF - 8;
    if (cx < -lim) hits.push({ nx: 1, nz: 0, pen: -lim - cx });
    if (cx > lim) hits.push({ nx: -1, nz: 0, pen: cx - lim });
    if (cz < -lim) hits.push({ nx: 0, nz: 1, pen: -lim - cz });
    if (cz > lim) hits.push({ nx: 0, nz: -1, pen: cz - lim });
    return hits;
  }

  function collide(car) {
    let impact = collideStatic(car);
    // Traffic, police and bins.
    impact = Math.max(impact, traffic.collide(car), police.collide(car));
    bins.hit(car, sound);
    return impact;
  }
  function collideStatic(car) {
    let impact = 0;
    const sh = Math.sin(car.h), ch = Math.cos(car.h);
    const y = groundHeight(car.x, car.z);
    for (const c of HULL) {
      const px = sh * c.o, pz = ch * c.o;
      const hs = contacts(car.x + px, car.z + pz, c.r, y);
      for (const hit of hs) {
        car.x += hit.nx * hit.pen;
        car.z += hit.nz * hit.pen;
        const vpx = car.vx + car.r * pz, vpz = car.vz - car.r * px;
        const vn = vpx * hit.nx + vpz * hit.nz;
        if (vn >= 0) continue;
        if (!hit.soft || -vn > 4) impact = Math.max(impact, hit.soft ? -vn * 0.5 : -vn);
        const rn = pz * hit.nx - px * hit.nz;
        const m = car.spec.mass, I = car.spec.inertia;
        const j = (-(1 + (hit.soft ? 0.05 : 0.25)) * vn) / (1 / m + (rn * rn) / I);
        car.applyImpulse(px, pz, hit.nx * j, hit.nz * j);
        const tx = -hit.nz, tz = hit.nx;
        const vt = vpx * tx + vpz * tz;
        const jt = -vt * m * (hit.soft ? 0.04 : 0.12);
        car.applyImpulse(px, pz, tx * jt, tz * jt);
      }
    }
    return impact;
  }

  // Grip and drag from what the tyres are on.
  const sq = {};
  function surface(car) {
    roadQuery(net, car.x, car.z, sq);
    let grip = 1, rough = 0;
    if (sq.road) {
      const a = Math.abs(sq.lat), r = sq.road;
      if (a <= r.hw) grip = 1;
      else if (r.gutter && a <= r.hw + r.gutter) grip = 0.96;
      else if (r.sidewalk && a <= r.hw + r.sidewalk) grip = 0.95;
      else if (r.shoulder && a <= r.hw + r.shoulder) grip = 0.92;
      else { grip = 0; }
    } else grip = 0;
    if (grip === 0 && net.lots.some((l) => inLot(l, car.x, car.z))) grip = 1;
    if (grip === 0) {
      // Off the road: sand by the sea, grass and dirt elsewhere.
      const y = heightAt(heights, car.x, car.z);
      if (y < 0.4) { grip = 0.45; rough = 1.6; }
      else if (car.z < -1600) { grip = 0.55; rough = 0.55; }
      else { grip = 0.68; rough = 0.22; }
    }
    if (water.wetAt(car.x, car.z)) grip *= 0.78;
    car.grip = grip;
    car.roughness = rough;
  }

  function nearestRoad(x, z, heading) {
    const r = {};
    roadQuery(net, x, z, r);
    let best = r.road ? r : null;
    if (!best) {
      // Search outward for the closest road sample.
      let bd = Infinity;
      for (const road of net.roads) for (let i = 0; i < road.samples.length; i += 4) {
        const p = road.samples[i], d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) { bd = d; best = { road, x: p.x, z: p.z, tx: p.tx, tz: p.tz, lat: 0 }; }
      }
    }
    const fwd = Math.sin(heading) * best.tx + Math.cos(heading) * best.tz >= 0 ? 1 : -1;
    // Your own lane: the right in America, the left on the Japanese roads. (-tz, tx) is the driver's right.
    const lane = (best.road.lanes >= 4 ? 5.3 : 2) * (['village', 'touge', 'ridge', 'pier'].includes(best.road.kind) ? -1 : 1);
    const tx = best.tx * fwd, tz = best.tz * fwd;
    return { x: best.x - tz * lane, z: best.z + tx * lane, heading: Math.atan2(tx, tz) };
  }

  function placeInfo(car) {
    const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    roadQuery(net, car.x, car.z, sq);
    const dLA = Math.hypot(Math.max(LA.x0 - car.x, 0, car.x - LA.x1), Math.max(LA.z0 - car.z, 0, car.z - LA.z1));
    const area = dLA < 80 ? 'Vista Del Mar' : Math.hypot(car.x - VILLAGE.x, car.z - VILLAGE.z) < 300 ? 'Sakura Village' : Math.hypot(car.x - PEAK.x, car.z - PEAK.z) < 800 ? 'Mt. Kurogane' : 'Route 7 country';
    const lot = net.lots.find((l) => inLot(l, car.x, car.z));
    const road = lot ? lot.name : sq.road && Math.abs(sq.lat) < sq.road.hw + 6 ? sq.road.name : 'Off road';
    return `${road} · ${area} · ${time}`;
  }

  const spawn = (() => {
    // In the car meet lot on the boulevard.
    const s = town.spawn;
    return { x: s.x, z: s.z, heading: s.heading };
  })();

  let wind = 0;
  const camPos = new THREE.Vector3();
  const world = {
    id: 'open',
    name: 'Open World',
    root,
    spawn,
    env,
    flat: false,
    collide,
    surface,
    nearestRoad,
    groundAt,
    blocked(x, z, m) {
      void m;
      const list = cells.get(key(Math.floor(x / CC), Math.floor(z / CC)));
      if (list) for (const idx of list) {
        const c = colliders[idx];
        if (c.type === 'box' && c.tall) {
          const ca = Math.cos(c.a), sa = Math.sin(c.a);
          const lx = (x - c.x) * ca - (z - c.z) * sa, lz = (x - c.x) * sa + (z - c.z) * ca;
          if (Math.abs(lx) < c.hx + 0.4 && Math.abs(lz) < c.hz + 0.4) return true;
        }
      }
      return false;
    },
    drawMinimap(g, car, W) {
      const s = W / 2 / 160 * MAP_PX;
      const ch = Math.cos(car.h), shh = Math.sin(car.h);
      // Map pixels: X = (HALF - x) / MAP_PX, Y = (HALF - z) / MAP_PX. Rotate so the car points up.
      const px = (HALF - car.x) / MAP_PX, py = (HALF - car.z) / MAP_PX;
      const a = s * ch, b = s * shh, c = -s * shh, d = s * ch;
      g.setTransform(a, b, c, d, W / 2 - a * px - c * py, W / 2 - b * px - d * py);
      g.imageSmoothingEnabled = true;
      g.drawImage(mapImg, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      police.drawMinimap(g, car, W, s / MAP_PX);
    },
    placeInfo,
    get hours() { return hours; },
    setTimeOfDay(v) {
      if (v !== 'cycle') hours = TIME_PRESETS[v];
      applyTime();
    },
    update(t, dt, ctx) {
      const { camera, car, playing } = ctx;
      if (settings.timeOfDay === 'cycle' && playing) {
        hours = (hours + dt / 60) % 24; // one game hour per real minute
        applyTime();
      }
      camPos.copy(camera.position);
      sky.follow(car.x, groundHeight(car.x, car.z), car.z);
      sky.uniforms.uTime.value = t;
      sky.mesh.position.copy(camPos);
      wind = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 2);
      nature.update(t, dt, camPos, wind, particles);
      water.update(t, dt, camPos, car, particles, sound, ctx.hud);
      lamps.update(camPos);
      roads.update(camPos);
      town.update(t, camPos);
      marks.update(t, sky.state.night);
      bins.update(dt);
      if (playing) {
        traffic.update(dt, car, camPos, sky.state.night);
        police.update(dt, car, ctx, sky.state.night, (c) => { collideStatic(c); surface(c); });
      }
      // Ambience: wind in the mountains, the waterfall's roar, and the siren when the police are close.
      const nearMountain = 1 - smooth(500, 1000, Math.hypot(car.x - PEAK.x, car.z - PEAK.z));
      sound.setAmbience({ wind: 0.3 + nearMountain * 0.7 * wind, water: water.loudness(car), siren: police.sirenLevel(car) });
      if (env.moodChanged) { env.moodChanged = false; ctx.carView?.setEnvMap(env.carEnv); }
      ctx.carView?.setLights(env.headlights);
      ctx.applyEnv();
    },
    onBank(points) { police.onDrift(points, sky.state.night); },
    // Back on the road keeps any chase going; a fresh start clears everything.
    onReset(kind) { if (kind !== 'respawn') { police.reset(); traffic.reset?.(); } bins.reset(); },
    resize() {},
    dispose() {
      disposeTree(root);
      for (const e of Object.values(envs)) e.dispose();
    },
    debug: { net, heights, roads, town, nature, water, traffic, police, sky },
  };
  void CELL;
  await progress(1, 'Ready');
  return world;
}
