import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { VEHICLE_TUNING } from "../../config/vehicleTuning";
import { DEG } from "../../core/math";
import { createSim, loadCarRig, type Sim } from "../../test/sim";
import { Groups } from "../groups";

/**
 * Headless driving scenarios: the real player-car GLB on Rapier at the game's
 * 120 Hz step. These pin down the feel targets from docs/ROADMAP.md (Phase 1).
 */

const KMH = 1 / 3.6;
const log = (...args: unknown[]) => {
  if (process.env.SIM_LOG) console.log(...args);
};

/** Accelerate in a straight line until `speed` (m/s), then hold it. */
function cruiseTo(sim: Sim, speed: number, seconds = 12): void {
  sim.run(seconds, (s) => ({ throttle: s.car.telemetry.speed < speed ? 1 : 0.25 }));
}

/** Handbrake + steer-left entry at the current speed. */
function enterDrift(sim: Sim): void {
  sim.run(0.35, { steer: -0.8, handbrake: true, throttle: 0.4 });
}

/** Steer toward the direction of travel (counter-steer) by `amount`. */
const counterSteer = (amount: number) => (s: Sim) => ({ throttle: 0.85, steer: -Math.sign(s.car.telemetry.slipAngle) * amount });

describe("ArcadeVehicle on the player car GLB", () => {
  it("settles level on its modelled ride height and stays put", async () => {
    const sim = await createSim();
    sim.run(2, {});
    const { car } = sim;
    const loads = car.wheels.map((w) => w.load);
    const mean = loads.reduce((a, b) => a + b) / loads.length;
    expect(car.telemetry.groundedWheels).toBe(4);
    expect(car.telemetry.speed).toBeLessThan(0.05);
    expect(Math.abs(car.position.y)).toBeLessThan(0.01); // root on the ground, hubs at their sockets
    for (const load of loads) expect(Math.abs(load - mean) / mean).toBeLessThan(0.05);
    expect(mean).toBeCloseTo((1250 * 9.81) / 4, -2);
  });

  it("launches 0-100 km/h in under 4.5 s and tracks straight", async () => {
    const sim = await createSim();
    sim.run(0.5, {});
    const start = sim.time;
    let t100 = Infinity;
    sim.run(8, { throttle: 1 }, (s) => {
      if (t100 === Infinity && s.car.telemetry.speed > 100 * KMH) t100 = s.time - start;
    });
    const travelled = sim.car.position.z;
    log("0-100", t100.toFixed(2), "s; lateral drift", sim.car.position.x.toFixed(2), "m over", travelled.toFixed(0), "m");
    expect(t100).toBeLessThan(4.5);
    expect(Math.abs(sim.car.position.x) / travelled).toBeLessThan(0.03);
  });

  it("tops out between 230 and 280 km/h", async () => {
    const sim = await createSim();
    sim.run(45, { throttle: 1 });
    const v = sim.car.body.linvel();
    const top = Math.hypot(v.x, v.z) / KMH;
    log("top speed", top.toFixed(0), "km/h");
    expect(top).toBeGreaterThan(230);
    expect(top).toBeLessThan(280);
  });

  it("brakes hard from 100 km/h, then reverses while brake is held", async () => {
    const sim = await createSim();
    cruiseTo(sim, 100 * KMH);
    const start = sim.time;
    let stopped = Infinity;
    sim.run(6, { brake: 1 }, (s) => {
      if (stopped === Infinity && s.car.telemetry.forwardSpeed < 0.5) stopped = s.time - start;
    });
    const decel = (100 * KMH) / stopped;
    log("100-0 in", stopped.toFixed(2), "s =", decel.toFixed(1), "m/s²; reverse speed", sim.car.telemetry.forwardSpeed.toFixed(1));
    expect(decel).toBeGreaterThan(9);
    expect(sim.car.telemetry.gear).toBe(-1);
    expect(sim.car.telemetry.forwardSpeed).toBeLessThan(-5);
    expect(sim.car.telemetry.forwardSpeed).toBeGreaterThan(-VEHICLE_TUNING.reverseTopSpeed - 1);
  });

  it("corners with grip at moderate steering (no accidental drift)", async () => {
    const sim = await createSim();
    cruiseTo(sim, 60 * KMH);
    let maxSlip = 0;
    let minUp = 1;
    sim.run(4, (s) => ({ steer: -0.5, throttle: s.car.telemetry.speed < 60 * KMH ? 0.6 : 0.2 }), (s) => {
      maxSlip = Math.max(maxSlip, Math.abs(s.car.telemetry.slipAngle));
      minUp = Math.min(minUp, s.car.telemetry.uprightness);
    });
    log("half-lock at 60 km/h: max slip", (maxSlip / DEG).toFixed(1), "°, min upright", minUp.toFixed(3));
    expect(maxSlip).toBeLessThan(10 * DEG);
    expect(sim.car.telemetry.drifting).toBe(false);
    expect(minUp).toBeGreaterThan(0.95);
  });

  it("handbrake + steer breaks traction into a drift that never spins out", async () => {
    const sim = await createSim();
    cruiseTo(sim, 90 * KMH);
    const start = sim.time;
    let driftAt = Infinity;
    let maxAngle = 0;
    enterDrift(sim);
    sim.run(3, counterSteer(0.5), (s) => {
      if (driftAt === Infinity && s.car.telemetry.drifting) driftAt = s.time - start;
      maxAngle = Math.max(maxAngle, Math.abs(s.car.telemetry.slipAngle));
    });
    log("drift started after", driftAt.toFixed(2), "s; max angle", (maxAngle / DEG).toFixed(0), "°");
    expect(driftAt).toBeLessThan(0.6);
    expect(maxAngle).toBeGreaterThan(20 * DEG);
    expect(maxAngle).toBeLessThan(72 * DEG);
    expect(sim.car.telemetry.uprightness).toBeGreaterThan(0.95);
  });

  it("counter-steering through a slide keeps speed (drift-angle assist + retention)", async () => {
    const run = async (tuning = VEHICLE_TUNING, steer = counterSteer(0.6)) => {
      const sim = await createSim({ tuning });
      cruiseTo(sim, 90 * KMH);
      const entry = sim.car.telemetry.speed;
      enterDrift(sim);
      sim.run(2.5, steer);
      return { sim, kept: sim.car.telemetry.speed / entry };
    };
    const assisted = await run();
    const noRetention = await run({ ...VEHICLE_TUNING, retentionBase: 0, retentionCounterSteer: 0 });
    const intoTurn = await run(VEHICLE_TUNING, () => ({ throttle: 0.85, steer: -1 }));
    log("speed kept: counter-steer", assisted.kept.toFixed(2), "| no retention", noRetention.kept.toFixed(2), "| steering into turn", intoTurn.kept.toFixed(2));
    expect(assisted.kept).toBeGreaterThan(0.85);
    expect(assisted.kept - noRetention.kept).toBeGreaterThan(0.05);
    expect(assisted.kept).toBeGreaterThan(intoTurn.kept);
  });

  it("recovers to a straight line when the player straightens out", async () => {
    const sim = await createSim();
    cruiseTo(sim, 90 * KMH);
    enterDrift(sim);
    sim.run(1.5, counterSteer(0.5));
    expect(sim.car.telemetry.drifting).toBe(true);
    // Straighten out: counter-steer fully and ease off the throttle.
    const start = sim.time;
    let endedAt = Infinity;
    sim.run(3, (s) => ({ ...counterSteer(1)(s), throttle: 0.3 }), (s) => {
      if (endedAt === Infinity && !s.car.telemetry.drifting) endedAt = s.time - start;
    });
    sim.run(1, { throttle: 0.5 });
    log("drift exit after", endedAt.toFixed(2), "s; final slip", (sim.car.telemetry.slipAngle / DEG).toFixed(1), "°");
    expect(endedAt).toBeLessThan(2.5);
    expect(Math.abs(sim.car.telemetry.slipAngle)).toBeLessThan(5 * DEG);
  });

  it("jumps a ramp and lands wheels-down", async () => {
    const sim = await createSim({
      build: ({ R, world }) => {
        // 1.2 m kicker, 8 m long, 30 m ahead of the spawn.
        const pts = new Float32Array([-3, 0, 30, 3, 0, 30, -3, 0, 38, 3, 0, 38, -3, 1.2, 38, 3, 1.2, 38]);
        world.createCollider(R.ColliderDesc.convexHull(pts)!.setCollisionGroups(Groups.ground));
      },
    });
    let airTime = 0;
    let landing = 0;
    let minUp = 1;
    sim.run(6, (s) => ({ throttle: s.car.telemetry.speed < 70 * KMH ? 1 : 0.4 }), (s) => {
      airTime = Math.max(airTime, s.car.telemetry.airTime);
      landing = Math.max(landing, s.car.consumeEvents().landing);
      minUp = Math.min(minUp, s.car.telemetry.uprightness);
    });
    log("ramp: air time", airTime.toFixed(2), "s; landing", landing.toFixed(2), "; min upright", minUp.toFixed(2));
    expect(airTime).toBeGreaterThan(0.4);
    expect(landing).toBeGreaterThan(0);
    expect(minUp).toBeGreaterThan(0.7);
    expect(sim.car.telemetry.groundedWheels).toBe(4);
  });

  it("hits a wall hard enough to register an impact, without tunnelling", async () => {
    const sim = await createSim({
      build: ({ R, world }) => {
        world.createCollider(R.ColliderDesc.cuboid(100, 1, 0.3).setTranslation(0, 1, 60).setCollisionGroups(Groups.obstacle));
      },
    });
    const { hullPoints } = await loadCarRig();
    const point = new Vector3();
    let impact = 0;
    let deepest = -Infinity;
    sim.run(8, { throttle: 1 }, (s) => {
      impact = Math.max(impact, s.car.consumeEvents().impact);
      // Front-most hull point in world space, whatever the heading after impact.
      for (let i = 0; i < hullPoints.length; i += 3) {
        point.fromArray(hullPoints, i).applyQuaternion(s.car.quaternion).add(s.car.position);
        deepest = Math.max(deepest, point.z);
      }
    });
    // Wall face at z = 59.7; allow the solver's few centimetres of contact slop.
    log("wall impact", impact.toFixed(2), "; hull reached z", deepest.toFixed(3));
    expect(impact).toBeGreaterThan(0.6);
    expect(deepest).toBeLessThan(59.75);
  });

  it("knocks loose cones out of the way", async () => {
    let cone: import("@dimforge/rapier3d-compat").RigidBody | undefined;
    const sim = await createSim({
      build: ({ R, world }) => {
        cone = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.6, 0.36, 25));
        world.createCollider(R.ColliderDesc.cone(0.36, 0.2).setMass(3).setCollisionGroups(Groups.prop), cone);
      },
    });
    sim.run(5, (s) => ({ throttle: s.car.telemetry.speed < 30 * KMH ? 1 : 0.2 }));
    const p = cone!.translation();
    log("cone moved to", [p.x, p.y, p.z].map((v) => v.toFixed(1)));
    expect(Math.hypot(p.x - 0.6, p.z - 25)).toBeGreaterThan(1);
  });

  it("tyre colliders sit on the WHEEL sockets and are what strike a low kerb", async () => {
    // A 5 cm kerb under the left-hand tyres only: below the body's 12 cm ground
    // clearance, so the only thing that can touch it is a tyre collider.
    let kerb: import("@dimforge/rapier3d-compat").Collider | undefined;
    const sim = await createSim({
      build: ({ R, world }) => {
        kerb = world.createCollider(R.ColliderDesc.cuboid(0.1, 0.025, 0.4).setTranslation(0.84, 0.025, 20).setCollisionGroups(Groups.obstacle));
      },
    });
    sim.run(0.5, {});
    for (const w of sim.car.wheels) {
      const c = w.collider.translation();
      const expected = w.rest.clone().applyQuaternion(sim.car.quaternion).add(sim.car.position);
      expect(new Vector3(c.x, c.y, c.z).distanceTo(expected)).toBeLessThan(1e-4);
    }
    const hits = new Set<string>();
    let bodyHit = false;
    sim.run(4, (s) => ({ throttle: s.car.telemetry.speed < 20 * KMH ? 1 : 0.2 }), (s) => {
      for (const w of s.car.wheels) {
        s.physics.world.contactPair(w.collider, kerb!, (m) => { if (m.numContacts() > 0) hits.add(w.id); });
      }
      s.physics.world.contactPair(s.car.chassis, kerb!, (m) => { if (m.numContacts() > 0) bodyHit = true; });
    });
    log("kerb struck by tyres:", [...hits].join(","), "| body:", bodyHit);
    expect(hits.has("FL")).toBe(true);
    expect(hits.has("FR")).toBe(false);
    expect(bodyHit).toBe(false);
  });
});
