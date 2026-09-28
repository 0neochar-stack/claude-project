import type RAPIER from "@dimforge/rapier3d-compat";

export type Rapier = typeof RAPIER;

type ContactListener = (force: number, other: RAPIER.Collider | undefined) => void;

/** Owns the Rapier world and routes contact-force events to whoever registered a collider. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;
  private readonly contactListeners = new Map<number, ContactListener>();

  /**
   * Loads Rapier on demand: the compat build inlines its WASM as base64 (~3 MB),
   * so it gets its own chunk and downloads in parallel with the rest of the boot.
   */
  static async create(): Promise<PhysicsWorld> {
    const { default: R } = await import("@dimforge/rapier3d-compat");
    await R.init();
    return new PhysicsWorld(R);
  }

  private constructor(readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.events = new R.EventQueue(true);
  }

  /** Receive contact-force events for `collider` (it must enable CONTACT_FORCE_EVENTS). */
  onContactForce(collider: RAPIER.Collider, listener: ContactListener): void {
    this.contactListeners.set(collider.handle, listener);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.events);
    this.events.drainContactForceEvents((event) => {
      const a = event.collider1();
      const b = event.collider2();
      const force = event.maxForceMagnitude();
      this.contactListeners.get(a)?.(force, this.world.getCollider(b));
      this.contactListeners.get(b)?.(force, this.world.getCollider(a));
    });
  }
}
