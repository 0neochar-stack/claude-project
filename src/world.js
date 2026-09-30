// City layout and collision. Pure data and math (no three.js) so it is shared by rendering, the minimap and physics.

const BLOCK = 74;
// Widths of the roads between blocks, west to east (and south to north). Wide avenues are for drifting.
const ROAD_WIDTHS = [26, 18, 22, 30, 22, 18, 26];
const PLAZA = new Set(['1,4', '2,4']); // blocks left open as a drift lot

function axis() {
  const total = ROAD_WIDTHS.reduce((a, b) => a + b, 0) + BLOCK * (ROAD_WIDTHS.length - 1);
  let p = -total / 2;
  const roads = [], blocks = [];
  ROAD_WIDTHS.forEach((w, i) => {
    roads.push({ c: p + w / 2, w, lo: p, hi: p + w });
    p += w;
    if (i < ROAD_WIDTHS.length - 1) {
      blocks.push({ lo: p, hi: p + BLOCK });
      p += BLOCK;
    }
  });
  return { roads, blocks, half: total / 2 };
}

const A = axis();
export const HALF = A.half;
export const ROADS = A.roads; // same list is used for x and z
export const CURB = 0.22;

export const BLOCKS = [];
A.blocks.forEach((bx, i) => A.blocks.forEach((bz, j) => {
  BLOCKS.push({ i, j, x0: bx.lo, x1: bx.hi, z0: bz.lo, z1: bz.hi, plaza: PLAZA.has(`${i},${j}`) });
}));

const plazaBlocks = BLOCKS.filter((b) => b.plaza);
const plazaMinX = Math.min(...plazaBlocks.map((b) => b.x0));
const plazaMaxX = Math.max(...plazaBlocks.map((b) => b.x1));
const pz0 = plazaBlocks[0].z0, pz1 = plazaBlocks[0].z1;
export const PLAZA_AREA = { x0: plazaMinX, x1: plazaMaxX, z0: pz0, z1: pz1 };

// Round neon pylons in the drift lot to circle around.
export const PILLARS = [
  { x: (plazaMinX + plazaMaxX) / 2, z: (pz0 + pz1) / 2, r: 3.2 },
  { x: plazaMinX + 34, z: (pz0 + pz1) / 2 + 6, r: 1.6 },
  { x: plazaMaxX - 34, z: (pz0 + pz1) / 2 - 6, r: 1.6 },
];

export const SOLID_BLOCKS = BLOCKS.filter((b) => !b.plaza);

export const SPAWN = { x: ROADS[3].c + 7, z: -HALF + 40, heading: 0 };

// Car hull as two circles along its length.
const HULL = [{ o: 1.3, r: 1.0 }, { o: -1.3, r: 1.0 }];

// Pushes the car out of curbs, pylons and the city edge. Returns the hardest impact speed (m/s).
export function collide(car) {
  let impact = 0;
  const sh = Math.sin(car.h), ch = Math.cos(car.h);
  for (const c of HULL) {
    const px = sh * c.o, pz = ch * c.o;
    const cx = car.x + px, cz = car.z + pz;
    const hits = [];
    for (const b of SOLID_BLOCKS) {
      if (cx < b.x0 - c.r || cx > b.x1 + c.r || cz < b.z0 - c.r || cz > b.z1 + c.r) continue;
      const qx = Math.min(Math.max(cx, b.x0), b.x1);
      const qz = Math.min(Math.max(cz, b.z0), b.z1);
      let dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
      if (d >= c.r) continue;
      if (d < 1e-4) { // centre inside the block: push out through the nearest face
        const faces = [[cx - b.x0, -1, 0], [b.x1 - cx, 1, 0], [cz - b.z0, 0, -1], [b.z1 - cz, 0, 1]];
        faces.sort((f, g) => f[0] - g[0]);
        hits.push({ nx: faces[0][1], nz: faces[0][2], pen: faces[0][0] + c.r });
      } else hits.push({ nx: dx / d, nz: dz / d, pen: c.r - d });
    }
    for (const p of PILLARS) {
      const dx = cx - p.x, dz = cz - p.z, d = Math.hypot(dx, dz);
      if (d < p.r + c.r && d > 1e-4) hits.push({ nx: dx / d, nz: dz / d, pen: p.r + c.r - d });
    }
    const lim = HALF - c.r;
    if (cx < -lim) hits.push({ nx: 1, nz: 0, pen: -lim - cx });
    if (cx > lim) hits.push({ nx: -1, nz: 0, pen: cx - lim });
    if (cz < -lim) hits.push({ nx: 0, nz: 1, pen: -lim - cz });
    if (cz > lim) hits.push({ nx: 0, nz: -1, pen: cz - lim });

    for (const hit of hits) {
      car.x += hit.nx * hit.pen;
      car.z += hit.nz * hit.pen;
      // Contact point velocity: v + omega x r, with omega about +y.
      const vpx = car.vx + car.r * pz, vpz = car.vz - car.r * px;
      const vn = vpx * hit.nx + vpz * hit.nz;
      if (vn >= 0) continue;
      impact = Math.max(impact, -vn);
      const rn = pz * hit.nx - px * hit.nz;
      const m = car.spec.mass, I = car.spec.inertia;
      const j = (-(1 + 0.25) * vn) / (1 / m + (rn * rn) / I);
      car.applyImpulse(px, pz, hit.nx * j, hit.nz * j);
      // Scrape friction along the wall.
      const tx = -hit.nz, tz = hit.nx;
      const vt = vpx * tx + vpz * tz;
      const jt = -vt * m * 0.12;
      car.applyImpulse(px, pz, tx * jt, tz * jt);
    }
  }
  return impact;
}

// Nearest point on a road centre line, heading along that road (used by reset).
export function nearestRoad(x, z, heading) {
  let best = null;
  for (const r of ROADS) {
    const dx = Math.abs(x - r.c);
    if (!best || dx < best.d) best = { d: dx, x: r.c, z: clampRoad(z), alongZ: true };
    const dz = Math.abs(z - r.c);
    if (dz < best.d) best = { d: dz, x: clampRoad(x), z: r.c, alongZ: false };
  }
  const fx = Math.sin(heading), fz = Math.cos(heading);
  let h;
  if (best.alongZ) h = fz >= 0 ? 0 : Math.PI;
  else h = fx >= 0 ? Math.PI / 2 : -Math.PI / 2;
  return { x: best.x, z: best.z, heading: h };
}

function clampRoad(v) {
  return Math.min(Math.max(v, -HALF + 12), HALF - 12);
}
