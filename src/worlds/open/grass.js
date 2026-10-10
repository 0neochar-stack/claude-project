// Grass that follows the camera: one instanced draw of tens of thousands of clumps laid on a lattice
// that repeats every 2R metres, so each clump stays put in the world as you drive while the set wraps
// round to stay centred on the camera. The vertex shader stands each clump on the ground (from a height
// texture), takes its colour from the ground under it, thins it out where the mask says there's road,
// lot, building or town, fades it out toward the edge of the patch, and sways it in the wind.
import * as THREE from 'three';
import { HALF, N, CELL, LA, VILLAGE, inLot } from './layout.js';

// net: road network; heights: the baked grid; colors: terrain colours per grid node (Float32 rgb);
// stores: roadside store footprints; preset: graphics preset.
export function buildGrass(net, heights, colors, stores, preset, windUniforms) {
  const counts = { 0: 0, 1: 10000, 2: 24000 };
  const radius = { 0: 0, 1: 30, 2: 40 };
  const detail = preset.detail ?? 2;
  const count = counts[detail], R = radius[detail];
  if (!count) return null;
  const n = N + 1;

  // Ground height, as floats, fetched texel by texel and blended in the shader.
  const hTex = new THREE.DataTexture(new Float32Array(heights), n, n, THREE.RedFormat, THREE.FloatType);
  hTex.needsUpdate = true;
  // Ground colour on the same grid.
  const cData = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    cData[i * 4] = Math.min(255, colors[i * 3] * 255);
    cData[i * 4 + 1] = Math.min(255, colors[i * 3 + 1] * 255);
    cData[i * 4 + 2] = Math.min(255, colors[i * 3 + 2] * 255);
    cData[i * 4 + 3] = 255;
  }
  const cTex = new THREE.DataTexture(cData, n, n, THREE.RGBAFormat);
  cTex.magFilter = cTex.minFilter = THREE.LinearFilter;
  cTex.needsUpdate = true;

  // Where grass may grow, at 2 m a pixel: everywhere but roads, lots, stores and the two towns.
  const S = Math.ceil((HALF * 2) / 2);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, S, S);
  const px = (x) => (x + HALF) / 2, pz = (z) => (z + HALF) / 2;
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  g.lineCap = g.lineJoin = 'round';
  g.fillRect(px(LA.x0 - 20), pz(LA.z0 - 20), (LA.x1 - LA.x0 + 40) / 2, (LA.z1 - LA.z0 + 40) / 2);
  g.beginPath(); g.arc(px(VILLAGE.x), pz(VILLAGE.z), (VILLAGE.r * 0.7) / 2, 0, Math.PI * 2); g.fill();
  for (const r of net.roads) {
    g.lineWidth = (r.hw + (r.sidewalk || r.gutter || r.shoulder || 0) + 1.2) * 2 / 2;
    g.beginPath();
    r.samples.forEach((p, i) => (i ? g.lineTo(px(p.x), pz(p.z)) : g.moveTo(px(p.x), pz(p.z))));
    g.stroke();
  }
  for (const lot of net.lots) {
    if (lot.shape === 'circle') { g.beginPath(); g.arc(px(lot.x), pz(lot.z), (lot.r + 4) / 2, 0, Math.PI * 2); g.fill(); }
    else g.fillRect(px(lot.x0 - 4), pz(lot.z0 - 4), (lot.x1 - lot.x0 + 8) / 2, (lot.z1 - lot.z0 + 8) / 2);
  }
  for (const st of stores || []) {
    g.save();
    g.translate(px(st.x), pz(st.z));
    g.rotate(-st.rot);
    g.fillRect(-(st.w / 2 + 3) / 2, -(st.d / 2 + 4) / 2, (st.w + 6) / 2, (st.d + 8) / 2);
    g.restore();
  }
  const mTex = new THREE.CanvasTexture(cv);
  mTex.magFilter = mTex.minFilter = THREE.LinearFilter;
  mTex.generateMipmaps = false;
  mTex.flipY = false; // row = z, like the other grids
  void inLot; void CELL;

  // A clump: six single-triangle blades, dark at the root and pale at the tip.
  const blades = 7, pos = [], col = [], nor = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2, h = 0.3 + rnd() * 0.4, w = 0.022 + rnd() * 0.02, lean = 0.12 + rnd() * 0.3;
    const ox = (rnd() - 0.5) * 0.45, oz = (rnd() - 0.5) * 0.45;
    const dx = Math.cos(a), dz = Math.sin(a);
    pos.push(ox - dz * w, 0, oz + dx * w, ox + dz * w, 0, oz - dx * w, ox + dx * lean * h, h, oz + dz * lean * h);
    col.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.15, 1.15, 1.0);
    for (let k = 0; k < 3; k++) nor.push(0, 1, 0);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const offs = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { offs[i * 4] = rnd(); offs[i * 4 + 1] = rnd(); offs[i * 4 + 2] = rnd(); offs[i * 4 + 3] = rnd(); }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(offs, 4));
  geo.instanceCount = count;

  const uniforms = {
    uHeights: { value: hTex }, uColors: { value: cTex }, uMask: { value: mTex },
    uCam: { value: new THREE.Vector3() }, uR: { value: R }, uHalf: { value: HALF }, uN: { value: n }, uCell: { value: CELL },
    uTime: windUniforms.uTime, uWind: windUniforms.uWind,
  };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSeed;
        uniform sampler2D uHeights; uniform sampler2D uColors; uniform sampler2D uMask;
        uniform vec3 uCam; uniform float uR; uniform float uHalf; uniform float uN; uniform float uCell;
        uniform float uTime; uniform float uWind;
        varying float vKeep;
        float hAt(vec2 g) { return texelFetch(uHeights, ivec2(clamp(g, vec2(0.0), vec2(uN - 1.0))), 0).r; }
        float groundY(vec2 w) {
          vec2 g = (w + uHalf) / uCell; vec2 i = floor(g); vec2 f = g - i;
          float a = hAt(i), b = hAt(i + vec2(1.0, 0.0)), c = hAt(i + vec2(0.0, 1.0)), d = hAt(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }`)
      .replace('#include <begin_vertex>', `
        // Lattice position that repeats every 2R, wrapped to stay round the camera.
        float span = uR * 2.0;
        vec2 base = aSeed.xy * span;
        vec2 wp = uCam.xz - uR + mod(base - (uCam.xz - uR), span);
        vec2 uvW = (wp + uHalf) / (uHalf * 2.0);
        float mask = texture2D(uMask, uvW).r;
        float dist = length(wp - uCam.xz);
        float fade = 1.0 - smoothstep(uR * 0.6, uR * 0.98, dist);
        float y = groundY(wp);
        // Thin out on masked ground, under water and at the edge; vary size per clump.
        float keep = step(aSeed.z, mask * 0.98) * step(0.6, y) * fade;
        float sc = keep * (0.7 + aSeed.w * 0.8);
        float ang = aSeed.z * 40.0;
        vec3 p = position;
        p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
        p *= sc;
        // Wind: tips sway more than roots.
        float ph = wp.x * 0.11 + wp.y * 0.07;
        float sway = (sin(uTime * 1.7 + ph) * 0.7 + sin(uTime * 3.3 + ph * 1.9) * 0.3) * (0.35 + uWind);
        p.x += sway * p.y * 0.35; p.z += cos(uTime * 1.3 + ph) * p.y * 0.18 * (0.35 + uWind);
        vec3 transformed = vec3(wp.x, y - 0.03, wp.y) + p;
        vKeep = keep;
        {
          // Colour from the ground under the clump: greener and brighter, a little different per clump.
          vec3 gc = texture2D(uColors, uvW).rgb;
          vec3 grass = mix(gc * 1.35, vec3(0.42, 0.55, 0.22), 0.35) * (0.85 + aSeed.w * 0.3);
          vColor.rgb *= grass;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vKeep;')
      .replace('#include <clipping_planes_fragment>', 'if (vKeep < 0.01) discard;\n#include <clipping_planes_fragment>')
      // Both faces lit as if facing up, so no blade goes black from behind.
      .replace('#include <normal_fragment_begin>', 'vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;');
  };
  mat.customProgramCacheKey = () => 'grass-field';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return {
    mesh,
    // Thins the field out (0..1) when the frame rate needs it: fewer clumps over a smaller patch.
    setScale(f) {
      geo.instanceCount = Math.round(count * f * f);
      uniforms.uR.value = R * Math.max(0.4, f);
      mesh.visible = f > 0.05;
    },
    update(cam) { uniforms.uCam.value.copy(cam); },
  };
}
