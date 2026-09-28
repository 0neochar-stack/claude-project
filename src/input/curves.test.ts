import { describe, expect, it } from "vitest";
import { applyDeadzone, applyRadialDeadzone, applyResponseCurve } from "./curves";

describe("stick curves", () => {
  it("zeroes the deadzone and rescales the rest without a jump", () => {
    expect(applyDeadzone(0.09, 0.1)).toBe(0);
    expect(applyDeadzone(0.1001, 0.1)).toBeCloseTo(0, 3);
    expect(applyDeadzone(0.55, 0.1)).toBeCloseTo(0.5);
    expect(applyDeadzone(-1, 0.1)).toBe(-1);
  });

  it("reaches full lock before the physical stop (outer deadzone)", () => {
    expect(applyDeadzone(0.98, 0.1, 0.02)).toBe(1);
  });

  it("response curve keeps sign and softens the centre", () => {
    expect(applyResponseCurve(-1, 1.5)).toBe(-1);
    expect(applyResponseCurve(0.5, 1.5)).toBeCloseTo(0.3536, 3);
    expect(applyResponseCurve(-0.5, 1.5)).toBeCloseTo(-0.3536, 3);
  });

  it("radial deadzone preserves direction", () => {
    const v = applyRadialDeadzone(0.6, 0.6, 0.15);
    expect(v.x).toBeCloseTo(v.y);
    expect(applyRadialDeadzone(0.1, 0.05, 0.15)).toEqual({ x: 0, y: 0 });
  });
});
