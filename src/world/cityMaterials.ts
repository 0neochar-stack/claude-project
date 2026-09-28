import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node, type Object3D } from "three/webgpu";
import {
  abs, cameraPosition, color, distance, float, floor, fract, hash, instanceIndex, max, min, mix, mx_fractal_noise_float,
  mx_noise_float, normalWorld, positionWorld, reflector, round, sin, smoothstep, step, time, vec2, vec3,
} from "three/tsl";

type FloatNode = Node<"float">;

/** Street grid shared by the layout and the road shader. */
export const CITY = {
  pitch: 80, // road centreline spacing (m)
  road: 20, // road width, kerb to kerb
  sidewalk: 4,
  kerb: 0.15, // sidewalk height
} as const;

/**
 * Wet asphalt with a real-time mirror: puddles (fractal-noise mask) are glassy and
 * reflect the neon city, rain ripples distort the reflection, and lane markings,
 * dashed centre lines and crosswalks are painted procedurally from the street grid.
 * Returns the material plus the reflector target, which must be added to the scene.
 */
export function createWetAsphalt(): { material: MeshStandardNodeMaterial; reflectorTarget: Object3D } {
  const p = positionWorld.xz;

  // --- Puddles and rain ripples.
  const puddle = smoothstep(0.3, 0.44, mx_fractal_noise_float(vec3(p.mul(0.05), 0), 3));
  const ripplePhase = time.mul(2.2);
  const ripple = mx_noise_float(vec3(p.mul(3.2), ripplePhase)).mul(0.6)
    .add(mx_noise_float(vec3(p.mul(9), ripplePhase.mul(1.7))).mul(0.4));
  const grain = mx_noise_float(vec3(p.mul(1.7), 0)).mul(0.5).add(0.5);

  // --- Markings, from the distance to the nearest road centreline on each axis.
  const { pitch, road } = CITY;
  const half = road / 2;
  const rx = abs(positionWorld.x.sub(round(positionWorld.x.div(pitch)).mul(pitch)));
  const rz = abs(positionWorld.z.sub(round(positionWorld.z.div(pitch)).mul(pitch)));
  const onRoadX = step(rx, half); // on a road running along Z
  const onRoadZ = step(rz, half); // on a road running along X
  const junction = onRoadX.mul(onRoadZ);
  const thin = (d: FloatNode, w: number) => float(1).sub(smoothstep(w * 0.6, w, d));
  const dashZ = step(fract(positionWorld.z.div(9)), 0.5);
  const dashX = step(fract(positionWorld.x.div(9)), 0.5);
  const centre = thin(rx, 0.12).mul(dashZ).mul(onRoadX).add(thin(rz, 0.12).mul(dashX).mul(onRoadZ)).mul(float(1).sub(junction));
  const edge = thin(abs(rx.sub(half - 0.7)), 0.1).mul(float(1).sub(onRoadZ))
    .add(thin(abs(rz.sub(half - 0.7)), 0.1).mul(float(1).sub(onRoadX)));
  const zebraBandZ = step(half + 1, rz).mul(step(rz, half + 4.5)).mul(step(rx, half - 1)).mul(step(fract(positionWorld.x.div(1.3)), 0.5));
  const zebraBandX = step(half + 1, rx).mul(step(rx, half + 4.5)).mul(step(rz, half - 1)).mul(step(fract(positionWorld.z.div(1.3)), 0.5));
  const paint = min(float(1), centre.add(edge).add(zebraBandZ).add(zebraBandX));
  const centreLine = min(float(1), thin(rx, 0.12).mul(onRoadX).add(thin(rz, 0.12).mul(onRoadZ)));
  const paintColour = mix(color(0xd8e4ff), color(0xffc247), centreLine);

  // --- Mirror reflection, distorted by ripples, strongest in puddles and at grazing angles.
  const reflection = reflector({ resolutionScale: 0.4 });
  reflection.target.rotateX(-Math.PI / 2);
  reflection.uvNode = reflection.uvNode!.add(vec2(ripple.mul(0.006).add(grain.mul(0.004)), ripple.mul(0.004)));
  const view = positionWorld.sub(cameraPosition).normalize();
  const grazing = float(1).sub(abs(view.y)).pow(3);
  const wetness = mix(float(0.03), float(0.9), puddle).mul(mix(0.55, 1, grazing)).mul(float(1).sub(paint.mul(0.6)));

  const material = new MeshStandardNodeMaterial({ metalness: 0 });
  material.colorNode = mix(color(0x0b0c10).mul(mix(0.7, 1.2, grain)), paintColour.mul(0.55), paint).mul(mix(1, 0.55, puddle));
  material.roughnessNode = mix(mix(float(0.68), float(0.03), puddle), float(0.4), paint);
  material.normalNode = normalWorld.add(vec3(ripple.mul(0.05).mul(puddle), 0, ripple.mul(0.05).mul(puddle))).normalize();
  material.emissiveNode = reflection.rgb.mul(wetness);
  return { material, reflectorTarget: reflection.target };
}

