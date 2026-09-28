import {
  Color, Mesh, Object3D, PointLight, Quaternion, SpotLight, Vector3, type MeshStandardMaterial, type Scene,
} from "three/webgpu";
import { vehicleSpec, type VehicleRig } from "../assets/vehicleRig";
import { VEHICLE_TUNING } from "../config/vehicleTuning";
import { damp } from "../core/math";
import type { DriveInput } from "../input/types";
import { ArcadeVehicle, type Spawn } from "../physics/vehicle/ArcadeVehicle";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

const X_AXIS = new Vector3(1, 0, 0);
const BRAKE_GLOW = 24;

/**
 * The player's car: the GLB rig driven by an ArcadeVehicle. Physics runs at the
 * fixed step; `render()` interpolates the body and animates wheels and lights.
 */
export class PlayerCar {
  readonly vehicle: ArcadeVehicle;
  /** Interpolated render pose of the car root. */
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();

  private readonly tailLight: MeshStandardMaterial | undefined;
  private readonly tailIdle: number;
  private readonly brakeGlow: PointLight;
  private readonly spin = new Quaternion();

  constructor(
    scene: Scene,
    physics: PhysicsWorld,
    readonly rig: VehicleRig,
    spawn: Spawn,
  ) {
    this.vehicle = new ArcadeVehicle(physics, vehicleSpec(rig), VEHICLE_TUNING, spawn);
    let top: Object3D = rig.root;
    while (top.parent) top = top.parent;
    scene.add(top);
    rig.root.traverse((o) => {
      if ((o as Mesh).isMesh && !o.name.startsWith("COL_")) o.castShadow = true;
    });

    this.tailLight = rig.materials.get("LIGHT_Tail") as MeshStandardMaterial | undefined;
    this.tailIdle = this.tailLight?.emissiveIntensity ?? 7;

    // Real lights hung on the naming-contract sockets.
    for (const side of ["L", "R"]) {
      const socket = rig.sockets.get(`headlight_${side}`);
      if (!socket) continue;
      const beam = new SpotLight(0xdff4ff, 180, 70, 0.42, 0.55, 1.4);
      const aim = new Object3D();
      aim.position.set(0, -0.6, 20);
      socket.add(beam, aim);
      beam.target = aim;
    }
    const underglow = new PointLight(new Color(0x00e5ff), 6, 4.5, 1.8);
    rig.sockets.get("underglow")?.add(underglow);
    this.brakeGlow = new PointLight(new Color(0xff1744), 0.5, 5, 2);
    this.brakeGlow.position.set(0, 0, 0.6);
    rig.sockets.get("taillight")?.add(this.brakeGlow);
  }

  fixedUpdate(dt: number, input: DriveInput): void {
    this.vehicle.step(dt, input);
  }

  /** After PhysicsWorld.step(). */
  afterPhysics(): void {
    this.vehicle.capture();
  }

  reset(spawn: Spawn): void {
    this.vehicle.reset(spawn);
  }

  render(alpha: number, dt: number): void {
    const { vehicle, rig } = this;
    vehicle.interpolate(alpha, this.position, this.quaternion);
    rig.root.position.copy(this.position);
    rig.root.quaternion.copy(this.quaternion);
    const v = vehicle.body.linvel();
    this.velocity.set(v.x, v.y, v.z);

    const bump = vehicle.tuning.bumpTravel;
    rig.wheels.forEach((wheel, i) => {
      const state = vehicle.wheels[i]!;
      wheel.pivot.position.set(wheel.restPosition.x, wheel.restPosition.y + bump - state.length, wheel.restPosition.z);
      wheel.pivot.rotation.set(0, wheel.front ? vehicle.steerAngle : 0, 0);
      // Spin about the pivot's X axis; premultiply keeps the right-side 180° flip.
      wheel.spin.quaternion.copy(wheel.spinRest).premultiply(this.spin.setFromAxisAngle(X_AXIS, state.spinAngle));
    });

    const braking = vehicle.telemetry.braking;
    if (this.tailLight) {
      this.tailLight.emissiveIntensity = damp(this.tailLight.emissiveIntensity, braking ? BRAKE_GLOW : this.tailIdle, 18, dt);
    }
    this.brakeGlow.intensity = damp(this.brakeGlow.intensity, braking ? 8 : 0.5, 18, dt);
  }
}
