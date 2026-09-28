import { describe, expect, it } from "vitest";
import { FixedStepLoop } from "./FixedStepLoop";

describe("FixedStepLoop", () => {
  it("runs whole steps and returns the leftover as alpha", () => {
    const loop = new FixedStepLoop(0.01);
    let steps = 0;
    const alpha = loop.advance(0.035, () => steps++);
    expect(steps).toBe(3);
    expect(alpha).toBeCloseTo(0.5);
  });

  it("carries the remainder into the next frame", () => {
    const loop = new FixedStepLoop(0.01);
    let steps = 0;
    loop.advance(0.006, () => steps++);
    loop.advance(0.006, () => steps++);
    expect(steps).toBe(1);
  });

  it("drops the backlog after a hitch instead of spiralling", () => {
    const loop = new FixedStepLoop(0.01, 4);
    let steps = 0;
    loop.advance(1, () => steps++);
    expect(steps).toBe(4);
    steps = 0;
    loop.advance(0.01, () => steps++);
    expect(steps).toBeLessThanOrEqual(2);
  });
});
