// Builds a small synthetic Overpass JSON shaped like real OSM output: a strip mall with an Albertsons and its
// car park on Margarita Road, cross streets, houses, a park and some shops. Only for testing the bake pipeline.
import { writeFileSync } from 'node:fs';

const lat0 = 33.501, lon0 = -117.152;
const mLat = 1 / 111320, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
let nid = 1, wid = 1;
const elements = [];
const node = (x, z, tags) => { const id = nid++; elements.push({ type: 'node', id, lat: lat0 - z * mLat, lon: lon0 + x * mLon, ...(tags ? { tags } : {}) }); return id; };
const way = (pts, tags, closed = false) => {
  const ids = pts.map(([x, z]) => node(x, z));
  if (closed) ids.push(ids[0]);
  elements.push({ type: 'way', id: wid++, nodes: ids, tags });
};
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

// Margarita Road runs north-south at x = 0; Rancho Vista Road crosses at z = 0; a residential street at z = 260.
way([[0, -500], [0, 0], [0, 500]], { highway: 'secondary', name: 'Margarita Road', lanes: '6' });
way([[-500, 0], [0, 0], [500, 0]], { highway: 'secondary', name: 'Rancho Vista Road', lanes: '4' });
way([[-400, 260], [0, 260]], { highway: 'residential', name: 'Calle Medusa' });
way([[-400, 260], [-400, 450]], { highway: 'residential', name: 'Via Lobo' });
node(0, 0, { highway: 'traffic_signals' });
// Strip mall east of Margarita: Albertsons (the anchor), smaller shops, the car park in front facing the road.
way(rect(150, -260, 260, -150), { building: 'retail', name: 'Albertsons', shop: 'supermarket', brand: 'Albertsons', 'addr:housenumber': '40425', 'addr:street': 'Winchester Road' }, true);
way(rect(150, -140, 260, -100), { building: 'retail' }, true);
node(205, -120, { shop: 'hairdresser', name: 'Supercuts' });
way(rect(150, -90, 260, -50), { building: 'retail' }, true);
node(205, -70, { amenity: 'fast_food', name: 'Rubio’s Coastal Grill' });
way(rect(25, -280, 145, -40), { amenity: 'parking', parking: 'surface' }, true);
way([[25, -160], [145, -160]], { highway: 'service', service: 'parking_aisle' });
way([[0, -160], [25, -160]], { highway: 'service' });
// A fuel station on the corner.
way(rect(30, 20, 70, 50), { building: 'roof', amenity: 'fuel', name: 'Chevron', brand: 'Chevron' }, true);
// Houses along Calle Medusa.
for (let k = 0; k < 8; k++) way(rect(-380 + k * 45, 272, -350 + k * 45, 300), { building: 'house', 'addr:housenumber': String(31000 + k * 10), 'addr:street': 'Calle Medusa' }, true);
// A park with a name.
way(rect(-300, 40, -60, 220), { leisure: 'park', name: 'Margarita Community Park' }, true);
writeFileSync(process.argv[2], JSON.stringify({ version: 0.6, generator: 'fixture', elements }));
console.log(`fixture: ${elements.length} elements`);
