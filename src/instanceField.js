// Huge numbers of placed copies (trees, bushes, grass, rocks, street props) drawn cheaply.
//
// Copies are bucketed into square cells. Every frame the cells in front of the camera are picked, each
// at a level of detail for its distance, and their precomputed matrices are copied into one
// InstancedMesh per kind, level and part, so the draw-call count stays at a few dozen however many
// copies there are, and nothing behind the camera or past its range is drawn at all.
//
// Shadows: only the nearest level casts them, so far copies never go through the shadow pass.
import * as THREE from 'three';

const _frusta = [], _dir = new THREE.Vector3(), _m = new THREE.Matrix4(), _box = new THREE.Box3(), _v = new THREE.Vector3();
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class InstanceField {
  // cell: cell size (m). shadows: whether the nearest levels cast shadows at all.
  constructor({ cell = 64, shadows = true } = {}) {
    this.cellSize = cell;
    this.shadows = shadows;
    this.kinds = new Map(); // id -> { lods: [{ parts, dist }], height, shadow, items: [] }
    this.group = new THREE.Group();
    this.group.name = 'instance-field';
    this.cells = [];
    this.stamp = -1;
    this.enabled = true;
    this.lodScale = 1;
  }

  // lods: [{ parts: [[geometry, material]], dist }], nearest first; past the last dist the kind isn't drawn.
  // height: rough top of a copy, for culling. shadow: whether the nearest level casts shadows.
  // color: copies carry their own colour (instanceColor).
  addKind(id, { lods, height = 10, shadow = true, color = false }) {
    this.kinds.set(id, { id, lods: lods.filter((l) => l.parts.length), height, shadow, color, items: [] });
  }

  add(id, x, y, z, rot = 0, s = 1, color = null) {
    const k = this.kinds.get(id);
    if (k && k.lods.length) k.items.push(x, y, z, rot, s, color ? color.r : 1, color ? color.g : 1, color ? color.b : 1);
  }

  count(id) { const k = this.kinds.get(id); return k ? k.items.length / 8 : 0; }

  build() {
    const C = this.cellSize;
    const cells = new Map();
    for (const k of this.kinds.values()) {
      const it = k.items, n = it.length / 8;
      if (!n) continue;
      // Bucket by cell.
      const byCell = new Map();
      for (let i = 0; i < n; i++) {
        const key = `${Math.floor(it[i * 8] / C)},${Math.floor(it[i * 8 + 2] / C)}`;
        let l = byCell.get(key);
        if (!l) byCell.set(key, (l = []));
        l.push(i);
      }
      for (const [key, idx] of byCell) {
        let c = cells.get(key);
        if (!c) {
          const [cx, cz] = key.split(',').map(Number);
          cells.set(key, (c = { x0: cx * C, z0: cz * C, y0: Infinity, y1: -Infinity, slots: [] }));
        }
        const mats = new Float32Array(idx.length * 16);
        const cols = k.color ? new Float32Array(idx.length * 3) : null;
        let maxS = 0;
        idx.forEach((i, j) => {
          const b = i * 8;
          _m.compose(_v.set(it[b], it[b + 1], it[b + 2]), _q.setFromAxisAngle(_up, it[b + 3]), _s.setScalar(it[b + 4]));
          _m.toArray(mats, j * 16);
          if (cols) { cols[j * 3] = it[b + 5]; cols[j * 3 + 1] = it[b + 6]; cols[j * 3 + 2] = it[b + 7]; }
          c.y0 = Math.min(c.y0, it[b + 1]);
          maxS = Math.max(maxS, it[b + 4]);
          c.y1 = Math.max(c.y1, it[b + 1] + k.height * it[b + 4]);
        });
        c.slots.push({ kind: k, mats, cols, n: idx.length, pad: k.height * maxS * 0.5 });
      }
      k.items = null; // matrices live in the cells now
    }
    this.cells = [...cells.values()];
    // One mesh per kind, level and part, sized for every copy of the kind; plus the shadow casters.
    for (const k of this.kinds.values()) {
      const total = this.cells.reduce((a, c) => a + c.slots.filter((s) => s.kind === k).reduce((b, s) => b + s.n, 0), 0);
      k.total = total;
      k.meshes = k.lods.map((l, i) => l.parts.map(([geo, mat]) => this.#mesh(geo, mat, total, k.color, this.shadows && k.shadow && i === 0)));
    }
    return this.group;
  }

  #mesh(geo, mat, n, color, shadow) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (color) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3).setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    im.frustumCulled = false; // culled per cell here
    im.castShadow = shadow;
    im.receiveShadow = false;
    this.group.add(im);
    return im;
  }

  // camera: the view camera. Picks the visible cells and their levels, and refills the meshes when that
  // choice changes.
  // camera: one camera, or several (split screen) - a cell is drawn if any of them sees it, at the
  // detail the nearest one needs.
  update(camera) {
    if (!this.enabled) return;
    const cams = Array.isArray(camera) ? camera : [camera];
    // Only re-pick when a camera has moved 3 m or turned 2 degrees (cells are padded to cover the gap).
    const last = (this.lastCams ||= []);
    let same = last.length === cams.length && this.lastScale === this.lodScale;
    cams.forEach((cam, i) => {
      cam.getWorldDirection(_dir);
      const l = (last[i] ||= { p: new THREE.Vector3(1e9, 0, 0), d: new THREE.Vector3() });
      if (l.p.distanceToSquared(cam.position) > 9 || l.d.dot(_dir) < 0.9994) same = false;
    });
    if (same) return;
    last.length = cams.length;
    cams.forEach((cam, i) => { last[i].p.copy(cam.position); cam.getWorldDirection(last[i].d); });
    this.lastScale = this.lodScale;
    const frusta = cams.map((cam, i) => {
      cam.updateMatrixWorld();
      _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      return (_frusta[i] ||= new THREE.Frustum()).setFromProjectionMatrix(_m);
    });
    const C = this.cellSize;
    const ls = this.lodScale; // detail ranges shrink when the frame rate needs it
    const half = C * 0.7071;
    const pick = [];
    // A running hash of which cells were picked at which level: unchanged means nothing to refill.
    let stamp = 0;
    for (let ci = 0; ci < this.cells.length; ci++) {
      const c = this.cells[ci];
      const mx = c.x0 + C / 2, mz = c.z0 + C / 2;
      let d = Infinity;
      for (const cam of cams) d = Math.min(d, Math.max(0, Math.hypot(mx - cam.position.x, mz - cam.position.z) - half));
      let inView = null; // tested lazily
      for (const s of c.slots) {
        const lods = s.kind.lods;
        if (d > lods[lods.length - 1].dist * (lods.length > 1 ? 1 : ls)) continue;
        if (inView === null) {
          _box.min.set(c.x0 - s.pad - 6, c.y0 - 4, c.z0 - s.pad - 6);
          _box.max.set(c.x0 + C + s.pad + 6, c.y1 + 4, c.z0 + C + s.pad + 6);
          inView = frusta.some((f) => f.intersectsBox(_box));
        }
        if (!inView) continue;
        let lod = 0;
        while (lod < lods.length - 1 && d > lods[lod].dist * ls) lod++;
        pick.push(s, lod);
        stamp = (Math.imul(stamp, 31) + ci * 8 + lod + 1) | 0;
      }
    }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    for (const k of this.kinds.values()) for (const ms of k.meshes) for (const m of ms) m.count = 0;
    for (let i = 0; i < pick.length; i += 2) for (const m of pick[i].kind.meshes[pick[i + 1]]) this.#put(m, pick[i]);
    for (const k of this.kinds.values()) {
      for (const m of k.meshes.flat()) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, m.count * 16);
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) {
          m.instanceColor.clearUpdateRanges();
          m.instanceColor.addUpdateRange(0, m.count * 3);
          m.instanceColor.needsUpdate = true;
        }
        m.visible = m.count > 0;
      }
    }
  }

  #put(m, s) {
    m.instanceMatrix.array.set(s.mats, m.count * 16);
    if (m.instanceColor && s.cols) m.instanceColor.array.set(s.cols, m.count * 3);
    m.count += s.n;
  }
}

