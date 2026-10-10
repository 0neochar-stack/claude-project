// Shrinks a downloaded model for shipping: drops the duplicate "Armature|clip" animations some exports
// carry, merges duplicate data, prunes what nothing uses, and quantizes vertex data.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// keep: animation names to ship (others are dropped); omit to keep them all.
// ratio: simplify meshes to about this fraction of their triangles (for models drawn by the thousand).
export async function optimizeModel(src, dst, keep, ratio) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  const names = new Set(root.listAnimations().map((a) => a.getName()));
  for (const a of root.listAnimations()) {
    const short = a.getName().split('|').pop();
    if ((a.getName().includes('|') && names.has(short)) || (keep && !keep.includes(a.getName()))) a.dispose();
  }
  const steps = [weld(), dedup(), resample(), prune()];
  if (ratio) { await MeshoptSimplifier.ready; steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.06 })); }
  await doc.transform(...steps, quantize());
  await io.write(dst, doc);
}
