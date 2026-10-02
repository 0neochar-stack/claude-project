// Street furniture and building details: a library of low-poly models plus a static batcher.
//
// Every model is a list of parts (geometry in model space, a material class, a colour, optional atlas region).
// The batcher bakes each placed copy into one merged mesh per material class per city chunk, with colours in
// the vertex data, so hundreds of different models cost a few draw calls and off-screen chunks are culled.
import * as THREE from 'three';
import { LAYER_MAIN_ONLY } from './wet.js';

const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

// ---------- parts ----------
function part(geo, cls, color, uv = null) {
  if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
  return { geo, cls, color: color instanceof THREE.Color ? color : C(color), uv };
}
const tr = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  if (rx) geo.rotateX(rx);
  if (rz) geo.rotateZ(rz);
  if (ry) geo.rotateY(ry);
  return geo.translate(x, y, z);
};
const box = (w, h, d, x, y, z, cls, color, r = [0, 0, 0]) => part(tr(new THREE.BoxGeometry(w, h, d), x, y, z, ...r), cls, color);
const cyl = (rt, rb, h, seg, x, y, z, cls, color, r = [0, 0, 0]) => part(tr(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, ...r), cls, color);
const sph = (rad, x, y, z, cls, color, sx = 1, sy = 1, sz = 1, detail = 0) => part(new THREE.IcosahedronGeometry(rad, detail).scale(sx, sy, sz).translate(x, y, z), cls, color);
// Flat panel facing +z (rotate with ry), mapped to an atlas region.
const panel = (w, h, x, y, z, ry, cls, color, uv) => part(tr(new THREE.PlaneGeometry(w, h), x, y, z, 0, ry), cls, color, uv);
// A rod between two points.
function rod(a, b, r, cls, color, seg = 4) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  const m = va.clone().add(vb).multiplyScalar(0.5);
  return part(g.translate(m.x, m.y, m.z), cls, color);
}

// ---------- palette ----------
const P = {
  steel: 0x5c6069, dark: 0x1c1d24, black: 0x0b0b0e, white: 0xe8e8e2, concrete: 0x6e6a73, wood: 0x6b4a32, darkwood: 0x3e2a1d,
  red: 0xc8202c, orange: 0xf06a1a, yellow: 0xe8c21a, green: 0x2f6b3a, leaf: 0x1d3b26, leaf2: 0x24502e, blue: 0x1f58c9, cream: 0xe9e4d4,
  rubber: 0x121214, chrome: 0xb8bcc6, cardboard: 0x9a7650, teal: 0x2a6f6a,
};