// Flat stand-ins for distant trees: each model is drawn once from the side into a texture, and shown as
// two crossed cards. renderer: the game's renderer. parts: [[geometry, material]]. Returns parts.
export function impostor(renderer, parts, { size = 256 } = {}) {
  const scene = new THREE.Scene();
  const box = new THREE.Box3();
  for (const [g, m] of parts) {
    const mesh = new THREE.Mesh(g, plainMaterial(m));
    scene.add(mesh);
    g.computeBoundingBox();
    box.union(g.boundingBox);
  }
  scene.add(new THREE.AmbientLight(0xffffff, 1.4), new THREE.DirectionalLight(0xffffff, 1.6).translateX(2).translateY(4).translateZ(5));
  const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z), h = box.max.y - box.min.y;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, box.max.y, box.min.y, -100, 100);
  cam.position.set((box.max.x + box.min.x) / 2, 0, 50);
  cam.lookAt((box.max.x + box.min.x) / 2, 0, 0);
  const H = Math.min(512, Math.round((size * h) / w / 8) * 8) || size;
  const rt = new THREE.WebGLRenderTarget(size, Math.max(32, H), { samples: 0 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  rt.texture.anisotropy = 4;
  const prev = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), color: renderer.getClearColor(new THREE.Color()), shadow: renderer.shadowMap.enabled };
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.color, prev.alpha);
  renderer.shadowMap.enabled = prev.shadow;
  for (const o of scene.children) if (o.isMesh) o.material.dispose();
  // Two crossed cards, lit from above so neither goes dark against the sun.
  const cx = (box.max.x + box.min.x) / 2;
  const cards = [0, Math.PI / 2].map((a) => new THREE.PlaneGeometry(w, h).translate(0, box.min.y + h / 2, 0).rotateY(a));
  const geo = new THREE.BufferGeometry();
  const pos = [], uv = [], nor = [];
  for (const c of cards) {
    const ci = c.toNonIndexed();
    pos.push(...ci.attributes.position.array);
    uv.push(...ci.attributes.uv.array);
    for (let i = 0; i < ci.attributes.position.count; i++) nor.push(0, 1, 0);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.translate(cx * 0, 0, 0);
  // A little self-light from the texture: flat cards facing up catch less sun than a real crown does.
  const mat = new THREE.MeshStandardMaterial({ map: rt.texture, emissiveMap: rt.texture, emissive: 0xffffff, emissiveIntensity: 0.35, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  mat.userData.impostor = true;
  return [[geo, mat]];
}

// A copy of a material without any vertex-shader tweaks (wind), for drawing a model on its own.
function plainMaterial(m) {
  const c = m.clone();
  c.onBeforeCompile = () => {};
  c.customProgramCacheKey = () => 'plain';
  return c;
}
