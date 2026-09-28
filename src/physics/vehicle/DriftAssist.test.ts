import { describe, expect, it } from "vitest";
import { VEHICLE_TUNING as T } from "../../config/vehicleTuning";
import { DEG } from "../../core/math";
import {
  counterSteerAmount, DriftDetector, driftYawAssist, speedRetention, stabilityYawAssist, targetDriftAngle,
} from "./DriftAssist";
import { lateralGripCurve, lateralLimit } from "./TireModel";

describe("tyre model", () => {
  it("grip rises to the peak slip angle, then falls to the slide plateau", () => {
    const g = (deg: number) => lateralGripCurve(deg * DEG, T.peakSlip, T.slideSlip, T.slideRatio);
    expect(g(0)).toBe(0);
    expect(g(T.peakSlip / DEG)).toBeCloseTo(1);
    expect(g(40)).toBeCloseTo(T.slideRatio);
    expect(g(-40)).toBeCloseTo(T.slideRatio); // symmetric
    expect(g(12)).toBeLessThan(1);
    expect(g(12)).toBeGreaterThan(T.slideRatio);
  });

  it("friction circle: longitudinal force eats lateral capacity", () => {
    expect(lateralLimit(1000, 0, 1)).toBe(1000);
    expect(lateralLimit(1000, 600, 1)).toBeCloseTo(800);
    expect(lateralLimit(1000, 2000, 1)).toBe(0);
  });
});

describe("drift assist", () => {
  // Convention: slip > 0 means the car travels to the left of its nose.
  it("counter-steer means steering toward the direction of travel", () => {
    expect(counterSteerAmount(1, 20 * DEG)).toBe(1); // travelling left, steering left
    expect(counterSteerAmount(-1, 20 * DEG)).toBe(0); // steering away = into the slide
    expect(counterSteerAmount(-0.5, -20 * DEG)).toBe(0.5);
  });

  it("counter-steering keeps more speed than not, and throttle keeps more than lifting", () => {
    expect(speedRetention(T, 1, 1)).toBeGreaterThan(speedRetention(T, 0, 1));
    expect(speedRetention(T, 1, 1)).toBeGreaterThan(speedRetention(T, 1, 0));
    expect(speedRetention(T, 1, 1)).toBeLessThanOrEqual(1);
  });

  it("target angle: throttle holds it, steering into the turn deepens it, full counter-steer exits", () => {
    const slip = -30 * DEG; // sliding with travel to the right of the nose
    expect(targetDriftAngle(T, 0, slip, 1)).toBeCloseTo(T.driftAngleNeutral);
    expect(targetDriftAngle(T, 1, slip, 1)).toBeCloseTo(T.driftAngleInto); // steering left = away from travel
    expect(targetDriftAngle(T, -1, slip, 0.3)).toBeLessThan(T.driftExitAngle);
    expect(targetDriftAngle(T, 0, slip, 0)).toBeLessThan(T.driftExitAngle);
  });

  it("yaw assist turns the nose back toward travel past the limit", () => {
    // Travel far to the left of the nose: rotating the nose left (+yaw) reduces the angle.
    expect(driftYawAssist(T, 80 * DEG, 0, 1, 0)).toBeGreaterThan(0);
    expect(driftYawAssist(T, -80 * DEG, 0, 1, 0)).toBeLessThan(0);
    // Damping opposes the angle changing.
    expect(driftYawAssist(T, 30 * DEG, 0, 1, -2)).toBeLessThan(driftYawAssist(T, 30 * DEG, 0, 1, 0));
    expect(stabilityYawAssist(T, 2 * DEG, 0)).toBe(0); // inside the deadband
    expect(stabilityYawAssist(T, 12 * DEG, 0)).toBeGreaterThan(0);
  });

  it("only enters a drift with intent, and exits after settling", () => {
    const d = new DriftDetector();
    d.update(20, 25 * DEG, true, false, 1 / 120, T);
    expect(d.drifting).toBe(false); // an unintended slide is not a drift
    d.update(20, 25 * DEG, true, true, 1 / 120, T);
    expect(d.drifting).toBe(true);
    for (let i = 0; i < 20; i++) d.update(20, 5 * DEG, true, false, 1 / 120, T);
    expect(d.drifting).toBe(true); // hysteresis hold
    for (let i = 0; i < 40; i++) d.update(20, 5 * DEG, true, false, 1 / 120, T);
    expect(d.drifting).toBe(false);
  });
});
