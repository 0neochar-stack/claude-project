// Street lights. Posts are instanced per style; heads glow and throw a soft pool of light on the ground
// at night (an additive decal, no real lights, so hundreds cost almost nothing).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { radialTexture } from '../../fx.js';

// Per style: post geometry (local +x points toward the road), head positions, light colour and reach.
function styleParts(style) {
  const parts = [];
  const heads = [];
  const metal = (g) => parts.push(g);
  if (style === 'cobra' || style === 'mountain') {
    const h = style === 'mountain' ? 7.5 : 8.8, arm = style === 'mountain' ? 1.8 : 2.4;
    metal(new THREE.CylinderGeometry(0.09, 0.14, h, 7).translate(0, h / 2, 0));
    metal(new THREE.CylinderGeometry(0.05, 0.05, arm, 5).rotateZ(Math.PI / 2 - 0.12).translate(arm / 2, h - 0.05, 0));
    heads.push({ x: arm + 0.25, y: h + 0.05, z: 0, w: 0.7, d: 0.32 });
  } else if (style === 'twin') {
    const h = 10;
    metal(new THREE.CylinderGeometry(0.11, 0.16, h, 7).translate(0, h / 2, 0));
    for (const s of [-1, 1]) {
      metal(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5).rotateZ(Math.PI / 2 - 0.1 * s).translate(s * 1.3, h, 0));
      heads.push({ x: s * 2.7, y: h + 0.05, z: 0, w: 0.7, d: 0.32 });
    }
  } else if (style === 'lot') {
    const h = 10.5;
    metal(new THREE.CylinderGeometry(0.12, 0.16, h, 7).translate(0, h / 2, 0));
    metal(new THREE.BoxGeometry(2.0, 0.12, 0.12).translate(0, h, 0));
    for (const s of [-1, 1]) heads.push({ x: s * 0.9, y: h - 0.12, z: 0, w: 0.6, d: 0.6 });
  } else if (style === 'lantern') {
    metal(new THREE.BoxGeometry(0.16, 2.6, 0.16).translate(0, 1.3, 0));
    metal(new THREE.BoxGeometry(0.5, 0.08, 0.5).translate(0, 3.15, 0));
    heads.push({ x: 0, y: 2.85, z: 0, w: 0.4, d: 0.4, h: 0.55 });
  }
  return { post: mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; })), heads };
}
const STYLE = {
  cobra: { color: 0xfff0d8, pool: 7.5, poolColor: 0xffe2b8 },
  mountain: { color: 0xffa040, pool: 8, poolColor: 0xff9a3a },
  twin: { color: 0xffb060, pool: 11, poolColor: 0xffa858 },
  lot: { color: 0xf4f8ff, pool: 12, poolColor: 0xdfe8ff },
  lantern: { color: 0xffb46a, pool: 5, poolColor: 0xff9a50 },
};

export function buildLamps(roadLamps, townLamps, preset, groundAt) {
  const group = new THREE.Group();
  const colliders = [];
  const all = [...roadLamps, ...townLamps];
  const byStyle = {};
  for (const l of all) (byStyle[l.style] ||= []).push(l);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6a6e74, metalness: 0.6, roughness: 0.45 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 });
  const headMats = [];
  const pools = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (const [style, list] of Object.entries(byStyle)) {
    const { post, heads } = styleParts(style);
    const st = STYLE[style];
    const posts = new THREE.InstancedMesh(post, style === 'lantern' ? woodMat : postMat, list.length);
    const headGeo = mergeGeometries(heads.map((h) => new THREE.BoxGeometry(h.w, h.h || 0.16, h.d).translate(h.x, h.y, h.z)));
    const headMat = new THREE.MeshBasicMaterial({ color: st.color });
    headMat.userData.base = new THREE.Color(st.color);
    headMats.push(headMat);
    const headMesh = new THREE.InstancedMesh(headGeo, headMat, list.length);
    list.forEach((l, i) => {
      const rot = Math.atan2(-(l.nz || 0), l.nx || 1);
      q.setFromAxisAngle(up, rot);
      m4.compose(p.set(l.x, l.y, l.z), q, one);
      posts.setMatrixAt(i, m4);
      headMesh.setMatrixAt(i, m4);
      if (style !== 'twin') colliders.push({ type: 'circle', x: l.x, z: l.z, r: 0.22 });
      for (const h of heads) {
        const hx = l.x + Math.cos(rot) * h.x + Math.sin(rot) * h.z, hz = l.z - Math.sin(rot) * h.x + Math.cos(rot) * h.z;
        pools.push({ x: hx, z: hz, y: groundAt(hx, hz), r: st.pool, color: st.poolColor });
      }
    });
    for (const m of [posts, headMesh]) { m.computeBoundingSphere(); group.add(m); }
    posts.castShadow = true;
  }
  // Light pools.
  const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, opacity: 0 });
  const poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), poolMat, Math.max(1, pools.length));
  const c = new THREE.Color();
  pools.forEach((pl, i) => {
    m4.compose(p.set(pl.x, pl.y + 0.08, pl.z), q.identity(), new THREE.Vector3(pl.r, 1, pl.r));
    poolMesh.setMatrixAt(i, m4);
    poolMesh.setColorAt(i, c.set(pl.color).multiplyScalar(0.32));
  });
  poolMesh.count = pools.length;
  poolMesh.computeBoundingSphere();
  poolMesh.frustumCulled = false;
  group.add(poolMesh);
  void preset;
  return {
    group,
    colliders,
    setNight(n) {
      const on = Math.min(1, Math.max(0, (n - 0.2) / 0.4));
      for (const m of headMats) m.color.copy(m.userData.base).multiplyScalar(0.2 + on * 1.6);
      poolMat.opacity = on * 0.4;
      poolMesh.visible = on > 0.01;
    },
    update() {},
  };
}
