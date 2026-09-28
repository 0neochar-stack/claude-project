import { BackSide, DoubleSide, MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import {
  abs, cameraPosition, color, distance, exp, float, floor, fract, hash, instanceIndex, max, min, mix, mx_fractal_noise_float,
  mx_noise_float, normalWorld, positionLocal, positionWorld, round, sin, smoothstep, step, time, uv, vec2, vec3,
} from "three/tsl";

/** Freeway cross-section, metres from the centre line (UV u = 0..1 spans ±HALF_WIDTH). */
export const FREEWAY = {
  halfWidth: 15,
  median: 0.6, // median barrier half width
  laneLines: [5.3, 9], // dashed lane dividers
  innerEdge: 1.6,
  outerEdge: 12.7,
  lightSpacing: 60, // overhead light poles along the median
  lightReach: 7, // lamp heads this far either side of the median
} as const;

/**
 * Freeway asphalt: mostly dry with the odd rain puddle (glassy, rippling, reflecting
 * the skyline through the environment map), US-style lane markings, and warm pools
 * of light under the overhead lamps. UV: u across the road, v = metres along it.
 */
export function createFreewayAsphalt(): MeshStandardNodeMaterial {
  const s = abs(uv().x.sub(0.5)).mul(FREEWAY.halfWidth * 2); // distance from centre line
  const v = uv().y;
  const p = positionWorld.xz;

  const puddle = smoothstep(0.3, 0.42, mx_fractal_noise_float(vec3(p.mul(0.06), 0), 3));
  const ripple = mx_noise_float(vec3(p.mul(4), time.mul(2.4))).mul(puddle);
  const grain = mx_noise_float(vec3(p.mul(2.1), 0)).mul(0.5).add(0.5);
  const tyreLanes = sin(s.mul(Math.PI / 1.85)).abs().mul(0.12); // darker, polished wheel paths

  const line = (at: number, width: number) => float(1).sub(smoothstep(width * 0.5, width, abs(s.sub(at))));
  const dashes = step(fract(v.div(12)), 0.25); // 3 m dash, 9 m gap
  const [laneA, laneB] = FREEWAY.laneLines;
  const white = line(FREEWAY.outerEdge, 0.12).add(line(laneA, 0.08).add(line(laneB, 0.08)).mul(dashes));
  const yellow = line(FREEWAY.innerEdge, 0.1);
  const paint = min(float(1), white.add(yellow));
  const paintColour = mix(color(0xcfd6e6), color(0xf2b233), yellow);

  // Overhead lamps: a pool of warm light on each carriageway under every pole.
  const along = v.sub(round(v.div(FREEWAY.lightSpacing)).mul(FREEWAY.lightSpacing));
  const pool = exp(along.mul(along).add(s.sub(FREEWAY.lightReach).pow(2)).div(-2 * 8.5 * 8.5));

  const asphalt = color(0x16171b).mul(mix(0.75, 1.15, grain)).mul(float(1).sub(tyreLanes));
  const material = new MeshStandardNodeMaterial({ metalness: 0 });
  material.colorNode = mix(asphalt, paintColour.mul(0.6), paint).mul(mix(1, 0.5, puddle));
  material.roughnessNode = mix(mix(float(0.72), float(0.55), tyreLanes.mul(4)), float(0.04), puddle);
  material.normalNode = normalWorld.add(vec3(ripple.mul(0.06), 0, ripple.mul(0.06))).normalize();
  material.emissiveNode = color(0xffcf9a).mul(pool).mul(mix(0.05, 0.22, puddle).add(paint.mul(0.12)));
  return material;
}

/** Concrete jersey barriers; the median carries a cyan neon strip, the outer ones amber reflectors. */
export function createBarrierMaterial(neonStrip: boolean): MeshStandardNodeMaterial {
  const v = uv().y;
  const h = positionLocal.y;
  const material = new MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
  const stain = mx_noise_float(vec3(positionWorld.xz.mul(0.4), h.mul(2))).mul(0.5).add(0.5);
  material.colorNode = mix(color(0x3a3b42), color(0x23242a), stain.mul(smoothstep(0.6, 0, h)));
  if (neonStrip) {
    material.emissiveNode = color(0x00e5ff).mul(smoothstep(0.98, 1.05, h).mul(2.2));
  } else {
    const reflector = step(fract(v.div(10)), 0.02).mul(step(0.7, h)).mul(step(h, 0.8));
    material.emissiveNode = color(0xffa640).mul(reflector.mul(3));
  }
  return material;
}

/** LA night sky: navy zenith, violet mid-sky, orange light pollution on the horizon, a few stars. */
export function createSkyMaterial(): MeshBasicNodeMaterial {
  const dir = positionLocal.normalize();
  const y = max(dir.y, 0);
  const horizon = color(0xff7040).mul(0.55);
  const mid = color(0x3b1f5e).mul(0.55);
  const zenith = color(0x05061a);
  const sky = mix(mix(horizon, mid, smoothstep(0, 0.12, y)), zenith, smoothstep(0.1, 0.55, y));
  const cell = floor(dir.mul(420));
  const star = step(0.9985, hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113)))).mul(smoothstep(0.15, 0.5, y)).mul(0.8);
  const material = new MeshBasicNodeMaterial({ side: BackSide, fog: false, depthWrite: false });
  material.colorNode = sky.add(vec3(star));
  return material;
}

