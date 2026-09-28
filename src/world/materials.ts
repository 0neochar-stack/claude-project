import { Color, MeshBasicMaterial, MeshStandardMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import {
  abs, cameraPosition, color, distance, float, fract, fwidth, max, min, mix, positionLocal, positionWorld,
  smoothstep, step,
} from "three/tsl";

/** 1 on a grid line, 0 elsewhere; anti-aliased with screen-space derivatives. */
function gridLines(spacing: number, widthPx: number) {
  const coord = positionWorld.xz.div(spacing);
  const g = abs(fract(coord.sub(0.5)).sub(0.5)).div(fwidth(coord).mul(widthPx));
  return float(1).sub(min(min(g.x, g.y), 1));
}

/** Dark glossy floor with a 5 m / 25 m neon grid that fades into the fog. */
export function createGridMaterial(): MeshStandardNodeMaterial {
  const minor = gridLines(5, 1);
  const major = gridLines(25, 1.6);
  const fade = float(1).sub(smoothstep(30, 230, distance(positionWorld.xz, cameraPosition.xz)));
  const lineColour = mix(color(0x1a5cff), color(0x00e5ff), major);
  const material = new MeshStandardNodeMaterial({ roughness: 0.32, metalness: 0.1 });
  material.colorNode = color(0x07080d);
  material.emissiveNode = lineColour.mul(max(minor.mul(0.45), major.mul(2.2))).mul(fade);
  return material;
}

/** Traffic cone: neon orange with a bright reflective band (cone geometry centred on its origin). */
export function createConeMaterial(): MeshStandardNodeMaterial {
  const band = step(0.02, positionLocal.y).mul(float(1).sub(step(0.14, positionLocal.y)));
  const material = new MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0 });
  material.colorNode = color(0x2a0d00);
  material.emissiveNode = mix(color(0xff5a00).mul(1.6), color(0xfff4e0).mul(3), band);
  return material;
}

export const neonMaterial = (hex: number, intensity = 4): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(intensity) });

export const darkMetal = (hex = 0x0e1018, roughness = 0.45): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: hex, roughness, metalness: 0.6 });
