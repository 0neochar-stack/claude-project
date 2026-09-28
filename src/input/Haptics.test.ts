import { describe, expect, it } from "vitest";
import { Haptics, type HapticSignals } from "./Haptics";

const idle: HapticSignals = {
  throttle: 0, accel: 0, grounded: true, rearSlip: 0, wheelspin: 0, brakeLock: 0, impact: 0, landing: 0,
};

function fakePad(effects = ["dual-rumble"]) {
  const calls: { type: string; params: Record<string, number> }[] = [];
  const pad = {
    vibrationActuator: {
      effects,
      playEffect: (type: string, params: Record<string, number>) => {
        calls.push({ type, params });
        return Promise.resolve("complete");
      },
      reset: () => Promise.resolve("complete"),
    },
  } as unknown as Gamepad;
  return { pad, calls };
}

describe("Haptics", () => {
  it("maps acceleration to the weak motor and drift slip to the strong motor", () => {
    const h = new Haptics();
    h.update(null, { ...idle, throttle: 1, accel: 7 }, 1 / 60, 0);
    expect(h.levels.weak).toBeGreaterThan(0.4);
    expect(h.levels.strong).toBe(0);
    h.update(null, { ...idle, rearSlip: 1 }, 1 / 60, 100);
    expect(h.levels.strong).toBeGreaterThan(0.5);
  });

  it("collisions fire a full burst that decays", () => {
    const h = new Haptics();
    h.update(null, { ...idle, impact: 1 }, 1 / 60, 0);
    expect(h.levels.strong).toBe(1);
    for (let i = 0; i < 30; i++) h.update(null, idle, 1 / 60, i * 16);
    expect(h.levels.strong).toBeLessThan(0.1);
  });

  it("uses trigger-rumble when the pad supports it, rate-limited", () => {
    const { pad, calls } = fakePad(["dual-rumble", "trigger-rumble"]);
    const h = new Haptics();
    h.update(pad, { ...idle, throttle: 1, accel: 7, wheelspin: 1 }, 1 / 60, 1000);
    h.update(pad, { ...idle, throttle: 1, accel: 7, wheelspin: 1 }, 1 / 60, 1010); // within 50 ms
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe("trigger-rumble");
    expect(calls[0]!.params.rightTrigger).toBeGreaterThan(0.5);
  });

  it("falls back to dual-rumble, and stays silent when disabled", () => {
    const { pad, calls } = fakePad();
    const h = new Haptics();
    h.update(pad, { ...idle, impact: 1 }, 1 / 60, 1000);
    expect(calls[0]!.type).toBe("dual-rumble");
    h.enabled = false;
    h.update(pad, { ...idle, impact: 1 }, 1 / 60, 2000); // sends one silencing effect...
    h.update(pad, { ...idle, impact: 1 }, 1 / 60, 3000); // ...then nothing
    expect(calls).toHaveLength(2);
    expect(calls[1]!.params.strongMagnitude).toBe(0);
  });
});
