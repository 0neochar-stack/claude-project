// Shrinks a downloaded model for shipping: drops the duplicate "Armature|clip" animations some exports
// carry, merges duplicate data, prunes what nothing uses, and quantizes vertex data.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample, weld } from '@gltf-transform/functions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// keep: animation names to ship (others are dropped); omit to keep them all.
export async function optimizeModel(src, dst, keep) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  const names = new Set(root.listAnimations().map((a) => a.getName()));
  for (const a of root.listAnimations()) {
    const short = a.getName().split('|').pop();
    if ((a.getName().includes('|') && names.has(short)) || (keep && !keep.includes(a.getName()))) a.dispose();
  }
  await doc.transform(weld(), dedup(), resample(), prune(), quantize());
  await io.write(dst, doc);
}
