# Real City mode: architecture

Goal: a completely free, street-view-style driving simulator. You drive freely around a real city built from OpenStreetMap (roads, street names, buildings, businesses, intersections, parks), with real street-level photos wherever they exist. First city: Temecula, California, starting in the Albertsons car park on Margarita Road.

Status: design. Nothing in this document has been verified against live services yet, because every map host is blocked by this cloud environment's network policy (see "Hosts to allow"). Coverage and exact image hosts get confirmed with one probe per host once they are allowed.

## 1. Data sources (all free)

| Need | Provider | API | Licence | Key needed |
|---|---|---|---|---|
| Roads, street names, lanes, one-ways, signals, buildings, heights, businesses, addresses, parks, car parks | OpenStreetMap via Overpass | `overpass-api.de/api/interpreter` | ODbL: attribute "© OpenStreetMap contributors" | No |
| **Street-level imagery (primary)** | **Mapillary** (Meta) | Graph API v4: `graph.mapillary.com` | CC BY-SA 4.0: attribute, share-alike | **Yes, a free client token** |
| Street-level imagery (supplement) | KartaView | `api.openstreetcam.org` | CC BY-SA 4.0 | No |
| Street-level imagery (supplement) | Panoramax (OSM community, federated) | `api.panoramax.xyz` | CC BY-SA 4.0 or Etalab, per instance | No |
| Aerial photo for ground and roofs | USDA NAIP, 0.6 m | `gis.apfo.usda.gov` ImageServer | Public domain | No |
| Aerial fallback | USGS National Map imagery | `basemap.nationalmap.gov` | Public domain | No |
| Terrain (Temecula is hilly) | USGS 3DEP elevation | `elevation.nationalmap.gov` ImageServer | Public domain | No |
| Search for a city by name ("Pick a city") | Nominatim | `nominatim.openstreetmap.org` | ODbL; max 1 request/s; no bulk use | No |

### Why Mapillary is the primary imagery source

It is the only free source with broad United States street-level coverage, including many 360° panoramas. Its API returns, per image:

- the photo's position and compass heading, corrected by Mapillary's structure-from-motion processing (`computed_geometry`, `computed_compass_angle`)
- whether it is a panorama (`is_pano`)
- capture time and sequence
- links to thumbnails at 256, 1024 and 2048 px, plus the original

KartaView and Panoramax are open and need no key, but their US coverage is thin. They fill gaps only.

### Ruled out

- **Google Street View:** paid. Its terms forbid storing images or building derived scenes.
- **Bing Streetside and Apple Look Around:** no public free API.

## 2. Hosts to allow in this cloud environment

Change the cloud environment's **Network access** setting (environment menu → Edit → Custom, keep the package-manager defaults) and add:

**Required**
- `overpass-api.de`: OpenStreetMap data
- `graph.mapillary.com`: Mapillary image search and metadata
- `*.fbcdn.net`: Mapillary image files. Thumbnails are served from Meta's CDN on varying subdomains such as `scontent-lax3-1.xx.fbcdn.net`, so this needs a wildcard.
- `gis.apfo.usda.gov`: NAIP aerial imagery

**Recommended**
- `tiles.mapillary.com`: coverage vector tiles. This is the fast way to map where imagery exists across a whole city before downloading anything.
- `elevation.nationalmap.gov`: terrain heights
- `basemap.nationalmap.gov`: aerial fallback
- `overpass.kumi.systems`: Overpass mirror, used if the main server is busy

**Optional supplements**
- `api.openstreetcam.org` and KartaView's image storage host. The exact storage host is confirmed on the first allowed request.
- `api.panoramax.xyz` plus the instances it points to (for example `panoramax.openstreetmap.fr`, `panoramax.ign.fr`)
- `nominatim.openstreetmap.org`: city search by name

**Mapillary token:** create a free account, then register an application at mapillary.com/dashboard/developers and copy its client token (it starts with `MLY|`). For baking, the token is passed as an environment variable and never written into the repository or the published game.

## 3. The hard constraint: the published game cannot fetch at runtime

The published game page runs under a strict content security policy:

- Scripts may load from a few public code CDNs.
- Everything else, including `fetch`, XHR and images from other sites, is blocked.
- `fetch()` of files published alongside the page works.

So the published game cannot call Mapillary or Overpass while you play. Everything must be **baked**: downloaded in this environment and published with the game.

The published game also has size limits: 15 MB per binary file, about 256 MB per version and 511 files per version. That leads to two delivery modes.

| | Published artifact (baked) | Self-hosted or local (live) |
|---|---|---|
| Where it runs | The claude.ai link | `npm run dev`, or any static host such as GitHub Pages |
| OpenStreetMap data | Whole city, baked | Whole city, baked |
| Aerial ground | Whole city at 2.4 m/px, 1.2 m within 3 km and 0.6 m within 1 km of the start | Same |
| Street-level photos | **A baked corridor**, about 1,000–1,500 images at 1024 px: the start area plus main roads, one image every ~20–30 m, packed into atlas files | **Whole city**, streamed from Mapillary as you drive. You paste your own token in the settings, stored only in your browser. |

