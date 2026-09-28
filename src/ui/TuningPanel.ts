import GUI from "lil-gui";
import type { VehicleTuning } from "../config/vehicleTuning";
import { DEG } from "../core/math";

type NumericKey = { [K in keyof VehicleTuning]: VehicleTuning[K] extends number ? K : never }[keyof VehicleTuning];

/**
 * Live driving-feel panel (open the game with `?tune`). Edits the shared tuning
 * object in place; ArcadeVehicle reads it every physics step. Spring rate and
 * inertia are derived at spawn, so they are not listed.
 */
export function createTuningPanel(t: VehicleTuning): GUI {
  const gui = new GUI({ title: "Vehicle tuning" });
  const num = (folder: GUI, key: NumericKey, min: number, max: number, step?: number) => folder.add(t, key, min, max, step);
  // Angles are stored in radians; show degrees.
  const deg = (folder: GUI, key: NumericKey, min: number, max: number) => {
    const proxy = { get [key]() { return (t[key] as number) / DEG; }, set [key](v: number) { (t[key] as number) = v * DEG; } };
    return folder.add(proxy, key, min, max, 0.5).name(`${key} (°)`);
  };

  const engine = gui.addFolder("Engine / brakes");
  num(engine, "enginePower", 100_000, 800_000, 10_000);
  num(engine, "maxDriveForce", 3_000, 20_000, 100);
  num(engine, "brakeForce", 5_000, 30_000, 500);
  num(engine, "handbrakeForce", 0, 15_000, 250);
  num(engine, "dragCoefficient", 0.2, 2, 0.05);
  num(engine, "downforce", 0, 4, 0.1);

  const tyres = gui.addFolder("Tyres");
  num(tyres, "gripFront", 0.5, 2.5, 0.05);
  num(tyres, "gripRear", 0.5, 2.5, 0.05);
  num(tyres, "gripLongitudinal", 0.5, 2.5, 0.05);
  num(tyres, "slideRatio", 0.3, 1, 0.01);
  num(tyres, "combinedSlip", 0, 1, 0.05);
  num(tyres, "tractionControl", 0.3, 1, 0.05);

  const steering = gui.addFolder("Steering");
  deg(steering, "maxSteerLow", 10, 50);
  deg(steering, "maxSteerHigh", 2, 25);
  num(steering, "steerRate", 1, 10, 0.1);

  const drift = gui.addFolder("Drift");
  num(drift, "handbrakeRearGrip", 0.1, 1, 0.01);
  num(drift, "driftRearGrip", 0.3, 1, 0.01);
  num(drift, "driftRearGripThrottle", 0.3, 1, 0.01);
  num(drift, "handbrakeKick", 0, 2, 0.05);
  num(drift, "counterSteerAssist", 0, 1.5, 0.05);
  num(drift, "retentionBase", 0, 1, 0.05);
  num(drift, "retentionCounterSteer", 0, 1, 0.05);
  deg(drift, "driftAngleNeutral", 5, 60);
  deg(drift, "driftAngleInto", 10, 80);
  deg(drift, "driftMaxAngle", 30, 90);
  num(drift, "angleHold", 0, 15, 0.5);
  num(drift, "spinGuard", 0, 60, 1);
  num(drift, "driftAngleDamping", 0, 8, 0.25);
  num(drift, "stabilityGain", 0, 12, 0.5);

  gui.add({ copy: () => void navigator.clipboard?.writeText(JSON.stringify(t, null, 2)) }, "copy").name("Copy values as JSON");
  gui.close();
  return gui;
}