/** Wet concrete slabs with expansion joints. */
export function createSidewalk(): MeshStandardNodeMaterial {
  const p = positionWorld.xz;
  const joints = max(step(fract(p.x.div(2.5)), 0.03), step(fract(p.y.div(2.5)), 0.03));
  const damp = mx_noise_float(vec3(p.mul(0.3), 0)).mul(0.5).add(0.5);
  const material = new MeshStandardNodeMaterial({ metalness: 0 });
  material.colorNode = mix(color(0x2a2c35), color(0x14151b), joints.max(damp.mul(0.4)));
  material.roughnessNode = mix(float(0.18), float(0.5), damp);
  return material;
}

/**
 * Towers: dark glass-and-concrete facades with procedurally lit windows (one draw
 * call for every building). Each tower gets its own light colour and occupancy, and
 * a bright shopfront band at street level.
 */
export function createBuildingMaterial(): MeshStandardNodeMaterial {
  const seed = float(instanceIndex).mul(17.13);
  const n = normalWorld;
  const side = step(0.5, abs(n.x)); // faces pointing along X use Z as the horizontal axis
  const u = mix(positionWorld.x, positionWorld.z, side);
  const v = positionWorld.y;
  const cell = vec2(u.div(2.2), v.div(3.2));
  const id = floor(cell);
  const f = fract(cell);
  const pane = step(0.22, f.x).mul(step(f.x, 0.78)).mul(step(0.3, f.y)).mul(step(f.y, 0.72));
  const occupancy = mix(float(0.35), float(0.75), hash(seed));
  const lit = step(hash(id.x.mul(12.9898).add(id.y.mul(78.233)).add(seed)), occupancy);
  const flicker = mix(float(0.6), float(1.25), hash(id.x.add(id.y.mul(3.7)).add(seed.mul(2))));
  const tint = hash(seed.add(4.2));
  const warm = mix(color(0xffb36b), color(0x9fd8ff), step(0.55, tint));
  const windowColour = mix(warm, color(0xff5fd7), step(0.88, tint));
  const walls = float(1).sub(step(0.5, abs(n.y)));
  const upperFloors = step(4.2, v);
  const windows = pane.mul(lit).mul(flicker).mul(walls).mul(upperFloors);
  const shopfront = walls.mul(step(0.6, v)).mul(step(v, 3.4)).mul(step(0.1, f.x)).mul(step(f.x, 0.9));
  const shopColour = mix(color(0x00e5ff), color(0xff2bd6), step(0.5, hash(seed.add(9.1))));

  const material = new MeshStandardNodeMaterial({ roughness: 0.28, metalness: 0.55 });
  material.colorNode = mix(color(0x0d0f16), color(0x05060a), pane);
  material.emissiveNode = windowColour.mul(windows.mul(0.75)).add(shopColour.mul(shopfront.mul(1.1)));
  return material;
}

/** Neon signs: per-instance colour (setColorAt), with a few buzzing and flickering. */
export function createSignMaterial(): MeshBasicNodeMaterial {
  const seed = float(instanceIndex);
  const flickers = step(0.85, hash(seed.add(3.3)));
  const buzz = step(0.12, fract(sin(time.mul(hash(seed).mul(9).add(4)).add(seed)).mul(43758.5)));
  const intensity = mix(float(1), buzz, flickers).mul(mix(4, 7, hash(seed.add(1.7))));
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec3(intensity);
  return material;
}

/** Street lamp heads: cool white, slightly warmer toward the far end of the city. */
export function createLampMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const fade = smoothstep(40, 260, distance(positionWorld.xz, cameraPosition.xz));
  material.colorNode = mix(color(0xe8f2ff).mul(9), color(0xffc58a).mul(7), fade);
  return material;
}
