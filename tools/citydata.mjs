// Turns OpenStreetMap (Overpass JSON) into the compact city format the game loads. Pure functions, no network,
// so tests can run them on fixtures.
//
// Coordinates: a local tangent plane around the city origin, in metres. +x is east, +z is south (north is -z),
// stored as integer decimetres in flat [x, z, x, z, ...] arrays.

const R = 6378137;
const DEG = Math.PI / 180;

export function makeProjection(lat0, lon0) {
  const kx = R * DEG * Math.cos(lat0 * DEG), kz = R * DEG;
  return {
    lat0, lon0,
    toLocal: (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * kz],
    toLatLon: (x, z) => [lat0 - z / kz, lon0 + x / kx],
  };
}

// ---------- classification ----------
// Drivable road classes, with default lane count and lane width when OSM does not say.
export const ROAD_CLASSES = {
  motorway: { lanes: 4, lw: 3.7, rank: 9 }, trunk: { lanes: 4, lw: 3.6, rank: 8 }, primary: { lanes: 4, lw: 3.6, rank: 7 },
  secondary: { lanes: 4, lw: 3.5, rank: 6 }, tertiary: { lanes: 2, lw: 3.5, rank: 5 }, unclassified: { lanes: 2, lw: 3.2, rank: 3 },
  residential: { lanes: 2, lw: 4.2, rank: 4 }, living_street: { lanes: 2, lw: 3, rank: 2 }, service: { lanes: 1, lw: 4, rank: 1 },
  motorway_link: { lanes: 1, lw: 4, rank: 6 }, trunk_link: { lanes: 1, lw: 4, rank: 6 }, primary_link: { lanes: 1, lw: 4, rank: 5 },
  secondary_link: { lanes: 1, lw: 4, rank: 5 }, tertiary_link: { lanes: 1, lw: 4, rank: 4 }, track: { lanes: 1, lw: 3, rank: 0 },
};
const CLASS_ORDER = Object.keys(ROAD_CLASSES);

export function roadWidth(tags) {
  const c = ROAD_CLASSES[tags.highway];
  if (!c) return 0;
  const w = parseFloat(tags.width);
  if (w > 2 && w < 60) return w;
  let lanes = parseInt(tags.lanes, 10);
  if (!(lanes > 0 && lanes < 12)) lanes = c.lanes;
  if (tags.highway === 'service' && tags.service === 'parking_aisle') return 6;
  return lanes * c.lw;
}

// Building height: explicit height, else storeys, else a sensible default for the building type.
export function buildingHeight(tags) {
  const h = parseFloat(tags.height ?? tags['building:height']);
  if (h > 1 && h < 400) return h;
  const lv = parseFloat(tags['building:levels']);
  if (lv > 0 && lv < 120) return lv * 3.4 + (parseFloat(tags['roof:levels']) || 0) * 1.5 + 0.6;
  const t = tags.building;
  if (t === 'garage' || t === 'garages' || t === 'carport' || t === 'shed' || t === 'roof') return 3;
  if (t === 'house' || t === 'detached' || t === 'semidetached_house' || t === 'residential') return 5.5;
  if (t === 'apartments') return 10;
  if (t === 'retail' || t === 'commercial' || t === 'supermarket') return 7.5;
  if (t === 'industrial' || t === 'warehouse') return 9;
  if (t === 'school' || t === 'church' || t === 'hospital' || t === 'office') return 9;
  return 6;
}

export const AREA_KINDS = {
  park: (t) => t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.leisure === 'dog_park',
  pitch: (t) => t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'golf_course' || t.leisure === 'sports_centre',
  grass: (t) => t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'recreation_ground' || t.natural === 'grassland' || t.natural === 'scrub' || t.landuse === 'vineyard' || t.landuse === 'orchard',
  wood: (t) => t.landuse === 'forest' || t.natural === 'wood',
  water: (t) => t.natural === 'water' || t.landuse === 'reservoir' || t.waterway === 'riverbank' || t.landuse === 'basin',
  parking: (t) => t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey',
  school: (t) => t.amenity === 'school' || t.amenity === 'college' || t.amenity === 'university',
  retail: (t) => t.landuse === 'retail' || t.landuse === 'commercial',
};
const areaKind = (t) => Object.keys(AREA_KINDS).find((k) => AREA_KINDS[k](t)) || null;

const POI_KEYS = ['shop', 'amenity', 'tourism', 'leisure', 'office', 'healthcare', 'craft', 'club'];
const SKIP_AMENITY = new Set(['parking', 'parking_space', 'bench', 'waste_basket', 'bicycle_parking', 'parking_entrance', 'drinking_water', 'vending_machine', 'post_box', 'toilets', 'shelter', 'loading_dock', 'motorcycle_parking', 'waste_disposal', 'recycling']);
export function poiCategory(tags) {
  if (!tags.name && !tags.brand) return null;
  for (const k of POI_KEYS) {
    if (!tags[k]) continue;
    if (k === 'amenity' && SKIP_AMENITY.has(tags[k])) return null;
    if (k === 'leisure' && !['park', 'playground', 'sports_centre', 'fitness_centre', 'golf_course', 'stadium', 'dog_park'].includes(tags[k])) continue;
    return tags[k] === 'yes' ? k : tags[k];
  }
  return null;
}