For the published version, "entire city" means the whole road network, buildings and names, with photos where the bake budget reaches. Full photo coverage of every street needs the live mode.

One thing to verify on the first allowed probe: whether Mapillary's image CDN sends CORS headers. The live mode needs them to use photos as WebGL textures. If it doesn't, live photos can still be shown in a panel, just not projected onto buildings.

## 4. Pipeline

```
tools/cities.json            city config: bounding box or boundary name, start point, imagery levels, photo budget
tools/citydata.mjs           pure conversion: OSM → local metres, roads, buildings, areas, places, start point (unit tested)
tools/bake-city.mjs          orchestrates the downloads (curl through the proxy, one attempt per host, then stop and report)
tools/streetphotos.mjs       NEW: picks and downloads street photos
public/cities/index.json     list of baked cities for the picker
public/cities/<id>/city.json roads, names, buildings, areas, places, signals, start point, imagery and photo indexes
public/cities/<id>/img/      aerial tiles
public/cities/<id>/photos/   street photo atlases plus photos.json (position, heading, panorama flag, author, licence, source id)
public/cities/<id>/terrain/  height grid (phase 3)
```

How `tools/streetphotos.mjs` chooses photos:

1. Read coverage from `tiles.mapillary.com`. This is the cheapest way to see where imagery exists across the city.
2. Walk the OpenStreetMap road network from the start point, main roads first.
3. Every ~20–30 m along each road, pick the best image near that point. Score candidates by:
   - newest capture
   - panorama over flat photo
   - corrected heading along the road
   - quality score
4. Fill gaps from KartaView and Panoramax.
5. Download the 1024 px thumbnails and pack them into 4096×4096 atlases, 16 per file, about 3–5 MB each.
6. Record attribution per image: the creator's username and a link to the source image.

## 5. In the game

**World swap.** `main.js` gets a small world interface, so the neon city and real cities share the car, physics, sound, HUD, garage and drift scoring:

```
collide(car), nearestRoad(x, z, h), spawn, isBlocked(x, z, m) for the camera,
drawMinimap(ctx, car), env (sky, sun, fog, exposure), flags (rain, wet reflections),
placeInfo(car) → { street, crossStreet, nearestBusiness }, update(t, dt, camera)
```

**Real-city world.** Everything is built only from data:

- **Ground:** aerial photo tiles. Real lane paint, car parks and grass come from the photo, so no road meshes are drawn where imagery exists.
- **Buildings:** extruded from OpenStreetMap footprints and heights. Roofs are textured from the aerial photo. Walls are plain until a street photo covers them.
- **Labels:** street names drawn along the road surface the way Street View does, and floating name tags for businesses and parks.
- **HUD:** shows the street you're on, the next cross street and the nearest business.
- **Collisions:** against building footprints. The vector minimap draws from OpenStreetMap.

**Street-level layer.** This comes in two steps:

1. **Street View panel.** While you drive, a panel shows the nearest real photo matching your position and heading, with the street name and the photo credit. Pressing V switches to a full-screen Street View that you can look around in and step along the photos, then drive on.
2. **Photo-textured facades.** Photos with corrected position and heading are projected onto the extruded building walls and the ground, so real storefronts appear on the 3D buildings near the start and along main roads.

The facade projection works best in front of the camera position where each photo was taken. Parked cars and passers-by in the photos get projected too, so it's limited to walls that face the camera within about 40 m.

**No invented models.** Following your rule, nothing is hand-modelled unless it comes from data. Trees, poles and signs only appear if OpenStreetMap maps them, and then only as data markers. Real detail comes from photos.

## 6. Phases

1. **Allow the hosts and get a token.** Then one probe per host to confirm reachability, exact image CDN hosts, CORS, and Mapillary coverage around the Temecula start.
2. **Bake Temecula's map data and aerial imagery.** Build the world swap, the real-city world, labels, HUD, collisions and the city picker. Test against the existing synthetic fixture.
3. **Street-level imagery:**
   - the photo bake for the start corridor
   - the Street View panel and full-screen viewer
   - attribution
4. **Facade projection from photos, and terrain** from USGS 3DEP elevation.
5. **Live mode** for self-hosted runs (streamed Mapillary with your own token), and **city search** for more cities through Nominatim.

## 7. Attribution and licences shown in game

- OpenStreetMap: "© OpenStreetMap contributors" (ODbL)
- Mapillary, KartaView and Panoramax: per-photo creator and source, CC BY-SA 4.0
  - Facade textures made from these photos are derivatives and are shared under CC BY-SA 4.0.
- USDA NAIP, USGS and 3DEP: public domain, credited anyway

## 8. Work already done (not yet committed)

- `tools/citydata.mjs`: projection, road classes and widths, building heights, area and place classification, multipolygon assembly, finding the Albertsons near a named street and choosing a car park spot facing it, compact encoding
- `tools/bake-city.mjs` and `tools/cities.json`: the bake command line, with an offline `--osm file.json` mode
- `tests/fixtures/make-osm-fixture.mjs`: a synthetic OpenStreetMap-shaped fixture. It bakes correctly offline and finds the start point in the Albertsons car park.
