import type RAPIER from "@dimforge/rapier3d-compat";
import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Float32BufferAttribute, FogExp2,
  Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, PMREMGenerator, PointLight,
  Quaternion, Scene, TorusGeometry, Vector3, type WebGPURenderer,
} from "three/webgpu";
import type { Spawn } from "../physics/vehicle/ArcadeVehicle";
import { Groups } from "../physics/groups";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { addGroundTiles } from "../physics/staticGeometry";
import { createConeMaterial, createGridMaterial, darkMetal, neonMaterial } from "./materials";

const ARENA = 200; // half-size of the drivable square (m)
const Y_AXIS = new Vector3(0, 1, 0);

interface Cone {
  body: RAPIER.RigidBody;
  home: Vector3;
}

/**
 * Phase 1 test pad: a neon grid arena with ramps, a jump, a table-top, static
 * drift pylons for donuts and figure-eights, and knockable cone slaloms.
 * Layout (car spawns at the origin facing +Z; +X is the car's left):
 *   ahead      cone slalom along the centre line
 *   left  (+X) kicker, jump + landing ramp, table-top
 *   right (-X) figure-eight pylons
 *   behind     donut pylon inside a ring of cones
 */
export class TestTrack {
  readonly spawn: Spawn = { position: new Vector3(0, 0.05, 0), yaw: 0 };
  /** Follows the car so its shadow stays sharp anywhere in the arena. */
  readonly sun: DirectionalLight;

