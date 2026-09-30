import * as THREE from 'three';
import { LAYER_MAIN_ONLY } from './wet.js';

// Tyre smoke and road spray as one pooled point cloud.
export class Particles {
  constructor(count = 700) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.base = new Float32Array(count);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 }, uTint: { value: new THREE.Color(0.75, 0.72, 0.85) } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.5);
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTint;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          if (vAlpha * a < 0.004) discard;
          gl_FragColor = vec4(uTint, vAlpha * a * a);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER_MAIN_ONLY);
  }

  emit(x, y, z, vx, vy, vz, size, grow, life, alpha) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.base[i] = alpha;
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      const drag = Math.exp(-dt * 1.8);
      this.vel[k] *= drag; this.vel[k + 2] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag + dt * 0.4;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.base[i] * Math.min(1, (1 - t) * 6) * t;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}

// Rain streaks that wrap around the camera, computed on the GPU.
export function makeRain(count) {
  const seeds = new Float32Array(count * 2 * 4);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    seeds.set([x, y, z, 0, x, y, z, 1], i * 8);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(2.5, 1.2) },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime; uniform vec3 uCam; uniform vec2 uWind;
      varying float vA;
      void main() {
        const vec3 box = vec3(70.0, 36.0, 70.0);
        float fall = 26.0 + aSeed.x * 6.0;
        vec3 p;
        p.x = uCam.x + mod(aSeed.x * box.x + uTime * uWind.x - uCam.x, box.x) - box.x * 0.5;
        p.z = uCam.z + mod(aSeed.z * box.z + uTime * uWind.y - uCam.z, box.z) - box.z * 0.5;
        p.y = uCam.y + mod(aSeed.y * box.y - uTime * fall - uCam.y, box.y) - box.y * 0.5;
        vec3 vel = vec3(uWind.x, -fall, uWind.y);
        p -= vel * 0.03 * aSeed.w;
        float d = distance(p, uCam);
        vA = smoothstep(34.0, 6.0, d) * step(0.0, p.y) * (0.25 + 0.75 * aSeed.w);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFlash;
      varying float vA;
      void main() { gl_FragColor = vec4(vec3(0.55, 0.62, 0.8) * (1.0 + uFlash * 3.0), vA * 0.35); }`,
  });
  const rain = new THREE.LineSegments(geo, mat);
  rain.frustumCulled = false;
  rain.layers.set(LAYER_MAIN_ONLY);
  return rain;
}
