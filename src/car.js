import * as THREE from 'three';
import { LAYER_MAIN_ONLY } from './wet.js';

export const PAINTS = [
  { name: 'Midnight Violet', color: 0x3b1a78 },
  { name: 'Hot Magenta', color: 0xc2186b },
  { name: 'Ice Cyan', color: 0x1aa6c9 },
  { name: 'Pearl White', color: 0xd9dde6 },
  { name: 'Racing Lime', color: 0x7ccf1f },
  { name: 'Gunmetal', color: 0x2a2e36 },
];

// Neon room captured into a PMREM so the clearcoat picks up pink and cyan streaks.
export function makeCarEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x05040a);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const strip = (color, x, y, z, sx, sy, sz, k = 6) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    env.add(m);
  };
  strip(0xff2bd6, -6, 3, 0, 0.5, 2, 14);
  strip(0x22e6ff, 6, 3, 0, 0.5, 2, 14);
  strip(0xffffff, 0, 8, 0, 10, 0.3, 1.2, 3);
  strip(0xffa040, 0, 4, -8, 8, 1.2, 0.5, 3);
  strip(0x6a4cff, 0, 4, 8, 8, 1.2, 0.5, 3);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.03).texture;
  pmrem.dispose();
  return tex;
}

function profileShape(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (const p of points.slice(1)) s.lineTo(p[0], p[1]);
  return s;
}

// Extrude a side profile (z forward, y up) across the car's width.
function extrudeProfile(points, width, bevel) {
  const g = new THREE.ExtrudeGeometry(profileShape(points), {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1,
  });
  // Shape x is the car's z axis; extrusion runs along z, which becomes the car's x.
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  g.computeVertexNormals();
  return g;
}

export function buildCar(envMap, radial) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // rolls and pitches on the suspension
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: PAINTS[0].color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMap, envMapIntensity: 1.4,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.55, metalness: 0.3, envMap, envMapIntensity: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x06070d, metalness: 0.2, roughness: 0.04, clearcoat: 1, envMap, envMapIntensity: 1.8 });

  // Wedge-nosed coupe, low and wide.
  const lower = extrudeProfile([
    [-2.2, 0.26], [2.05, 0.26], [2.24, 0.38], [2.22, 0.62], [1.2, 0.8], [0.35, 0.86], [-1.9, 0.9], [-2.24, 0.86], [-2.26, 0.4],
  ], 1.84, 0.07);
  body.add(new THREE.Mesh(lower, paint));
  const cabin = extrudeProfile([
    [0.4, 0.84], [-0.3, 1.26], [-1.25, 1.27], [-1.95, 0.9],
  ], 1.5, 0.05);
  body.add(new THREE.Mesh(cabin, glass));
  // Roof panel in body colour over the glass.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 0.86), paint);
  roof.position.set(0, 1.305, -0.77);
  body.add(roof);
  // Side skirts, splitter, diffuser.
  const skirtGeo = new THREE.BoxGeometry(0.1, 0.12, 2.6);
  for (const s of [-1, 1]) {
    const sk = new THREE.Mesh(skirtGeo, trim);
    sk.position.set(s * 0.93, 0.27, -0.1);
    body.add(sk);
  }
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.3), trim);
  splitter.position.set(0, 0.24, 2.15);
  body.add(splitter);
  // Wing.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.36), trim);
  wing.position.set(0, 1.15, -1.95);
  wing.rotation.x = -0.08;
  body.add(wing);
  for (const s of [-0.55, 0.55]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.14), trim);
    st.position.set(s, 1.0, -1.95);
    body.add(st);
  }

  // Lights.
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.2, 4.6) });
  for (const s of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.06), headMat);
    hl.position.set(s, 0.6, 2.2);
    hl.rotation.x = -0.35;
    body.add(hl);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.08, 0.12) });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.04), tailMat);
  tail.position.set(0, 0.76, -2.27);
  body.add(tail);

  // Underglow: a bright strip under the sills plus a coloured pool on the road.
  const glowColor = new THREE.Color(0xff2bd6);
  const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 3.4), new THREE.MeshBasicMaterial({ color: glowColor.clone().multiplyScalar(3) }));
  glowStrip.position.set(0, 0.2, 0);
  body.add(glowStrip);
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: radial, color: glowColor.clone().multiplyScalar(0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  pool.position.y = 0.035;
  pool.layers.set(LAYER_MAIN_ONLY);
  root.add(pool);

  // Headlight beam.
  const beam = new THREE.SpotLight(0xdde8ff, 260, 70, 0.42, 0.55, 1.4);
  beam.position.set(0, 0.7, 2.0);
  beam.target.position.set(0, 0, 14);
  body.add(beam, beam.target);
  const tailGlow = new THREE.PointLight(0xff2030, 6, 7, 2);
  tailGlow.position.set(0, 0.6, -2.8);
  body.add(tailGlow);

  // Wheels: tyre, dished rim and a neon lip.
  const wheels = [];
  const tyreGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 22).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.26, 10).rotateZ(Math.PI / 2);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a8f9c, metalness: 0.9, roughness: 0.25, envMap });
  const spokeGeo = new THREE.BoxGeometry(0.27, 0.4, 0.05);
  for (const [x, z, front] of [[-0.8, 1.25, true], [0.8, 1.25, true], [-0.8, -1.35, false], [0.8, -1.35, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.33, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tyreGeo, tyreMat));
    spin.add(new THREE.Mesh(rimGeo, rimMat));
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Mesh(spokeGeo, rimMat);
      sp.rotation.x = (k * Math.PI) / 3;
      spin.add(sp);
    }
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, front, x, z });
  }

  let paintIndex = 0;
  return {
    root, body, wheels, beam,
    setPaint(i) {
      paintIndex = (i + PAINTS.length) % PAINTS.length;
      paint.color.set(PAINTS[paintIndex].color);
      return PAINTS[paintIndex].name;
    },
    get paintIndex() { return paintIndex; },
    update(car, dt) {
      root.position.set(car.x, 0, car.z);
      root.rotation.y = car.h;
      // Body roll from lateral load, pitch from acceleration.
      const lat = car.r * car.u;
      body.rotation.z = THREE.MathUtils.damp(body.rotation.z, THREE.MathUtils.clamp(lat * 0.006, -0.07, 0.07), 8, dt);
      body.rotation.x = THREE.MathUtils.damp(body.rotation.x, THREE.MathUtils.clamp(-car.ax * 0.006, -0.05, 0.05), 8, dt);
      for (const w of wheels) {
        if (w.front) w.pivot.rotation.y = car.steer;
        if (w.front) w.spin.rotation.x += (car.u / 0.33) * dt;
        else w.spin.rotation.x = car.wheelSpinAngle;
      }
      const braking = car.braking > 0.1 || car.handbrake;
      tailMat.color.setRGB(braking ? 6 : 2.2, braking ? 0.2 : 0.08, braking ? 0.25 : 0.12);
      tailGlow.intensity = braking ? 14 : 5;
    },
  };
}
