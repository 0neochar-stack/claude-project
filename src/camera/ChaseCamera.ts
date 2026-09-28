import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { clamp, clamp01, damp, dampAngle, smoothstep, wrapAngle } from "../core/math";

export type CameraMode = "chase" | "far" | "hood";
const MODE_ORDER: readonly CameraMode[] = ["chase", "far", "hood"];

export interface CameraTarget {
  /** Interpolated car root (ground level, between the axles). */
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  speed: number;
  forwardSpeed: number;
  /** Forward acceleration, m/s² (smoothed). */
  accel: number;
  throttle: number;
  drifting: boolean;
}

interface ChaseRig {
  distance: number;
  height: number;
  lookHeight: number;
  lookAhead: number;
  /** Extra follow distance per m/s of speed. */
  speedDistance: number;
  /** Extra follow distance per m/s² of acceleration (the "speed lag"). */
  accelLag: number;
}

const RIGS: Record<Exclude<CameraMode, "hood">, ChaseRig> = {
  chase: { distance: 5.2, height: 1.55, lookHeight: 0.85, lookAhead: 2.5, speedDistance: 0.028, accelLag: 0.1 },
  far: { distance: 8.2, height: 2.6, lookHeight: 1.0, lookAhead: 3.5, speedDistance: 0.034, accelLag: 0.13 },
};

const FOV = {
  base: 58,
  speed: 16, // added at top speed
  topSpeed: 70, // m/s where the speed FOV is fully in
  kick: 9, // degrees at hard acceleration
  kickAccel: 8, // m/s² for a full kick
  hoodBase: 72,
};

/**
 * Third-person follow camera. It trails the car's heading with a rotational lag
 * (swinging toward the direction of travel in a drift), stretches with speed and
 * pulls back under acceleration, and kicks the FOV wider when you floor it.
 */
export class ChaseCamera {
  readonly camera = new PerspectiveCamera(FOV.base, 16 / 9, 0.25, 12_000);
  mode: CameraMode = "chase";

  private yaw = 0;
  private distance = RIGS.chase.distance;
  private height = RIGS.chase.height;
  private fovKick = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private shake = 0;
  private time = 0;
  private snapNext = true;
  private readonly follow = new Vector3();
  private readonly fwd = new Vector3();
  private readonly lookAt = new Vector3();

  /** Next view; also re-centres the camera behind the car. */
  cycleMode(): CameraMode {
    this.mode = MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length]!;
    this.reset();
    return this.mode;
  }

  /** Snap behind the car on the next update and drop any free-look offset. */
  reset(): void {
    this.snapNext = true;
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, clamp01(amount));
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, target: CameraTarget, look: { x: number; y: number }): void {
    this.time += dt;
    this.fwd.set(0, 0, 1).applyQuaternion(target.quaternion);
    const headingYaw = Math.atan2(this.fwd.x, this.fwd.z);

    // FOV: wider with speed, plus a kick while accelerating hard.
    const kickTarget = clamp01(target.accel / FOV.kickAccel) * clamp01(target.throttle * 1.5) * FOV.kick;
    this.fovKick = damp(this.fovKick, kickTarget, kickTarget > this.fovKick ? 6 : 2.2, dt);
    const speedFov = FOV.speed * smoothstep(0, FOV.topSpeed, target.speed);

    this.lookYaw = damp(this.lookYaw, look.x * 2.4, 8, dt);
    this.lookPitch = damp(this.lookPitch, -look.y * 0.35, 8, dt);

    if (this.mode === "hood") {
      this.updateHood(target, speedFov);
    } else {
      this.updateChase(dt, target, RIGS[this.mode], headingYaw, speedFov);
    }

    // Impact shake: a few summed sines, decaying fast.
    this.shake *= Math.exp(-6 * dt);
    if (this.shake > 0.001) {
      const a = this.shake * 0.12;
      const t = this.time * 38;
      this.camera.position.x += Math.sin(t * 1.1) * a;
      this.camera.position.y += Math.sin(t * 1.7 + 1.3) * a * 0.7;
      this.camera.position.z += Math.sin(t * 0.9 + 2.1) * a;
    }
    this.camera.updateProjectionMatrix();
    this.snapNext = false;
  }

  private updateChase(dt: number, target: CameraTarget, rig: ChaseRig, headingYaw: number, speedFov: number): void {
    // Follow the direction of travel a little (a lot while drifting), never in reverse.
    const velocityYaw = Math.atan2(target.velocity.x, target.velocity.z);
    const followTravel = target.forwardSpeed > 1 ? smoothstep(3, 15, target.speed) * (target.drifting ? 0.55 : 0.3) : 0;
    const desiredYaw = headingYaw + wrapAngle(velocityYaw - headingYaw) * followTravel;
    const desiredDistance = rig.distance + target.speed * rig.speedDistance + clamp(target.accel, -8, 12) * rig.accelLag;
    const desiredHeight = rig.height + target.speed * 0.006;

    if (this.snapNext) {
      this.yaw = desiredYaw;
      this.distance = desiredDistance;
      this.height = desiredHeight;
      this.follow.copy(target.position);
    } else {
      this.yaw = dampAngle(this.yaw, desiredYaw, 5.5, dt); // rotational lag through corners
      this.distance = damp(this.distance, desiredDistance, 3, dt); // stretches with speed / acceleration
      this.height = damp(this.height, desiredHeight, 3, dt);
      // Heavier vertical smoothing hides suspension bounce and ramp landings.
      this.follow.x = damp(this.follow.x, target.position.x, 25, dt);
      this.follow.z = damp(this.follow.z, target.position.z, 25, dt);
      this.follow.y = damp(this.follow.y, target.position.y, 7, dt);
    }

    const yaw = this.yaw + this.lookYaw;
    const pitchLift = Math.sin(this.lookPitch) * this.distance;
    const cam = this.camera;
    cam.position.set(
      this.follow.x - Math.sin(yaw) * this.distance,
      Math.max(this.follow.y + this.height + pitchLift, target.position.y + 0.35),
      this.follow.z - Math.cos(yaw) * this.distance,
    );
    const ahead = rig.lookAhead * smoothstep(0, 30, target.speed);
    this.lookAt.set(
      this.follow.x + Math.sin(this.yaw) * ahead,
      this.follow.y + rig.lookHeight,
      this.follow.z + Math.cos(this.yaw) * ahead,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(this.lookAt);
    cam.fov = FOV.base + speedFov + this.fovKick;
  }

  private updateHood(target: CameraTarget, speedFov: number): void {
    const cam = this.camera;
    cam.position.set(0, 1.02, 0.2).applyQuaternion(target.quaternion).add(target.position);
    this.lookAt.set(Math.sin(this.lookYaw) * 20, 0.95 + this.lookPitch * 20, Math.cos(this.lookYaw) * 20)
      .applyQuaternion(target.quaternion).add(target.position);
    cam.up.set(0, 1, 0).applyQuaternion(target.quaternion);
    cam.lookAt(this.lookAt);
    cam.fov = FOV.hoodBase + speedFov * 0.8 + this.fovKick * 0.6;
  }
}
