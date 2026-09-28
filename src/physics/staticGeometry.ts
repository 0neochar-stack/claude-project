import { Groups } from "./groups";
import type { PhysicsWorld } from "./PhysicsWorld";

/**
 * Flat ground as a grid of box tiles with their top face at y = 0. One huge box
 * breaks down numerically: past a few hundred metres, a quarter of suspension shape
 * casts miss it outright. 50 m tiles are exact apart from rare seam misses, which
 * the suspension's ray fallback covers.
 */
export function addGroundTiles(physics: PhysicsWorld, halfExtent: number, tile = 50): void {
  const { R, world } = physics;
  for (let x = -halfExtent + tile / 2; x < halfExtent; x += tile) {
    for (let z = -halfExtent + tile / 2; z < halfExtent; z += tile) {
      world.createCollider(
        R.ColliderDesc.cuboid(tile / 2, 0.5, tile / 2)
          .setTranslation(x, -0.5, z)
          .setCollisionGroups(Groups.ground)
          .setFriction(0.8),
      );
    }
  }
}