// ---------- geometry helpers ----------
export function polygonArea(p) {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}
export function centroid(p) {
  let cx = 0, cz = 0, a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const f = p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
    cx += (p[i * 2] + p[j * 2]) * f;
    cz += (p[i * 2 + 1] + p[j * 2 + 1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; }
    return [cx / n, cz / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}
export function pointInPolygon(x, z, p) {
  let inside = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function distToPolygonEdge(x, z, p) {
  let best = Infinity;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    best = Math.min(best, distToSegment(x, z, p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]));
  }
  return best;
}
export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
// Drop points closer than `tol` metres to the previous one (keeps shapes, trims noisy traces).
function simplify(p, tol = 0.3) {
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    if (Math.hypot(p[i] - out[out.length - 2], p[i + 1] - out[out.length - 1]) >= tol) out.push(p[i], p[i + 1]);
  }
  return out;
}

// ---------- conversion ----------
// Assemble closed rings from multipolygon member ways (joins way chains end to end).
function assembleRings(memberWays) {
  const rings = [];
  const pool = memberWays.map((w) => w.slice());
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (ring[0] !== ring[ring.length - 1] && guard++ < 1000) {
      const end = ring[ring.length - 1];
      const k = pool.findIndex((w) => w[0] === end || w[w.length - 1] === end);
      if (k < 0) break;
      const w = pool.splice(k, 1)[0];
      ring = ring.concat(w[0] === end ? w.slice(1) : w.slice(0, -1).reverse());
    }
    if (ring.length > 3 && ring[0] === ring[ring.length - 1]) rings.push(ring);
  }
  return rings;
}

export function convertOsm(osm, { lat0, lon0, name, bbox }) {
  const proj = makeProjection(lat0, lon0);
  const nodes = new Map(), ways = new Map();
  for (const e of osm.elements) {
    if (e.type === 'node') nodes.set(e.id, e);
    else if (e.type === 'way') ways.set(e.id, e);
  }
  const ringToLocal = (ids) => {
    const out = [];
    for (const id of ids) {
      const n = nodes.get(id);
      if (!n) return null;
      out.push(...proj.toLocal(n.lat, n.lon));
    }
    return out;
  };
  const names = [], nameIdx = new Map();
  const nm = (s) => {
    if (!s) return -1;
    if (!nameIdx.has(s)) { nameIdx.set(s, names.length); names.push(s); }
    return nameIdx.get(s);
  };
  const roads = [], buildings = [], areas = [], pois = [], signals = [];
  const usedWays = new Set();

  const addPolygonFeature = (tags, ring, id) => {
    if (!ring || ring.length < 8) return;
    let p = simplify(ring.slice(0, -2), 0.25); // drop the closing duplicate
    if (p.length < 6) return;
    const area = polygonArea(p);
    if (Math.abs(area) < 6) return;
    if (area < 0) { // store counter-clockwise in x/z (consistent winding for extrusion)
      const r = [];
      for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
      p = r;
    }
    if (tags.building && tags.building !== 'no' && !tags['building:part'] && tags.location !== 'underground') {
      const addr = tags['addr:housenumber'] && tags['addr:street'] ? `${tags['addr:housenumber']} ${tags['addr:street']}` : null;
      const label = tags.name || tags.brand || null;
      buildings.push({ h: +buildingHeight(tags).toFixed(1), t: tags.building, n: nm(label), a: nm(addr), c: tags['building:colour'] || tags['roof:colour'] || null, p, id });
    }
    const kind = areaKind(tags);
    if (kind) areas.push({ k: kind, n: nm(tags.name), p });
    const cat = poiCategory(tags);
    if (cat) {
      const [cx, cz] = centroid(p);
      pois.push({ n: nm(tags.name || tags.brand), c: cat, b: tags.brand || null, x: cx, z: cz, addr: tags['addr:housenumber'] && tags['addr:street'] ? `${tags['addr:housenumber']} ${tags['addr:street']}` : null });
    }
  };

  for (const e of osm.elements) {
    if (e.type === 'relation' && e.tags && (e.tags.type === 'multipolygon' || e.tags.building)) {
      const outer = e.members.filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '')).map((m) => ways.get(m.ref)?.nodes).filter(Boolean);
      for (const ring of assembleRings(outer)) addPolygonFeature(e.tags, ringToLocal(ring), e.id);
      for (const m of e.members) if (m.type === 'way') usedWays.add(m.ref);
    }
  }
  for (const w of ways.values()) {
    const t = w.tags;
    if (!t) continue;
    if (t.highway && ROAD_CLASSES[t.highway] && t.area !== 'yes') {
      const p = ringToLocal(w.nodes);
      if (!p || p.length < 4) continue;
      const oneway = t.oneway === 'yes' || t.oneway === '1' || t.highway === 'motorway' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : 0;
      roads.push({ n: nm(t.name || t.ref || null), k: CLASS_ORDER.indexOf(t.highway), w: +roadWidth(t).toFixed(1), o: oneway, p: simplify(p, 0.5), sv: t.service || null });
      continue;
    }
    const closed = w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];
    if (closed && (t.building || areaKind(t) || poiCategory(t)) && !(usedWays.has(w.id) && !t.building)) addPolygonFeature(t, ringToLocal(w.nodes), w.id);
  }
  for (const n of nodes.values()) {
    const t = n.tags;
    if (!t) continue;
    if (t.highway === 'traffic_signals') signals.push(...proj.toLocal(n.lat, n.lon));
    const cat = poiCategory(t);
    if (cat) {
      const [x, z] = proj.toLocal(n.lat, n.lon);
      pois.push({ n: nm(t.name || t.brand), c: cat, b: t.brand || null, x, z, addr: t['addr:housenumber'] && t['addr:street'] ? `${t['addr:housenumber']} ${t['addr:street']}` : null });
    }
  }
  const [s, w, nth, e] = bbox;
  const [x0, z1] = proj.toLocal(s, w), [x1, z0] = proj.toLocal(nth, e);
  return { proj, city: { name, origin: { lat: lat0, lon: lon0 }, bounds: [x0, z0, x1, z1], names, roads, buildings, areas, pois, signals } };
}

