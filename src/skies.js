// Sky themes for the open world: the list the phone shows, the colour grading each one applies to the
// sky and the light, the GLSL that paints planets, rings, galaxies, a second sun and aurora into the
// dome, and the fairy castle floating on its own island in the clouds.
import * as THREE from 'three';

export const SKIES = [
  { id: 'earth', name: 'Earth', note: 'Clouds, sun and stars' },
  { id: 'saturn', name: 'Ringed Giant', note: 'A gas giant and its rings' },
  { id: 'galaxy', name: 'Galaxy Core', note: 'Nebulae and the galactic band' },
  { id: 'dune', name: 'Arrakis', note: 'Twin suns, spice haze, two moons' },
  { id: 'fairy', name: 'Fairy Kingdom', note: 'A castle in pink skies' },
  { id: 'aurora', name: 'Aurora', note: 'Northern lights over everything' },
];
export const THEME_INDEX = Object.fromEntries(SKIES.map((s, i) => [s.id, i]));

// Colour grading per theme: where the zenith and horizon colours are pulled, how hard, and a tint for the
// ambient light. `keepDay` keeps some of the real daylight colour.
const GRADE = {
  earth: null,
  saturn: { zen: 0x2a4a9a, hor: 0xc8b8d8, mix: 0.25, light: 0xfff4ff },
  galaxy: { zen: 0x0c0626, hor: 0x3a1858, mix: 0.82, light: 0xc8b0ff },
  dune: { zen: 0xc0703a, hor: 0xf2c27a, mix: 0.8, light: 0xffd0a0 },
  fairy: { zen: 0xd86ad0, hor: 0xffd4ec, mix: 0.75, light: 0xffd8f0 },
  aurora: { zen: 0x040c1c, hor: 0x123040, mix: 0.7, light: 0xa8ffe0 },
};
const tmp = new THREE.Color();
export function gradeSky(theme, zen, hor, hemi, night) {
  const g = GRADE[theme];
  if (!g) return;
  // At night the themed colours darken but never go fully black, so the sky still reads.
  const lift = 1 - night * 0.7;
  zen.lerp(tmp.setHex(g.zen).multiplyScalar(lift), g.mix);
  hor.lerp(tmp.setHex(g.hor).multiplyScalar(lift), g.mix);
  hemi.color.lerp(tmp.setHex(g.light), 0.35);
}

// GLSL added to the sky shader. Uses uTheme (int), uTime, uNight, uSun, d (view direction), col.
export const SKY_GLSL_FUNCS = /* glsl */ `
  uniform int uTheme;
  float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
  float n3(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n3(p); p *= 2.07; a *= 0.5; } return s; }
  // A planet seen at infinity: centred on direction pc with angular radius ar, lit from sun, banded
  // along axis ax, with rings in the plane normal to ax between r0 and r1 planet radii (0 for none).
  vec4 planet(vec3 d, vec3 pc, float ar, vec3 sun, vec3 ax, vec3 cA, vec3 cB, float bandF, float r0, float r1) {
    float R = sin(ar);
    float b = dot(d, pc), c = 1.0 - R * R, disc = b * b - c;
    float tP = disc > 0.0 ? b - sqrt(disc) : 1e9;
    vec4 ring = vec4(0.0); float tR = 1e9;
    if (r1 > 0.0) {
      float dn = dot(d, ax);
      if (abs(dn) > 1e-4) {
        float t = dot(pc, ax) / dn;
        vec3 p = d * t - pc;
        float r = length(p) / R;
        if (t > 0.0 && r > r0 && r < r1) {
          float u = (r - r0) / (r1 - r0);
          float dens = 0.62 + 0.14 * sin(u * 140.0) + 0.12 * sin(u * 37.0 + 1.3) + 0.1 * sin(u * 9.0);
          dens *= 1.0 - 0.85 * smoothstep(0.55, 0.57, u) * (1.0 - smoothstep(0.61, 0.63, u)); // the gap
          dens *= smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.9, 1.0, u));
          // In the planet's shadow?
          vec3 wp = d * t;
          float sb = dot(wp - pc, sun);
          float sh = (sb < 0.0 && length((wp - pc) - sun * sb) < R) ? 0.15 : 1.0;
          vec3 rc = mix(vec3(0.92, 0.84, 0.7), vec3(0.62, 0.55, 0.48), 0.5 + 0.5 * sin(u * 31.0));
          ring = vec4(rc * (0.35 + 0.75 * sh), clamp(dens, 0.0, 1.0) * 0.92);
          tR = t;
        }
      }
    }
    vec4 o = vec4(0.0);
    if (tP < 1e8) {
      vec3 n = normalize(d * tP - pc);
      float lam = max(dot(n, sun), 0.0);
      float lat = dot(n, ax);
      float swirl = n3(n * 6.0 + vec3(0.0, lat * 4.0, 0.0)) * 1.4;
      float bands = 0.5 + 0.5 * sin(lat * bandF + swirl * 2.2);
      vec3 pcol = mix(cA, cB, bands);
      pcol *= 0.04 + 1.15 * pow(lam, 0.8);
      float rim = pow(1.0 - max(dot(n, -d), 0.0), 2.5);
      pcol += cA * rim * 0.35 * smoothstep(-0.2, 0.3, dot(n, sun));
      o = vec4(pcol, 1.0);
    }
    if (tR < tP) o = vec4(mix(o.rgb, ring.rgb, ring.a), max(o.a, ring.a));
    else if (tP > 1e8) o = ring;
    return o;
  }
`;

