// Landmarks and roadside detail: the pier's pilings and its Ferris wheel lit up at night, and the touge's
// signage — chevron boards round the hairpins, orange convex curve mirrors, and speed limit signs.
import * as THREE from 'three';
import { heightAt, rng } from './layout.js';

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildLandmarks(net, heights) {
  const group = new THREE.Group();
  const colliders = [];
  const animated = [];
  const R = rng(4242);

  // ---------- pier ----------
  const pier = net.byId.pier;
  {
    const S = pier.samples;
    const deckY = S[0].y;
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a5240, roughness: 0.95 });
    const piles = [];
    for (let i = 4; i < S.length; i += 3) {
      const p = S[i];
      const sea = heightAt(heights, p.x, p.z);
      if (sea > deckY - 1.5) continue;
      for (const lat of [-pier.hw + 0.4, -pier.hw / 3, pier.hw / 3, pier.hw - 0.4]) piles.push([p.x - p.tz * lat, sea - 1, p.z + p.tx * lat, deckY - sea + 0.6]);
    }
    const pg = new THREE.CylinderGeometry(0.22, 0.26, 1, 6).translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(pg, wood, piles.length);
    const m4 = new THREE.Matrix4();
    piles.forEach(([x, y, z, h], i) => pm.setMatrixAt(i, m4.makeScale(1, h, 1).setPosition(x, y, z)));
    pm.computeBoundingSphere();
    group.add(pm);
    // Deck fascia and cross beams under the planks.
    const first = S.findIndex((p) => heightAt(heights, p.x, p.z) < deckY - 1.5);
    const a = S[Math.max(0, first)], b = S[S.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(pier.width + 0.4, 0.6, len), wood);
    deck.position.set((a.x + b.x) / 2, deckY - 0.32, (a.z + b.z) / 2);
    deck.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    group.add(deck);
    // Ferris wheel on a platform off the end, turning slowly, lit with chasing colours at night.
    const end = S[S.length - 1];
    const cx = end.x + 16, cz = end.z + 6, hubY = deckY + 17, rad = 14;
    const platform = new THREE.Mesh(new THREE.BoxGeometry(22, 1, 22), wood);
    platform.position.set(cx, deckY - 0.5, cz);
    group.add(platform);
    for (const [dx, dz] of [[-9, -9], [9, -9], [-9, 9], [9, 9], [0, 0]]) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, deckY + 12, 6), wood);
      pile.position.set(cx + dx, (deckY - 12) / 2, cz + dz);
      group.add(pile);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0xe8e8ec, metalness: 0.6, roughness: 0.35 });
    // A-frame legs.
    for (const s of [-1, 1]) for (const k of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, hubY - deckY + 1, 6), steel);
      leg.position.set(cx + k * 4.2, (hubY + deckY) / 2, cz + s * 1.6);
      leg.rotation.z = -k * 0.24;
      group.add(leg);
    }
    const wheel = new THREE.Group();
    wheel.position.set(cx, hubY, cz);
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.14, 6, 64), steel);
      rim.position.z = s * 1.1;
      wheel.add(rim);
    }
    const SPOKES = 16;
    for (let k = 0; k < SPOKES; k++) {
      const a2 = (k / SPOKES) * Math.PI * 2;
      for (const s of [-1, 1]) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, rad, 0.08), steel);
        spoke.position.set(Math.cos(a2) * rad / 2, Math.sin(a2) * rad / 2, s * 1.1);
        spoke.rotation.z = a2 - Math.PI / 2;
        wheel.add(spoke);
      }
    }
    // Bulbs: points on the rim, coloured per point and chased round at night.
    const bulbs = 96;
    const bp = new Float32Array(bulbs * 2 * 3), bc = new Float32Array(bulbs * 2 * 3);
    for (let k = 0; k < bulbs; k++) for (const [j, s] of [[0, -1], [1, 1]]) {
      const a2 = (k / bulbs) * Math.PI * 2;
      bp.set([Math.cos(a2) * (rad + 0.2), Math.sin(a2) * (rad + 0.2), s * 1.1], (k * 2 + j) * 3);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    bg.setAttribute('color', new THREE.BufferAttribute(bc, 3));
    const bulbMat = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true });
    wheel.add(new THREE.Points(bg, bulbMat));
    // Gondolas hang from the rim and stay level.
    const gondolas = [];
    const gMats = [0xff4a6a, 0x3ac8ff, 0xffd23a, 0x6aff8a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    for (let k = 0; k < 16; k++) {
      const g = new THREE.Group();
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 1.6), gMats[k % 4]);
      cab.position.y = -1.2;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.6, 4), steel);
      roof.position.y = -0.2;
      roof.rotation.y = Math.PI / 4;
      g.add(cab, roof);
      wheel.add(g);
      gondolas.push({ g, a: (k / 16) * Math.PI * 2 });
    }
    group.add(wheel);
    colliders.push({ type: 'circle', x: cx, z: cz, r: 6 });
    animated.push((t, night) => {
      const spin = t * 0.08;
      wheel.rotation.z = spin;
      for (const gd of gondolas) {
        const a2 = gd.a;
        gd.g.position.set(Math.cos(a2) * rad, Math.sin(a2) * rad, 0);
        gd.g.rotation.z = -spin;
      }
      const c = new THREE.Color();
      for (let k = 0; k < bulbs; k++) {
        const hue = (k / bulbs + t * 0.05) % 1;
        const chase = 0.55 + 0.45 * Math.sin(k * 0.6 - t * 6);
        c.setHSL(hue, 0.9, 0.55).multiplyScalar((0.2 + night * 1.3) * chase);
        bc.set([c.r, c.g, c.b], k * 6);
        bc.set([c.r, c.g, c.b], k * 6 + 3);
      }
      bg.attributes.color.needsUpdate = true;
    });
  }

  // ---------- touge signage ----------
  const chevronTex = canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = '#f2c21a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111';
    g.beginPath(); g.moveTo(W * 0.3, H * 0.12); g.lineTo(W * 0.72, H * 0.5); g.lineTo(W * 0.3, H * 0.88); g.lineTo(W * 0.18, H * 0.76); g.lineTo(W * 0.48, H * 0.5); g.lineTo(W * 0.18, H * 0.24); g.closePath(); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
  });
  const speedTex = canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(W / 2, H / 2, 62, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d4141e'; g.lineWidth = 14; g.beginPath(); g.arc(W / 2, H / 2, 54, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#1a3aa0'; g.font = 'bold 58px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('40', W / 2, H / 2 + 3);
  });
  const chevronMat = new THREE.MeshStandardMaterial({ map: chevronTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: chevronTex, emissiveIntensity: 0 });
  const speedMat = new THREE.MeshStandardMaterial({ map: speedTex, transparent: true, alphaTest: 0.5, roughness: 0.5, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.6, roughness: 0.4 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 });
  const mirror = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.04 });
  const posts = [], boards = [], mirrors = [];
  for (const id of ['touge', 'ridge']) {
    const road = net.byId[id];
    const S = road.samples;
    let lastMirror = -999, lastSpeed = -999;
    for (let i = 6; i < S.length - 6; i++) {
      const a = S[i - 6], c = S[i + 6];
      const turn = a.tx * c.tz - a.tz * c.tx; // + turning left
      const tight = Math.abs(turn) > 0.55;
      const p = S[i];
      // turn > 0 is a right-hand bend; its outside is on the left, which is -(-tz, tx).
      const side = turn > 0 ? -1 : 1;
      const off = road.hw + (road.gutter || 0) + 1.0;
      const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
      if (tight && i % 3 === 0) {
        // Chevron boards facing back into the bend, arrow pointing the way it turns.
        const y = heightAt(heights, x, z);
        const face = Math.atan2(p.tz * side, -p.tx * side); // toward the road
        posts.push({ x, y, z, h: 1.5 });
        boards.push({ x, y: y + 1.25, z, rot: face, flip: turn < 0 });
      }
      if (tight && p.s - lastMirror > 120) {
        lastMirror = p.s;
        const y = heightAt(heights, x, z);
        posts.push({ x, y, z, h: 3.0, orange: true });
        mirrors.push({ x, y: y + 3.0, z, rot: Math.atan2(-p.tx, -p.tz) });
        colliders.push({ type: 'circle', x, z, r: 0.18 });
      }
      if (!tight && p.s - lastSpeed > 420 && Math.abs(turn) < 0.1) {
        lastSpeed = p.s;
        const so = road.hw + (road.gutter || 0) + 1.2;
        const sx = p.x + p.tz * so, sz = p.z - p.tx * so; // right-hand side
        const y = heightAt(heights, sx, sz);
        posts.push({ x: sx, y, z: sz, h: 2.2 });
        const sm = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), speedMat);
        sm.position.set(sx, y + 2.1, sz);
        sm.rotation.y = Math.atan2(-p.tx, -p.tz);
        group.add(sm);
      }
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const grey = posts.filter((p) => !p.orange), orng = posts.filter((p) => p.orange);
  for (const [list, mat] of [[grey, postMat], [orng, orange]]) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6).translate(0, 0.5, 0), mat, list.length);
    list.forEach((p, i) => im.setMatrixAt(i, m4.compose(v.set(p.x, p.y, p.z), q.identity(), sc.set(1, p.h, 1))));
    im.computeBoundingSphere();
    group.add(im);
  }
  if (boards.length) {
    const bgeo = new THREE.PlaneGeometry(0.6, 0.6);
    const flipGeo = bgeo.clone();
    const uv = flipGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    for (const [geo, list] of [[bgeo, boards.filter((b) => !b.flip)], [flipGeo, boards.filter((b) => b.flip)]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, chevronMat, list.length);
      list.forEach((b, i) => im.setMatrixAt(i, m4.compose(v.set(b.x, b.y, b.z), q.setFromAxisAngle(up, b.rot), sc.set(1, 1, 1))));
      im.computeBoundingSphere();
      group.add(im);
    }
  }
  for (const mr of mirrors) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 20), orange);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, 0.6).rotateX(Math.PI / 2), mirror);
    glass.scale.z = 0.5;
    g.add(ring, glass);
    g.position.set(mr.x, mr.y, mr.z);
    g.rotation.y = mr.rot;
    group.add(g);
  }
  void R;
  return {
    group,
    colliders,
    update(t, night) {
      for (const f of animated) f(t, night);
      chevronMat.emissiveIntensity = night * 0.35; // catching the headlights
    },
  };
}