// ---------- spawn ----------
// Find a store by brand near a named street, then a spot in its car park facing the entrance side.
export function findSpawn(city, { brand, nearStreet }) {
  const want = brand.toLowerCase();
  const streetIdx = city.names.findIndex((s) => s.toLowerCase() === nearStreet.toLowerCase() || s.toLowerCase().replace(' road', ' rd') === nearStreet.toLowerCase());
  const streetSegs = city.roads.filter((r) => r.n === streetIdx);
  const distToStreet = (x, z) => {
    let best = Infinity;
    for (const r of streetSegs) for (let i = 0; i < r.p.length - 2; i += 2) best = Math.min(best, distToSegment(x, z, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]));
    return best;
  };
  const matches = (i) => i >= 0 && city.names[i].toLowerCase().includes(want);
  const candidates = [
    ...city.buildings.filter((b) => matches(b.n)).map((b) => ({ c: centroid(b.p), b })),
    ...city.pois.filter((p) => matches(p.n)).map((p) => ({ c: [p.x, p.z], b: city.buildings.find((b) => pointInPolygon(p.x, p.z, b.p)) || null })),
  ];
  if (!candidates.length) return null;
  candidates.sort((a, b) => distToStreet(...a.c) - distToStreet(...b.c));
  const store = candidates[0];
  const [sx, sz] = store.c;
  // Car parks near the store, nearest first.
  const lots = city.areas.filter((a) => a.k === 'parking').map((a) => ({ a, d: Math.hypot(centroid(a.p)[0] - sx, centroid(a.p)[1] - sz) })).filter((l) => l.d < 250).sort((p, q) => p.d - q.d);
  const blocked = (x, z) => city.buildings.some((b) => pointInPolygon(x, z, b.p) || (Math.abs(centroid(b.p)[0] - x) < 120 && distToPolygonEdge(x, z, b.p) < 5));
  for (const { a } of lots) {
    let best = null;
    const xs = a.p.filter((_, i) => i % 2 === 0), zs = a.p.filter((_, i) => i % 2 === 1);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 2) {
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += 2) {
        if (!pointInPolygon(x, z, a.p) || distToPolygonEdge(x, z, a.p) < 3 || blocked(x, z)) continue;
        const d = Math.hypot(x - sx, z - sz);
        const score = Math.abs(d - 45); // a few rows back from the doors
        if (!best || score < best.score) best = { x, z, score };
      }
    }
    if (best) return { x: best.x, z: best.z, heading: Math.atan2(sx - best.x, sz - best.z), store: city.names[store.b?.n ?? -1] || brand };
  }
  // No mapped car park: stand off the store toward the named street.
  return { x: sx, z: sz + 40, heading: Math.PI, store: brand };
}

// ---------- encoding ----------
const q = (v) => Math.round(v * 10); // decimetres
export function encodeCity(city) {
  return {
    v: 1,
    name: city.name,
    origin: city.origin,
    bounds: city.bounds.map((v) => Math.round(v)),
    attribution: city.attribution,
    spawn: city.spawn,
    names: city.names,
    roadClasses: CLASS_ORDER,
    roads: city.roads.map((r) => [r.n, r.k, r.w, r.o, r.p.map(q), r.sv ? 1 : 0]),
    buildings: city.buildings.map((b) => [b.n, b.a, b.h, b.c, b.p.map(q)]),
    areas: city.areas.map((a) => [a.k, a.n, a.p.map(q)]),
    pois: city.pois.map((p) => [p.n, p.c, q(p.x), q(p.z), p.b, p.addr]),
    signals: city.signals.map(q),
    imagery: city.imagery || [],
  };
}
