// Driving cameras: chase, far chase, hood and first person from the driver's seat.
// Third-person cameras swing toward the direction of travel so a drift is framed side-on, stay out of
// walls and above the ground.
import * as THREE from 'three';

export const CAMERAS = [
  { id: 'chase', name: 'Chase' },
  { id: 'far', name: 'Far chase' },
  { id: 'hood', name: 'Hood' },
  { id: 'cockpit', name: 'First person' },
];

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), up = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.lean = 0;
    this.shake = 0;
    this.headX = 0;
    this.headY = 0;
    this.fresh = true;
    // Free look (GTA style): offsets from the normal view, eased back once you stop looking.
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lookIdle = 99;
  }

  // Adds to the free-look offsets (radians). Yaw wraps all the way round; pitch is limited.
  addLook(dYaw, dPitch) {
    this.lookYaw = Math.atan2(Math.sin(this.lookYaw + dYaw), Math.cos(this.lookYaw + dYaw));
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + dPitch, -0.35, 0.7);
    this.lookIdle = 0;
  }

  get id() { return CAMERAS[this.mode].id; }
  get name() { return CAMERAS[this.mode].name; }
  get firstPerson() { return this.id === 'cockpit' || this.id === 'hood'; }

  set(id) {
    const i = CAMERAS.findIndex((c) => c.id === id);
    this.mode = i < 0 ? 0 : i;
    this.fresh = true;
  }

  cycle(dir = 1) {
    this.mode = (this.mode + dir + CAMERAS.length) % CAMERAS.length;
    this.fresh = true;
    return this.name;
  }

  // Toggles between first person and the chase camera.
  toggleView() {
    this.set(this.id === 'cockpit' ? 'chase' : 'cockpit');
    return this.name;
  }

  snap(car) { this.fresh = true; this.yaw = car.h; }

  // Walks from the car toward the camera and stops before the first blocked spot. Returns how far it got.
  avoid(pos, car, world, ground) {
    const dx = pos.x - car.x, dz = pos.z - car.z;
    let t = 1;
    for (let k = 1; k <= 12; k++) {
      if (world.blocked(car.x + (dx * k) / 12, car.z + (dz * k) / 12, 0.6)) { t = Math.max(0.2, (k - 1) / 12); break; }
    }
    pos.x = car.x + dx * t;
    pos.z = car.z + dz * t;
    const gy = world.groundAt(pos.x, pos.z) + 0.6;
    if (pos.y < gy) pos.y = gy;
    return t;
  }

  update(dt, car, view, world, ground, playing) {
    const cam = this.camera;
    // After a moment without input the view swings back behind the car.
    this.lookIdle += dt;
    if (this.lookIdle > 1.2) {
      const k = 1 - Math.exp(-dt * 3);
      this.lookYaw -= this.lookYaw * k;
      this.lookPitch -= this.lookPitch * k;
    }
    const free = window.__cdFreeCam; // debug: park the camera anywhere
    if (free) {
      cam.position.set(...free.pos);
      cam.lookAt(...free.look);
      cam.fov = free.fov || 60;
      cam.near = 0.1;
      cam.updateProjectionMatrix();
      return;
    }
    const gy = ground ? ground.y : 0;
    const id = this.id;
    if (id === 'cockpit' || id === 'hood') {
      view.root.updateMatrixWorld();
      // Head sways a little against the cornering and braking load.
      this.headX = THREE.MathUtils.damp(this.headX, THREE.MathUtils.clamp(car.ay * 0.004, -0.05, 0.05), 6, dt);
      this.headY = THREE.MathUtils.damp(this.headY, THREE.MathUtils.clamp(-car.ax * 0.002, -0.03, 0.03), 6, dt);
      if (id === 'cockpit') {
        view.cockpit(v1);
        v2.set(this.headX, this.headY, 0).applyQuaternion(view.body.getWorldQuaternion(new THREE.Quaternion()));
        cam.position.copy(v1).add(v2);
      } else {
        v1.set(0, 1.18, 0.4);
        view.body.localToWorld(v1);
        cam.position.copy(v1);
      }
      // Look along the body, with the head turning a touch toward where the car is travelling in a slide.
      const lookYaw = car.speed > 3 ? THREE.MathUtils.clamp(Math.atan2(Math.sin(Math.atan2(car.vx, car.vz) - car.h), Math.cos(Math.atan2(car.vx, car.vz) - car.h)) * 0.35, -0.5, 0.5) : 0;
      // Head turn: free look swings up to about 140 degrees either way and tilts up and down.
      const turn = lookYaw + THREE.MathUtils.clamp(this.lookYaw, -2.4, 2.4);
      v2.set(Math.sin(turn) * 10, (id === 'cockpit' ? 0.75 : -0.9) - this.lookPitch * 8, Math.cos(turn) * 10);
      view.body.localToWorld(v2);
      up.set(0, 1, 0).applyQuaternion(view.body.getWorldQuaternion(new THREE.Quaternion()));
      cam.up.copy(up);
      cam.lookAt(v2);
      cam.near = 0.12; // as far out as the cabin allows: depth precision far away depends on it
      const fov = (id === 'cockpit' ? 74 : 66) + Math.min(car.speed * 3.6, 240) * 0.05;
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
      this.fresh = true;
      return;
    }
    cam.up.set(0, 1, 0);
    cam.near = 0.3;
    // Swing toward the direction of travel so the car is framed side-on in a drift.
    const velYaw = car.speed > 3 ? Math.atan2(car.vx, car.vz) : car.h;
    let diff = Math.atan2(Math.sin(velYaw - car.h), Math.cos(velYaw - car.h));
    const targetYaw = car.h + diff * 0.55;
    let dy = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
    this.yaw += this.fresh ? dy : dy * Math.min(1, dt * 5);
    const far = id === 'far';
    const dist = (far ? 8.8 : 6.0) + Math.min(car.speed, 50) * 0.028;
    const height = (far ? 3.2 : 2.1) + gy;
    // Free look orbits the camera round the car and up or down.
    const oy = this.yaw + this.lookYaw, op = this.lookPitch;
    const flat = dist * Math.cos(op * 0.9);
    v1.set(car.x - Math.sin(oy) * flat, height + Math.sin(op * 0.9) * dist, car.z - Math.cos(oy) * flat);
    const clear = this.avoid(v1, car, world);
    v1.y += (1 - clear) * 1.6;
    if (this.fresh) { this.pos.copy(v1); this.fresh = false; }
    this.pos.lerp(v1, 1 - Math.exp(-dt * 10));
    this.avoid(this.pos, car, world);
    cam.position.copy(this.pos);
    this.look.set(car.x + Math.sin(oy) * 3, gy + 1.0, car.z + Math.cos(oy) * 3);
    cam.lookAt(this.look);
    this.lean = THREE.MathUtils.damp(this.lean, THREE.MathUtils.clamp(-car.r * car.u * 0.0018, -0.035, 0.035), 4, dt);
    cam.rotateZ(this.lean);
    // Fine high-speed buzz above 150 km/h, and the crash shake.
    const fast = Math.max(0, car.speed * 3.6 - 150) / 100;
    if (fast > 0 && playing) {
      cam.position.x += (Math.random() - 0.5) * 0.02 * fast;
      cam.position.y += (Math.random() - 0.5) * 0.02 * fast;
    }
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    const fov = 62 + Math.min(car.speed * 3.6, 220) * 0.07;
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
  }
}
