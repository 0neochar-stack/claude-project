/**
 * Headless driving harness: the real GLB rig + ArcadeVehicle on a Rapier ground plane,
 * stepped at the game's fixed rate. Used by the vehicle scenario tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { parseVehicleRig, vehicleSpec } from "../assets/vehicleRig";
import { VEHICLE_TUNING, type VehicleTuning } from "../config/vehicleTuning";
import { neutralDrive, type DriveInput } from "../input/types";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { addGroundTiles } from "../physics/staticGeometry";
import { ArcadeVehicle } from "../physics/vehicle/ArcadeVehicle";

export const STEP = 1 / 120;
const GLB = fileURLToPath(new URL("../../public/models/cars/player_car.glb", import.meta.url));

export async function loadCarRig() {
  const bytes = readFileSync(GLB);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  return parseVehicleRig(gltf.scene);
}

export interface Sim {
  physics: PhysicsWorld;
  car: ArcadeVehicle;
  time: number;
  /** Drive for `seconds`, with a fixed input or one computed per step. */
  run(seconds: number, input: Partial<DriveInput> | ((sim: Sim) => Partial<DriveInput>), onStep?: (sim: Sim) => void): void;
}

export async function createSim(options: { tuning?: VehicleTuning; build?: (physics: PhysicsWorld) => void } = {}): Promise<Sim> {
  const physics = await PhysicsWorld.create();
  addGroundTiles(physics, 1000);
  options.build?.(physics);
  physics.step(STEP); // scene queries only see colliders after a step
  const rig = await loadCarRig();
  const car = new ArcadeVehicle(physics, vehicleSpec(rig), options.tuning ?? VEHICLE_TUNING, { position: new Vector3(0, 0.02, 0), yaw: 0 });
  const sim: Sim = {
    physics,
    car,
    time: 0,
    run(seconds, input, onStep) {
      const steps = Math.round(seconds / STEP);
      for (let i = 0; i < steps; i++) {
        const partial = typeof input === "function" ? input(sim) : input;
        car.step(STEP, { ...neutralDrive(), ...partial });
        physics.step(STEP);
        car.capture();
        // Long runs: slide the car back toward the origin instead of driving off the world.
        const p = car.body.translation();
        if (Math.abs(p.x) > 800 || Math.abs(p.z) > 800) {
          car.body.setTranslation({ x: p.x % 400, y: p.y, z: p.z % 400 }, true);
          car.capture();
          car.capture();
        }
        sim.time += STEP;
        onStep?.(sim);
      }
    },
  };
  return sim;
}
