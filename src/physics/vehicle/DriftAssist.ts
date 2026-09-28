import { clamp01, lerp } from "../../core/math";
import type { VehicleTuning } from "../../config/vehicleTuning";

/*
 * Sign conventions shared with ArcadeVehicle:
 *   slipAngle  > 0  the car is travelling to the LEFT of where its nose points
 *   steerLeft  > 0  the player steers left (-1..1)
 *   yaw        > 0  the nose rotates left (about +Y)
 */

/** Hysteresis state machine: is the car drifting, and for how long. */
export class DriftDetector {
  drifting = false;
  /** Seconds in the current drift (0 when not drifting). */
  time = 0;
  private exitTimer = 0;

  /** `intent`: the player asked for a drift (recent handbrake or a power-over). */
  update(speed: number, slipAngle: number, grounded: boolean, intent: boolean, dt: number, t: VehicleTuning): void {
    const angle = Math.abs(slipAngle);
    if (!this.drifting) {
      if (intent && grounded && speed > t.driftEnterSpeed && angle > t.driftEnterAngle) {
        this.drifting = true;
        this.time = 0;
        this.exitTimer = 0;
      }
      return;
    }
    this.time += dt;
    const settling = speed < t.driftExitSpeed || (grounded && angle < t.driftExitAngle);
    this.exitTimer = settling ? this.exitTimer + dt : 0;
    if (this.exitTimer > t.driftExitHold) {
      this.drifting = false;
      this.time = 0;
    }
  }

  reset(): void {
    this.drifting = false;
    this.time = 0;
    this.exitTimer = 0;
  }
}

/** 0..1: how much the player is steering toward the direction of travel (counter-steer). */
export function counterSteerAmount(steerLeft: number, slipAngle: number): number {
  if (Math.abs(slipAngle) < 1e-3) return 0;
  return clamp01(steerLeft * Math.sign(slipAngle));
}

/** 0..1: how much the player is steering away from travel, deeper into the slide. */
export function intoSlideAmount(steerLeft: number, slipAngle: number): number {
  return counterSteerAmount(-steerLeft, slipAngle);
}

/** Fraction of tyre scrub given back as forward speed while drifting. */
export function speedRetention(t: VehicleTuning, counterSteer: number, throttle: number): number {
  return clamp01((t.retentionBase + t.retentionCounterSteer * counterSteer) * lerp(t.retentionNoThrottle, 1, throttle));
}

/** Drift angle (magnitude) the assist aims for, from the player's throttle and steering. */
export function targetDriftAngle(t: VehicleTuning, steerLeft: number, slipAngle: number, throttle: number): number {
  const counter = counterSteerAmount(steerLeft, slipAngle);
  const into = intoSlideAmount(steerLeft, slipAngle);
  const base = lerp(t.driftAngleOffThrottle, t.driftAngleNeutral, throttle);
  return lerp(lerp(base, t.driftAngleCounter, counter), t.driftAngleInto, into);
}

/**
 * Yaw acceleration (rad/s^2, + = nose left) the assist adds while drifting:
 * pulls the slide toward the target angle, hard-limits spin-outs, and damps how
 * fast the angle changes. `slipRate` is d(slipAngle)/dt; the nose rotating left
 * relative to travel makes it negative, so damping is simply `+k * slipRate`.
 */
export function driftYawAssist(
  t: VehicleTuning, slipAngle: number, steerLeft: number, throttle: number, slipRate: number,
): number {
  const target = Math.sign(slipAngle) * targetDriftAngle(t, steerLeft, slipAngle, throttle);
  const hold = t.angleHold * (slipAngle - target);
  const limit = Math.max(-t.driftMaxAngle, Math.min(t.driftMaxAngle, slipAngle));
  const guard = t.spinGuard * (slipAngle - limit);
  return hold + guard + t.driftAngleDamping * slipRate;
}

/**
 * Outside drift mode: yaw acceleration that nudges an unintended slide back in
 * line with travel (a light stability control), beyond a small deadband.
 */
export function stabilityYawAssist(t: VehicleTuning, slipAngle: number, slipRate: number): number {
  const excess = Math.sign(slipAngle) * Math.max(0, Math.abs(slipAngle) - t.stabilityDeadband);
  return t.stabilityGain * excess + t.driftAngleDamping * slipRate;
}
