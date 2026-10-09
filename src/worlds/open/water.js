// Water: the Pacific along the south edge, and the Kurogane waterfall, which pours off a cliff above the
// touge and across the road into a pool below. You can drift straight through it.
import * as THREE from 'three';
import { HALF, CELL, N, heightAt, smooth, clamp } from './layout.js';

// ---------- the waterfall site ----------
// Picks the spot on the touge, raises a cliff on the uphill side and digs a pool on the downhill side.
// Runs before the terrain mesh is built.
export function prepareWater(net, heights) {
  const touge = net.byId.touge;
  let best = 0, bd = Infinity;
  touge.samples.forEach((p, i) => { const d = Math.hypot(p.x - 1452, p.z - 1466); if (d < bd) { bd = d; best = i; } });
  const p = touge.samples[best];
  const nx = -p.tz, nz = p.tx; // left normal
  const left = heightAt(heights, p.x + nx * 18, p.z + nz * 18), right = heightAt(heights, p.x - nx * 18, p.z - nz * 18);
  const u = left > right ? 1 : -1; // uphill side
  const lipH = 30;
  const edge = touge.hw + touge.gutter + 1.2;
  const n = N + 1;
  // Cliff: within ±16 m along the road, rising almost sheer from just past the gutter to the lip.
  const reach = 34;
  const i0 = Math.max(0, Math.floor((p.x - reach + HALF) / CELL)), i1 = Math.min(N, Math.ceil((p.x + reach + HALF) / CELL));
  const j0 = Math.max(0, Math.floor((p.z - reach + HALF) / CELL)), j1 = Math.min(N, Math.ceil((p.z + reach + HALF) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    const lat = ((x - p.x) * nx + (z - p.z) * nz) * u;
    if (lat > edge) {
      const wAlong = 1 - smooth(14, 26, Math.abs(along));
      const target = p.y + lipH * smooth(edge, edge + 5, lat) - Math.max(0, lat - 18) * 0.3;
      const k = j * n + i;
      heights[k] = Math.max(heights[k], heights[k] + (target - heights[k]) * wAlong);
    }
  }
  // Pool below the road on the other side.
  const poolLat = 17;
  const px = p.x - nx * u * poolLat, pz = p.z - nz * u * poolLat;
  const poolY = Math.min(p.y - 9, heightAt(heights, px, pz) - 1.5);
  const pr = 13;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    const d = Math.hypot(x - px, z - pz);
    if (d > pr + 10) continue;
    const lat = ((x - p.x) * nx + (z - p.z) * nz) * u;
    if (lat > -edge - 2) continue; // keep the road's embankment
    const k = j * n + i;
    const target = poolY - 1.6 + smooth(pr * 0.5, pr + 10, d) * 12;
    heights[k] = Math.min(heights[k], target);
  }
  return { i: best, p: { ...p }, nx, nz, u, lipH, edge, pool: { x: px, z: pz, y: poolY, r: pr } };
}

// ---------- shaders ----------
const oceanVert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const oceanFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uDeep; uniform float uNight;
  varying vec3 vWorld;
  vec2 waveGrad(vec2 p, float t) {
    vec2 g = vec2(0.0);
    g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.09 + t * 0.9) * 0.09;
    g += vec2(-0.3, 1.0) * cos(dot(p, vec2(-0.3, 1.0)) * 0.21 + t * 1.4) * 0.07;
    g += vec2(0.95, -0.2) * cos(dot(p, vec2(0.95, -0.2)) * 0.47 + t * 2.1) * 0.05;
    g += vec2(0.2, 0.9) * cos(dot(p, vec2(0.2, 0.9)) * 1.13 + t * 3.1) * 0.035;
    g += vec2(-0.7, 0.7) * cos(dot(p, vec2(-0.7, 0.7)) * 2.31 + t * 4.3) * 0.02;
    return g;
  }
  void main() {
    vec2 g = waveGrad(vWorld.xz, uTime);
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0) * 0.9 + 0.06;
    vec3 col = mix(uDeep, uSky, fres);
    vec3 h = normalize(normalize(uSun) + v);
    float spec = pow(max(dot(n, h), 0.0), 380.0) * 6.0 + pow(max(dot(n, h), 0.0), 40.0) * 0.25;
    col += uSunCol * spec * smoothstep(-0.05, 0.05, uSun.y);
    // Moonlight glitter at night.
    vec3 hm = normalize(normalize(vec3(-0.4, 0.45, -0.8)) + v);
    col += vec3(0.5, 0.6, 0.9) * pow(max(dot(n, hm), 0.0), 300.0) * 2.0 * uNight;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