  private readonly cones: Cone[] = [];
  private readonly coneMesh: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    renderer: WebGPURenderer,
  ) {
    scene.background = new Color(0x05060c);
    scene.fog = new FogExp2(0x05060c, 0.0055);
    scene.environment = createNeonEnvironment(renderer);
    scene.environmentIntensity = 0.9;

    scene.add(new HemisphereLight(0x3b4a8a, 0x07070c, 0.8));
    this.sun = new DirectionalLight(0xa8b8ff, 1.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 });
    this.sun.shadow.bias = -0.0005;
    scene.add(this.sun, this.sun.target);

    this.buildGround();
    this.buildWalls();
    this.buildRamps();
    this.buildPylons();
    this.coneMesh = this.buildCones();
  }

  /** Keep the shadow frustum centred on the car. */
  followSun(target: Vector3): void {
    this.sun.position.set(target.x + 18, 40, target.z - 12);
    this.sun.target.position.copy(target);
  }

  /** Copy cone bodies into the instanced mesh. */
  update(): void {
    this.cones.forEach((cone, i) => {
      const p = cone.body.translation();
      const r = cone.body.rotation();
      this.position.set(p.x, p.y, p.z);
      this.quaternion.set(r.x, r.y, r.z, r.w);
      this.coneMesh.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, this.scale));
    });
    this.coneMesh.instanceMatrix.needsUpdate = true;
  }

  /** Stand every cone back up where it started. */
  resetProps(): void {
    for (const cone of this.cones) {
      cone.body.setTranslation(cone.home, true);
      cone.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      cone.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      cone.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  private buildGround(): void {
    const ground = new Mesh(new PlaneGeometry(ARENA * 2 + 200, ARENA * 2 + 200).rotateX(-Math.PI / 2), createGridMaterial());
    ground.receiveShadow = true;
    this.scene.add(ground);
    addGroundTiles(this.physics, ARENA + 50);

    // Spawn pad marker.
    const pad = new Mesh(new TorusGeometry(4.5, 0.03, 6, 64).rotateX(Math.PI / 2), neonMaterial(0xff2bd6, 1.2));
    pad.position.y = 0.02;
    this.scene.add(pad);
  }

  private buildWalls(): void {
    const { R, world } = this.physics;
    const height = 1.6;
    const body = darkMetal(0x0b0d14);
    const strip = neonMaterial(0xff2bd6, 5);
    for (const [x, z, sx, sz] of [
      [0, ARENA, ARENA, 0.5], [0, -ARENA, ARENA, 0.5], [ARENA, 0, 0.5, ARENA], [-ARENA, 0, 0.5, ARENA],
    ] as const) {
      const wall = new Mesh(new BoxGeometry(sx * 2, height, sz * 2), body);
      wall.position.set(x, height / 2, z);
      wall.receiveShadow = true;
      const top = new Mesh(new BoxGeometry(sx * 2 + 0.02, 0.08, sz * 2 + 0.02), strip);
      top.position.set(x, height, z);
      this.scene.add(wall, top);
      world.createCollider(
        R.ColliderDesc.cuboid(sx, height / 2, sz).setTranslation(x, height / 2, z)
          .setCollisionGroups(Groups.obstacle).setFriction(0.2),
      );
    }
  }

  private buildRamps(): void {
    // Kicker.
    this.ramp(new Vector3(40, 0, 35), 0, 8, 1.2, 6, 0x00e5ff);
    // Jump: launch ramp, a 20 m gap, then a landing ramp sloping away.
    this.ramp(new Vector3(75, 0, 15), 0, 12, 2.2, 8, 0xff2bd6);
    this.ramp(new Vector3(75, 0, 47 + 18), Math.PI, 18, 2.2, 10, 0xff2bd6);
    // Table-top: up, across, down.
    this.ramp(new Vector3(120, 0, 60), 0, 10, 1.5, 12, 0x00e5ff);
    this.box(new Vector3(120, 0.75, 76), new Vector3(12, 1.5, 12), 0x00e5ff);
    this.ramp(new Vector3(120, 0, 92), Math.PI, 10, 1.5, 12, 0x00e5ff);
  }

  /** Wedge rising along its local +Z from `start` (low edge centre) over `length`. */
  private ramp(start: Vector3, yaw: number, length: number, height: number, width: number, neon: number): void {
    const w = width / 2;
    // Triangular prism: low edge at z = 0, high edge at z = length.
    const pts = [
      [-w, 0, 0], [w, 0, 0], [-w, 0, length], [w, 0, length], [-w, height, length], [w, height, length],
    ];
    // Counter-clockwise from outside: sides, slope, back face, underside.
    const faces = [[0, 2, 4], [1, 5, 3], [0, 4, 5], [0, 5, 1], [2, 3, 5], [2, 5, 4], [0, 1, 3], [0, 3, 2]];
    const positions = faces.flatMap((f) => f.flatMap((i) => pts[i]!));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();

    const group = new Group();
    group.position.copy(start);
    group.rotation.y = yaw;
    const mesh = new Mesh(geometry, darkMetal(0x10131c, 0.35));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    // Neon rails along both sloped edges and the lip.
    const slope = Math.hypot(length, height);
    const angle = Math.atan2(height, length);
    for (const x of [-w, w]) {
      const rail = new Mesh(new BoxGeometry(0.08, 0.06, slope), neonMaterial(neon, 4));
      rail.position.set(x, height / 2 + 0.03, length / 2);
      rail.rotation.x = -angle;
      group.add(rail);
    }
    const lip = new Mesh(new BoxGeometry(width, 0.06, 0.08), neonMaterial(neon, 4));
    lip.position.set(0, height + 0.03, length);
    group.add(lip);
    this.scene.add(group);

    const { R, world } = this.physics;
    const rotation = new Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    const hull = new Float32Array(pts.flatMap((p) => new Vector3(p[0], p[1], p[2]).applyQuaternion(rotation).add(start).toArray()));
    world.createCollider(R.ColliderDesc.convexHull(hull)!.setCollisionGroups(Groups.ground).setFriction(0.8));
  }

  private box(centre: Vector3, size: Vector3, neon: number): void {
    const mesh = new Mesh(new BoxGeometry(size.x, size.y, size.z), darkMetal(0x10131c, 0.35));
    mesh.position.copy(centre);
    mesh.castShadow = mesh.receiveShadow = true;
    const edge = new Mesh(new BoxGeometry(size.x + 0.04, 0.06, size.z + 0.04), neonMaterial(neon, 3));
    edge.position.set(centre.x, centre.y + size.y / 2 + 0.03, centre.z);
    this.scene.add(mesh, edge);
    const { R, world } = this.physics;
    world.createCollider(
      R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(centre.x, centre.y, centre.z)
        .setCollisionGroups(Groups.ground).setFriction(0.8),
    );
  }

  private buildPylons(): void {
    // Figure-eight pair on the right, donut pylon behind the spawn.
    for (const [x, z, neon, ring] of [
      [-60, 60, 0x00e5ff, 13], [-60, 115, 0xff2bd6, 13], [0, -75, 0xffb000, 16],
    ] as const) {
      this.pylon(new Vector3(x, 0, z), neon, ring);
    }
  }

  private pylon(base: Vector3, neon: number, guideRadius: number): void {
    const radius = 0.6;
    const height = 3.6;
    const column = new Mesh(new CylinderGeometry(radius, radius * 1.15, height, 24), darkMetal(0x0c0e16, 0.3));
    column.position.set(base.x, height / 2, base.z);
    column.castShadow = true;
    this.scene.add(column);
    for (const y of [0.5, 1.5, 2.5]) {
      const band = new Mesh(new CylinderGeometry(radius + 0.03, radius + 0.03, 0.12, 24, 1, true), neonMaterial(neon, 5));
      band.position.set(base.x, y, base.z);
      this.scene.add(band);
    }
    const cap = new Mesh(new CylinderGeometry(radius * 0.9, radius, 0.2, 24), neonMaterial(neon, 8));
    cap.position.set(base.x, height + 0.1, base.z);
    const guide = new Mesh(new TorusGeometry(guideRadius, 0.06, 6, 96).rotateX(Math.PI / 2), neonMaterial(neon, 2.5));
    guide.position.set(base.x, 0.02, base.z);
    const glow = new PointLight(new Color(neon), 60, 30, 1.6);
    glow.position.set(base.x, height + 1.2, base.z);
    this.scene.add(cap, guide, glow);

    const { R, world } = this.physics;
    world.createCollider(
      R.ColliderDesc.cylinder(height / 2, radius).setTranslation(base.x, height / 2, base.z)
        .setCollisionGroups(Groups.obstacle).setFriction(0.3),
    );

    // A loose ring of cones around the donut / figure-eight posts.
    const count = Math.round(guideRadius * 0.9);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.cone(new Vector3(base.x + Math.cos(a) * (guideRadius + 2.5), 0, base.z + Math.sin(a) * (guideRadius + 2.5)));
    }
  }

  private buildCones(): InstancedMesh {
    // Slalom straight ahead of the spawn.
    for (let i = 0; i < 9; i++) this.cone(new Vector3(0, 0, 30 + i * 14));
    // Gate between the figure-eight posts.
    for (const x of [-56, -64]) this.cone(new Vector3(x, 0, 87.5));

    const geometry = new ConeGeometry(0.2, 0.72, 16);
    const mesh = new InstancedMesh(geometry, createConeMaterial(), this.cones.length);
    mesh.castShadow = true;
    mesh.frustumCulled = false; // instances move; the base bounds would be stale
    this.scene.add(mesh);
    return mesh;
  }

  private cone(base: Vector3): void {
    const { R, world } = this.physics;
    const home = new Vector3(base.x, 0.36, base.z);
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(home.x, home.y, home.z).setLinearDamping(0.3).setAngularDamping(0.6),
    );
    world.createCollider(
      R.ColliderDesc.cone(0.36, 0.2).setMass(3).setFriction(0.7).setCollisionGroups(Groups.prop),
      body,
    );
    body.sleep();
    this.cones.push({ body, home });
  }
}

/**
 * Reflection environment for the car paint: a dark room with neon panels,
 * pre-filtered once with PMREM. Cheap and reads as a night city.
 */
export function createNeonEnvironment(renderer: WebGPURenderer) {
  const env = new Scene();
  env.background = new Color(0x020308);
  const panel = (w: number, h: number, hex: number, k: number, x: number, y: number, z: number) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(k), side: 2 }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(10, 1.2, 0xff2bd6, 3, -12, 4, 6);
  panel(12, 1.0, 0x00e5ff, 3, 12, 5, -4);
  panel(3, 10, 0x7a6cff, 1.5, 0, 12, 0);
  panel(6, 0.6, 0xffb000, 2, 4, 2, 14);
  panel(8, 0.8, 0x00e5ff, 2, -6, 2, -14);
  return new PMREMGenerator(renderer).fromScene(env, 0.04).texture;
}
