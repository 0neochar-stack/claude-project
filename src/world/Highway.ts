import {
  BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, DirectionalLight, FogExp2,
  HemisphereLight, InstancedMesh, Matrix4, Mesh, PlaneGeometry, PMREMGenerator, Quaternion, SphereGeometry, Vector3,
  type Material, type Scene, type WebGPURenderer,
} from "three/webgpu";
import type { Spawn } from "../physics/vehicle/ArcadeVehicle";
import { Groups } from "../physics/groups";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { addGroundTiles } from "../physics/staticGeometry";
import {
  createBarrierMaterial, createBasinMaterial, createBillboardMaterial, createFreewayAsphalt, createPalmMaterial, createSkyMaterial,
  FREEWAY,
} from "./highwayMaterials";
import { darkMetal } from "./materials";
import { createLampMaterial } from "./cityMaterials";
import { Skyline } from "./Skyline";

/** Freeway centre line (x, z): sweepers, an S-bend and two tight hairpins for drifting. */
const ROUTE: [number, number][] = [
  [0, 0], [350, -60], [700, 0], [900, 200], [880, 450], [700, 560], [520, 480], [420, 330], [260, 300],
  [120, 420], [60, 640], [-120, 760], [-340, 700], [-420, 500], [-360, 300], [-460, 150], [-380, 20], [-200, -20],
];
const SAMPLE_SPACING = 4; // metres between road cross-sections
const Y = new Vector3(0, 1, 0);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sample {
  centre: Vector3;
  /** Unit vector to the right of travel. */
  right: Vector3;
  distance: number;
}

/**
 * An LA-style night freeway: a 4 km closed loop with a median, jersey barriers,
 * overhead lights and palms, winding through a basin of street lights under a
 * skyline of towers. Rain puddles here and there, otherwise dry.
 */