// ---------- the model library ----------
// Models face +z (toward the street when placed against a wall) and sit on y = 0.
export function buildModels(glow, lit) {
  const G = (n) => glow.uv(n), L = (n) => lit.uv(n);
  const M = {};

  // 1-3. Bus stop: shelter with glass, a bench, a backlit ad and a lit roof; pole with timetable; standalone bench.
  for (let v = 0; v < 8; v++) {
    M[`busShelter${v}`] = [
      box(3.7, 0.1, 1.7, 0, 2.55, 0, 'satin', P.dark),
      box(3.5, 0.03, 0.05, 0, 2.48, 0.8, 'glow', C(0xcfe8ff, 3)),
      ...[[-1.75, -0.7], [1.75, -0.7], [-1.75, 0.7], [1.75, 0.7]].map(([x, z]) => box(0.08, 2.5, 0.08, x, 1.25, z, 'metal', P.steel)),
      box(3.4, 2.0, 0.03, 0, 1.25, -0.72, 'glass', C(0x9fc7ff, 0.9)),
      box(0.03, 2.0, 1.2, -1.75, 1.25, -0.05, 'glass', C(0x9fc7ff, 0.9)),
      box(0.2, 2.1, 1.3, 1.78, 1.2, 0, 'satin', P.dark),
      panel(1.1, 1.65, 1.89, 1.2, 0, Math.PI / 2, 'signGlow', C(0xffffff, 1.5), G(`p${v}`)),
      panel(1.1, 1.65, 1.67, 1.2, 0, -Math.PI / 2, 'signGlow', C(0xffffff, 1.5), G(`p${(v + 3) % 8}`)),
      box(2.6, 0.06, 0.42, -0.2, 0.48, -0.42, 'satin', P.wood),
      box(2.6, 0.4, 0.05, -0.2, 0.75, -0.64, 'satin', P.wood),
      ...[-1.3, 0.9].map((x) => box(0.06, 0.45, 0.4, x, 0.23, -0.42, 'metal', P.steel)),
      panel(0.5, 1.0, -0.9, 1.6, -0.7, 0, 'signLit', C(0xffffff), L('timetable')),
    ];
  }
  M.busPole = [
    cyl(0.04, 0.04, 2.8, 6, 0, 1.4, 0, 'metal', P.steel),
    panel(0.55, 0.55, 0, 2.65, 0.03, 0, 'signLit', C(0xffffff), L('bus')),
    panel(0.55, 0.55, 0, 2.65, -0.03, Math.PI, 'signLit', C(0xffffff), L('bus')),
    box(0.3, 0.6, 0.05, 0, 1.6, 0, 'satin', P.green),
    panel(0.26, 0.52, 0, 1.6, 0.03, 0, 'signLit', C(0xffffff), L('timetable')),
  ];
  M.bench = [
    ...[0, 1, 2].map((k) => box(1.8, 0.04, 0.12, 0, 0.45, -0.15 + k * 0.15, 'matte', P.wood)),
    ...[0, 1].map((k) => box(1.8, 0.1, 0.03, 0, 0.62 + k * 0.14, -0.25, 'matte', P.wood)),
    ...[-0.75, 0.75].map((x) => box(0.05, 0.45, 0.45, x, 0.22, -0.05, 'metal', P.dark)),
  ];
  // 4. Free-standing ad lightbox.
  for (let v = 0; v < 8; v++) {
    M[`adBox${v}`] = [
      box(1.3, 2.1, 0.22, 0, 1.25, 0, 'satin', P.dark),
      panel(1.12, 1.68, 0, 1.3, 0.115, 0, 'signGlow', C(0xffffff, 1.4), G(`p${v}`)),
      panel(1.12, 1.68, 0, 1.3, -0.115, Math.PI, 'signGlow', C(0xffffff, 1.4), G(`p${(v + 5) % 8}`)),
      box(0.5, 0.2, 0.3, 0, 0.1, 0, 'satin', P.dark),
    ];
  }
  // 5-6. Street trees in steel grates, one strung with fairy lights.
  const canopy = (k) => [
    sph(1.5, 0, 4.4, 0, 'matte', P.leaf, 1, 0.8, 1),
    sph(1.1, 0.7, 5.3, 0.3, 'matte', P.leaf2, 1, 0.85, 1),
    sph(1.0, -0.6, 5.1, -0.4, 'matte', k ? P.leaf2 : P.leaf, 1, 0.9, 1),
  ];
  M.tree = [
    cyl(0.13, 0.18, 4, 6, 0, 2, 0, 'matte', P.darkwood),
    ...canopy(0),
    box(1.3, 0.03, 1.3, 0, 0.015, 0, 'metal', P.dark),
  ];
  M.treeLit = [...M.tree];
  for (let k = 0; k < 18; k++) {
    const a = k * 1.3, y = 3.4 + (k / 18) * 2.6, r = 1.5 - (k / 18) * 0.6;
    M.treeLit.push(box(0.07, 0.07, 0.07, Math.cos(a) * r, y, Math.sin(a) * r, 'glow', C(k % 3 ? 0xffd27a : 0xff7ad9, 3)));
  }
  // 7. Convex traffic mirror on an orange pole.
  M.trafficMirror = [
    cyl(0.04, 0.04, 3.2, 6, 0, 1.6, 0, 'satin', P.orange),
    panel(0.8, 0.8, 0, 3.0, 0.08, 0, 'signLit', C(0xffffff), L('mirror')),
    cyl(0.42, 0.42, 0.08, 14, 0, 3.0, 0.03, 'satin', P.orange, [Math.PI / 2, 0, 0]),
  ];
  // 8. Fire hydrant.
  M.hydrant = [
    cyl(0.14, 0.16, 0.6, 10, 0, 0.3, 0, 'satin', P.red),
    sph(0.15, 0, 0.62, 0, 'satin', P.red, 1, 0.6, 1),
    cyl(0.05, 0.05, 0.42, 6, 0, 0.42, 0, 'metal', P.chrome, [0, 0, Math.PI / 2]),
    cyl(0.04, 0.04, 0.2, 6, 0, 0.75, 0, 'metal', P.yellow),
  ];
  // 9. Parking meter.
  M.meter = [
    cyl(0.04, 0.04, 1.1, 6, 0, 0.55, 0, 'metal', P.steel),
    box(0.22, 0.38, 0.16, 0, 1.25, 0, 'satin', P.dark),
    box(0.14, 0.08, 0.01, 0, 1.33, 0.081, 'glow', C(0x7dff6a, 2)),
  ];
  // 10-13. Road signs on poles.
  const roadSign = (name, size = 0.6, h = 2.6) => [
    cyl(0.035, 0.035, h, 6, 0, h / 2, 0, 'metal', P.steel),
    panel(size, size, 0, h - size / 2, 0.035, 0, 'signLit', C(0xffffff), L(name)),
    panel(size, size, 0, h - size / 2, 0.025, Math.PI, 'matte', P.steel),
  ];
  M.signSpeed = roadSign('speed');
  M.signNoParking = roadSign('noparking');
  M.signCrossing = roadSign('crossing');
  M.signStop = roadSign('stop', 0.7, 2.2);
  // 14. Street name plates.
  for (let v = 0; v < 4; v++) {
    M[`streetName${v}`] = [
      cyl(0.04, 0.04, 3.2, 6, 0, 1.6, 0, 'metal', P.steel),
      panel(1.2, 0.6, 0.62, 3.0, 0.02, 0, 'signLit', C(0xffffff), L(`street${v}`)),
      panel(1.2, 0.6, 0.62, 3.0, -0.02, Math.PI, 'signLit', C(0xffffff), L(`street${v}`)),
    ];
  }
  // 15. Bicycle (side-on along x).
  const wheel = (x) => part(new THREE.TorusGeometry(0.31, 0.022, 3, 12).translate(x, 0.33, 0), 'matte', P.rubber);
  for (const [v, col] of [[0, 0x1f58c9], [1, 0xc8202c], [2, 0xe9e4d4], [3, 0x2f6b3a]].map(([a, b]) => [a, b])) {
    M[`bicycle${v}`] = [
      wheel(-0.52), wheel(0.52),
      rod([-0.52, 0.33, 0], [0, 0.35, 0], 0.018, 'satin', col), rod([0, 0.35, 0], [-0.12, 0.85, 0], 0.018, 'satin', col),
      rod([-0.52, 0.33, 0], [-0.12, 0.85, 0], 0.016, 'satin', col), rod([-0.12, 0.85, 0], [0.42, 0.88, 0], 0.018, 'satin', col),
      rod([0, 0.35, 0], [0.42, 0.88, 0], 0.02, 'satin', col), rod([0.42, 0.88, 0], [0.52, 0.33, 0], 0.018, 'satin', col),
      rod([0.42, 0.88, 0], [0.38, 1.02, 0], 0.016, 'metal', P.chrome), box(0.04, 0.03, 0.5, 0.38, 1.03, 0, 'matte', P.black),
      box(0.24, 0.06, 0.1, -0.14, 0.92, 0, 'matte', P.black), box(0.3, 0.2, 0.3, 0.6, 0.85, 0, 'metal', P.steel),
    ];
  }
  // 16. Bike rack.
  M.bikeRack = [0, 1, 2, 3].flatMap((k) => [
    rod([-0.35, 0, k * 0.7], [-0.35, 0.75, k * 0.7], 0.025, 'metal', P.chrome), rod([0.35, 0, k * 0.7], [0.35, 0.75, k * 0.7], 0.025, 'metal', P.chrome),
    rod([-0.35, 0.75, k * 0.7], [0.35, 0.75, k * 0.7], 0.025, 'metal', P.chrome),
  ]);
  // 17. Scooter.
  for (const [v, col] of [[0, 0xe8e8e2], [1, 0x3fb7a6], [2, 0xc8202c]]) {
    M[`scooter${v}`] = [
      part(new THREE.TorusGeometry(0.2, 0.06, 4, 12).translate(-0.55, 0.26, 0), 'matte', P.rubber),
      part(new THREE.TorusGeometry(0.2, 0.06, 4, 12).translate(0.6, 0.26, 0), 'matte', P.rubber),
      box(1.0, 0.25, 0.36, -0.1, 0.5, 0, 'satin', col), box(0.6, 0.12, 0.3, -0.25, 0.72, 0, 'matte', P.black),
      box(0.18, 0.7, 0.3, 0.45, 0.62, 0, 'satin', col, [0, 0, -0.3]), box(0.06, 0.06, 0.62, 0.62, 1.0, 0, 'metal', P.chrome),
      box(0.08, 0.08, 0.16, 0.66, 0.85, 0, 'glow', C(0xfff4d6, 3)),
    ];
  }
  // 18. Pedestrian guard rail (2 m segment), white with a yellow top rail.
  M.guardRail = [
    ...[-0.95, 0.95].map((x) => box(0.06, 0.95, 0.06, x, 0.47, 0, 'satin', P.white)),
    box(2.0, 0.06, 0.06, 0, 0.92, 0, 'satin', P.yellow),
    box(2.0, 0.05, 0.04, 0, 0.45, 0, 'satin', P.white),
  ];
  // 19. Electrical cabinet with stickers.
  M.cabinet = [
    box(0.9, 1.4, 0.5, 0, 0.7, 0, 'satin', 0x9ea3a8),
    panel(0.84, 1.3, 0, 0.72, 0.251, 0, 'signLit', C(0xffffff), L('cabinet')),
    box(0.98, 0.05, 0.58, 0, 1.42, 0, 'metal', P.steel),
  ];
  // 20. Red post box.
  M.postBox = [
    cyl(0.25, 0.25, 1.1, 12, 0, 0.55, 0, 'satin', P.red),
    sph(0.27, 0, 1.12, 0, 'satin', P.red, 1, 0.45, 1, 1),
    box(0.3, 0.04, 0.02, 0, 0.9, 0.25, 'matte', P.black),
    box(0.16, 0.12, 0.02, 0, 0.62, 0.25, 'matte', P.white),
  ];
  // 21. Phone booth.
  M.phoneBooth = [
    box(1.0, 0.12, 1.0, 0, 2.3, 0, 'satin', 0x56706a),
    box(0.9, 0.12, 0.02, 0, 2.3, 0.51, 'glow', C(0x7dffb2, 2.2)),
    ...[[-0.47, -0.47], [0.47, -0.47], [-0.47, 0.47], [0.47, 0.47]].map(([x, z]) => box(0.06, 2.25, 0.06, x, 1.12, z, 'satin', 0x56706a)),
    box(0.92, 2.0, 0.02, 0, 1.1, -0.47, 'glass', C(0xbfe6d8)), box(0.02, 2.0, 0.92, -0.47, 1.1, 0, 'glass', C(0xbfe6d8)),
    box(0.02, 2.0, 0.92, 0.47, 1.1, 0, 'glass', C(0xbfe6d8)), box(0.92, 2.0, 0.02, 0, 1.1, 0.47, 'glass', C(0xbfe6d8)),
    box(0.3, 0.4, 0.2, 0, 1.3, -0.35, 'satin', 0x2f9a5a), box(0.6, 0.04, 0.35, 0, 1.0, -0.3, 'matte', P.dark),
    box(0.6, 0.02, 0.6, 0, 2.2, 0, 'glow', C(0xe9f2ff, 1.5)),
  ];
  // 22. Drink vending machines (3 brands), lit fronts.
  for (let v = 0; v < 3; v++) {
    M[`vending${v}`] = [
      box(1.0, 1.9, 0.75, 0, 0.95, 0, 'satin', [0xc8102e, 0x1f58c9, 0xe9e4d4][v]),
      panel(0.92, 1.42, 0, 1.12, 0.376, 0, 'propGlow', C(0xffffff, 1.25), L(`vend${v}`)),
      box(0.9, 0.12, 0.05, 0, 1.92, 0.36, 'glow', C(0xffffff, 2)),
      box(0.4, 0.14, 0.08, 0.1, 0.25, 0.38, 'matte', P.black),
    ];
  }
  // 23. Ticket machine.
  M.ticketMachine = [
    box(0.7, 1.5, 0.55, 0, 0.75, 0, 'satin', 0x2b2d36),
    box(0.62, 0.42, 0.04, 0, 1.18, 0.29, 'glow', C(0x35eaff, 1.4), [-0.25, 0, 0]),
    ...[0, 1, 2].map((k) => box(0.12, 0.08, 0.04, -0.2 + k * 0.2, 0.82, 0.28, 'glow', C(0xffb040, 2))),
    box(0.3, 0.1, 0.05, 0, 0.5, 0.28, 'matte', P.black),
  ];
  // 24. Recycling bins.
  M.recycling = [[-0.55, 0x1f58c9], [0, 0x2f9a5a], [0.55, 0xe8c21a]].flatMap(([x, c]) => [
    box(0.48, 0.9, 0.5, x, 0.45, 0, 'satin', c), box(0.5, 0.05, 0.52, x, 0.92, 0, 'satin', c),
    box(0.22, 0.05, 0.02, x, 0.78, 0.26, 'matte', P.black),
  ]);
  // 25. Planter with shrubs.
  M.planter = [
    box(1.6, 0.6, 0.7, 0, 0.3, 0, 'matte', P.concrete),
    sph(0.45, -0.4, 0.8, 0, 'matte', P.leaf2, 1, 0.8, 0.9), sph(0.5, 0.35, 0.82, 0, 'matte', P.leaf, 1, 0.8, 0.9),
    sph(0.2, 0.1, 1.0, 0.15, 'matte', 0xd2316b),
  ];
  // 26-27. Crates and cardboard.
  M.crates = [
    box(0.8, 0.6, 0.6, 0, 0.3, 0, 'matte', P.wood), box(0.8, 0.6, 0.6, 0.1, 0.9, 0.05, 'matte', 0x7a5a3c, [0, 0.2, 0]),
    box(0.9, 0.12, 0.9, -0.9, 0.06, 0, 'matte', 0x8c6a46), box(0.6, 0.45, 0.5, -0.9, 0.35, 0, 'matte', 0x2f9a5a),
  ];
  M.cardboard = [
    box(0.6, 0.45, 0.5, 0, 0.23, 0, 'matte', P.cardboard), box(0.5, 0.4, 0.45, 0.05, 0.65, 0, 'matte', 0xae8a5f, [0, 0.4, 0]),
    box(0.7, 0.3, 0.5, 0.65, 0.15, 0.1, 'matte', 0x8f6c45, [0, -0.3, 0]),
  ];
  // 28. Dumpster.
  M.dumpster = [
    box(1.8, 1.1, 1.0, 0, 0.65, 0, 'satin', 0x2c5a3c),
    box(1.82, 0.05, 1.05, 0, 1.3, -0.15, 'satin', 0x234a31, [0.35, 0, 0]),
    ...[-0.75, 0.75].flatMap((x) => [cyl(0.08, 0.08, 0.06, 8, x, 0.08, 0.4, 'matte', P.rubber, [0, 0, Math.PI / 2]), cyl(0.08, 0.08, 0.06, 8, x, 0.08, -0.4, 'matte', P.rubber, [0, 0, Math.PI / 2])]),
  ];
  // 29. Gas meters and pipes on a wall.
  M.gasMeters = [
    ...[-0.35, 0.35].map((x) => box(0.35, 0.45, 0.2, x, 1.4, 0.12, 'satin', 0xd6d3c8)),
    ...[-0.35, 0.35].map((x) => cyl(0.03, 0.03, 1.2, 6, x, 0.6, 0.12, 'metal', P.yellow)),
    cyl(0.03, 0.03, 1.4, 6, 0, 1.9, 0.1, 'metal', P.yellow, [0, 0, Math.PI / 2]),
  ];
  // 30. Roller shutters (closed shop fronts).
  for (let v = 0; v < 2; v++) {
    M[`shutter${v}`] = [
      panel(5.4, 3.1, 0, 1.6, 0.04, 0, 'signLit', C(0xffffff), L(`shutter${v}`)),
      box(5.6, 0.35, 0.35, 0, 3.3, 0.15, 'satin', 0x6f7178),
    ];
  }
  // 31. Striped shop awning, sloping out over the pavement.
  for (const [v, a, b] of [[0, 0xc8202c, 0xe9e4d4], [1, 0x1f58c9, 0xe9e4d4], [2, 0x2f6b3a, 0xe8c21a]]) {
    const stripes = [];
    for (let k = 0; k < 9; k++) stripes.push(box(0.6, 0.03, 1.5, -2.4 + k * 0.6, 3.55, 0.7, 'matte', k % 2 ? b : a, [0.35, 0, 0]));
    M[`awning${v}`] = [...stripes, box(5.4, 0.25, 0.03, 0, 3.22, 1.42, 'matte', a)];
  }
  // 32. Noren shop door with two paper lanterns.
  M.noren = [
    box(2.6, 0.12, 0.25, 0, 2.6, 0.12, 'matte', P.darkwood),
    panel(2.2, 1.0, 0, 2.05, 0.2, 0, 'signLit', C(0xffffff), L('noren')),
    ...[-1.45, 1.45].flatMap((x) => [part(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 10, 1, true).translate(x, 2.3, 0.4), 'propGlow', C(0xffffff, 1.6), L('lantern')), box(0.04, 0.08, 0.04, x, 2.62, 0.4, 'matte', P.black)]),
  ];
  // 33. A pair of hanging red lanterns.
  M.lanterns = [-0.5, 0.5].flatMap((x) => [
    part(new THREE.CylinderGeometry(0.26, 0.26, 0.62, 10, 1, true).translate(x, 2.6, 0), 'propGlow', C(0xffffff, 1.8), L('lantern')),
    box(0.3, 0.06, 0.3, x, 2.94, 0, 'matte', P.black), box(0.3, 0.06, 0.3, x, 2.27, 0, 'matte', P.black),
  ]);
  // 34. A-frame menu board.
  for (let v = 0; v < 2; v++) {
    M[`aFrame${v}`] = [
      panel(0.5, 1.0, 0, 0.5, 0.18, 0, 'signLit', C(0xffffff), L(`menu${v}`)),
      part(tr(new THREE.PlaneGeometry(0.5, 1.0), 0, 0.5, -0.18, 0, Math.PI), 'signLit', C(0xffffff), L(`menu${(v + 1) % 2}`)),
      box(0.52, 1.02, 0.03, 0, 0.5, 0.17, 'matte', P.wood, [-0.18, 0, 0]),
      box(0.52, 1.02, 0.03, 0, 0.5, -0.17, 'matte', P.wood, [0.18, 0, 0]),
    ];
  }
  // 35. Yatai food stall: wooden cart with a roof, counter, stools, noren and lanterns.
  M.yatai = [
    box(2.2, 0.9, 1.0, 0, 0.75, 0, 'matte', P.wood),
    box(2.5, 0.06, 0.45, 0, 1.22, 0.55, 'matte', P.darkwood),
    ...[[-1.05, -0.45], [1.05, -0.45], [-1.05, 0.45], [1.05, 0.45]].map(([x, z]) => box(0.08, 1.6, 0.08, x, 1.95, z, 'matte', P.darkwood)),
    box(2.7, 0.08, 1.6, 0, 2.8, 0.1, 'matte', 0x4b2f20, [0.08, 0, 0]),
    panel(2.2, 0.55, 0, 2.45, 0.56, 0, 'signLit', C(0xffffff), L('noren')),
    ...[-0.8, 0.8].map((x) => part(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 10, 1, true).translate(x, 2.3, 0.75), 'propGlow', C(0xffffff, 1.8), L('lantern'))),
    ...[-0.75, 0, 0.75].map((x) => cyl(0.16, 0.16, 0.6, 8, x, 0.3, 1.0, 'matte', P.red)),
    ...[-0.6, 0.6].map((x) => part(new THREE.TorusGeometry(0.3, 0.05, 4, 12).rotateX(Math.PI / 2).translate(x, 0.32, -0.55), 'matte', P.rubber)),
    box(0.5, 0.25, 0.5, -0.4, 1.32, -0.1, 'metal', P.steel),
  ];
  // 36. Neon arch over a shopping street, made per road width.
  M.archFor = (w, sign) => [
    ...[-1, 1].flatMap((s) => [box(0.5, 7.5, 0.5, s * (w / 2 + 0.6), 3.75, 0, 'satin', P.dark), box(0.08, 7.3, 0.08, s * (w / 2 + 0.6), 3.75, 0.27, 'glow', C(0xff3fd0, 3))]),
    box(w + 1.7, 1.6, 0.4, 0, 7.6, 0, 'satin', P.dark),
    panel(Math.min(w, 9), Math.min(w, 9) / 4, 0, 7.6, 0.21, 0, 'signGlow', C(0xffffff, 2.2), G(`h${sign}`)),
    panel(Math.min(w, 9), Math.min(w, 9) / 4, 0, 7.6, -0.21, Math.PI, 'signGlow', C(0xffffff, 2.2), G(`h${(sign + 5) % 16}`)),
    box(w + 1.7, 0.06, 0.06, 0, 8.45, 0.22, 'glow', C(0x35eaff, 3)),
  ];
  // 38. Balcony with a frosted rail, sometimes laundry or a plant (made per variant).
  M.balcony = [
    box(2.4, 0.15, 1.1, 0, 0, 0.55, 'matte', 0x8a8690),
    box(2.4, 0.9, 0.04, 0, 0.5, 1.08, 'glass', C(0xd8e4ff, 0.8)),
    box(2.44, 0.05, 0.08, 0, 0.98, 1.08, 'metal', P.steel),
  ];
  M.balconyLaundry = [...M.balcony,
    box(2.2, 0.025, 0.025, 0, 1.6, 0.8, 'metal', P.steel),
    ...[[-0.8, 0xe86a8a], [-0.35, 0xf4f4f0], [0.15, 0x6aa8e8], [0.6, 0xf2d06b]].map(([x, c]) => box(0.38, 0.55, 0.02, x, 1.3, 0.8, 'matte', c)),
  ];
  M.balconyPlant = [...M.balcony, cyl(0.2, 0.15, 0.35, 8, 0.8, 0.25, 0.7, 'matte', 0x9a4d32), sph(0.35, 0.8, 0.65, 0.7, 'matte', P.leaf2)];
  // 39. Fire escape for one storey: landing, rails, and a zigzag stair.
  M.fireEscape = [
    box(3.2, 0.06, 1.0, 0, 0, 0.5, 'metal', 0x2a2b31),
    box(3.2, 0.04, 0.04, 0, 0.95, 1.0, 'metal', 0x2a2b31),
    ...[-1.6, -0.8, 0, 0.8, 1.6].map((x) => box(0.03, 0.95, 0.03, x, 0.47, 1.0, 'metal', 0x2a2b31)),
    box(0.04, 0.95, 1.0, -1.6, 0.47, 0.5, 'metal', 0x2a2b31),
    box(2.4, 0.05, 0.7, 0.3, 1.7, 0.6, 'metal', 0x2a2b31, [0, 0, -0.85]),
    rod([-1.0, 0.95, 0.95], [1.6, 3.4, 0.95], 0.02, 'metal', 0x2a2b31),
  ];
  // 40-42. Drainpipe (1 m, scaled), laundry pole, satellite dish.
  M.drainpipe = [cyl(0.06, 0.06, 1, 6, 0, 0.5, 0.08, 'satin', 0x8c8a86)];
  M.satellite = [
    part(new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, 0.9).rotateX(Math.PI / 2 + 0.5).translate(0, 0.55, 0.15), 'satin', P.white),
    rod([0, 0, 0], [0, 0.45, 0.1], 0.03, 'metal', P.steel), rod([0, 0.6, 0.2], [0, 0.55, 0.55], 0.015, 'metal', P.steel),
  ];
  // 43. Projecting box sign with an icon, both faces lit.
  for (let v = 0; v < 8; v++) {
    M[`boxSign${v}`] = [
      box(0.25, 1.5, 1.5, 0, 0, 0.9, 'satin', P.dark),
      panel(1.4, 1.4, 0.13, 0, 0.9, Math.PI / 2, 'signGlow', C(0xffffff, 2.2), G(`b${v}`)),
      panel(1.4, 1.4, -0.13, 0, 0.9, -Math.PI / 2, 'signGlow', C(0xffffff, 2.2), G(`b${v}`)),
      box(0.08, 0.08, 0.3, 0, 0.5, 0.1, 'metal', P.steel), box(0.08, 0.08, 0.3, 0, -0.5, 0.1, 'metal', P.steel),
    ];
  }
  // 44. Rooftop billboard on a steel truss with floodlights.
  for (let v = 0; v < 6; v++) {
    const w = 16, h = 8;
    M[`billboard${v}`] = [
      panel(w, h, 0, 6 + h / 2, 0.25, 0, 'signGlow', C(0xffffff, 1.6), G(`bb${v}`)),
      box(w + 0.6, h + 0.6, 0.4, 0, 6 + h / 2, 0, 'satin', P.dark),
      ...[-w / 2 + 1, -w / 6, w / 6, w / 2 - 1].flatMap((x) => [box(0.3, 6, 0.3, x, 3, -0.5, 'metal', P.steel), rod([x, 0, -2.5], [x, 6, -0.5], 0.1, 'metal', P.steel)]),
      ...[-w / 3, 0, w / 3].map((x) => box(0.5, 0.25, 0.4, x, 5.6, 1.2, 'glow', C(0xfff4d6, 3))),
      box(w, 0.12, 1.2, 0, 5.5, 0.7, 'metal', P.steel),
    ];
  }
  // 45. Tower crane: lattice mast, jib, counter-jib with weights, cab, hook and beacons.
  {
    const steel = 0xe8b41a, H = 70, parts = [];
    for (let y = 0; y < H; y += 3) {
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.15, 3, 0.15, x, y + 1.5, z, 'satin', steel));
      parts.push(rod([-1, y, -1], [1, y + 3, -1], 0.06, 'satin', steel, 4), rod([1, y, 1], [-1, y + 3, 1], 0.06, 'satin', steel, 4));
      parts.push(rod([-1, y, 1], [-1, y + 3, -1], 0.06, 'satin', steel, 4), rod([1, y, -1], [1, y + 3, 1], 0.06, 'satin', steel, 4));
    }
    parts.push(box(2.6, 2.4, 2.6, 0, H + 1.2, 0, 'satin', steel), box(1.6, 1.6, 1.6, 1.8, H + 1, 0, 'glass', C(0xbfe6ff)));
    for (let x = 0; x < 50; x += 4) {
      parts.push(box(4, 0.12, 0.12, x + 2, H + 3.2, -0.6, 'satin', steel), box(4, 0.12, 0.12, x + 2, H + 3.2, 0.6, 'satin', steel), box(4, 0.12, 0.12, x + 2, H + 4.4, 0, 'satin', steel));
      parts.push(rod([x, H + 3.2, -0.6], [x + 2, H + 4.4, 0], 0.05, 'satin', steel, 4), rod([x, H + 3.2, 0.6], [x + 2, H + 4.4, 0], 0.05, 'satin', steel, 4));
    }
    parts.push(box(16, 0.4, 1.4, -8, H + 3.2, 0, 'satin', steel), box(4, 3, 2, -14, H + 2, 0, 'matte', P.concrete));
    parts.push(rod([0, H + 9, 0], [48, H + 4.4, 0], 0.05, 'metal', P.steel), rod([0, H + 9, 0], [-15, H + 3.4, 0], 0.05, 'metal', P.steel), box(0.4, 6, 0.4, 0, H + 6, 0, 'satin', steel));
    parts.push(rod([34, H + 3, 0], [34, H - 22, 0], 0.03, 'metal', P.dark), box(1.2, 0.8, 0.6, 34, H - 22.4, 0, 'satin', P.red));
    for (const [x, y] of [[0, H + 9.2], [48, H + 4.6], [-15, H + 3.6]]) parts.push(sph(0.35, x, y, 0, 'glow', C(0xff2010, 4)));
    M.crane = parts;
  }
  // 46. Helipad pad with edge lights.
  M.helipad = [
    box(16, 0.4, 16, 0, 0.2, 0, 'matte', 0x2b2b33),
    part(tr(new THREE.PlaneGeometry(15, 15), 0, 0.41, 0, -Math.PI / 2), 'signLit', C(0xffffff), L('helipad')),
    ...Array.from({ length: 16 }, (_, k) => { const a = (k / 16) * Math.PI * 2; return box(0.25, 0.2, 0.25, Math.cos(a) * 7.6, 0.5, Math.sin(a) * 7.6, 'glow', C(k % 2 ? 0x7dff6a : 0xffffff, 3)); }),
  ];
  // 47-48. Construction: hoarding panel (4 m) and a water-filled barrier.
  M.hoarding = [
    panel(4, 2.4, 0, 1.2, 0.03, 0, 'signLit', C(0xffffff), L('hoarding')),
    box(4, 2.4, 0.05, 0, 1.2, 0, 'satin', 0x3a3a40),
    ...[-2, 2].map((x) => box(0.1, 2.5, 0.1, x, 1.25, -0.05, 'metal', P.steel)),
    box(0.25, 0.15, 0.08, 1.6, 2.45, 0.05, 'glow', C(0xffa000, 3)),
  ];
  M.waterBarrier = [
    box(1.8, 0.7, 0.5, 0, 0.35, 0, 'satin', P.red), box(1.8, 0.2, 0.45, 0, 0.8, 0, 'satin', P.white),
    box(1.6, 0.06, 0.02, 0, 0.55, 0.26, 'glow', C(0xffffff, 1.2)),
  ];
  // 49. Overhead direction gantry spanning a road, made per width.
  M.gantryFor = (w, v) => [
    ...[-1, 1].map((s) => box(0.45, 7.2, 0.45, s * (w / 2 + 0.7), 3.6, 0, 'metal', P.steel)),
    box(w + 1.8, 0.35, 0.35, 0, 7.0, 0, 'metal', P.steel), box(w + 1.8, 0.25, 0.25, 0, 8.4, 0, 'metal', P.steel),
    panel(9, 3, 0, 7.7, 0.25, 0, 'signLit', C(0xffffff, 1.1), L(`gantry${v}`)),
    panel(9, 3, 0, 7.7, -0.25, Math.PI, 'signLit', C(0xffffff, 1.1), L(`gantry${(v + 1) % 2}`)),
    box(9, 0.1, 0.15, 0, 9.3, 0.3, 'glow', C(0xe9f2ff, 2)),
  ];
  // 51. Storm drain grate (lies on the road at the curb).
  M.drain = [part(tr(new THREE.PlaneGeometry(0.9, 0.45), 0, 0.02, 0, -Math.PI / 2), 'signLit', C(0xffffff), L('drain'))];
  // 52. Rooftop garden: raised beds and small trees.
  M.roofGarden = [
    box(6, 0.5, 1.2, 0, 0.25, -1.5, 'matte', P.wood), box(6, 0.5, 1.2, 0, 0.25, 1.5, 'matte', P.wood),
    ...[-2, 0, 2].flatMap((x) => [sph(0.6, x, 0.9, -1.5, 'matte', P.leaf2), sph(0.55, x + 0.5, 0.85, 1.5, 'matte', P.leaf)]),
    ...[-2.5, 2.5].flatMap((x) => [cyl(0.06, 0.08, 1.8, 5, x, 0.9, 0, 'matte', P.darkwood), sph(0.8, x, 2.2, 0, 'matte', P.leaf)]),
    ...Array.from({ length: 12 }, (_, k) => box(0.06, 0.06, 0.06, -3 + k * 0.55, 1.4 + Math.sin(k) * 0.1, 0, 'glow', C(0xffd27a, 3))),
  ];
  // 53. Rooftop AC tower with a big fan.
  M.coolingTower = [
    box(3, 2.4, 3, 0, 1.2, 0, 'satin', 0x8a8d96),
    cyl(1.25, 1.25, 0.4, 16, 0, 2.6, 0, 'satin', 0x6d7079),
    cyl(1.1, 1.1, 0.05, 16, 0, 2.82, 0, 'matte', P.black),
    ...[-1.51, 1.51].map((x) => box(0.02, 1.8, 2.6, x, 1.2, 0, 'matte', 0x4a4d55)),
  ];
  return M;
}

