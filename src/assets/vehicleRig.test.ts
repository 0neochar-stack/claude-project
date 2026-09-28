import { describe, expect, it } from "vitest";
import { loadCarRig } from "../test/sim";

describe("parseVehicleRig on player_car.glb", () => {
  it("finds the four wheel sockets where the Blender script put them", async () => {
    const rig = await loadCarRig();
    const byId = Object.fromEntries(rig.wheels.map((w) => [w.id, w]));
    // Car faces +Z, left is +X (docs/BLENDER_PIPELINE.md).
    expect(byId.FL!.restPosition.toArray().map((v) => +v.toFixed(3))).toEqual([0.84, 0.34, 1.35]);
    expect(byId.RR!.restPosition.toArray().map((v) => +v.toFixed(3))).toEqual([-0.85, 0.34, -1.35]);
    expect(byId.FL!.front && byId.FL!.left).toBe(true);
    expect(byId.RL!.width).toBeCloseTo(0.31);
  });

  it("reads physics extras, sockets, materials and the collider hull", async () => {
    const rig = await loadCarRig();
    expect(rig.extras.mass_kg).toBe(1250);
    expect([...rig.sockets.keys()]).toEqual(expect.arrayContaining(["headlight_L", "headlight_R", "taillight", "underglow"]));
    expect(rig.materials.has("LIGHT_Tail")).toBe(true);
    expect(rig.hullPoints.length % 3).toBe(0);
    expect(rig.hullPoints.length / 3).toBeGreaterThan(20);
    expect(rig.root.getObjectByName("COL_body")!.visible).toBe(false);
  });
});