export const SKY_GLSL_MAIN = /* glsl */ `
  {
    vec3 sun = normalize(uSun);
    float above = smoothstep(-0.02, 0.06, d.y);
    float dayAmt = smoothstep(-0.1, 0.25, sun.y);
    if (uTheme == 1) {
      // Ringed gas giant hanging over the mountains.
      vec3 pc = normalize(vec3(0.55, 0.5, 0.72));
      vec3 ax = normalize(vec3(0.25, 0.95, -0.2));
      vec4 p = planet(d, pc, 0.3, normalize(vec3(-0.6, 0.35, 0.3)), ax, vec3(0.95, 0.78, 0.55), vec3(0.75, 0.55, 0.38), 26.0, 1.3, 2.35);
      col = mix(col, p.rgb + col * 0.15 * dayAmt, p.a * above * (1.0 - 0.25 * dayAmt));
      vec4 m = planet(d, normalize(vec3(-0.5, 0.55, 0.65)), 0.025, sun, vec3(0,1,0), vec3(0.8), vec3(0.6), 9.0, 0.0, 0.0);
      col = mix(col, m.rgb, m.a * above);
    } else if (uTheme == 2) {
      // The galactic core: a dusty band of light, coloured nebulae, a dense star field.
      vec3 G = normalize(vec3(0.35, 0.55, 0.75));
      float band = exp(-pow(dot(d, G) * 4.0, 2.0));
      float neb = fbm3(d * 3.5 + vec3(uTime * 0.002));
      float dust = fbm3(d * 9.0);
      vec3 nebCol = mix(vec3(0.55, 0.15, 0.75), vec3(0.1, 0.7, 0.9), smoothstep(0.35, 0.7, fbm3(d * 2.0 + 7.0)));
      nebCol = mix(nebCol, vec3(1.0, 0.35, 0.55), smoothstep(0.55, 0.8, fbm3(d * 2.6 + 3.0)) * 0.7);
      float core = pow(max(dot(d, normalize(G.zxy * vec3(1.0, 0.2, -1.0) + vec3(0.0, 0.6, 0.0))), 0.0), 18.0);
      vec3 gal = vec3(1.0, 0.86, 0.7) * (band * (0.6 + neb) - dust * band * 0.55) + nebCol * smoothstep(0.42, 0.75, neb) * 0.8 + vec3(1.0, 0.8, 0.6) * core * 1.6;
      float s = h31(floor(d * 600.0));
      vec3 stars = vec3(step(0.993, s)) * mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.8, 0.6), h31(floor(d * 600.0) + 3.0)) * (0.6 + 0.4 * sin(uTime * 3.0 + s * 90.0));
      col += (gal * 0.9 + stars * (1.0 + band * 2.0)) * above * (1.0 - 0.45 * dayAmt);
      vec4 p = planet(d, normalize(vec3(-0.7, 0.25, -0.65)), 0.08, sun, normalize(vec3(0.3, 1.0, 0.1)), vec3(0.3, 0.55, 0.95), vec3(0.15, 0.25, 0.6), 14.0, 0.0, 0.0);
      col = mix(col, p.rgb, p.a * above);
    } else if (uTheme == 3) {
      // Arrakis: a second, whiter sun, dust haze, two pale moons.
      vec3 sun2 = normalize(sun + vec3(0.25, 0.08, -0.2));
      float s2 = max(dot(d, sun2), 0.0);
      col += vec3(1.0, 0.95, 0.85) * pow(s2, 700.0) * 14.0 * dayAmt + vec3(1.0, 0.7, 0.4) * pow(s2, 8.0) * 0.25 * dayAmt;
      float haze = fbm3(vec3(d.xz / max(d.y + 0.2, 0.1) * 0.8, uTime * 0.01));
      col = mix(col, vec3(0.95, 0.68, 0.38) * (0.4 + 0.6 * dayAmt), smoothstep(0.45, 0.8, haze) * 0.35 * (1.0 - smoothstep(0.0, 0.5, d.y)));
      vec4 m1 = planet(d, normalize(vec3(-0.45, 0.48, -0.75)), 0.06, sun, vec3(0,1,0), vec3(0.9, 0.85, 0.78), vec3(0.62, 0.55, 0.5), 4.0, 0.0, 0.0);
      vec4 m2 = planet(d, normalize(vec3(-0.2, 0.62, -0.75)), 0.022, sun, vec3(0,1,0), vec3(0.85, 0.8, 0.85), vec3(0.6), 3.0, 0.0, 0.0);
      col = mix(col, m1.rgb + col * 0.3, m1.a * above * 0.92);
      col = mix(col, m2.rgb + col * 0.3, m2.a * above * 0.92);
    } else if (uTheme == 4) {
      // Fairy kingdom: sparkles, pastel glow and a soft pink moon.
      float sp = h31(floor(d * 420.0));
      col += vec3(1.0, 0.85, 1.0) * step(0.996, sp) * (0.5 + 0.5 * sin(uTime * 4.0 + sp * 60.0)) * above * (0.4 + 0.6 * uNight);
      float glow = fbm3(d * 2.5 + vec3(0.0, uTime * 0.01, 0.0));
      col += vec3(0.9, 0.5, 1.0) * smoothstep(0.5, 0.8, glow) * 0.18 * above;
      vec4 m = planet(d, normalize(vec3(0.3, 0.5, -0.8)), 0.09, sun, vec3(0,1,0), vec3(1.0, 0.82, 0.92), vec3(0.95, 0.65, 0.85), 5.0, 1.4, 1.9);
      col = mix(col, m.rgb + col * 0.25, m.a * above * 0.9);
    } else if (uTheme == 5) {
      // Aurora: three wavy curtains round the whole sky, sharp along the bottom edge and fading up in
      // vertical rays, green low and violet high.
      float t = uTime * 0.05;
      float az = atan(d.x, d.z);
      float curtain = 0.0, hue = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float base = 0.1 + fi * 0.11 + 0.07 * sin(az * (2.0 + fi) + t * (1.0 + fi * 0.3) + fbm3(vec3(az * 1.5, fi, t)) * 2.5);
        float h = d.y - base;
        float rays = 0.45 + 0.55 * n3(vec3(az * 55.0, fi * 7.0, t * 5.0));
        float c = (h > 0.0 ? exp(-h * 7.0) : exp(h * 70.0)) * rays * (0.8 - fi * 0.18);
        curtain += c;
        hue += c * clamp(h * 4.0, 0.0, 1.0);
      }
      vec3 ac = mix(vec3(0.15, 1.0, 0.5), vec3(0.7, 0.3, 1.0), clamp(hue / max(curtain, 0.001), 0.0, 1.0));
      col += ac * curtain * 0.9 * smoothstep(0.0, 0.08, d.y) * (0.55 + 0.45 * uNight);
      float s = h31(floor(d * 500.0));
      col += vec3(step(0.995, s)) * above * (0.3 + 0.7 * uNight);
    }
  }
`;

