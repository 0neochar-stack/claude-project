import {
  BoxGeometry, Color, ConeGeometry, CylinderGeometry, InstancedMesh, Matrix4, MeshBasicNodeMaterial, MeshStandardNodeMaterial,
  Quaternion, SphereGeometry, Vector3, type BufferGeometry, type Material, type Scene,
} from "three/webgpu";
import {
  abs, color, float, floor, fract, hash, instanceIndex, mix, normalWorld, positionWorld, smoothstep, step, time, vec2, vec3,
} from "three/tsl";

type Rng = () => number;

export interface District {
  centre: [number, number];
  radius: number;
  count: number;
  height: [number, number];
}

interface Part {
  position: Vector3;
  scale: Vector3;
  yaw: number;
  colour?: number;
}

const CROWN_COLOURS = [0xff2bd6, 0x00e5ff, 0xffb000, 0x8a5cff, 0xff3b3b, 0xe8f0ff];
const Y_AXIS = new Vector3(0, 1, 0);

/**
 * A skyline of towers that are all different: slabs, setback wedding-cakes,
 * round towers, stepped cylinders, pyramid crowns, spires with aircraft beacons,
 * lit crown bands. Each shape family is one instanced draw call; every tower's
 * windows get their own pattern, colour and occupancy in the shader.
 */
export class Skyline {
  private readonly boxes: Part[] = [];
  private readonly cylinders: Part[] = [];
  private readonly roofs: Part[] = [];
  private readonly crowns: Part[] = [];
  private readonly antennas: Part[] = [];
  private readonly beacons: Part[] = [];

  constructor(private readonly random: Rng) {}

  addDistrict(d: District, avoid: (x: number, z: number) => boolean): void {
    let placed = 0;
    for (let attempt = 0; attempt < d.count * 6 && placed < d.count; attempt++) {
      const a = this.random() * Math.PI * 2;
      const r = Math.sqrt(this.random()) * d.radius;
      const x = d.centre[0] + Math.cos(a) * r;
      const z = d.centre[1] + Math.sin(a) * r;
      if (avoid(x, z)) continue;
      // Taller toward the district centre.
      const core = 1 - r / d.radius;
      const h = d.height[0] + (d.height[1] - d.height[0]) * Math.pow(this.random(), 1.6) * (0.4 + 0.6 * core);
      this.tower(x, z, h);
      placed++;
    }
  }

  build(scene: Scene): void {
    const building = createTowerMaterial();
    const glow = new MeshBasicNodeMaterial();
    glow.colorNode = vec3(float(5));
    const metal = new MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.8, color: 0x15161c });
    const beacon = new MeshBasicNodeMaterial();
    const blink = step(0.55, fract(time.mul(0.8).add(hash(float(instanceIndex)))));
    beacon.colorNode = color(0xff1a1a).mul(blink.mul(12).add(0.4));

    scene.add(
      instanced(new BoxGeometry(1, 1, 1), building, this.boxes),
      instanced(new CylinderGeometry(0.5, 0.5, 1, 20), building, this.cylinders),
      instanced(new ConeGeometry(0.72, 1, 4).rotateY(Math.PI / 4), building, this.roofs),
      instanced(new CylinderGeometry(0.5, 0.5, 1, 20, 1, true), glow, this.crowns),
      instanced(new CylinderGeometry(0.5, 0.5, 1, 6), metal, this.antennas),
      instanced(new SphereGeometry(0.5, 8, 6), beacon, this.beacons),
    );
  }

  private tower(x: number, z: number, h: number): void {
    const r = this.random;
    const yaw = r() < 0.7 ? 0 : (r() - 0.5) * 0.8; // mostly on the street grid
    const w = 16 + r() * 26;
    const d = w * (0.55 + r() * 0.6);
    const kind = r();
    let top = h;
    if (kind < 0.28) {
      // Slab.
      this.boxes.push({ position: new Vector3(x, h / 2, z), scale: new Vector3(w, h, d), yaw });
    } else if (kind < 0.55) {
      // Setbacks: 2-3 shrinking tiers.
      const tiers = 2 + Math.floor(r() * 2);
      let y = 0;
      let tw = w;
      let td = d;
      for (let i = 0; i < tiers; i++) {
        const th = (h / tiers) * (i === 0 ? 1.3 : 0.85);
        this.boxes.push({ position: new Vector3(x, y + th / 2, z), scale: new Vector3(tw, th, td), yaw });
        y += th;
        tw *= 0.72;
        td *= 0.72;
      }
      top = y;
    } else if (kind < 0.72) {
      // Round tower, sometimes stepped.
      const stepped = r() < 0.5;
      const dia = Math.min(w, 34);
      if (stepped) {
        this.cylinders.push({ position: new Vector3(x, h * 0.35, z), scale: new Vector3(dia, h * 0.7, dia), yaw });
        this.cylinders.push({ position: new Vector3(x, h * 0.85, z), scale: new Vector3(dia * 0.75, h * 0.3, dia * 0.75), yaw });
      } else {
        this.cylinders.push({ position: new Vector3(x, h / 2, z), scale: new Vector3(dia, h, dia), yaw });
      }
      this.crowns.push({ position: new Vector3(x, top - 2, z), scale: new Vector3(dia * (stepped ? 0.77 : 1.02), 1.2, dia * (stepped ? 0.77 : 1.02)), yaw, colour: pick(r, CROWN_COLOURS) });
    } else if (kind < 0.86) {
      // Pyramid crown.
      this.boxes.push({ position: new Vector3(x, h / 2, z), scale: new Vector3(w, h, w), yaw });
      const ph = w * (0.5 + r() * 0.5);
      this.roofs.push({ position: new Vector3(x, h + ph / 2, z), scale: new Vector3(w, ph, w), yaw });
      top = h + ph;
    } else {
      // Slab with a spire.
      this.boxes.push({ position: new Vector3(x, h / 2, z), scale: new Vector3(w, h, d), yaw });
      const sh = 20 + r() * 45;
      this.antennas.push({ position: new Vector3(x, h + sh / 2, z), scale: new Vector3(1.4, sh, 1.4), yaw });
      top = h + sh;
    }
    // Lit crown bands on some boxy towers, beacons on anything tall.
    if (kind < 0.55 && r() < 0.45) {
      this.crowns.push({ position: new Vector3(x, top - 1.5, z), scale: new Vector3(w * 0.5, 1, d * 0.5), yaw, colour: pick(r, CROWN_COLOURS) });
    }
    if (top > 90) this.beacons.push({ position: new Vector3(x, top + 1, z), scale: new Vector3(2.2, 2.2, 2.2), yaw });
  }
}

