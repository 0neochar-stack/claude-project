// Downloaded glTF models: loading, and turning them into game-ready pieces.
//
// Static models are baked: every mesh's transform goes into its geometry (the exports come with all sorts of
// unit scales and axis flips), meshes are merged per material, and the result is scaled to a real size in
// metres, centred, and stood on y = 0. Files holding several objects (five trees, three bushes) can be split
// into one variant per object. Placed copies are drawn as InstancedMeshes grouped into tiles that drop out
// past a distance. Animated animals are cloned with their skeletons.
//
// Everything is optional: a model that fails to load is simply missing and the game keeps its own
// procedural version.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MODEL_FILES } from './modelList.js';

const cache = new Map();
let loader = null;

// Loads the given model keys in parallel. Resolves to a map of key -> gltf for the ones that loaded.
export async function loadModels(keys, onProgress) {
  loader ||= new GLTFLoader();
  const base = new URL('models/', document.baseURI);
  let done = 0;
  const out = new Map();
  await Promise.all(keys.map(async (key) => {
    const file = MODEL_FILES[key];
    if (!file) return;
    if (!cache.has(key)) cache.set(key, fetchModel(new URL(`${file}.txt`, base).href).catch((e) => { console.warn(`model ${key} not loaded`, e?.message || e); return null; }));
    const g = await cache.get(key);
    if (g) out.set(key, g);
    onProgress?.(++done / keys.length);
  }));
  return out;
}

// The build ships each .glb as base64 text (the only kind of file the page host serves for it).
async function fetchModel(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bin = atob((await res.text()).trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return loader.parseAsync(bytes.buffer, url.slice(0, url.lastIndexOf('/') + 1));
}

const assocNode = (parser, obj) => {
  for (let o = obj; o; o = o.parent) {
    const a = parser.associations.get(o);
    if (a && a.nodes !== undefined && parser.json.nodes[a.nodes].mesh !== undefined) return o;
  }
  return obj;
};

// Material clean-up for the FBX and OBJ exports: they come through shiny and metallic, and foliage with
// blended alpha that sorts badly. opts.matte forces fully rough, non-metal.
function fixMaterial(m, opts) {
  const mat = m.clone();
  if (mat.metalness !== undefined) mat.metalness = Math.min(mat.metalness, opts.metal ?? 0.15);
  if (mat.roughness !== undefined) mat.roughness = Math.max(mat.roughness, opts.matte ? 0.9 : 0.5);
  if (mat.transparent || mat.alphaTest > 0) {
    mat.transparent = false;
    mat.alphaTest = 0.45;
    mat.side = THREE.DoubleSide;
    mat.depthWrite = true;
  }
  if (opts.tint) mat.color.multiply(new THREE.Color(opts.tint));
  if (mat.map) mat.map.anisotropy = 8;
  opts.material?.(mat);
  return mat;
}

// A plain float copy of an attribute (the shipped models are quantized to normalized integers, which
// can't hold baked positions).
function toFloat(attr) {
  const n = attr.count, k = attr.itemSize, out = new Float32Array(n * k);
  const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * k + c] = get[c].call(attr, i);
  return new THREE.BufferAttribute(out, k);
}

// Bakes a gltf into static variants: [{ parts: [{ geometry, material }], size, radius }].
// opts: split (one variant per object), height | length | scale (sizing; with split, the tallest or
// longest variant gets that size and the rest keep their proportions), rotate (radians about y), sink (m).
export function bakeStatic(gltf, opts = {}) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const key = opts.split ? assocNode(gltf.parser, o).uuid : 'all';
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name: assocNode(gltf.parser, o).name, meshes: [] }));
    g.meshes.push(o);
  });
  const matCache = new Map();
  const rot = new THREE.Matrix4().makeRotationY(opts.rotate || 0);
  let variants = [...groups.values()].map((g) => {
    const byMat = new Map();
    for (const mesh of g.meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const src = mesh.geometry;
      const pieces = mats.length > 1 && src.groups.length ? src.groups.map((gr) => ({ gr, mat: mats[gr.materialIndex] })) : [{ gr: null, mat: mats[0] }];
      for (const { gr, mat } of pieces) {
        let geo = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) if (src.attributes[name]) geo.setAttribute(name, toFloat(src.attributes[name]));
        if (mat.vertexColors && src.attributes.color) geo.setAttribute('color', toFloat(src.attributes.color));
        const n = geo.attributes.position.count;
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        let idx = src.index ? Array.from(src.index.array) : Array.from({ length: n }, (_, i) => i);
        if (gr) idx = idx.slice(gr.start, gr.start + gr.count);
        const m = mesh.matrixWorld.clone().premultiply(rot);
        if (m.determinant() < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
        geo.setIndex(idx);
        geo.applyMatrix4(m);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        let fixed = matCache.get(mat);
        if (!fixed) matCache.set(mat, (fixed = fixMaterial(mat, opts)));
        if (!byMat.has(fixed)) byMat.set(fixed, []);
        byMat.get(fixed).push(geo);
      }
    }
    const parts = [];
    for (const [material, geos] of byMat) {
      const hasColor = geos.every((x) => x.attributes.color);
      for (const x of geos) if (!hasColor) x.deleteAttribute('color');
      parts.push({ geometry: geos.length > 1 ? mergeGeometries(geos) : geos[0], material });
    }
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    return { name: g.name, parts, box };
  });
  // Size: one scale for the whole file so split variants keep their proportions.
  let k = opts.scale || 1;
  if (opts.height) k = opts.height / Math.max(...variants.map((v) => v.box.max.y - v.box.min.y));
  else if (opts.length) k = opts.length / Math.max(...variants.map((v) => Math.max(v.box.max.x - v.box.min.x, v.box.max.z - v.box.min.z)));
  variants = variants.map((v) => {
    const c = v.box.getCenter(new THREE.Vector3());
    const m = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, -v.box.min.y, -c.z));
    if (opts.sink) m.premultiply(new THREE.Matrix4().makeTranslation(0, -opts.sink, 0));
    const box = new THREE.Box3();
    for (const p of v.parts) {
      p.geometry.applyMatrix4(m);
      p.geometry.computeBoundingBox();
      p.geometry.computeBoundingSphere();
      box.union(p.geometry.boundingBox);
    }
    const size = box.getSize(new THREE.Vector3());
    return { name: v.name, parts: v.parts, size, radius: Math.max(size.x, size.z) / 2 };
  });
  return variants;
}

