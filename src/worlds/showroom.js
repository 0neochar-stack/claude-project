// The showroom behind the main menu and the Customize screen: a dark studio with a turntable, a curved
// backdrop, rings of neon light bars and key and rim spotlights on the car. Cheap to render.
import * as THREE from 'three';
import { disposeTree } from './util.js';

function floorTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(512, 512, 40, 512, 512, 512);
  grd.addColorStop(0, '#2a2438');
  grd.addColorStop(0.45, '#13101c');
  grd.addColorStop(1, '#07060b');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 1024);
  // Turntable rings and radial seams.
  g.strokeStyle = 'rgba(160,150,220,0.16)';
  g.lineWidth = 2;
  for (const r of [150, 156, 300, 470]) { g.beginPath(); g.arc(512, 512, r, 0, Math.PI * 2); g.stroke(); }
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    g.beginPath();
    g.moveTo(512 + Math.cos(a) * 160, 512 + Math.sin(a) * 160);
    g.lineTo(512 + Math.cos(a) * 300, 512 + Math.sin(a) * 300);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createShowroom() {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.45, metalness: 0.4 }),
  );
  root.add(floor);
  // Glowing turntable edge.
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x33f0ff).multiplyScalar(1.3) });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.55, 0.025, 6, 96).rotateX(Math.PI / 2), ringMat);
  ring.position.y = 0.02;
  root.add(ring);
  // Curved backdrop.
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(28, 28, 18, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0f0b18, roughness: 0.9, side: THREE.BackSide }),
  );
  wall.position.y = 9;
  root.add(wall);
  // Neon light bars standing in a ring, alternating pink and cyan, and a halo overhead.
  const barGeo = new THREE.BoxGeometry(0.12, 6, 0.12);
  const pink = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3fb4).multiplyScalar(1.3) });
  const cyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x33f0ff).multiplyScalar(1.3) });
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const bar = new THREE.Mesh(barGeo, k % 2 ? pink : cyan);
    bar.position.set(Math.cos(a) * 16, 3, Math.sin(a) * 16);
    root.add(bar);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(7, 0.05, 6, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.9).multiplyScalar(1.1) }));
  halo.position.y = 7.5;
  root.add(halo);

  root.add(new THREE.HemisphereLight(0x8a7cff, 0x120a18, 0.6));
  const key = new THREE.SpotLight(0xffffff, 320, 40, 0.5, 0.6, 1.6);
  key.position.set(6, 9, 7);
  const rimA = new THREE.SpotLight(0xff3fb4, 220, 40, 0.55, 0.7, 1.6);
  rimA.position.set(-8, 5, -6);
  const rimB = new THREE.SpotLight(0x33f0ff, 220, 40, 0.55, 0.7, 1.6);
  rimB.position.set(8, 4, -7);
  for (const l of [key, rimA, rimB]) { l.target.position.set(0, 0.6, 0); root.add(l, l.target); }

  return {
    id: 'showroom',
    root,
    spawn: { x: 0, z: 0, heading: 0.6 },
    env: {
      background: new THREE.Color(0x07060b),
      fog: new THREE.Fog(0x07060b, 20, 45),
      exposure: 0.95,
      bloom: { strength: 0.45, radius: 0.45, threshold: 0.92 },
      far: 120,
      headlights: true,
    },
    flat: true,
    groundAt: () => 0,
    blocked: () => false,
    // Camera for the menus: a slow orbit, closer and lower in Customize.
    // Orbit camera for the menus: `orbit` holds yaw, pitch and zoom (from dragging, the wheel or the right
    // stick); it drifts round on its own when left alone. Closer and lower in Customize.
    camera(t, mode, cam, orbit = { yaw: t * 0.1 + 0.8, pitch: 0, zoom: 1 }) {
      const near = mode === 'customize';
      const r = (near ? (cam.aspect < 1 ? 10.5 : 6.6) : 8.2) * orbit.zoom;
      const el = Math.max(0.02, Math.min(1.2, (near ? 0.12 : 0.18) + orbit.pitch));
      const ty = near ? 0.6 : 0.75;
      cam.position.set(Math.sin(orbit.yaw) * Math.cos(el) * r, ty + Math.sin(el) * r, Math.cos(orbit.yaw) * Math.cos(el) * r);
      cam.lookAt(0, ty, 0);
    },
    update(t) {
      ringMat.color.setRGB(0.2, 0.94, 1).multiplyScalar(1.1 + Math.sin(t * 2) * 0.2);
    },
    dispose() { disposeTree(root); },
  };
}