function pick<T>(r: Rng, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)]!;
}

function instanced(geometry: BufferGeometry, material: Material, parts: Part[]): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, parts.length));
  const m = new Matrix4();
  const q = new Quaternion();
  const c = new Color();
  parts.forEach((p, i) => {
    mesh.setMatrixAt(i, m.compose(p.position, q.setFromAxisAngle(Y_AXIS, p.yaw), p.scale));
    if (p.colour !== undefined) mesh.setColorAt(i, c.set(p.colour));
  });
  mesh.count = parts.length;
  return mesh;
}

/**
 * Facades with per-tower character: window grid size, floor height, colour
 * temperature and occupancy all come from the instance hash, and a share of towers
 * use vertical LED strips or full-width floor bands instead of windows. Works for
 * boxes and cylinders of any rotation (the horizontal coordinate follows the face).
 */
function createTowerMaterial(): MeshStandardNodeMaterial {
  const seed = float(instanceIndex).mul(13.37);
  const n = normalWorld;
  const tangent = vec2(n.z.negate(), n.x).normalize();
  const u = positionWorld.xz.dot(tangent);
  const v = positionWorld.y;
  const wall = float(1).sub(step(0.6, abs(n.y)));

  const cellW = mix(float(1.6), float(3.4), hash(seed.add(1)));
  const floorH = mix(float(3), float(4.2), hash(seed.add(2)));
  const cell = vec2(u.div(cellW), v.div(floorH));
  const id = floor(cell);
  const f = fract(cell);
  const paneW = mix(float(0.55), float(0.9), hash(seed.add(3)));
  const pane = smoothstep(0.5, 0.45, abs(f.x.sub(0.5)).div(paneW)).mul(step(0.25, f.y)).mul(step(f.y, 0.8));
  const occupancy = mix(float(0.25), float(0.8), hash(seed.add(4)));
  const lit = step(hash(id.x.mul(12.99).add(id.y.mul(78.23)).add(seed)), occupancy);
  const variation = mix(float(0.5), float(1.2), hash(id.x.add(id.y.mul(5.1)).add(seed.mul(3))));

  const style = hash(seed.add(5));
  const strips = step(0.9, fract(u.div(mix(float(3), float(6), hash(seed.add(6)))))); // vertical LED strips
  const bands = step(0.82, fract(v.div(floorH))); // glowing floor slabs
  const windows = pane.mul(lit).mul(variation);
  const pattern = mix(mix(windows, strips.mul(0.9), step(0.78, style)), bands.mul(0.8), step(0.9, style));

  const temp = hash(seed.add(7));
  const light = mix(mix(color(0xffc27a), color(0xdfeaff), step(0.45, temp)), color(0x7fe0ff), step(0.9, temp));
  const accent = mix(color(0xff2bd6), color(0x00e5ff), hash(seed.add(8)));
  const lightColour = mix(light, accent, step(0.78, style));
  const glassy = hash(seed.add(9));

  const material = new MeshStandardNodeMaterial({ metalness: 0.6 });
  material.colorNode = mix(mix(color(0x191b24), color(0x0c1018), glassy), color(0x05060a), pane.mul(wall));
  material.roughnessNode = mix(float(0.55), float(0.18), glassy);
  material.emissiveNode = lightColour.mul(pattern.mul(wall).mul(1.1));
  return material;
}
