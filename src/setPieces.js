// Moving set pieces: LED screens (scrolling tickers and ad loops), a hologram over the drift lot, an ad
// blimp circling the city, delivery drones over the roads, and traffic cones in the lot you can knock flying.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROADS, HALF, CURB, PILLARS, PLAZA_AREA } from './world.js';
import { LAYER_MAIN_ONLY } from './wet.js';
import { BILLBOARDS } from './textures.js';

const FACE_N = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };

// One material for every screen: mode 0 scrolls the ticker, mode 1 cycles the billboard ads with a wipe.
function screenMaterial(atlas) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      map: { value: atlas.tex },
      uTime: { value: 0 },
      uTicker: { value: new THREE.Vector4(...atlas.uv('ticker')) },
      uBB: { value: BILLBOARDS.map((_, i) => new THREE.Vector4(...atlas.uv(`bb${i}`))) },
    },
    vertexShader: /* glsl */ `
      attribute float aMode; attribute float aSeed;
      varying vec2 vUv; varying float vMode; varying float vSeed;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vMode = aMode; vSeed = aSeed;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uTime; uniform vec4 uTicker; uniform vec4 uBB[${BILLBOARDS.length}];
      varying vec2 vUv; varying float vMode; varying float vSeed;
      #include <fog_pars_fragment>
      void main() {
        vec3 col;
        if (vMode < 0.5) {
          float x = fract(vUv.x + uTime * 0.045 + vSeed);
          col = texture2D(map, vec2(mix(uTicker.x, uTicker.z, x), mix(uTicker.y, uTicker.w, vUv.y))).rgb;
        } else {
          float tt = uTime / 5.0 + vSeed * 6.0;
          int i0 = int(mod(floor(tt), ${BILLBOARDS.length}.0)), i1 = int(mod(floor(tt) + 1.0, ${BILLBOARDS.length}.0));
          float wipe = smoothstep(0.86, 1.0, fract(tt));
          vec3 a = texture2D(map, mix(uBB[i0].xy, uBB[i0].zw, vUv)).rgb;
          vec3 b = texture2D(map, mix(uBB[i1].xy, uBB[i1].zw, vUv)).rgb;
          col = mix(a, b, step(vUv.x, wipe));
          col += vec3(0.6, 0.9, 1.0) * smoothstep(0.02, 0.0, abs(vUv.x - wipe)) * step(0.001, wipe) * step(wipe, 0.999);
        }
        // LED pixel grid and a slight refresh shimmer.
        vec2 g = fract(vUv * vec2(240.0, 135.0));
        col *= 0.72 + 0.28 * step(0.18, g.x) * step(0.18, g.y);
        col *= 1.7 + 0.08 * sin(uTime * 37.0 + vUv.y * 30.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
}

function screenGeo(w, h, mode, seed) {
  const g = new THREE.PlaneGeometry(w, h);
  const n = g.attributes.position.count;
  g.setAttribute('aMode', new THREE.Float32BufferAttribute(new Array(n).fill(mode), 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Array(n).fill(seed), 1));
  return g;
}

export function buildSetPieces(scene, plan, rand, glowAtlas) {
  const range = (a, b) => a + (b - a) * rand();
  const screenMat = screenMaterial(glowAtlas);
  const updaters = [];

  // ---------- LED screens on building faces ----------
  {
    const geos = [], frames = [];
    const tall = plan.filter((b) => !b.tier && b.faces && b.faces.length && b.h > 38 && Math.abs((b.x0 + b.x1) / 2) < HALF && b.facade !== 'glass');
    let made = 0;
    for (const b of tall) {
      if (made >= 22 || rand() > 0.45) continue;
      const f = b.faces[Math.floor(rand() * b.faces.length)];
      const [nx, nz] = FACE_N[f];
      const span = nx ? b.z1 - b.z0 : b.x1 - b.x0;
      const ticker = rand() < 0.45;
      const w = ticker ? Math.min(span - 2, 26) : Math.min(span - 4, 18);
      const h = ticker ? w / 8 : w * (9 / 16);
      if (w < 8) continue;
      const y = CURB + (ticker ? range(12, Math.min(b.h - 4, 24)) : Math.min(b.h - h / 2 - 3, range(20, 34)));
      const cx = nx ? (nx > 0 ? b.x1 : b.x0) : (b.x0 + b.x1) / 2;
      const cz = nz ? (nz > 0 ? b.z1 : b.z0) : (b.z0 + b.z1) / 2;
      const ry = Math.atan2(nx, nz);
      const g = screenGeo(w, h, ticker ? 0 : 1, rand()).rotateY(ry).translate(cx + nx * 0.45, y, cz + nz * 0.45);
      geos.push(g);
      frames.push(new THREE.BoxGeometry(w + 0.8, h + 0.8, 0.4).rotateY(ry).translate(cx + nx * 0.22, y, cz + nz * 0.22));
      made++;
    }
    if (geos.length) {
      scene.add(new THREE.Mesh(mergeGeometries(geos), screenMat));
      const fr = new THREE.Mesh(mergeGeometries(frames), new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.5, metalness: 0.6 }));
      fr.layers.set(LAYER_MAIN_ONLY);
      scene.add(fr);
    }
    updaters.push((t) => { screenMat.uniforms.uTime.value = t; });
  }

  // ---------- hologram over the central pylon in the drift lot ----------
  {
    const p = PILLARS[0];
    const holoMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { map: { value: glowAtlas.tex }, uTime: { value: 0 }, uRect: { value: new THREE.Vector4(...glowAtlas.uv('bb2')) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float uTime; uniform vec4 uRect; varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          uv.x += sin(uv.y * 40.0 + uTime * 9.0) * 0.004 * step(0.92, fract(uTime * 0.37)); // glitch now and then
          vec3 c = texture2D(map, mix(uRect.xy, uRect.zw, uv)).rgb;
          float lum = max(c.r, max(c.g, c.b));
          float scan = 0.65 + 0.35 * sin(vUv.y * 260.0 - uTime * 6.0);
          float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
          float flick = 0.85 + 0.15 * sin(uTime * 23.0) * sin(uTime * 7.1);
          vec3 col = mix(vec3(0.2, 0.9, 1.0), vec3(1.0, 0.3, 0.9), vUv.y) * lum * 1.8 + vec3(0.05, 0.2, 0.3) * 0.25;
          gl_FragColor = vec4(col * scan * edge * flick, 1.0);
        }`,
    });
    const holo = new THREE.Group();
    const w = 16, h = 8;
    const a = new THREE.Mesh(new THREE.PlaneGeometry(w, h), holoMat);
    const bmesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), holoMat);
    bmesh.rotation.y = Math.PI / 2;
    holo.add(a, bmesh);
    holo.position.set(p.x, 26 + 8 + h / 2, p.z);
    holo.layers.set(LAYER_MAIN_ONLY);
    a.layers.set(LAYER_MAIN_ONLY);
    bmesh.layers.set(LAYER_MAIN_ONLY);
    // Projector beam from the top of the pylon.
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.6, 0.8), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 0.6, 8, 24, 1, true).translate(0, 4, 0), beamMat);
    beam.position.set(p.x, 26, p.z);
    beam.layers.set(LAYER_MAIN_ONLY);
    scene.add(holo, beam);
    updaters.push((t) => {
      holoMat.uniforms.uTime.value = t;
      holo.rotation.y = t * 0.25;
      holo.position.y = 26 + 8 + h / 2 + Math.sin(t * 0.8) * 0.4;
      // Swap the ad every 9 s.
      const i = Math.floor(t / 9) % BILLBOARDS.length;
      holoMat.uniforms.uRect.value.set(...glowAtlas.uv(`bb${i}`));
    });
  }

  // ---------- advertising blimp circling the city ----------
  {
    const blimp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14).scale(32, 8.5, 8.5), new THREE.MeshStandardMaterial({ color: 0x23202c, roughness: 0.6, metalness: 0.3 }));
    body.rotation.y = Math.PI / 2;
    blimp.add(body);
    const fins = new THREE.Mesh(mergeGeometries([
      new THREE.BoxGeometry(0.4, 9, 6).translate(0, 4, -27), new THREE.BoxGeometry(12, 0.4, 6).translate(0, 0, -27),
    ]), new THREE.MeshStandardMaterial({ color: 0x1a1820, roughness: 0.6 }));
    blimp.add(fins);
    blimp.add(new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 9).translate(0, -9.3, 2), new THREE.MeshStandardMaterial({ color: 0x15141a })));
    // Screens on both flanks.
    for (const side of [1, -1]) {
      const g = screenGeo(30, 9, 1, side > 0 ? 0.3 : 0.7).rotateY(side * Math.PI / 2).translate(side * 8.7, 0, 0);
      blimp.add(new THREE.Mesh(g, screenMat));
    }
    // Neon belt and blinking nav lights.
    const belt = new THREE.Mesh(new THREE.TorusGeometry(8.6, 0.12, 6, 48).rotateY(Math.PI / 2).scale(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.25, 0.85).multiplyScalar(3) }));
    belt.position.z = 14;
    blimp.add(belt);
    const navMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.1) });
    for (const [x, y, z] of [[0, 9, 0], [0, -11, 2], [6, 0, -27], [-6, 0, -27]]) {
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), navMat);
      n.position.set(x, y, z);
      blimp.add(n);
    }
    blimp.traverse((o) => o.layers.set(LAYER_MAIN_ONLY));
    scene.add(blimp);
    updaters.push((t) => {
      const a = t * 0.012;
      blimp.position.set(Math.cos(a) * 240, 150 + Math.sin(t * 0.2) * 2, Math.sin(a) * 240);
      blimp.rotation.y = -a; // nose along the circle
      navMat.color.setRGB(Math.sin(t * 3) > 0.7 ? 4 : 0.3, 0.1, 0.1);
    });
  }

  // ---------- delivery drones patrolling above the roads ----------
  {
    const n = 26;
    const drones = [];
    for (let i = 0; i < n; i++) {
      const road = ROADS[Math.floor(rand() * ROADS.length)];
      drones.push({ alongZ: rand() < 0.5, c: road.c + range(-road.w / 3, road.w / 3), y: range(24, 48), speed: range(6, 13) * (rand() < 0.5 ? -1 : 1), phase: rand() * 1000 });
    }
    const bodyGeo = mergeGeometries([
      new THREE.BoxGeometry(0.9, 0.25, 0.9),
      new THREE.BoxGeometry(2.2, 0.06, 0.1), new THREE.BoxGeometry(0.1, 0.06, 2.2),
      new THREE.BoxGeometry(0.5, 0.4, 0.5).translate(0, -0.45, 0),
    ]);
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x2a2b33, roughness: 0.5, metalness: 0.5 }), n);
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshBasicMaterial(), n * 2);
    bodies.layers.set(LAYER_MAIN_ONLY);
    lights.layers.set(LAYER_MAIN_ONLY);
    bodies.frustumCulled = lights.frustumCulled = false;
    const red = new THREE.Color(4, 0.2, 0.2), green = new THREE.Color(0.2, 4, 0.6), off = new THREE.Color(0.2, 0.05, 0.05);
    for (let i = 0; i < n; i++) { lights.setColorAt(i * 2, red); lights.setColorAt(i * 2 + 1, green); }
    scene.add(bodies, lights);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    updaters.push((t) => {
      drones.forEach((d, i) => {
        // Back and forth along the road, turning round at the city edge.
        const span = HALF * 2 - 40;
        const u = ((t * d.speed + d.phase) % (span * 2) + span * 2) % (span * 2);
        const s = u < span ? u - span / 2 : span * 1.5 - u;
        const dir = (u < span ? 1 : -1) * Math.sign(d.speed);
        pos.set(d.alongZ ? d.c : s, d.y + Math.sin(t * 1.3 + i) * 0.4, d.alongZ ? s : d.c);
        q.setFromAxisAngle(up, d.alongZ ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2));
        m.compose(pos, q, one);
        bodies.setMatrixAt(i, m);
        for (const k of [0, 1]) {
          m.makeTranslation(pos.x + (k ? 0.7 : -0.7), pos.y, pos.z);
          lights.setMatrixAt(i * 2 + k, m);
        }
        lights.setColorAt(i * 2, Math.sin(t * 6 + i) > 0.3 ? red : off);
      });
      bodies.instanceMatrix.needsUpdate = true;
      lights.instanceMatrix.needsUpdate = true;
      lights.instanceColor.needsUpdate = true;
    });
  }

  // ---------- cones in the drift lot: knock them and they fly ----------
  const cones = [];
  {
    for (const p of PILLARS.slice(1)) {
      const r = p.r + 9;
      for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; cones.push({ hx: p.x + Math.cos(a) * r, hz: p.z + Math.sin(a) * r }); }
    }
    for (let x = PLAZA_AREA.x0 + 22; x < PLAZA_AREA.x1 - 20; x += 16) cones.push({ hx: x, hz: PLAZA_AREA.z0 + 14 + (Math.round(x) % 2 ? 0 : 2) });
    for (const c of cones) Object.assign(c, { x: c.hx, y: 0, z: c.hz, vx: 0, vy: 0, vz: 0, tilt: 0, tiltV: 0, yaw: rand() * 6, spin: 0, rest: true });
    const geo = mergeGeometries([
      new THREE.CylinderGeometry(0.04, 0.2, 0.62, 12).translate(0, 0.35, 0),
      new THREE.CylinderGeometry(0.115, 0.15, 0.12, 12).translate(0, 0.38, 0),
      new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(0, 0.025, 0),
    ]);
    // Vertex colours: orange cone, white reflective band, black base.
    const col = [];
    const counts = [geo.attributes.position.count];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const c = y < 0.06 ? [0.05, 0.05, 0.06] : y > 0.31 && y < 0.45 && Math.abs(Math.hypot(pos.getX(i), pos.getZ(i))) > 0.11 ? [0.95, 0.95, 0.95] : [1.0, 0.32, 0.05];
      col.push(...c);
    }
    void counts;
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), cones.length);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const write = () => {
      cones.forEach((c, i) => {
        e.set(c.tilt, c.yaw, 0, 'YXZ');
        m.compose(p.set(c.x, c.y, c.z), q.setFromEuler(e), one);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    write();
    let lastHitSound = 0;
    updaters.push((t, dt, car, sound) => {
      if (!car) return;
      let moved = false;
      const sh = Math.sin(car.h), ch = Math.cos(car.h);
      for (const c of cones) {
        // Hits from the car's two hull circles.
        for (const o of [1.3, -1.3, 0]) {
          const hx = car.x + sh * o, hz = car.z + ch * o;
          const dx = c.x - hx, dz = c.z - hz, d = Math.hypot(dx, dz);
          if (d < 1.15 && c.y < 0.6) {
            const vpx = car.vx + car.r * ch * o, vpz = car.vz - car.r * sh * o;
            const sp = Math.hypot(vpx, vpz);
            if (sp < 0.5) continue;
            const nx = dx / (d || 1), nz = dz / (d || 1);
            c.vx = vpx * 1.25 + nx * sp * 0.5;
            c.vz = vpz * 1.25 + nz * sp * 0.5;
            c.vy = 1.5 + sp * 0.18;
            c.tiltV = 6 + sp * 0.6;
            c.spin = (Math.random() - 0.5) * 12;
            c.rest = false;
            c.x = hx + nx * 1.2;
            c.z = hz + nz * 1.2;
            if (t - lastHitSound > 0.08 && sound) { sound.burst({ freq: 900, type: 'bandpass', q: 1.4, gain: Math.min(0.4, 0.1 + sp * 0.012), attack: 0.002, decay: 0.12 }); lastHitSound = t; }
          }
        }
        if (c.rest) continue;
        moved = true;
        c.vy -= 9.81 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.yaw += c.spin * dt;
        c.tilt = Math.min(Math.PI / 2, c.tilt + c.tiltV * dt);
        if (c.y <= 0) {
          c.y = 0;
          c.vy = Math.abs(c.vy) > 2 ? -c.vy * 0.3 : 0;
          const f = Math.exp(-dt * 3.5);
          c.vx *= f; c.vz *= f; c.spin *= f;
          if (Math.hypot(c.vx, c.vz) < 0.15 && c.vy === 0) { c.rest = true; c.vx = c.vz = 0; c.tilt = Math.max(c.tilt, 1.3); }
        }
      }
      if (moved) write();
    });
    cones.reset = () => {
      for (const c of cones) Object.assign(c, { x: c.hx, y: 0, z: c.hz, vx: 0, vy: 0, vz: 0, tilt: 0, rest: true });
      write();
    };
  }

  return {
    cones,
    resetCones: () => cones.reset(),
    update(t, dt, car, sound) { for (const u of updaters) u(t, dt, car, sound); },
  };
}
