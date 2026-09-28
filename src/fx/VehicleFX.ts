import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, Vector3, type Scene,
} from "three/webgpu";
import { attribute, color } from "three/tsl";
import type { ArcadeVehicle, WheelState } from "../physics/vehicle/ArcadeVehicle";
import { Particles } from "./Particles";

const SKID_SEGMENTS = 3000;
const SKID_WIDTH = 0.26;
const SKID_STEP = 0.3; // metres between skid segments

/**
 * Everything the tyres leave behind: drift smoke from the rear wheels, spray
 * kicked up off the wet road, and skid marks laid on the asphalt.
 */
export class VehicleFX {
  private readonly smoke = new Particles({
    max: 900, colour: 0x8f8ea6, opacity: 0.2, sizeStart: 0.6, sizeGrowth: 1.6, life: [1.6, 2.6], drag: 1.4, lift: 0.7,
  });
  private readonly spray = new Particles({
    max: 700, colour: 0x9fb8ec, opacity: 0.12, sizeStart: 0.35, sizeGrowth: 1.6, life: [0.35, 0.7], drag: 3, lift: -2,
  });
  private readonly skids: SkidMarks;
  private readonly smokeDebt = new Map<string, number>();
  private readonly tmp = new Vector3();
  private readonly vel = new Vector3();

  constructor(scene: Scene) {
    this.skids = new SkidMarks();
    scene.add(this.smoke.mesh, this.spray.mesh, this.skids.mesh);
  }

  update(dt: number, car: ArcadeVehicle): void {
    const t = car.telemetry;
    const v = car.body.linvel();
    for (const w of car.wheels) {
      const slip = this.wheelSlip(car, w);
      this.skids.track(w, slip);
      if (!w.contact) continue;

      // Drift / burnout smoke from the driven wheels.
      if (!w.front && slip > 0.15) {
        const debt = (this.smokeDebt.get(w.id) ?? 0) + dt * 70 * slip;
        let n = Math.floor(debt);
        this.smokeDebt.set(w.id, debt - n);
        while (n-- > 0) {
          this.tmp.copy(w.contactPoint).setY(w.contactPoint.y + 0.25);
          this.vel.set(v.x * 0.2, 0.6, v.z * 0.2);
          this.smoke.emit(this.tmp, this.vel, Math.min(1, slip * 1.4), 1.2);
        }
      }
      // Wet-road spray behind every tyre at speed.
      if (t.speed > 9 && Math.random() < dt * t.speed * 0.9) {
        this.tmp.copy(w.contactPoint).setY(w.contactPoint.y + 0.15);
        this.vel.set(v.x * 0.55, 1.4, v.z * 0.55);
        this.spray.emit(this.tmp, this.vel, Math.min(1, t.speed / 40), 1.6);
      }
    }
    this.smoke.update(dt);
    this.spray.update(dt);
  }

  reset(): void {
    this.skids.clear();
  }

  /** 0..1: how hard this tyre is sliding (sideways slip, wheelspin, or a locked rear). */
  private wheelSlip(car: ArcadeVehicle, w: WheelState): number {
    const t = car.telemetry;
    if (!w.contact || t.speed < 2) return 0;
    const lateral = Math.min(1, Math.max(0, (Math.abs(w.slipAngle) - 0.12) / 0.5));
    const rear = w.front ? 0 : Math.max(t.wheelspin, t.brakeLock * 0.8);
    return Math.max(lateral, rear);
  }
}

/** Ring buffer of quads laid behind each sliding tyre. */
class SkidMarks {
  readonly mesh: Mesh;
  private readonly positions = new Float32Array(SKID_SEGMENTS * 4 * 3);
  private readonly alphas = new Float32Array(SKID_SEGMENTS * 4);
  private readonly geometry = new BufferGeometry();
  private readonly last = new Map<string, Vector3>();
  private next = 0;
  private used = 0;
  private readonly side = new Vector3();

  constructor() {
    const index = new Uint32Array(SKID_SEGMENTS * 6);
    for (let i = 0; i < SKID_SEGMENTS; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.setAttribute("position", new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute("skidAlpha", new BufferAttribute(this.alphas, 1).setUsage(DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    material.colorNode = color(0x040405);
    material.opacityNode = attribute("skidAlpha", "float").mul(0.7);
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  track(w: WheelState, slip: number): void {
    if (slip < 0.2) {
      this.last.delete(w.id);
      return;
    }
    const at = w.contactPoint.clone().addScaledVector(w.contactNormal, 0.015);
    const prev = this.last.get(w.id);
    if (!prev) {
      this.last.set(w.id, at);
      return;
    }
    if (prev.distanceToSquared(at) < SKID_STEP * SKID_STEP) return;
    this.side.subVectors(at, prev).cross(w.contactNormal).normalize().multiplyScalar(SKID_WIDTH / 2);
    const i = this.next;
    const p = this.positions;
    p.set([prev.x - this.side.x, prev.y, prev.z - this.side.z, prev.x + this.side.x, prev.y, prev.z + this.side.z,
      at.x - this.side.x, at.y, at.z - this.side.z, at.x + this.side.x, at.y, at.z + this.side.z], i * 12);
    this.alphas.fill(Math.min(1, slip), i * 4, i * 4 + 4);
    this.next = (i + 1) % SKID_SEGMENTS;
    this.used = Math.min(SKID_SEGMENTS, this.used + 1);
    this.geometry.setDrawRange(0, this.used * 6);
    this.geometry.getAttribute("position").needsUpdate = true;
    this.geometry.getAttribute("skidAlpha").needsUpdate = true;
    this.last.set(w.id, at);
  }

  clear(): void {
    this.used = 0;
    this.next = 0;
    this.last.clear();
    this.geometry.setDrawRange(0, 0);
  }
}
