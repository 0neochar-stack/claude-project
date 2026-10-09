// Sky dome, sun, moon and stars, with the lighting for any time of day. One shader on a sphere that follows
// the camera; light colours and fog come from the same keyframes so everything agrees.
import * as THREE from 'three';

// Keyframes by sun elevation (radians): zenith, horizon, sun light colour and strength, ambient sky/ground.
const KEYS = [
  { e: -0.35, zen: 0x03050f, hor: 0x0c1430, sun: 0x000000, sunI: 0, sky: 0x1b2a55, gnd: 0x0a0c14, hemiI: 0.32, exp: 1.0, night: 1 },
  { e: -0.1, zen: 0x0b1030, hor: 0x2c2350, sun: 0x000000, sunI: 0, sky: 0x2c2c62, gnd: 0x120f1a, hemiI: 0.4, exp: 1.0, night: 1 },
  { e: -0.02, zen: 0x1b1d55, hor: 0xb4507a, sun: 0xff7b4a, sunI: 0.3, sky: 0x5a4a8a, gnd: 0x2a1c22, hemiI: 0.55, exp: 1.0, night: 0.75 },
  { e: 0.06, zen: 0x2f3c8c, hor: 0xff8a50, sun: 0xffa060, sunI: 1.6, sky: 0x8a7ab0, gnd: 0x3a2a24, hemiI: 0.7, exp: 0.95, night: 0.25 },
  { e: 0.25, zen: 0x3d74c8, hor: 0xd7c3a8, sun: 0xffe0b8, sunI: 2.6, sky: 0x9fc0e8, gnd: 0x5a4a38, hemiI: 0.85, exp: 0.85, night: 0 },
  { e: 1.2, zen: 0x2f6fd0, hor: 0xb8d6f0, sun: 0xfff6ea, sunI: 3.0, sky: 0xa8cdf2, gnd: 0x6a5a44, hemiI: 0.9, exp: 0.8, night: 0 },
];
const c1 = new THREE.Color(), c2 = new THREE.Color();
function sample(e, key, out) {
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (e - a.e) / (b.e - a.e)));
  if (out) return out.copy(c1.setHex(a[key])).lerp(c2.setHex(b[key]), t);
  return a[key] + (b[key] - a[key]) * t;
}

export class Sky {
  constructor(radius) {
    this.uniforms = {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uZen: { value: new THREE.Color() },
      uHor: { value: new THREE.Color() },
      uNight: { value: 0 },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform vec3 uZen; uniform vec3 uHor; uniform float uNight; uniform float uTime;
        varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1, 0), 1.0)), c = hash(vec3(i + vec2(0, 1), 1.0)), d = hash(vec3(i + 1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(uHor, uZen, pow(h, 0.45));
          // Below the horizon, fade to a darker haze.
          col = mix(col, uHor * 0.55, smoothstep(0.0, -0.15, d.y));
          float sd = max(dot(d, normalize(uSun)), 0.0);
          // Sun disc and glow; the glow warms the horizon toward the sun.
          float day = smoothstep(-0.12, 0.05, uSun.y);
          col += vec3(1.0, 0.62, 0.32) * pow(sd, 6.0) * 0.45 * day * (1.0 - h * 0.6);
          col += vec3(1.0, 0.9, 0.75) * pow(sd, 900.0) * 18.0 * day;
          // Clouds: soft streaks, lit by the sun at dusk, dark at night.
          vec2 cp = d.xz / max(d.y + 0.12, 0.05) * 1.6 + vec2(uTime * 0.004, 0.0);
          float cl = vnoise(cp) * 0.6 + vnoise(cp * 2.3) * 0.3 + vnoise(cp * 5.1) * 0.1;
          cl = smoothstep(0.55, 0.85, cl) * smoothstep(0.0, 0.25, d.y);
          vec3 cloudCol = mix(uHor * 1.15 + vec3(0.06), vec3(0.08, 0.09, 0.14), uNight);
          col = mix(col, cloudCol, cl * 0.75);
          // Stars and the moon at night.
          if (uNight > 0.01) {
            vec3 sp = floor(d * 380.0);
            float s = hash(sp);
            float star = step(0.9965, s) * (0.5 + 0.5 * sin(uTime * 2.0 + s * 80.0));
            col += vec3(star) * uNight * smoothstep(0.02, 0.3, d.y) * (1.0 - cl);
            vec3 moonDir = normalize(vec3(-0.4, 0.45, -0.8));
            float md = dot(d, moonDir);
            col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, md) * uNight * 1.6;
            col += vec3(0.25, 0.3, 0.5) * pow(max(md, 0.0), 60.0) * uNight * 0.35;
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sunTarget = this.sun.target;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    this.moon = new THREE.DirectionalLight(0x8aa0d8, 0.25);
    this.moon.position.set(-400, 450, -800);
    this.fog = new THREE.Fog(0x000000, 200, 2000);
    this.background = new THREE.Color();
    this.state = { night: 0, exposure: 1, sunE: 0 };
  }

  // hours: 0..24. Sun rises at 6 in the east (+x), sets at 18 in the west, a little to the south.
  setTime(hours) {
    const a = ((hours - 6) / 24) * Math.PI * 2;
    const e = Math.sin(a) * 1.15;
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.95, -0.35).normalize();
    // Elevation drives the colours.
    const el = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.uniforms.uSun.value.copy(dir);
    sample(el, 'zen', this.uniforms.uZen.value);
    sample(el, 'hor', this.uniforms.uHor.value);
    const night = sample(el, 'night');
    this.uniforms.uNight.value = night;
    this.state.night = night;
    this.state.sunE = el;
    this.state.exposure = sample(el, 'exp');
    sample(el, 'sun', this.sun.color);
    this.sun.intensity = sample(el, 'sunI');
    this.sunDir = dir;
    sample(el, 'sky', this.hemi.color);
    sample(el, 'gnd', this.hemi.groundColor);
    this.hemi.intensity = sample(el, 'hemiI');
    this.moon.intensity = 0.28 * night;
    this.fog.color.copy(this.uniforms.uHor.value).lerp(this.uniforms.uZen.value, 0.25);
    this.background.copy(this.fog.color);
    void e;
  }

  // The sun's shadow box follows the car.
  follow(x, y, z) {
    this.mesh.position.set(x, y, z);
    const d = this.sunDir || new THREE.Vector3(0, 1, 0);
    const up = Math.max(0.15, d.y);
    this.sun.position.set(x + (d.x / up) * 80, y + 80, z + (d.z / up) * 80);
    this.sunTarget.position.set(x, y, z);
    this.sunTarget.updateMatrixWorld();
  }
}

// Reflection environments for the car paint: a gradient sky over dark ground, made once per lighting mood.
export function skyEnvironment(renderer, zen, hor, gnd, sunColor, sunDir) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uZen: { value: new THREE.Color(zen) }, uHor: { value: new THREE.Color(hor) }, uGnd: { value: new THREE.Color(gnd) }, uSun: { value: sunDir.clone().normalize() }, uSunC: { value: new THREE.Color(sunColor) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uZen, uHor, uGnd, uSun, uSunC; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); vec3 c = d.y > 0.0 ? mix(uHor, uZen, pow(d.y, 0.5)) : mix(uHor * 0.6, uGnd, smoothstep(0.0, -0.2, d.y));
        c += uSunC * pow(max(dot(d, uSun), 0.0), 200.0) * 30.0; gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  return tex;
}