// Places many copies of baked variants, as instanced meshes per tile, with a draw distance.
export class Scatter {
  constructor({ tile = 300, far = 600, shadows = true } = {}) {
    this.tile = tile;
    this.far = far;
    this.shadows = shadows;
    this.items = new Map(); // variant -> [{x, y, z, rot, s, shadow}]
    this.group = new THREE.Group();
    this.tiles = [];
  }

  add(variant, x, y, z, rot = 0, s = 1) {
    if (!variant) return;
    if (!this.items.has(variant)) this.items.set(variant, []);
    this.items.get(variant).push({ x, y, z, rot, s });
  }

  build() {
    const tiles = new Map();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [variant, list] of this.items) {
      const byTile = new Map();
      for (const it of list) {
        const key = `${Math.floor(it.x / this.tile)},${Math.floor(it.z / this.tile)}`;
        if (!byTile.has(key)) byTile.set(key, []);
        byTile.get(key).push(it);
      }
      for (const [key, its] of byTile) {
        let t = tiles.get(key);
        if (!t) {
          tiles.set(key, (t = { group: new THREE.Group(), x: 0, z: 0, n: 0 }));
          this.group.add(t.group);
        }
        for (const it of its) { t.x += it.x; t.z += it.z; t.n++; }
        for (const part of variant.parts) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, its.length);
          its.forEach((it, i) => im.setMatrixAt(i, m4.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.rot), sc.setScalar(it.s))));
          im.computeBoundingSphere();
          im.castShadow = this.shadows;
          im.receiveShadow = true;
          t.group.add(im);
        }
      }
    }
    this.tiles = [...tiles.values()].map((t) => ({ group: t.group, x: t.x / t.n, z: t.z / t.n }));
    return this.group;
  }

  update(cam) {
    const r = this.far + this.tile * 0.7;
    for (const t of this.tiles) t.group.visible = Math.abs(t.x - cam.x) < r && Math.abs(t.z - cam.z) < r;
  }
}

// An animated animal: a skinned clone scaled to height, with its own mixer and clips by name.
export function makeAnimal(gltf, height) {
  const obj = cloneSkinned(gltf.scene);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const k = height / (box.max.y - box.min.y);
  const holder = new THREE.Group();
  obj.scale.multiplyScalar(k);
  obj.position.set(-((box.max.x + box.min.x) / 2) * k, -box.min.y * k, -((box.max.z + box.min.z) / 2) * k);
  holder.add(obj);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false; // skinned bounds don't follow the animation
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m) => fixMaterial(m, { matte: true }));
    if (o.material.length === 1) o.material = o.material[0];
  });
  const mixer = new THREE.AnimationMixer(obj);
  const clips = new Map();
  for (const c of gltf.animations) if (!c.name.includes('|')) clips.set(c.name, c);
  const actions = new Map();
  const action = (name) => {
    if (!actions.has(name)) { const c = clips.get(name); if (!c) return null; actions.set(name, mixer.clipAction(c)); }
    return actions.get(name);
  };
  let current = null;
  return {
    object: holder,
    mixer,
    has: (name) => clips.has(name),
    play(name, fade = 0.35, speed = 1) {
      const a = action(name);
      if (!a || a === current) { if (a) a.timeScale = speed; return; }
      a.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).play();
      if (current) current.crossFadeTo(a, fade, false);
      current = a;
    },
  };
}