export class Highway {
  readonly spawn: Spawn;
  readonly sun: DirectionalLight;
  private readonly samples: Sample[] = [];
  private readonly random = mulberry32(1984);

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    renderer: WebGPURenderer,
  ) {
    this.sampleRoute();
    const first = this.samples[0]!;
    const next = this.samples[1]!;
    const heading = next.centre.clone().sub(first.centre);
    this.spawn = { position: first.centre.clone().addScaledVector(first.right, 7).setY(0.05), yaw: Math.atan2(heading.x, heading.z) };

    scene.background = new Color(0x0b0816);
    scene.fog = new FogExp2(0x2a1a38, 0.00042);
    scene.add(new HemisphereLight(0x7a5a9a, 0x140c0c, 0.45));
    this.sun = new DirectionalLight(0xb0a0ff, 0.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 80 });
    this.sun.shadow.bias = -0.0005;
    scene.add(this.sun, this.sun.target);

    this.buildSkyAndBasin();
    this.buildRoad();
    this.buildBarriers();
    this.buildLights();
    this.buildPalms();
    this.buildBillboards();
    this.buildSkyline();

    // Reflections of the real skyline for paint and puddles, captured once (no per-frame mirror pass).
    const at = first.centre.clone().setY(25);
    scene.environment = new PMREMGenerator(renderer).fromScene(scene, 0.01, 1, 12_000, { size: 256, position: at }).texture;
    scene.environmentIntensity = 1;
  }

  followSun(target: Vector3): void {
    this.sun.position.set(target.x + 14, 40, target.z - 8);
    this.sun.target.position.copy(target);
  }

  update(): void {}

  resetProps(): void {}

  private sampleRoute(): void {
    const curve = new CatmullRomCurve3(ROUTE.map(([x, z]) => new Vector3(x, 0, z)), true, "centripetal");
    const length = curve.getLength();
    const count = Math.ceil(length / SAMPLE_SPACING);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const tangent = curve.getTangentAt(t).setY(0).normalize();
      this.samples.push({
        centre: curve.getPointAt(t).setY(0),
        right: new Vector3(-tangent.z, 0, tangent.x),
        distance: t * length,
      });
    }
  }

  /** Distance from (x, z) to the nearest road sample. */
  private distanceToRoad(x: number, z: number): number {
    let best = Infinity;
    for (const s of this.samples) best = Math.min(best, (s.centre.x - x) ** 2 + (s.centre.z - z) ** 2);
    return Math.sqrt(best);
  }

  /** Sweep a 2-D profile [(lateral, height)] along the route into a closed-loop mesh. */
  private sweep(profile: [number, number][], lift = 0): BufferGeometry {
    const n = this.samples.length;
    const m = profile.length;
    const positions = new Float32Array((n + 1) * m * 3);
    const uvs = new Float32Array((n + 1) * m * 2);
    const total = this.samples[n - 1]!.distance + SAMPLE_SPACING;
    for (let i = 0; i <= n; i++) {
      const s = this.samples[i % n]!;
      const distance = i === n ? total : s.distance;
      profile.forEach(([lateral, height], j) => {
        const k = i * m + j;
        positions.set([s.centre.x + s.right.x * lateral, height + lift, s.centre.z + s.right.z * lateral], k * 3);
        uvs.set([m > 2 ? j / (m - 1) : (lateral + FREEWAY.halfWidth) / (FREEWAY.halfWidth * 2), distance], k * 2);
      });
    }
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m - 1; j++) {
        const a = i * m + j;
        const b = a + m;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildSkyAndBasin(): void {
    const sky = new Mesh(new SphereGeometry(9000, 48, 24), createSkyMaterial());
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    const basin = new Mesh(new PlaneGeometry(16_000, 16_000).rotateX(-Math.PI / 2), createBasinMaterial());
    basin.position.y = -0.05;
    basin.receiveShadow = true;
    this.scene.add(sky, basin);

    // Hills ringing the basin (Hollywood Hills / San Gabriels), dotted with house lights.
    const segments = 240;
    const positions: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const ridge = 160 + 190 * Math.abs(Math.sin(a * 3.1 + 1)) * (0.6 + 0.4 * Math.sin(a * 7.3)) + 60 * Math.sin(a * 17);
      for (const [r, y] of [[2600, -5], [3100, ridge], [3900, ridge * 0.6], [4600, -5]] as const) {
        positions.push(Math.cos(a) * r + 220, y, Math.sin(a) * r + 350);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < 3; j++) {
        const a = i * 4 + j;
        index.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    this.scene.add(new Mesh(geometry, createBasinMaterial()));

    let extent = 0;
    for (const s of this.samples) extent = Math.max(extent, Math.abs(s.centre.x), Math.abs(s.centre.z));
    addGroundTiles(this.physics, extent + 150, 100);
  }

  private buildRoad(): void {
    const road = new Mesh(this.sweep([[-FREEWAY.halfWidth, 0], [FREEWAY.halfWidth, 0]], 0.005), createFreewayAsphalt());
    road.receiveShadow = true;
    this.scene.add(road);
  }

  private buildBarriers(): void {
    // Jersey barrier profile around a lateral position.
    const jersey = (c: number): [number, number][] =>
      [[c - 0.34, 0], [c - 0.22, 0.32], [c - 0.1, 1.05], [c + 0.1, 1.05], [c + 0.22, 0.32], [c + 0.34, 0]];
    const { R, world } = this.physics;
    for (const [lateral, neon] of [[0, true], [-FREEWAY.halfWidth + 0.35, false], [FREEWAY.halfWidth - 0.35, false]] as const) {
      const geometry = this.sweep(jersey(lateral));
      this.scene.add(new Mesh(geometry, createBarrierMaterial(neon)));
      const vertices = geometry.getAttribute("position").array as Float32Array;
      const indices = new Uint32Array(geometry.getIndex()!.array);
      world.createCollider(R.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(Groups.obstacle).setFriction(0.15));
    }
  }

  /** Double-armed lamp standards on the median, lighting both carriageways. */
  private buildLights(): void {
    const poles: Matrix4[] = [];
    const arms: Matrix4[] = [];
    const heads: Matrix4[] = [];
    const q = new Quaternion();
    const perSample = Math.round(FREEWAY.lightSpacing / SAMPLE_SPACING);
    this.samples.forEach((s, i) => {
      if (i % perSample !== 0) return;
      q.setFromAxisAngle(Y, Math.atan2(s.right.x, s.right.z));
      poles.push(new Matrix4().compose(s.centre.clone().setY(6.6), q, new Vector3(1, 1, 1)));
      arms.push(new Matrix4().compose(s.centre.clone().setY(12.1), q, new Vector3(0.18, 0.18, FREEWAY.lightReach * 2)));
      for (const side of [-1, 1]) {
        const at = s.centre.clone().addScaledVector(s.right, side * FREEWAY.lightReach).setY(11.9);
        heads.push(new Matrix4().compose(at, q, new Vector3(0.5, 0.2, 1.6)));
      }
    });
    this.scene.add(
      instancedFrom(new CylinderGeometry(0.14, 0.22, 12, 8), darkMetal(0x2a2c34, 0.5), poles),
      instancedFrom(new BoxGeometry(1, 1, 1), darkMetal(0x2a2c34, 0.5), arms),
      instancedFrom(new BoxGeometry(1, 1, 1), createLampMaterial(), heads),
    );
  }

  /** Palms along the shoulders and scattered through the basin. */
  private buildPalms(): void {
    const spots: Vector3[] = [];
    for (let i = 0; i < this.samples.length; i += 8 + Math.floor(this.random() * 4)) {
      const s = this.samples[i]!;
      const side = this.random() < 0.5 ? -1 : 1;
      const at = s.centre.clone().addScaledVector(s.right, side * (FREEWAY.halfWidth + 5 + this.random() * 8));
      if (this.distanceToRoad(at.x, at.z) > FREEWAY.halfWidth + 3) spots.push(at);
    }
    for (let k = 0; k < 160; k++) {
      const at = new Vector3(-900 + this.random() * 2300, 0, -500 + this.random() * 1700);
      if (this.distanceToRoad(at.x, at.z) > 40) spots.push(at);
    }
    const trunks: Matrix4[] = [];
    const crowns: Matrix4[] = [];
    const q = new Quaternion();
    for (const at of spots) {
      const h = 12 + this.random() * 11;
      const lean = new Quaternion().setFromAxisAngle(new Vector3(this.random() - 0.5, 0, this.random() - 0.5).normalize(), this.random() * 0.12);
      trunks.push(new Matrix4().compose(at.clone().setY(h / 2), lean, new Vector3(1, h, 1)));
      q.setFromAxisAngle(Y, this.random() * Math.PI * 2);
      crowns.push(new Matrix4().compose(at.clone().setY(h).add(new Vector3(0, 1, 0).applyQuaternion(lean).multiplyScalar(0)), q, new Vector3(1, 1, 1).multiplyScalar(0.85 + this.random() * 0.4)));
    }
    const material = createPalmMaterial();
    this.scene.add(
      instancedFrom(new CylinderGeometry(0.17, 0.26, 1, 7), material, trunks),
      instancedFrom(palmCrownGeometry(), material, crowns),
    );
  }

  /** Holo billboards facing the freeway every few hundred metres. */
  private buildBillboards(): void {
    const boards: Matrix4[] = [];
    const posts: Matrix4[] = [];
    const q = new Quaternion();
    const spacing = Math.round(320 / SAMPLE_SPACING);
    for (let i = spacing / 2; i < this.samples.length; i += spacing) {
      const s = this.samples[i]!;
      const side = (i / spacing) % 2 < 1 ? 1 : -1;
      const at = s.centre.clone().addScaledVector(s.right, side * (FREEWAY.halfWidth + 12));
      if (this.distanceToRoad(at.x, at.z) < FREEWAY.halfWidth + 8) continue;
      const toRoad = s.right.clone().multiplyScalar(-side);
      q.setFromAxisAngle(Y, Math.atan2(toRoad.x, toRoad.z));
      boards.push(new Matrix4().compose(at.clone().setY(13), q, new Vector3(18, 7, 1)));
      for (const off of [-5, 5]) {
        const post = at.clone().addScaledVector(new Vector3(toRoad.z, 0, -toRoad.x), off).setY(5);
        posts.push(new Matrix4().compose(post, q, new Vector3(1, 10, 1)));
      }
    }
    this.scene.add(
      instancedFrom(new PlaneGeometry(1, 1), createBillboardMaterial(), boards),
      instancedFrom(new CylinderGeometry(0.25, 0.25, 1, 8), darkMetal(0x1a1c24, 0.5), posts),
    );
  }

  private buildSkyline(): void {
    const skyline = new Skyline(this.random);
    const nearRoad = (min: number) => (x: number, z: number) => this.distanceToRoad(x, z) < min;
    // Downtown, Century City, the Wilshire corridor, Hollywood, Burbank - plus mid-rises
    // and a few towers right beside the freeway so the city looms overhead.
    skyline.addDistrict({ centre: [500, -950], radius: 420, count: 90, height: [80, 330] }, nearRoad(90));
    skyline.addDistrict({ centre: [-1350, 420], radius: 260, count: 32, height: [60, 220] }, nearRoad(90));
    for (let k = 0; k < 6; k++) {
      skyline.addDistrict({ centre: [-950 + k * 230, -480 + (k % 2) * 60], radius: 110, count: 10, height: [30, 140] }, nearRoad(80));
    }
    skyline.addDistrict({ centre: [150, 1550], radius: 380, count: 45, height: [18, 95] }, nearRoad(80));
    skyline.addDistrict({ centre: [1550, 950], radius: 360, count: 36, height: [15, 85] }, nearRoad(80));
    skyline.addDistrict({ centre: [220, 350], radius: 900, count: 70, height: [50, 210] }, nearRoad(95));
    skyline.addDistrict({ centre: [220, 350], radius: 1300, count: 160, height: [10, 45] }, nearRoad(60));
    skyline.build(this.scene);
  }
}

function instancedFrom(geometry: BufferGeometry, material: Material, matrices: Matrix4[]): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, matrices.length));
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  return mesh;
}

/** Twelve drooping fronds as bent, tapering strips, merged into one geometry (origin at the crown). */
function palmCrownGeometry(): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  const fronds = 12;
  const steps = 7;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + (f % 2) * 0.15;
    const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new Vector3(-dir.z, 0, dir.x);
    const reach = 3.6 + (f % 3) * 0.5;
    const base = positions.length / 3;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const centre = dir.clone().multiplyScalar(s * reach).setY(0.9 * s - 2.6 * s * s + (f % 2) * 0.3);
      const width = 0.55 * Math.sin(Math.PI * Math.min(1, s * 1.15 + 0.05));
      const l = centre.clone().addScaledVector(side, width);
      const r = centre.clone().addScaledVector(side, -width);
      positions.push(l.x, l.y - 0.1, l.z, r.x, r.y - 0.1, r.z);
    }
    for (let i = 0; i < steps; i++) {
      const k = base + i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
