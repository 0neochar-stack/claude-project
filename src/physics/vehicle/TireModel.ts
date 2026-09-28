import { lerp, smoothstep } from "../../core/math";
import type { VehicleTuning } from "../../config/vehicleTuning";

/**
 * Normalised lateral grip (0..1) for a slip angle: linear up to the peak, then
 * easing down to a plateau. The plateau is what makes a slide controllable.
 */
export function lateralGripCurve(slipAngle: number, peak: number, slide: number, slideRatio: number): number {
  const a = Math.abs(slipAngle);
  if (a <= peak) return a / peak;
  if (a >= slide) return slideRatio;
  return lerp(1, slideRatio, smoothstep(peak, slide, a));
}

/** Friction circle: lateral force still available once `longForce` is in use. */
export function lateralLimit(maxForce: number, longForce: number, combine: number): number {
  const used = longForce * combine;
  return Math.sqrt(Math.max(0, maxForce * maxForce - used * used));
}

/** Arcade engine: traction-limited at launch, power-limited at speed. */
export function engineForce(speed: number, t: VehicleTuning): number {
  return Math.min(t.maxDriveForce, t.enginePower / Math.max(Math.abs(speed), 1));
}

/** Steering lock shrinks with speed so the car stays stable at 250 km/h. */
export function maxSteerAngle(speed: number, t: VehicleTuning): number {
  return lerp(t.maxSteerLow, t.maxSteerHigh, smoothstep(0, t.steerFadeSpeed, Math.abs(speed)));
}
