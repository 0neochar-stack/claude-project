import {
  BoxGeometry, Color, CylinderGeometry, DirectionalLight, FogExp2, HemisphereLight, InstancedMesh, Matrix4, Mesh,
  PlaneGeometry, Quaternion, Vector3, type Scene, type WebGPURenderer,
} from "three/webgpu";
import type { Spawn } from "../physics/vehicle/ArcadeVehicle";
import { Groups } from "../physics/groups";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { addGroundTiles } from "../physics/staticGeometry";
import { CITY, createBuildingMaterial, createLampMaterial, createSidewalk, createSignMaterial, createWetAsphalt } from "./cityMaterials";
import { darkMetal } from "./materials";
import { createNeonEnvironment } from "./TestTrack";

const BLOCKS = 6; // blocks per side
const HALF = (BLOCKS / 2) * CITY.pitch; // outer road centreline (m)
const NEON = [0x00e5ff, 0xff2bd6, 0xffb000, 0x8a5cff, 0x39ff88, 0xff3b3b];

/** Deterministic PRNG so the city is the same every visit. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Box {
  centre: Vector3;
  size: Vector3;
}

/**
 * A rain-soaked downtown grid: 6x6 blocks of neon-lit towers separated by 20 m
 * streets with raised sidewalks, street lamps and signage. The road is one big
 * reflective wet-asphalt plane; everything repeated is instanced.
 */
export class NeonCity {
  readonly spawn: Spawn = { position: new Vector3(0, 0.05, -20), yaw: 0 };
  readonly sun: DirectionalLight;

