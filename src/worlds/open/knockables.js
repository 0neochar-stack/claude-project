// Wheelie bins out on the curb for trash day. Clip one and it flies, tumbles and rolls to a stop; they
// tidy themselves back up once you are well away.
import * as THREE from 'three';

function binGeometry() {
  // Tapered body, a lid that overhangs, two wheels at the back. Vertex colours: body white (tinted per
  // instance), lid and wheels dark.
  const parts = [];
  const body = new THREE.CylinderGeometry(0.34, 0.29, 0.98, 4, 1).rotateY(Math.PI / 4).scale(1.05, 1, 1.25).translate(0, 0.52, 0);
  const lid = new THREE.BoxGeometry(0.66, 0.06, 0.8).translate(0, 1.04, 0.02);
    const wheels = new THREE.CylinderGeometry(0.1, 0.1, 0.62, 5, 1, true).rotateZ(Math.PI / 2).translate(0, 0.1, -0.36);
  for (const [g, c] of [[body, 1], [lid, 0.55], [wheels, 0.12]]) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    const col = new Float32Array(ng.attributes.position.count * 3).fill(c);
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(ng);
  }
  const pos = [], nor = [], col = [];
  for (const p of parts) { pos.push(...p.attributes.position.array); nor.push(...p.attributes.normal.array); col.push(...p.attributes.color.array); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const CELL = 32;
export class Knockables {
  constructor(items, groundAt) {
    this.items = items.map((b) => ({ ...b, home: { x: b.x, z: b.z, rot: b.rot }, y: groundAt(b.x, b.z), vx: 0, vy: 0, vz: 0, q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot), w: new THREE.Vector3(), moving: false, moved: false, rest: 0 }));
    this.groundAt = groundAt;
    this.mesh = new THREE.InstancedMesh(binGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), Math.max(1, this.items.length));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const c = new THREE.Color();
    this.items.forEach((b, i) => this.mesh.setColorAt(i, c.set(b.color)));
    this.mesh.count = this.items.length;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.cells = new Map();
    this.items.forEach((b, i) => {
      const k = `${Math.floor(b.home.x / CELL)},${Math.floor(b.home.z / CELL)}`;
      (this.cells.get(k) || this.cells.set(k, []).get(k)).push(i);
    });
    this.m4 = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
    this.active = new Set();
    this.items.forEach((_, i) => this.write(i));
    this.mesh.computeBoundingSphere();
    this.mesh.frustumCulled = false;
    this.hits = 0;
  }

  write(i) {
    const b = this.items[i];
    this.m4.compose(this.p.set(b.x, b.y, b.z), b.q, this.one);
    this.mesh.setMatrixAt(i, this.m4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // Car against bins: anything inside the car's two hull circles gets launched.
  hit(car, sound) {
    const sh = Math.sin(car.h), ch = Math.cos(car.h);
    const cx = Math.floor(car.x / CELL), cz = Math.floor(car.z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = this.cells.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const i of list) {
        const b = this.items[i];
        if (b.vy > 0.5) continue;
        for (const o of [1.3, -1.3]) {
          const hx = car.x + sh * o, hz = car.z + ch * o;
          const ddx = b.x - hx, ddz = b.z - hz, d = Math.hypot(ddx, ddz);
          if (d > 1.35 || Math.abs(b.y - this.groundAt(car.x, car.z)) > 2) continue;
          const sp = Math.hypot(car.vx, car.vz);
          if (sp < 1.5) { b.x += (ddx / (d || 1)) * (1.35 - d); b.z += (ddz / (d || 1)) * (1.35 - d); b.moved = true; this.write(i); continue; }
          const k = 1.05 + Math.random() * 0.4;
          b.vx = car.vx * k + (ddx / (d || 1)) * sp * 0.25;
          b.vz = car.vz * k + (ddz / (d || 1)) * sp * 0.25;
          b.vy = 2 + Math.min(6, sp * 0.18) + Math.random() * 1.5;
          b.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14);
          b.moving = true;
          b.moved = true;
          b.rest = 0;
          this.active.add(i);
          // A little drag on the car.
          car.vx *= 0.985; car.vz *= 0.985;
          if (sound.ctx) sound.burst({ freq: 260, type: 'lowpass', gain: 0.35 + Math.min(0.4, sp * 0.01), attack: 0.002, decay: 0.18 });
          this.hits++;
          break;
        }
      }
    }
  }

  update(dt) {
    for (const i of this.active) {
      const b = this.items[i];
      b.vy -= 9.81 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const w = b.w.length();
      if (w > 1e-3) { this.tmpQ.setFromAxisAngle(this.p.copy(b.w).divideScalar(w), w * dt); b.q.premultiply(this.tmpQ); }
      const g = this.groundAt(b.x, b.z) + 0.3;
      if (b.y < g) {
        b.y = g;
        if (b.vy < -1.5) { b.vy = -b.vy * 0.35; b.w.multiplyScalar(0.7); }
        else b.vy = 0;
        b.vx *= 0.82; b.vz *= 0.82;
        b.w.multiplyScalar(0.9);
      }
      if (Math.hypot(b.vx, b.vz) < 0.3 && Math.abs(b.vy) < 0.3 && b.y <= g + 0.01) {
        b.rest += dt;
        if (b.rest > 0.4) { b.moving = false; b.vx = b.vy = b.vz = 0; this.active.delete(i); }
      }
      this.write(i);
    }
  }

  reset() {
    this.items.forEach((b, i) => {
      if (!b.moved) return;
      Object.assign(b, { x: b.home.x, z: b.home.z, y: this.groundAt(b.home.x, b.home.z), vx: 0, vy: 0, vz: 0, moving: false, moved: false });
      b.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.home.rot);
      b.w.set(0, 0, 0);
      this.write(i);
    });
    this.active.clear();
  }
}
