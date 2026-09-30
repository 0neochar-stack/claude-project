import * as THREE from 'three';

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
export function makeWet(material, reflections, { wet = 1, puddle = 1, grain = 1 } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, reflections.uniforms, {
      uWet: { value: wet }, uPuddle: { value: puddle }, uGrain: { value: grain },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tReflect; uniform mat4 reflectMatrix;
uniform float uTime, uRain, uWet, uPuddle, uGrain;
varying vec3 vWetPos;
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
diffuseColor.rgb *= mix(1.0, 0.45, max(wetPud, uWet * 0.45));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, uWet);
roughnessFactor = mix(roughnessFactor, 0.05, wetPud);`)
      .replace('#include <opaque_fragment>', `
{
  vec4 rc = reflectMatrix * vec4(vWetPos, 1.0);
  vec2 ruv = rc.xy / rc.w;
  vec2 rip = rainRipples(vWetPos.xz, uTime) * uRain;
  ruv += rip * 0.01 * (0.35 + 0.65 * wetPud);
  ruv.x += (wetGrain - 0.5) * 0.012 * (1.0 - wetPud);
  float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
  float amount = mix(uWet * 0.4, 0.92, wetPud) * mix(0.3, 1.0, fres);
  vec3 refl = texture2D(tReflect, ruv, mix(3.2, 0.3, wetPud)).rgb;
  outgoingLight = outgoingLight * (1.0 - amount * 0.5) + refl * amount;
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `wet-${wet}-${puddle}-${grain}`;
  return material;
}