// ---------- batcher ----------
const tmpM = new THREE.Matrix4(), tmpN = new THREE.Matrix3(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export class Batcher {
  constructor(chunk = 260, offset = 420) {
    this.chunk = chunk;
    this.offset = offset;
    this.buckets = new Map(); // `${cx},${cz},${cls}` -> arrays
    this.count = 0;
  }

  bucket(x, z, cls) {
    const key = `${Math.floor((x + this.offset) / this.chunk)},${Math.floor((z + this.offset) / this.chunk)},${cls}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { cls, pos: [], nor: [], col: [], uv: [], idx: [] }));
    return b;
  }

  // Place a model. `tint` multiplies every part's colour (for variety), scale may be a number or [x, y, z].
  add(model, x, y, z, ry = 0, scale = 1, tint = null) {
    const s = Array.isArray(scale) ? scale : [scale, scale, scale];
    tmpM.compose(tmpV.set(x, y, z), tmpQ.setFromAxisAngle(UP, ry), tmpS.set(s[0], s[1], s[2]));
    tmpN.getNormalMatrix(tmpM);
    this.count++;
    for (const p of model) {
      const b = this.bucket(x, z, p.cls);
      const base = b.pos.length / 3;
      const pos = p.geo.attributes.position, nor = p.geo.attributes.normal, uv = p.geo.attributes.uv;
      const r = p.color.r * (tint ? tint.r : 1), g = p.color.g * (tint ? tint.g : 1), bl = p.color.b * (tint ? tint.b : 1);
      const v = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(tmpM);
        n.fromBufferAttribute(nor, i).applyMatrix3(tmpN).normalize();
        b.pos.push(v.x, v.y, v.z);
        b.nor.push(n.x, n.y, n.z);
        b.col.push(r, g, bl);
        if (p.uv && uv) b.uv.push(p.uv[0] + uv.getX(i) * (p.uv[2] - p.uv[0]), p.uv[1] + uv.getY(i) * (p.uv[3] - p.uv[1]));
        else b.uv.push(0, 0);
      }
      const idx = p.geo.index;
      for (let i = 0; i < idx.count; i++) b.idx.push(base + idx.getX(i));
    }
  }

  build(group, materials) {
    let meshes = 0;
    for (const b of this.buckets.values()) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      const mat = materials[b.cls];
      const mesh = new THREE.Mesh(g, mat);
      // Lit things show in the wet road; plain props skip the reflection pass.
      if (!mat.userData.reflect) mesh.layers.set(LAYER_MAIN_ONLY);
      if (mat.transparent) mesh.renderOrder = 1;
      group.add(mesh);
      meshes++;
    }
    this.buckets.clear();
    return meshes;
  }
}

export function propMaterials(glowTex, litTex) {
  const reflect = (m) => { m.userData.reflect = true; return m; };
  return {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    satin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.32, depthWrite: false }),
    glow: reflect(new THREE.MeshBasicMaterial({ vertexColors: true })),
    signGlow: reflect(new THREE.MeshBasicMaterial({ vertexColors: true, map: glowTex })),
    propGlow: reflect(new THREE.MeshBasicMaterial({ vertexColors: true, map: litTex, side: THREE.DoubleSide })),
    signLit: new THREE.MeshStandardMaterial({ vertexColors: true, map: litTex, roughness: 0.55, alphaTest: 0.5, side: THREE.DoubleSide }),
  };
}
