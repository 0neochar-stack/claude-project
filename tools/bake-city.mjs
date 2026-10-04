#!/usr/bin/env node
// Bakes a real city for the "Pick a city" mode:
//   OpenStreetMap (Overpass API)  -> roads, names, buildings, parks, car parks, businesses, signals   (ODbL)
//   USDA NAIP / USGS aerial photos -> ground and roof imagery tiles                                   (public domain)
//
//   node tools/bake-city.mjs temecula                 download and bake (needs network access to the hosts below)
//   node tools/bake-city.mjs temecula --osm file.json bake from an Overpass JSON you saved yourself
//   node tools/bake-city.mjs temecula --no-imagery    skip the aerial photos
//
// Output: public/cities/<id>/city.json, public/cities/<id>/img/*.jpg, and public/cities/index.json.
// Downloads use curl, which honours HTTPS_PROXY and the system CA store.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertOsm, findSpawn, encodeCity } from './citydata.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
// Public-domain imagery, tried in order: USDA NAIP (0.6 m), then the USGS National Map imagery basemap.
const IMAGERY = [
  (b, w, h) => `https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/exportImage?bbox=${b}&bboxSR=4326&imageSR=4326&size=${w},${h}&format=jpg&compressionQuality=82&f=image`,
  (b, w, h) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export?bbox=${b}&bboxSR=4326&imageSR=4326&size=${w},${h}&format=jpg&transparent=false&f=image`,
];
const UA = 'cyberpunk-drift-city-baker/1.0 (+https://github.com/0neochar-stack/claude-project)';

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const cities = JSON.parse(readFileSync(join(ROOT, 'tools/cities.json'), 'utf8'));
if (!id || !cities[id]) {
  console.error(`usage: node tools/bake-city.mjs <${Object.keys(cities).join('|')}> [--osm file.json] [--no-imagery]`);
  process.exit(1);
}
const cfg = cities[id];
const out = opt('--out') || join(ROOT, 'public/cities', id);
mkdirSync(join(out, 'img'), { recursive: true });

function curl(url, file, { data = null, timeout = 300 } = {}) {
  const a = ['-sS', '-f', '-L', '--max-time', String(timeout), '-A', UA, '-o', file];
  if (data) a.push('--data-urlencode', `data=${data}`);
  execFileSync('curl', [...a, url], { stdio: ['ignore', 'ignore', 'pipe'] });
}
function overpass(query, file) {
  let err;
  for (const url of OVERPASS) {
    try { curl(url, file, { data: query, timeout: 900 }); return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { err = e; console.warn(`  ${url} failed: ${String(e.stderr || e.message).trim().slice(0, 160)}`); }
  }
  throw new Error(`Overpass unreachable: ${String(err?.stderr || err?.message).trim()}`);
}

// ---------- 1. map data ----------
let bbox = cfg.bbox; // [south, west, north, east]
let osm;
const cache = join(ROOT, 'tools/.cache');
mkdirSync(cache, { recursive: true });
if (opt('--osm')) {
  osm = JSON.parse(readFileSync(opt('--osm'), 'utf8'));
  console.log(`map data: ${opt('--osm')} (${osm.elements.length} elements)`);
} else {
  if (cfg.boundary) {
    console.log(`finding the ${cfg.boundary.name} city limits...`);
    try {
      const b = overpass(`[out:json][timeout:60];relation["boundary"="administrative"]["name"="${cfg.boundary.name}"]["admin_level"="${cfg.boundary.admin_level}"];out bb;`, join(cache, `${id}-boundary.json`));
      const r = b.elements[0]?.bounds;
      if (r) bbox = [r.minlat - 0.004, r.minlon - 0.005, r.maxlat + 0.004, r.maxlon + 0.005];
    } catch (e) { console.warn(`  using the configured box instead (${e.message.slice(0, 120)})`); }
  }
  const b = bbox.join(',');
  console.log(`downloading OpenStreetMap data for ${b} ...`);
  const q = `[out:json][timeout:900][maxsize:1073741824];
(
  way["highway"](${b});
  way["building"](${b}); relation["building"](${b});
  way["landuse"](${b}); relation["landuse"](${b});
  way["leisure"](${b}); relation["leisure"](${b});
  way["natural"~"water|wood|scrub|grassland"](${b}); relation["natural"~"water|wood"](${b});
  way["amenity"](${b}); relation["amenity"](${b});
  way["shop"](${b}); way["tourism"](${b}); way["office"](${b});
  node["shop"](${b}); node["amenity"](${b}); node["tourism"](${b}); node["office"](${b}); node["leisure"](${b}); node["healthcare"](${b}); node["craft"](${b});
  node["highway"="traffic_signals"](${b});
);
out body;
>;
out skel qt;`;
  osm = overpass(q, join(cache, `${id}-osm.json`));
  console.log(`  ${osm.elements.length} elements (${(statSync(join(cache, `${id}-osm.json`)).size / 1e6).toFixed(1)} MB)`);
}

const lat0 = (bbox[0] + bbox[2]) / 2, lon0 = (bbox[1] + bbox[3]) / 2;
const { proj, city } = convertOsm(osm, { lat0, lon0, name: cfg.name, bbox });
city.attribution = 'Map data © OpenStreetMap contributors (ODbL). Aerial imagery: USDA NAIP / USGS, public domain.';
console.log(`roads ${city.roads.length}, buildings ${city.buildings.length}, areas ${city.areas.length}, places ${city.pois.length}, signals ${city.signals.length / 2}`);

// ---------- 2. where you start ----------
const spawn = cfg.spawn ? findSpawn(city, cfg.spawn) : null;
city.spawn = spawn ? { x: +spawn.x.toFixed(1), z: +spawn.z.toFixed(1), heading: +spawn.heading.toFixed(3), label: cfg.spawn.label || spawn.store } : { x: 0, z: 0, heading: 0, label: cfg.name };
console.log(spawn ? `start: ${city.spawn.label} at (${city.spawn.x}, ${city.spawn.z})` : 'start: city centre (store not found in the data)');

// ---------- 3. aerial imagery ----------
if (!flag('--no-imagery')) {
  const [bx0, bz0, bx1, bz1] = city.bounds;
  const tiles = [];
  for (const L of cfg.imagery) {
    const span = L.mpp * L.tile;
    const cx = L.radius ? city.spawn.x : (bx0 + bx1) / 2, cz = L.radius ? city.spawn.z : (bz0 + bz1) / 2;
    const x0 = L.radius ? cx - L.radius : bx0, x1 = L.radius ? cx + L.radius : bx1;
    const z0 = L.radius ? cz - L.radius : bz0, z1 = L.radius ? cz + L.radius : bz1;
    const nx = Math.ceil((x1 - x0) / span), nz = Math.ceil((z1 - z0) / span);
    console.log(`imagery level ${L.lod}: ${nx} x ${nz} tiles at ${L.mpp} m/px`);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const tx0 = x0 + i * span, tz0 = z0 + j * span, tx1 = tx0 + span, tz1 = tz0 + span;
        const [n, w] = proj.toLatLon(tx0, tz0), [s, e] = proj.toLatLon(tx1, tz1);
        const file = `img/L${L.lod}_${i}_${j}.jpg`;
        const dest = join(out, file);
        if (!existsSync(dest)) {
          let ok = false;
          for (const make of IMAGERY) {
            try { curl(make(`${w},${s},${e},${n}`, L.tile, L.tile), dest, { timeout: 120 }); ok = statSync(dest).size > 2000; } catch { ok = false; }
            if (ok) break;
          }
          if (!ok) { console.warn(`  tile ${file} failed`); continue; }
        }
        tiles.push({ f: file, lod: L.lod, r: [Math.round(tx0), Math.round(tz0), Math.round(tx1), Math.round(tz1)] });
      }
    }
  }
  city.imagery = tiles;
}

// ---------- 4. write ----------
const json = JSON.stringify(encodeCity(city));
writeFileSync(join(out, 'city.json'), json);
console.log(`wrote ${join(out, 'city.json')} (${(json.length / 1e6).toFixed(1)} MB), ${city.imagery?.length || 0} imagery tiles`);
if (opt('--out') || cfg.hidden) process.exit(0); // test bakes do not touch the shipped city list
const indexFile = join(ROOT, 'public/cities/index.json');
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { cities: [] };
index.cities = index.cities.filter((c) => c.id !== id).concat([{ id, name: cfg.name, start: city.spawn.label }]);
writeFileSync(indexFile, JSON.stringify(index, null, 2));