// The fairy kingdom's castle on its floating island, wrapped in cloud. Unit scale: about 1 m, built big.
export function fairyCastle() {
  const g = new THREE.Group();
  const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, fog: false, ...extra });
  const pink = M(0xf7b8d8), rose = M(0xe060a8), blue = M(0x7a6ad8), rock = M(0x7a6a8a, { flatShading: true }), moss = M(0xa8d8a0), cloud = M(0xffffff, { roughness: 1, emissive: 0xffe8f4, emissiveIntensity: 0.25 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffe08a, fog: false });
  // Island: a rocky cone hanging under a mossy top.
  const isle = new THREE.Mesh(new THREE.ConeGeometry(90, 170, 9, 4).rotateX(Math.PI), rock);
  const p = isle.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.85 + Math.random() * 0.3; p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k); }
  isle.geometry.computeVertexNormals();
  isle.position.y = -85;
  g.add(isle, new THREE.Mesh(new THREE.CylinderGeometry(92, 90, 8, 18), moss));
  // Keep, walls and towers with tall pointed roofs.
  const keep = new THREE.Mesh(new THREE.BoxGeometry(56, 60, 46), pink);
  keep.position.y = 34;
  g.add(keep);
  const tower = (x, z, r, h, roofC) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 16), pink);
    t.position.set(x, 4 + h / 2, z);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.35, h * 0.55, 16), roofC);
    roof.position.set(x, 4 + h + h * 0.27, z);
    g.add(t, roof);
    // Lit windows up the tower.
    for (let k = 1; k < 5; k++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.5, 1), glow);
      const a = k * 1.7;
      w.position.set(x + Math.cos(a) * r, 4 + (h * k) / 5, z + Math.sin(a) * r);
      w.lookAt(x, w.position.y, z);
      g.add(w);
    }
  };
  for (const [x, z] of [[-34, -28], [34, -28], [-34, 28], [34, 28]]) tower(x, z, 9, 78, rose);
  tower(0, 0, 13, 120, blue);
  tower(-14, 12, 6, 95, rose);
  tower(18, -8, 7, 88, blue);
  // Battlements round the keep.
  for (let k = -5; k <= 5; k++) for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 3), pink);
    m.position.set(k * 5, 66, s * 23);
    g.add(m);
  }
  // Cloud puffs round the island's rim and under it.
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2 + Math.random() * 0.2, r = 95 + Math.random() * 30;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(16 + Math.random() * 18, 1), cloud);
    puff.position.set(Math.cos(a) * r, -18 - Math.random() * 40, Math.sin(a) * r);
    puff.scale.y = 0.6;
    g.add(puff);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  return g;
}
