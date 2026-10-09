// Shared helpers for worlds.

// Frees every geometry, material and texture under a root once a world is left.
export function disposeTree(root) {
  const textures = new Set();
  root.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v && v.isTexture) textures.add(v);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture) textures.add(u.value);
      m.dispose?.();
    }
  });
  for (const t of textures) if (!t.userData?.shared) t.dispose();
  root.removeFromParent();
}

// Seeded random numbers so worlds come out the same every time.
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