const fallVert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec2 vUv; varying float vY;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vY = wp.y;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const fallFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime; uniform float uNight; uniform float uSpeed; uniform vec3 uTint;
  varying vec2 vUv; varying float vY;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y); }
  void main() {
    // Streaks falling down: noise stretched along the flow and scrolled.
    vec2 p = vec2(vUv.x * 46.0, vUv.y * 5.0 - uTime * uSpeed);
    float s = vnoise(p) * 0.55 + vnoise(p * vec2(2.1, 3.0) + 3.0) * 0.3 + vnoise(p * vec2(5.0, 7.0) + 7.0) * 0.15;
    float foam = smoothstep(0.3, 0.75, s);
    float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
    // Thicker and whiter toward the bottom, where the fall breaks up into spray.
    float a = (0.55 + foam * 0.45) * edge * (0.8 + 0.2 * (1.0 - vUv.y));
    vec3 col = mix(uTint * 0.9, vec3(0.96, 0.98, 1.0), foam * 0.85 + (1.0 - vUv.y) * 0.25);
    col *= mix(1.0, 0.45, uNight);
    col += vec3(0.25, 0.45, 0.7) * uNight * foam * 0.5; // lit from below at night
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export function buildWater(net, heights, preset, site) {
  const group = new THREE.Group();
  // ---------- ocean ----------
  const oceanU = {
    uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.7) },
    uSky: { value: new THREE.Color(0x9fc0e8) }, uDeep: { value: new THREE.Color(0x0b3a4a) }, uNight: { value: 0 },
  };
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(14000, 8000, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, -1590 - 4000),
    new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, oceanU]), vertexShader: oceanVert, fragmentShader: oceanFrag, fog: true }),
  );
  // Merge keeps copies; point the material at the live uniforms.
  Object.assign(ocean.material.uniforms, oceanU);
  ocean.renderOrder = -1;
  group.add(ocean);

  // Shoreline foam: a strip along where the beach meets the water, washing in and out.
  const foamPos = [], foamUv = [], foamIdx = [];
  let col = 0;
  for (let x = -HALF; x <= HALF; x += 6) {
    let zc = null;
    for (let z = -1580; z > -1800; z -= 2) if (heightAt(heights, x, z) < 0.15) { zc = z; break; }
    if (zc === null) continue;
    for (const [dz, v] of [[6, 0], [-14, 1]]) { foamPos.push(x, 0.06, zc + dz); foamUv.push(x / 12, v); }
    if (col > 0) { const b = (col - 1) * 2; foamIdx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    col++;
  }
  const foamGeo = new THREE.BufferGeometry();
  foamGeo.setAttribute('position', new THREE.Float32BufferAttribute(foamPos, 3));
  foamGeo.setAttribute('uv', new THREE.Float32BufferAttribute(foamUv, 2));
  foamGeo.setIndex(foamIdx);
  const foamU = { uTime: { value: 0 }, uNight: { value: 0 } };
  const foam = new THREE.Mesh(foamGeo, new THREE.ShaderMaterial({
    uniforms: foamU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform float uNight; varying vec2 vUv;
      float hash(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        float wash = 0.5 + 0.5 * sin(uTime * 0.7 + vUv.x * 0.35);
        float line = smoothstep(0.08, 0.0, abs(vUv.y - (0.15 + wash * 0.5)));
        float lace = step(0.55, fract(sin(floor(vUv.x * 40.0) * 12.9898 + floor(vUv.y * 30.0 + uTime) * 78.233) * 43758.5453));
        float a = line * 0.75 + smoothstep(0.75, 0.2, vUv.y) * 0.15 * lace * (0.4 + wash);
        gl_FragColor = vec4(vec3(0.95) * mix(1.0, 0.35, uNight), a);
      }`,
  }));
  group.add(foam);

  // ---------- waterfall ----------
  const { p, nx, nz, u, lipH, pool } = site;
  const touge = net.byId.touge;
  const S = touge.samples;
  const top = p.y + lipH + 0.5;
  const bottom = pool.y + 0.2;
  // Curtain: across ~20 m of road, following its bend; each column falls from the lip in an arc that
  // crosses the road near its downhill edge and lands in the pool.
  const cols = [];
  for (let k = -3; k <= 3; k++) cols.push(S[clamp(site.i + k * 2, 0, S.length - 1)]);
  // Shoots off the lip, arcs out over the road and crosses it near the middle, then drops into the pool.
  const tCross = (top - p.y) / (top - bottom);
  const k = Math.log((site.edge + 3.5 + 0.5) / (site.edge + 3.5 + 13)) / Math.log(tCross);
  const latAt = (t) => u * (site.edge + 3.5) - u * (site.edge + 3.5 + 13) * Math.pow(t, k);
  const rows = 22;
  const pos = [], uv = [], idx = [];
  cols.forEach((c, ci) => {
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const y = top - (top - bottom) * t;
      const lat = latAt(t);
      pos.push(c.x + nx * lat, y, c.z + nz * lat);
      uv.push(ci / (cols.length - 1), 1 - t);
    }
  });
  for (let ci = 0; ci < cols.length - 1; ci++) for (let r = 0; r < rows; r++) {
    const a = ci * (rows + 1) + r, b = a + 1, c = a + rows + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const fallGeo = new THREE.BufferGeometry();
  fallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fallGeo.setIndex(idx);
  const fallU = { uTime: { value: 0 }, uNight: { value: 0 }, uSpeed: { value: 2.6 }, uTint: { value: new THREE.Color(0x9fc8d8) } };
  const fallMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, fallU]), vertexShader: fallVert, fragmentShader: fallFrag,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  Object.assign(fallMat.uniforms, fallU);
  group.add(new THREE.Mesh(fallGeo, fallMat));
  // A second, thinner veil just behind for depth.
  const veil = new THREE.Mesh(fallGeo.clone().translate(nx * u * 1.2, 0, nz * u * 1.2), fallMat);
  veil.scale.set(1, 1, 1);
  group.add(veil);
  // Where the curtain hits the road: the crossing line, with churning foam and a wet sheen across it.
  const tRoad = Math.pow(Math.max(0, (top - p.y) / (top - bottom)), 1);
  const crossLat = latAt(tRoad);
  {
    const fp = [], fu = [], fi = [];
    cols.forEach((c, ci) => {
      for (const [o, v] of [[-3.5, 0], [3.5, 1]]) { const l = crossLat + o; fp.push(c.x + nx * l, c.y + 0.07, c.z + nz * l); fu.push(ci / (cols.length - 1), v); }
      if (ci) { const b = (ci - 1) * 2; fi.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
    fg.setIndex(fi);
    const foamRoad = new THREE.Mesh(fg, new THREE.ShaderMaterial({
      uniforms: fallU, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; uniform float uNight; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y); }
        void main(){ float c = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float f = n(vec2(vUv.x * 60.0, vUv.y * 8.0 + uTime * 3.0)) * 0.6 + n(vec2(vUv.x * 140.0 - uTime, vUv.y * 20.0)) * 0.4;
          float a = smoothstep(0.0, 0.6, c) * (0.35 + smoothstep(0.45, 0.8, f) * 0.6);
          gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * mix(1.0, 0.4, uNight), a); }`,
    }));
    group.add(foamRoad);
  }
  // Pool surface.
  const poolU = { uTime: { value: 0 }, uNight: { value: 0 } };
  const poolMesh = new THREE.Mesh(new THREE.CircleGeometry(pool.r + 2, 40).rotateX(-Math.PI / 2).translate(pool.x, pool.y, pool.z), new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, poolU]), fog: true, transparent: true,
    vertexShader: fallVert.replace('varying vec2 vUv; varying float vY;', 'varying vec2 vUv; varying float vY;'),
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime; uniform float uNight; varying vec2 vUv;
      void main(){ vec2 c = vUv - 0.5; float r = length(c);
        float ring = 0.5 + 0.5 * sin(r * 70.0 - uTime * 5.0);
        vec3 col = mix(vec3(0.08, 0.22, 0.26), vec3(0.8, 0.9, 0.95), ring * smoothstep(0.45, 0.0, r) * 0.6);
        col *= mix(1.0, 0.4, uNight);
        gl_FragColor = vec4(col, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  }));
  Object.assign(poolMesh.material.uniforms, poolU);
  group.add(poolMesh);
  // Rocks around the lip and the pool are placed by nature (exported here).
  const rocks = [];
  for (let k = -4; k <= 4; k++) {
    const c = S[clamp(site.i + k * 2, 0, S.length - 1)];
    const lat = u * (site.edge + 4.2 + Math.abs(k) * 0.4);
    rocks.push({ x: c.x + nx * lat, z: c.z + nz * lat, s: 1.6 + Math.abs(Math.sin(k * 3.1)) * 1.4 });
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    rocks.push({ x: pool.x + Math.cos(a) * (pool.r + 2), z: pool.z + Math.sin(a) * (pool.r + 2), s: 1.2 + (k % 3) * 0.6 });
  }

  // Crossing centre on the road.
  const cx = p.x + nx * crossLat, cz = p.z + nz * crossLat;
  let mistAcc = 0, splashCooldown = 0, inside = false;
  const splashEl = document.getElementById('splash');
  return {
    group,
    rocks,
    site: { x: cx, z: cz, y: p.y },
    setSun(dir, night) {
      oceanU.uSun.value.copy(dir);
      oceanU.uNight.value = night;
      oceanU.uSky.value.setRGB(0.62, 0.75, 0.9).lerp(new THREE.Color(0x0c1430), night);
      oceanU.uDeep.value.setRGB(0.04, 0.2, 0.27).lerp(new THREE.Color(0x02060c), night * 0.8);
      oceanU.uSunCol.value.setRGB(1, 0.85, 0.65);
      foamU.uNight.value = night;
      fallU.uNight.value = night;
      poolU.uNight.value = night;
    },
    // Wet road around the falls.
    wetAt(x, z) { return Math.abs(x - cx) < 28 && Math.abs(z - cz) < 28 && Math.hypot(x - cx, z - cz) < 26; },
    loudness(car) { return 1 - smooth(20, 200, Math.hypot(car.x - cx, car.z - cz)); },
    update(t, dt, cam, car, particles, sound) {
      oceanU.uTime.value = t;
      foamU.uTime.value = t;
      fallU.uTime.value = t;
      poolU.uTime.value = t;
      // Mist where the water hits the road and the pool, when the camera is near enough to see it.
      if (Math.hypot(cam.x - cx, cam.z - cz) < 220) {
        mistAcc += dt * 40;
        while (mistAcc >= 1) {
          mistAcc -= 1;
          const c = cols[Math.floor(Math.random() * cols.length)];
          const onRoad = Math.random() < 0.6;
          const lat = onRoad ? crossLat : -u * (site.edge + 16);
          const y = onRoad ? p.y + 0.2 : pool.y + 0.3;
          particles.emit(c.x + nx * lat + (Math.random() - 0.5) * 2, y, c.z + nz * lat + (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2.5, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 2.5, 1.6, 2.4, 1.6 + Math.random(), 0.18);
        }
      }
      // Driving through the curtain: a splash on the lens and a burst of spray.
      splashCooldown -= dt;
      const along = (car.x - p.x) * p.tx + (car.z - p.z) * p.tz;
      const lat = (car.x - p.x) * nx + (car.z - p.z) * nz;
      const through = Math.abs(along) < 11 && Math.abs(lat - crossLat) < 2.2;
      if (through && !inside && splashCooldown <= 0) {
        splashCooldown = 0.6;
        if (splashEl) { splashEl.style.transition = 'none'; splashEl.style.opacity = '1'; void splashEl.offsetWidth; splashEl.style.transition = 'opacity 1.6s'; splashEl.style.opacity = '0'; }
        for (let k = 0; k < 40; k++) particles.emit(car.x + (Math.random() - 0.5) * 3, p.y + 1 + Math.random() * 1.5, car.z + (Math.random() - 0.5) * 3, car.vx * 0.3 + (Math.random() - 0.5) * 4, 1 + Math.random() * 2, car.vz * 0.3 + (Math.random() - 0.5) * 4, 1, 2.2, 1.2, 0.3);
        if (sound.ctx) sound.burst({ freq: 900, type: 'bandpass', q: 0.4, gain: 0.5, attack: 0.01, decay: 0.8 });
      }
      inside = through;
    },
  };
}
