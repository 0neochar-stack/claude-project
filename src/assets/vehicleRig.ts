import { Material, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from "three";

/**
 * Turns a vehicle GLB into game data using the naming contract in
 * docs/BLENDER_PIPELINE.md. Works on any Object3D tree, so it also runs in Node tests.
 */

export type WheelId = "FL" | "FR" | "RL" | "RR";
export const WHEEL_IDS: readonly WheelId[] = ["FL", "FR", "RL", "RR"];

export interface VehicleExtras {
  asset_type: "vehicle";
  asset_id: string;
  pipeline_version: number;
  mass_kg: number;
  wheelbase: number;
  track_front: number;
  track_rear: number;
  wheel_radius: number;
  tire_width_front: number;
  tire_width_rear: number;
}

export interface WheelRig {
  id: WheelId;
  front: boolean;
  left: boolean;
  radius: number;
  width: number;
  /** Hub centre at rest, in the vehicle root's local space. */
  restPosition: Vector3;
  /** Steer / suspension node. */
  pivot: Object3D;
  /** Spinning node and its rest orientation (right wheels are pre-rotated 180°). */
  spin: Object3D;
  spinRest: Quaternion;
}

export interface VehicleRig {
  root: Object3D;
  extras: VehicleExtras;
  wheels: WheelRig[];
  sockets: Map<string, Object3D>;
  /** Collider hull vertices in root-local space, xyz packed. */
  hullPoints: Float32Array;
  materials: Map<string, Material>;
}

/** Physics-only view of a rig: plain numbers, no scene graph. */
export interface VehicleSpec {
  massKg: number;
  hullPoints: Float32Array;
  wheels: { id: WheelId; front: boolean; left: boolean; radius: number; width: number; position: Vector3 }[];
}

export function parseVehicleRig(scene: Object3D): VehicleRig {
  let root: Object3D | undefined;
  scene.traverse((o) => {
    if (!root && o.userData.asset_type === "vehicle") root = o;
  });
  if (!root) throw new Error("No node with userData.asset_type === 'vehicle' (see docs/BLENDER_PIPELINE.md)");
  const extras = root.userData as VehicleExtras;
  for (const key of ["mass_kg", "wheel_radius", "tire_width_front", "tire_width_rear"] as const) {
    if (typeof extras[key] !== "number") throw new Error(`Vehicle extras missing '${key}'`);
  }

  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const local = (o: Object3D) => new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(toRoot, o.matrixWorld));

  const wheels = WHEEL_IDS.map((id): WheelRig => {
    const pivot = find(root!, `WHEEL_${id}`);
    const spin = find(root!, `WHEEL_${id}_mesh`);
    const front = id[0] === "F";
    return {
      id,
      front,
      left: id[1] === "L",
      radius: extras.wheel_radius,
      width: front ? extras.tire_width_front : extras.tire_width_rear,
      restPosition: local(pivot),
      pivot,
      spin,
      spinRest: spin.quaternion.clone(),
    };
  });

  const sockets = new Map<string, Object3D>();
  const materials = new Map<string, Material>();
  let hull: Mesh | undefined;
  root.traverse((o) => {
    if (o.name.startsWith("SOCKET_")) sockets.set(o.name.slice("SOCKET_".length), o);
    if (o.name.startsWith("COL_")) {
      o.visible = false;
      if ((o as Mesh).isMesh && o.userData.collider === "convex_hull") hull ??= o as Mesh;
    }
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (m.name) materials.set(m.name, m);
      }
    }
  });
  if (!hull) throw new Error("Vehicle has no COL_* convex hull mesh");

  const position = hull.geometry.getAttribute("position");
  const toHull = new Matrix4().multiplyMatrices(toRoot, hull.matrixWorld);
  const hullPoints = new Float32Array(position.count * 3);
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(toHull).toArray(hullPoints, i * 3);
  }

  return { root, extras, wheels, sockets, hullPoints, materials };
}

export function vehicleSpec(rig: VehicleRig): VehicleSpec {
  return {
    massKg: rig.extras.mass_kg,
    hullPoints: rig.hullPoints,
    wheels: rig.wheels.map(({ id, front, left, radius, width, restPosition }) => ({
      id, front, left, radius, width, position: restPosition.clone(),
    })),
  };
}

function find(root: Object3D, name: string): Object3D {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`Vehicle is missing required node '${name}'`);
  return node;
}
