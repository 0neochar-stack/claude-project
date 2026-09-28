import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  abs, bumpMap, cameraPosition, color, dot, float, floor, fract, hash, instanceIndex, min, mix, normalWorld, positionWorld,
  smoothstep, step, vec3,
} from "three/tsl";

/**
 * Photographic tower facades, one material for every building (per-tower variety
 * comes from the instance hash):
 *  - window style: glass curtain wall, ribbon windows or punched openings
 *  - cladding: concrete, dark metal, limestone, bronze, white panels, blue spandrel glass
 *  - interior mapping: each window looks into a real 3-D room (back wall, side walls,
 *    floor, ceiling with a light panel) that shifts with parallax as you drive past;
 *    rooms are lit or dark, warm or cool, with blinds at different heights
 *  - mullions and recessed glass via a bump map; glass reflects the captured skyline
 * Works on boxes and cylinders of any rotation: the horizontal axis follows each face.
 */
export function createFacadeMaterial(): MeshStandardNodeMaterial {
  const seed = float(instanceIndex).mul(13.37);
  const r = (k: number) => hash(seed.add(k));
  const n = normalWorld;
  const wall = float(1).sub(step(0.6, abs(n.y)));
  const tangent = vec3(n.z.negate(), 0, n.x).normalize();
  const u = dot(positionWorld, tangent);
  const v = positionWorld.y;

  // --- Grid and window style.
  const cellW = mix(float(1.8), float(3.4), r(1));
  const floorH = mix(float(3.3), float(4.1), r(2));
  const cellU = u.div(cellW);
  const cellV = v.div(floorH);
  const idU = floor(cellU);
  const idV = floor(cellV);
  const fu = fract(cellU);
  const fv = fract(cellV);
  const style = r(3);
  const curtain = step(style, 0.45);
  const ribbon = step(0.45, style).mul(step(style, 0.75));
  const winW = mix(mix(float(0.5), float(1.04), ribbon), float(0.93), curtain);
  const winH = mix(mix(float(0.55), float(0.5), ribbon), float(0.86), curtain);
  const gx = abs(fu.sub(0.5)).mul(2).div(winW);
  const gy = abs(fv.sub(0.53)).mul(2).div(winH);
  const glass = float(1).sub(smoothstep(0.96, 1, gx)).mul(float(1).sub(smoothstep(0.96, 1, gy))).mul(wall);
  const mullion = step(0.985, fract(cellU.mul(2))).mul(curtain); // extra vertical split on curtain walls

  // --- Interior mapping: march from the glass into a room of depth D.
  const depth = mix(float(4), float(8), r(4));
  const view = positionWorld.sub(cameraPosition).normalize();
  const dir = vec3(dot(view, tangent).div(cellW), view.y.div(floorH), dot(view, n).negate().div(depth));
  const tx = step(0, dir.x).sub(fu).div(dir.x);
  const ty = step(0, dir.y).sub(fv).div(dir.y);
  const tz = float(1).div(dir.z.max(0.001));
  const tHit = min(min(tx, ty), tz);
  const hit = vec3(fu, fv, 0).add(dir.mul(tHit));
  const back = step(tz, min(tx, ty));
  const floorOrCeiling = step(ty, tx).mul(float(1).sub(back));
  const ceiling = floorOrCeiling.mul(step(0, dir.y));
  const side = float(1).sub(back).sub(floorOrCeiling);
  const roomSeed = idU.mul(12.9898).add(idV.mul(78.233)).add(seed);
  const occupancy = mix(float(0.3), float(0.78), r(5));
  const shop = step(v, floorH.mul(1.15)); // ground-floor retail is always lit
  const lit = step(hash(roomSeed), occupancy).max(shop);
  const temp = hash(roomSeed.add(3.1));
  const towerTemp = r(6);
  const lamp = mix(mix(color(0xffc98a), color(0xf2f5ff), step(0.5, towerTemp.add(temp.mul(0.3)))), color(0x9fd9ff), step(0.93, temp));
  const panel = ceiling.mul(step(abs(hit.x.sub(0.5)), 0.28)).mul(step(abs(hit.z.sub(0.5)), 0.22));
  const surface = back.mul(0.5).add(side.mul(0.3)).add(floorOrCeiling.mul(mix(0.15, 0.35, ceiling)));
  const desks = back.mul(step(hit.y, 0.32)).mul(hash(roomSeed.add(floor(hit.x.mul(3)))).mul(0.6));
  const falloff = mix(1, 0.4, hit.z.min(1));
  const brightness = mix(float(0.6), float(1.3), hash(roomSeed.add(7.7)));
  const interior = lamp.mul(surface.sub(desks).max(0).mul(falloff).add(panel.mul(1.3))).mul(brightness).mul(lit);
  const blindsDown = hash(roomSeed.add(5.3)).mul(0.9);
  const blind = step(float(1).sub(blindsDown), fv.sub(0.53).div(winH).add(0.5)).mul(step(0.35, hash(roomSeed.add(9))));
  const roomColour = mix(interior, lamp.mul(0.35).mul(lit), blind).add(color(0x0a1426).mul(0.08));

  // --- Cladding.
  const clad = r(7);
  const claddingColour = mix(mix(mix(color(0x8c9199), color(0x2a2d34), step(0.25, clad)), mix(color(0xb9ae9b), color(0x4b3a2c), step(0.62, clad)), step(0.45, clad)),
    mix(color(0xd9dbde), color(0x1d2b36), step(0.9, clad)), step(0.8, clad));
  const stains = hash(floor(u.div(0.7)).add(floor(v.div(9)).mul(31)).add(seed)).mul(0.12);

  const material = new MeshStandardNodeMaterial();
  material.colorNode = mix(claddingColour.mul(float(1).sub(stains)), color(0x06080c), glass).mul(float(1).sub(mullion.mul(0.5)));
  material.roughnessNode = mix(mix(float(0.75), float(0.4), step(0.25, clad).mul(step(clad, 0.45))), float(0.06), glass);
  material.metalnessNode = mix(mix(float(0.05), float(0.7), step(0.25, clad).mul(step(clad, 0.45))), float(0.15), glass);
  material.emissiveNode = roomColour.mul(glass).mul(0.85);
  // Glass sits recessed behind the frame; floor slabs and mullions stand proud.
  material.normalNode = bumpMap(float(1).sub(glass.mul(0.8)).add(mullion.mul(0.5)), float(0.06));
  return material;
}