/**
 * The basin floor: dark ground near the car, turning into a sea of sodium street
 * lights (a hashed street grid) with distance, the way LA looks from a freeway.
 */
export function createBasinMaterial(): MeshStandardNodeMaterial {
  const p = positionWorld.xz;
  const block = vec2(96, 72);
  const inBlock = fract(p.div(block));
  const blockId = floor(p.div(block));
  // Streets run along the block edges.
  const street = max(step(0.465, abs(inBlock.x.sub(0.5))), step(0.465, abs(inBlock.y.sub(0.5))));
  const lampCell = floor(p.div(11));
  const lampSeed = hash(lampCell.x.mul(7.1).add(lampCell.y.mul(13.7)));
  const lampDot = float(1).sub(smoothstep(0.08, 0.3, fract(p.div(11)).sub(0.5).length()));
  const blockLit = step(0.12, hash(blockId.x.mul(3.3).add(blockId.y.mul(9.1))));
  const lamps = street.mul(lampDot).mul(step(0.35, lampSeed)).mul(blockLit);
  const houses = step(0.992, hash(floor(p.div(3.5)).x.add(floor(p.div(3.5)).y.mul(91.7)))).mul(float(1).sub(street));
  const far = smoothstep(160, 420, distance(p, cameraPosition.xz));
  const lampColour = mix(color(0xff9a3c), color(0xe8f0ff), step(0.82, lampSeed));

  const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  material.colorNode = color(0x0b0b0e);
  material.emissiveNode = lampColour.mul(lamps.mul(3).add(houses.mul(1.4))).mul(far);
  return material;
}

/** Palm silhouettes: near-black with a faint rim from the city glow. */
export function createPalmMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, side: DoubleSide });
  material.colorNode = color(0x0c0e0c);
  return material;
}

/** Holographic billboard ads: per-billboard palette, scrolling bands and a pulsing logo. */
export function createBillboardMaterial(): MeshBasicNodeMaterial {
  const seed = float(instanceIndex).mul(7.31);
  const q = uv();
  const a = mix(color(0xff2bd6), color(0x00e5ff), hash(seed));
  const b = mix(color(0xffb000), color(0x6a3cff), hash(seed.add(1)));
  const bands = sin(q.y.mul(18).add(time.mul(mix(0.8, 2.4, hash(seed.add(2))))).add(q.x.mul(4))).mul(0.5).add(0.5);
  const logo = float(1).sub(smoothstep(0.16, 0.2, q.sub(vec2(0.72, 0.5)).mul(vec2(2.6, 1)).length()));
  const ring = logo.mul(sin(time.mul(3).add(seed)).mul(0.25).add(0.75));
  const scan = sin(q.y.mul(220)).mul(0.08).add(0.92);
  const frame = max(step(q.x, 0.015), max(step(0.985, q.x), max(step(q.y, 0.04), step(0.96, q.y))));
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.colorNode = mix(mix(a, b, bands).mul(2.2), vec3(3), ring.mul(0.7)).mul(scan).add(vec3(frame.mul(2)));
  return material;
}
