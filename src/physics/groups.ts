/**
 * Rapier collision layers. A pair collides only when each one's membership is in
 * the other's filter. Packed as (memberships << 16) | filter.
 */
export const Layer = {
  GROUND: 1 << 0, // drivable surfaces: floor, ramps
  OBSTACLE: 1 << 1, // walls, fixed drift pylons
  CHASSIS: 1 << 2, // car body hull
  WHEEL: 1 << 3, // tyre cylinders on the chassis (side hits only)
  PROP: 1 << 4, // loose dynamic props: traffic cones
  SUSPENSION: 1 << 5, // suspension shape-cast queries
} as const;

export const interactionGroups = (memberships: number, filter: number): number =>
  ((memberships & 0xffff) << 16) | (filter & 0xffff);

export const Groups = {
  ground: interactionGroups(Layer.GROUND, Layer.CHASSIS | Layer.PROP | Layer.SUSPENSION),
  obstacle: interactionGroups(Layer.OBSTACLE, Layer.CHASSIS | Layer.WHEEL | Layer.PROP),
  prop: interactionGroups(Layer.PROP, Layer.GROUND | Layer.OBSTACLE | Layer.CHASSIS | Layer.WHEEL | Layer.PROP),
  chassis: interactionGroups(Layer.CHASSIS, Layer.GROUND | Layer.OBSTACLE | Layer.PROP),
  // Tyres never touch the ground as colliders - the suspension owns that contact.
  wheel: interactionGroups(Layer.WHEEL, Layer.OBSTACLE | Layer.PROP),
  suspensionQuery: interactionGroups(Layer.SUSPENSION, Layer.GROUND),
} as const;
