# Roadmap

Each phase ends with something playable or visibly better, plus an exit check that
can be run. The phases build on each other in order, but art (Blender scripts) can run
one phase ahead of code.

| Phase | Theme | Headline result |
|---|---|---|
| 0 | Foundations | Plan, toolchain, and the player car generated in Blender and rendering in the browser ✅ |
| 1 | Core driving | Drift the car around a test pad on keyboard **and** controller ✅ (needs a hands-on feel pass) |
| 2 | Look development | The test pad looks like the Blender preview: wet, neon, raining |
| 3 | Free Drift mode | Open neon city with drift scoring |
| 4 | Highway mode | Endless highway with traffic and near-miss combos |
| 5 | Game feel | Audio, haptics tuning, menus, garage/livery |
| 6 | Ship | Performance pass, compression, deploy |

---

## Phase 0: Foundations ✅

- [x] Architecture, roadmap and asset-pipeline docs
- [x] Vite + TypeScript + three.js (WebGPU with WebGL2 fallback) scaffold
- [x] `blender/scripts/cyberpunk_car.py`: procedural player car, preview stage, headless GLB export
- [x] `public/models/cars/player_car.glb` generated, passes the Khronos glTF validator (0 errors / 0 warnings)
- [x] `src/main.ts` smoke test: GLB loads with materials, neon emissive and root metadata intact

**Exit:** `npm run dev` shows the car with glowing neon. ✅

## Phase 1: Core driving ✅

- [x] `core/`: `Game` composition root, `FixedStepLoop` (120 Hz) with render interpolation
- [x] `assets/vehicleRig`: parses the GLB naming contract into wheels, sockets, collider hull, extras
- [x] `input/`: keyboard + Gamepad API behind one `DriveInput`, deadzones and curves, hot-plug, `Haptics`
      (acceleration, drift slip, collisions, landings; trigger-rumble on supporting pads)
- [x] `physics/`: Rapier world, collision layers, `ArcadeVehicle`: tyre colliders on the
      `WHEEL_*` sockets, shape-cast suspension, tyre model, handbrake traction loss, drift-angle
      assist, counter-steer speed retention, stability assist, reverse, air control
- [x] `camera/ChaseCamera`: chase / far / hood, rotational and speed lag, FOV kick, look-around, shake
- [x] `world/TestTrack`: neon grid pad, walls, kicker, jump + landing, table-top, drift pylons, cone slalom
- [x] HUD with a live input and rumble monitor; `?tune` live tuning panel
- [x] Vitest: 32 tests, including 12 headless driving scenarios on the real GLB
- Moved: `EventBus` / `StateMachine` to Phase 3 (first needed by game modes); `AssetLibrary`
  caching and KTX2 to Phase 2; camera collision push-in to Phase 3 (the city has walls to hit)

**Exit:** a figure-eight drift around two cones is repeatable on keyboard and on an Xbox/PS
controller, and rumble tracks slip. Stable 60 fps. No tunnelling through walls at 250 km/h.

Verified automatically: drift entry, hold, exit and speed retention in headless scenarios.
In headless Chromium, keyboard and a mocked Xbox pad both drive, drift and cycle cameras,
and the rumble effects the game sends track acceleration, slip and impacts. A 100 km/h
wall hit neither tunnels nor clips. Still needs a person: the feel on a real controller,
the frame rate on a real GPU (CI only has software rendering), and a 250 km/h wall hit.

## Phase 2: Look development

- `render/`: `RenderPipeline` post stack (bloom, SSR, TRAA, height fog, motion blur, grade) behind `QualityManager` tiers
- `WetAsphalt` material: puddle mask, ripples, streaks
- `fx/`: `Rain` (compute or vertex path), `Splashes`, `TireSmoke`, `SkidMarks`, `Spray`, `LensDroplets`
- Vehicle lights: headlight spots, underglow, brake lights driven through `LIGHT_Tail`
- KTX2 texture pipeline for the first textures (asphalt detail, puddle mask)

**Exit:** side-by-side with `docs/images/player_car_preview.jpg`, the in-game test pad reads
as the same world. High tier holds 60 fps on the reference GPU.

## Phase 3: Free Drift mode

- Blender: `city_kit.py` (road tiles, modular towers with window emissive atlases, neon signs, billboards, props). Extract `blender/scripts/lib/` shared helpers. Add `export_all.py`
- `world/city/`: seeded `CityGenerator`, `ChunkStreamer`, `DriftZones`
- `scoring/`: `DriftScorer`, `ComboMeter`; `ui/Hud` (speed, score, combo, zone timer)
- `modes/FreeDriftMode`, main menu, pause

**Exit:** ten minutes of free roam without hitches (> 55 fps worst second); drift zones
score and persist best times locally.

## Phase 4: Highway Traffic Swimming

- Blender: `traffic_cars.py` generating 4+ traffic archetypes with LOD0/LOD1 and shared materials
- `world/highway/`: `HighwayStreamer` (pooled spline segments, barriers, gantries, tunnels), `FloatingOrigin`
- `world/traffic/`: `TrafficSystem` (SoA + instanced rendering), `IDM`, `Mobil` lane changes, crash handoff to dynamic bodies
- `scoring/NearMissDetector`, run timer, results screen

**Exit:** 200+ traffic cars simulated, 60 fps; near misses feel fair (tuned by recorded
telemetry); 30-minute runs have no precision jitter.

## Phase 5: Game feel and polish

- `audio/`: engine (granular / crossfaded loops by RPM and load), tyre squeal by slip, rain ambience, impacts, synthwave soundtrack with ducking
- Haptics tuning pass per event; controller button prompts per device family
- Camera shake, speed lines, boost FX (chromatic aberration, FOV kick)
- Garage: paint and neon livery. The `NEON_*` / `LIGHT_*` material contract makes this pure data
- Settings: quality tier, key/button remapping, rumble intensity, accessibility (reduced flashing, colour-blind neon palettes)

## Phase 6: Performance and ship

- LODs everywhere, `gltf-transform optimize` (meshopt + KTX2) in the asset build
- Profile on target hardware; shader warm-up and pipeline caching to kill first-frame hitches
- Loading screen with progressive asset streaming
- Static deploy (e.g. GitHub Pages / Cloudflare Pages) with long-cache hashed assets

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| WebGPU missing on some browsers | `WebGPURenderer` falls back to WebGL2 automatically; TSL keeps one shader codebase; rain has a non-compute path |
| Arcade drift feels floaty or twitchy | Authored grip curves plus assist layer, live tuning panel, recorded input playback for A/B tests |
| High-speed tunnelling | 120 Hz physics, Rapier CCD on the player, swept near-miss checks |
| Float precision on endless highway | Floating origin every 2 km |
| Particle overdraw (rain, smoke) kills fill rate | Tiered counts, half-res particle pass on Low, soft-particle depth fade |
| Controller differences / vibration support varies | Standard mapping plus remap UI; every haptic call feature-detected and optional |
| Asset bloat | Per-asset triangle budgets enforced by the generator scripts; meshopt + KTX2 |