  private readonly random = mulberry32(2077);

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    renderer: WebGPURenderer,
  ) {
    scene.background = new Color(0x07081a);
    scene.fog = new FogExp2(0x0a0b1f, 0.0075);
    scene.environment = createNeonEnvironment(renderer);
    scene.environmentIntensity = 0.7;
    scene.add(new HemisphereLight(0x4a4a9a, 0x06060c, 0.55));

    this.sun = new DirectionalLight(0x9aa8ff, 0.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 90 });
    this.sun.shadow.bias = -0.0005;
    scene.add(this.sun, this.sun.target);

    this.buildRoad();
    const buildings = this.buildBlocks();
    this.buildSkyline();
    this.buildSigns(buildings);
    this.buildLamps();
    this.buildBoundary();
  }

  followSun(target: Vector3): void {
    this.sun.position.set(target.x + 16, 45, target.z - 10);
    this.sun.target.position.copy(target);
  }

  update(): void {}

  resetProps(): void {}

  private buildRoad(): void {
    const { material, reflectorTarget } = createWetAsphalt();
    const size = HALF * 2 + 400;
    const road = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), material);
    road.receiveShadow = true;
    this.scene.add(road, reflectorTarget);
    addGroundTiles(this.physics, HALF + 60);
  }

  /** Sidewalk slab per block, then 2-4 towers on it. Returns the towers. */
  private buildBlocks(): Box[] {
    const { pitch, road, sidewalk, kerb } = CITY;
    const blockSize = pitch - road;
    const slabs: Box[] = [];
    const towers: Box[] = [];
    for (let i = 0; i < BLOCKS; i++) {
      for (let j = 0; j < BLOCKS; j++) {
        const cx = -HALF + (i + 0.5) * pitch;
        const cz = -HALF + (j + 0.5) * pitch;
        slabs.push({ centre: new Vector3(cx, kerb / 2, cz), size: new Vector3(blockSize, kerb, blockSize) });
        // Split the buildable area into lots; big towers downtown, lower toward the edge.
        const inner = blockSize - sidewalk * 2;
        const splitsX = this.random() < 0.5 ? 2 : 3;
        const splitsZ = this.random() < 0.5 ? 2 : 3;
        const downtown = 1 - Math.hypot(cx, cz) / (HALF * 1.5);
        for (let a = 0; a < splitsX; a++) {
          for (let b = 0; b < splitsZ; b++) {
            if (this.random() < 0.1) continue; // the odd plaza gap
            const lotW = inner / splitsX;
            const lotD = inner / splitsZ;
            const w = lotW * (0.78 + this.random() * 0.2);
            const d = lotD * (0.78 + this.random() * 0.2);
            const h = 14 + this.random() * (30 + 110 * downtown * downtown);
            towers.push({
              centre: new Vector3(cx - inner / 2 + lotW * (a + 0.5), kerb + h / 2, cz - inner / 2 + lotD * (b + 0.5)),
              size: new Vector3(w, h, d),
            });
          }
        }
      }
    }
    this.instancedBoxes(slabs, createSidewalk(), false);
    this.instancedBoxes(towers, createBuildingMaterial(), false);

    const { R, world } = this.physics;
    for (const s of slabs) {
      world.createCollider(R.ColliderDesc.cuboid(s.size.x / 2, s.size.y / 2, s.size.z / 2)
        .setTranslation(s.centre.x, s.centre.y, s.centre.z).setCollisionGroups(Groups.ground).setFriction(0.8));
    }
    for (const t of towers) {
      world.createCollider(R.ColliderDesc.cuboid(t.size.x / 2, t.size.y / 2, t.size.z / 2)
        .setTranslation(t.centre.x, t.centre.y, t.centre.z).setCollisionGroups(Groups.obstacle).setFriction(0.2));
    }
    return towers;
  }

  /** A ring of distant towers so the horizon is a skyline, not a void. Visual only. */
  private buildSkyline(): void {
    const ring: Box[] = [];
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2;
      const r = HALF + 70 + this.random() * 140;
      const h = 40 + this.random() * 180;
      const w = 18 + this.random() * 30;
      ring.push({ centre: new Vector3(Math.cos(a) * r, h / 2, Math.sin(a) * r), size: new Vector3(w, h, w * (0.6 + this.random())) });
    }
    this.instancedBoxes(ring, createBuildingMaterial(), false);
  }

  /** Vertical blade signs and horizontal banners on street-facing walls. */
  private buildSigns(towers: Box[]): void {
    const signs: { centre: Vector3; size: Vector3; colour: number }[] = [];
    for (const t of towers) {
      const count = 1 + Math.floor(this.random() * 3);
      for (let k = 0; k < count; k++) {
        const face = Math.floor(this.random() * 4);
        const alongX = face < 2;
        const sign = face % 2 === 0 ? 1 : -1;
        const halfW = (alongX ? t.size.x : t.size.z) / 2;
        const halfD = (alongX ? t.size.z : t.size.x) / 2;
        const vertical = this.random() < 0.55;
        const size = vertical ? new Vector3(0.5, 4 + this.random() * 8, 0.25) : new Vector3(4 + this.random() * 8, 0.6 + this.random() * 0.8, 0.2);
        const y = vertical ? 6 + this.random() * Math.min(30, t.size.y - 16) + size.y / 2 : 3.8 + this.random() * Math.min(12, t.size.y - 6);
        if (y + size.y / 2 > t.size.y) continue;
        const offset = (this.random() - 0.5) * 2 * (halfW - size.x / 2 - 0.5);
        const centre = alongX
          ? new Vector3(t.centre.x + offset, y, t.centre.z + sign * (halfD + size.z / 2 + (vertical ? 0.6 : 0.05)))
          : new Vector3(t.centre.x + sign * (halfD + size.z / 2 + (vertical ? 0.6 : 0.05)), y, t.centre.z + offset);
        signs.push({ centre, size: alongX ? size : new Vector3(size.z, size.y, size.x), colour: NEON[Math.floor(this.random() * NEON.length)]! });
      }
    }
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), createSignMaterial(), signs.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const c = new Color();
    signs.forEach((s, i) => {
      mesh.setMatrixAt(i, m.compose(s.centre, q, s.size));
      mesh.setColorAt(i, c.set(s.colour));
    });
    this.scene.add(mesh);
  }

  /** Lamp posts along every kerb, 26 m apart. */
  private buildLamps(): void {
    const { pitch, road, kerb } = CITY;
    const posts: Matrix4[] = [];
    const heads: Matrix4[] = [];
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const add = (x: number, z: number, armX: number, armZ: number) => {
      posts.push(new Matrix4().compose(new Vector3(x, kerb + 3.5, z), q, one));
      heads.push(new Matrix4().compose(new Vector3(x + armX, kerb + 7, z + armZ), q, new Vector3(armX ? 1.6 : 0.35, 0.18, armZ ? 1.6 : 0.35)));
    };
    for (let k = -BLOCKS / 2; k <= BLOCKS / 2; k++) {
      const c = k * pitch;
      for (let s = -HALF + 20; s < HALF - 10; s += 26) {
        if (Math.abs(((s % pitch) + pitch) % pitch - pitch / 2) > pitch / 2 - road / 2 - 3) continue; // not in junctions
        const edge = road / 2 + 0.6;
        add(c + edge, s, -0.9, 0);
        add(c - edge, s, 0.9, 0);
        add(s, c + edge, 0, -0.9);
        add(s, c - edge, 0, 0.9);
      }
    }
    const pole = new InstancedMesh(new CylinderGeometry(0.08, 0.12, 7, 8), darkMetal(0x1a1c26, 0.4), posts.length);
    const head = new InstancedMesh(new BoxGeometry(1, 1, 1), createLampMaterial(), heads.length);
    posts.forEach((m, i) => pole.setMatrixAt(i, m));
    heads.forEach((m, i) => head.setMatrixAt(i, m));
    pole.castShadow = true;
    this.scene.add(pole, head);
  }

  /** Invisible walls around the outer ring road. */
  private buildBoundary(): void {
    const { R, world } = this.physics;
    const edge = HALF + CITY.road / 2 + 1;
    for (const [x, z, sx, sz] of [[0, edge, edge, 1], [0, -edge, edge, 1], [edge, 0, 1, edge], [-edge, 0, 1, edge]]) {
      world.createCollider(R.ColliderDesc.cuboid(sx!, 4, sz!).setTranslation(x!, 4, z!).setCollisionGroups(Groups.obstacle).setFriction(0.2));
    }
  }

  private instancedBoxes(boxes: Box[], material: InstancedMesh["material"], shadows: boolean): void {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, boxes.length);
    const m = new Matrix4();
    const q = new Quaternion();
    boxes.forEach((b, i) => mesh.setMatrixAt(i, m.compose(b.centre, q, b.size)));
    mesh.receiveShadow = true;
    mesh.castShadow = shadows;
    this.scene.add(mesh);
  }
}
