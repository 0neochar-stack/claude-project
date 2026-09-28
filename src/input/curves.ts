import { clamp } from "../core/math";

/**
 * Axial deadzone with rescaling: values inside `inner` read 0, the remaining
 * range is stretched back to 0..1 so there is no jump at the edge, and the last
 * `outer` of travel reads as full lock (worn sticks rarely reach 1.0).
 */
export function applyDeadzone(value: number, inner: number, outer = 0): number {
  const magnitude = Math.abs(value);
  if (magnitude <= inner) return 0;
  const scaled = clamp((magnitude - inner) / (1 - inner - outer), 0, 1);
  return Math.sign(value) * scaled;
}

/** Response curve: exponent > 1 softens the centre for precise small corrections. */
export function applyResponseCurve(value: number, exponent: number): number {
  return Math.sign(value) * Math.abs(value) ** exponent;
}

/** Radial deadzone for a 2-D stick, so diagonals are not squashed. */
export function applyRadialDeadzone(x: number, y: number, inner: number): { x: number; y: number } {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= inner) return { x: 0, y: 0 };
  const scaled = Math.min(1, (magnitude - inner) / (1 - inner));
  return { x: (x / magnitude) * scaled, y: (y / magnitude) * scaled };
}
