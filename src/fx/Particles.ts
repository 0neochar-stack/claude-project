import {
  DynamicDrawUsage, InstancedBufferAttribute, Mesh, NormalBlending, PlaneGeometry, SpriteNodeMaterial, Vector3,
} from "three/webgpu";
import {
  cameraPosition, color, distance, float, instancedDynamicBufferAttribute, mx_noise_float, smoothstep, uv, vec3,
} from "three/tsl";

export interface ParticleStyle {
  max: number;
  colour: number;
  /** Peak opacity. */
  opacity: number;
  sizeStart: number;
  /** Size growth, m/s. */
  sizeGrowth: number;
  life: [number, number];
  /** Velocity damping, 1/s. */
  drag: number;
  /** Upward acceleration (buoyancy), m/s². */
  lift: number;
}

/**
 * Soft billboard particles simulated on the CPU (a few hundred) and drawn as one
 * instanced sprite batch. Used for drift smoke and wet-road spray.
 */
export class Particles {
  readonly mesh: Mesh;
  private readonly position: InstancedBufferAttribute;
  private readonly size: InstancedBufferAttribute;
  private readonly alpha: InstancedBufferAttribute;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly strength: Float32Array;
  private next = 0;

  constructor(private readonly style: ParticleStyle) {
    const n = style.max;
    this.position = new InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
    this.size = new InstancedBufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage);
    this.alpha = new InstancedBufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage);
    this.velocity = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(Infinity);
    this.life = new Float32Array(n).fill(1);
    this.strength = new Float32Array(n);

    const centre = uv().sub(0.5).length().mul(2);
    const wisps = mx_noise_float(vec3(uv().mul(3.5), float(0))).mul(0.35).add(0.65); // break up the perfect disc
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: NormalBlending });
    material.positionNode = instancedDynamicBufferAttribute(this.position);
    material.scaleNode = instancedDynamicBufferAttribute(this.size);
    material.colorNode = color(style.colour);
    const clearOfLens = smoothstep(2.5, 7, distance(instancedDynamicBufferAttribute(this.position, "vec3"), cameraPosition));
    material.opacityNode = float(1).sub(smoothstep(0.2, 1, centre)).mul(wisps).mul(clearOfLens)
      .mul(instancedDynamicBufferAttribute(this.alpha, "float"));
    this.mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this.mesh.count = n;
    this.mesh.frustumCulled = false;
  }

  emit(at: Vector3, velocity: Vector3, strength: number, spread: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.style.max;
    const [a, b] = this.style.life;
    this.age[i] = 0;
    this.life[i] = a + Math.random() * (b - a);
    this.strength[i] = strength;
    this.position.setXYZ(i, at.x, at.y, at.z);
    this.velocity[i * 3] = velocity.x + (Math.random() - 0.5) * spread;
    this.velocity[i * 3 + 1] = velocity.y + Math.random() * spread * 0.5;
    this.velocity[i * 3 + 2] = velocity.z + (Math.random() - 0.5) * spread;
  }

  update(dt: number): void {
    const { drag, lift, sizeStart, sizeGrowth, opacity } = this.style;
    const damping = Math.exp(-drag * dt);
    const p = this.position.array as Float32Array;
    const s = this.size.array as Float32Array;
    const o = this.alpha.array as Float32Array;
    for (let i = 0; i < this.style.max; i++) {
      const age = (this.age[i] += dt);
      const t = age / this.life[i]!;
      if (t >= 1) {
        o[i] = 0;
        s[i] = 0;
        continue;
      }
      const v = i * 3;
      this.velocity[v]! *= damping;
      this.velocity[v + 1] = this.velocity[v + 1]! * damping + lift * dt;
      this.velocity[v + 2]! *= damping;
      p[v]! += this.velocity[v]! * dt;
      p[v + 1] = Math.max(0.05, p[v + 1]! + this.velocity[v + 1]! * dt);
      p[v + 2]! += this.velocity[v + 2]! * dt;
      s[i] = sizeStart + sizeGrowth * age;
      o[i] = opacity * this.strength[i]! * Math.min(1, age * 12) * (1 - t) ** 1.6;
    }
    this.position.needsUpdate = true;
    this.size.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
