import * as THREE from 'three';
import { ROADS } from './world.js';

// Layers: 0 = reflected scene, 1 = main-view only (rain, decals), 3 = wet ground (samples the reflection).
export const LAYER_MAIN_ONLY = 1;
export const LAYER_WET = 3;

const NOISE = /* glsl */ `
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
}
float wFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * wNoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

// Planar reflection of everything on layer 0, mirrored in the ground plane y = 0.
export class WetReflections {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(0);
    this.matrix = new THREE.Matrix4();
    this.clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.03)];
    this.scale = 0.5;
    this.uniforms = {
      tReflect: { value: this.target.texture },
      reflectMatrix: { value: this.matrix },
      uTime: { value: 0 },
      uRain: { value: 1 },
    };
    this._p = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  setSize(w, h) {
    this.target.setSize(Math.max(2, Math.round(w * this.scale)), Math.max(2, Math.round(h * this.scale)));
  }

  render(renderer, scene, camera) {
    const cam = this.camera;
    camera.getWorldPosition(this._p);
    camera.getWorldDirection(this._d);
    camera.getWorldQuaternion(this._q);
    this._u.set(0, 1, 0).applyQuaternion(this._q);
    cam.position.set(this._p.x, -this._p.y, this._p.z);
    cam.up.set(this._u.x, -this._u.y, this._u.z);
    cam.lookAt(this._p.x + this._d.x, -(this._p.y + this._d.y), this._p.z + this._d.z);
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    cam.updateMatrixWorld();
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    const prevClip = renderer.clippingPlanes;
    renderer.clippingPlanes = this.clip;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    renderer.clippingPlanes = prevClip;
  }
}

// Turns a MeshStandardMaterial into wet ground: darker, glossier, rain-rippled puddles that mirror the city.
// wet: overall sheen on dry-ish asphalt; puddle: how much of the surface is standing water; grain: asphalt mottling.
// road: asphalt detail (wheel tracks, cracks, repair patches, oil stains). tiles: paving slabs and tactile strips.
export function makeWet(material, reflections, { wet = 1, puddle = 1, grain = 1, road = false, tiles = false } = {}) {
  if (road) material.defines = { ...material.defines, WET_ROAD: '' };
  if (tiles) material.defines = { ...material.defines, WET_TILES: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, reflections.uniforms, {
      uWet: { value: wet }, uPuddle: { value: puddle }, uGrain: { value: grain },
      uRoadLo: { value: ROADS.map((r) => r.lo) }, uRoadHi: { value: ROADS.map((r) => r.hi) },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tReflect; uniform mat4 reflectMatrix;
uniform float uTime, uRain, uWet, uPuddle, uGrain;
uniform float uRoadLo[${ROADS.length}], uRoadHi[${ROADS.length}];
varying vec3 vWetPos;
// Street lamps stand on a fixed pattern: both sides of every road, 12 m in from each block end and mid-block,
// with the head reaching ~2.8 m out over the road at 7.4 m. Light from the nearest ones, 1 right under a head.
float lampLight(vec2 wp) {
  float L = 0.0;
  for (int i = 0; i < ${ROADS.length}; i++) {
    float c = (uRoadLo[i] + uRoadHi[i]) * 0.5, hw = (uRoadHi[i] - uRoadLo[i]) * 0.5;
    for (int axis = 0; axis < 2; axis++) {
      float lat = (axis == 0 ? wp.x : wp.y) - c;
      if (abs(lat) > hw + 8.0) continue;
      float s = axis == 0 ? wp.y : wp.x;
      float ds = 1e5;
      for (int k = 0; k < ${ROADS.length - 1}; k++) {
        float bl = uRoadHi[k], bh = uRoadLo[k + 1];
        ds = min(ds, min(min(abs(s - bl - 12.0), abs(s - (bl + bh) * 0.5)), abs(s - bh + 12.0)));
      }
      float dl = min(abs(lat - (hw - 1.9)), abs(lat + (hw - 1.9)));
      float d2 = ds * ds + dl * dl;
      L += 405.0 / pow(d2 + 54.8, 1.5);
    }
  }
  return min(L, 1.2);
}
${NOISE}
vec2 rainRipples(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 3; k++) {
    vec2 q = p * 1.7 + float(k) * 17.31;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = wHash(cell + float(k) * 3.7);
    vec2 c = (vec2(wHash(cell + 1.7), wHash(cell + 9.2)) - 0.5) * 0.4;
    float ph = fract(t * 0.9 + h);
    vec2 d = f - c;
    float r = length(d);
    float front = ph * 0.45;
    float ring = sin((r - front) * 55.0) * smoothstep(0.07, 0.0, abs(r - front)) * (1.0 - ph);
    acc += d / max(r, 1e-3) * ring;
  }
  return acc;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float wetPud = smoothstep(0.5, 0.6, wFbm(vWetPos.xz * 0.075) + 0.12 * wFbm(vWetPos.xz * 0.9)) * uPuddle;
float wetGrain = wFbm(vWetPos.xz * 0.45);
diffuseColor.rgb *= mix(1.0, 0.7 + 0.55 * wetGrain, uGrain);
diffuseColor.rgb *= mix(1.0, 0.45, max(wetPud, uWet * 0.45));
float roadPolish = 0.0, roadDull = 0.0;
#ifdef WET_ROAD
{
  vec2 wp = vWetPos.xz;
  float wpx = max(fwidth(wp.x), fwidth(wp.y));
  // Which road am I on, and how far across it?
  float offX = 1e5, wX = 0.0, offZ = 1e5, wZ = 0.0;
  for (int i = 0; i < ${ROADS.length}; i++) {
    float c = (uRoadLo[i] + uRoadHi[i]) * 0.5, w = uRoadHi[i] - uRoadLo[i];
    if (abs(wp.x - c) < abs(offX)) { offX = wp.x - c; wX = w; }
    if (abs(wp.y - c) < abs(offZ)) { offZ = wp.y - c; wZ = w; }
  }
  bool inX = abs(offX) < wX * 0.5, inZ = abs(offZ) < wZ * 0.5;
  bool useX = inX && (!inZ || abs(offX) < abs(offZ));
  float lat = useX ? offX : offZ, rw = useX ? wX : wZ;
  float onRoad = (inX || inZ) ? 1.0 : 0.0;
  // Polished wheel tracks, two per lane.
  float laneW = rw / (rw >= 26.0 ? 4.0 : 2.0);
  float lp = fract((lat + rw * 0.5) / laneW);
  float track = (smoothstep(0.13, 0.02, abs(lp - 0.28)) + smoothstep(0.13, 0.02, abs(lp - 0.72))) * onRoad * (inX && inZ ? 0.3 : 1.0);
  // Rectangular repair patches.
  vec2 pg = wp / vec2(5.0, 3.2);
  vec2 pf = fract(pg);
  float patchy = step(0.9, wHash(floor(pg) + 4.1)) * step(0.08, pf.x) * step(pf.x, 0.92) * step(0.12, pf.y) * step(pf.y, 0.88);
  // Crack networks, only in some areas, faded out where they get smaller than a pixel.
  vec2 g = wp * 1.3 + (vec2(wFbm(wp * 0.9), wFbm(wp * 0.9 + 5.2)) - 0.5) * 1.2, gi = floor(g), gf = fract(g);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 r = o + vec2(wHash(gi + o), wHash(gi + o + 7.3)) - gf;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  float edge = sqrt(d2) - sqrt(d1);
  float crack = (1.0 - smoothstep(0.012, 0.012 + wpx * 1.3, edge)) * smoothstep(0.6, 0.76, wFbm(wp * 0.05)) * (1.0 - smoothstep(0.04, 0.14, wpx));
  // Oil drips down the middle of each lane.
  float oil = smoothstep(0.6, 0.82, wFbm(wp * 0.32 + 11.0)) * smoothstep(0.22, 0.0, abs(lp - 0.5)) * onRoad;
  diffuseColor.rgb *= mix(1.0, 0.78, patchy) * (1.0 - 0.55 * crack) * (1.0 - 0.22 * track) * (1.0 - 0.4 * oil);
  diffuseColor.rgb += oil * vec3(0.006, 0.0, 0.012); // a faint petrol sheen
  roadPolish = track * 0.55 + oil * 0.7;
  roadDull = clamp(crack * 0.9 + patchy * 0.45 + (1.0 - wetPud) * (0.35 - 0.3 * track), 0.0, 0.9);
}
#endif
#ifdef WET_TILES
{
  vec2 wp = vWetPos.xz;
  float tpx = max(fwidth(wp.x), fwidth(wp.y));
  vec2 tp = wp / 0.6, tf = fract(tp);
  float jd = min(0.5 - abs(tf.x - 0.5), 0.5 - abs(tf.y - 0.5)) * 0.6;
  float fine = 1.0 - smoothstep(0.03, 0.1, tpx);
  float joint = (1.0 - smoothstep(0.008, 0.008 + tpx, jd)) * fine;
  float tv = mix(1.0, 0.86 + 0.28 * wHash(floor(tp)), fine);
  // Yellow tactile paving where the pavement meets a crossing.
  float dx = 1e5, dz = 1e5;
  for (int i = 0; i < ${ROADS.length}; i++) {
    dx = min(dx, min(abs(wp.x - uRoadLo[i]), abs(wp.x - uRoadHi[i])));
    dz = min(dz, min(abs(wp.y - uRoadLo[i]), abs(wp.y - uRoadHi[i])));
  }
  float tactile = clamp(step(0.35, dx) * step(dx, 0.95) * step(dz, 3.6) + step(0.35, dz) * step(dz, 0.95) * step(dx, 3.6), 0.0, 1.0);
  vec2 dp = fract(wp / 0.1) - 0.5;
  float bump = smoothstep(0.33, 0.24, length(dp)) * fine;
  diffuseColor.rgb = mix(diffuseColor.rgb * tv, vec3(0.5, 0.38, 0.04) * (0.85 + 0.3 * bump), tactile);
  diffuseColor.rgb *= 1.0 - 0.5 * joint * (1.0 - tactile);
}
#endif
// Pools of street-lamp light on the ground, after the detail so cracks and slabs show inside them.
totalEmissiveRadiance += diffuseColor.rgb * vec3(0.75, 0.82, 1.0) * lampLight(vWetPos.xz) * 4.0;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, uWet);
roughnessFactor *= 1.0 - 0.45 * roadPolish;
roughnessFactor = mix(roughnessFactor, 0.05, wetPud);`)
      .replace('#include <opaque_fragment>', `
{
  vec4 rc = reflectMatrix * vec4(vWetPos, 1.0);
  vec2 ruv = rc.xy / rc.w;
  vec2 rip = rainRipples(vWetPos.xz, uTime) * uRain;
  ruv += rip * 0.01 * (0.35 + 0.65 * wetPud);
  ruv.x += (wetGrain - 0.5) * 0.012 * (1.0 - wetPud);
  float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
  float amount = mix(uWet * 0.4, 0.92, wetPud) * mix(0.3, 1.0, fres) * (1.0 - roadDull);
  vec3 refl = texture2D(tReflect, ruv, mix(3.2, 0.3, wetPud)).rgb;
  outgoingLight = outgoingLight * (1.0 - amount * 0.5) + refl * amount;
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `wet-${wet}-${puddle}-${grain}-${road}-${tiles}`;
  return material;
}
