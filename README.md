# Cyberpunk Drift

A high-end 3D arcade drifting game for the browser: a rain-soaked neon city at night,
wet asphalt reflections, volumetric fog, tyre smoke, and full controller support.

![Player car rendered from the Blender generator](docs/images/player_car_preview.jpg)
<sub>The player car, generated entirely by `blender/scripts/cyberpunk_car.py` and rendered by its preview stage.</sub>

## Game modes

- **Free Drift**: an open night city with drift zones, combos and scoring.
- **Highway Traffic Swimming**: an endless neon highway where you weave through dense
  traffic at speed for near-miss combos.

## Status

**Phase 1: core driving.** The car drives on a neon test pad with ramps, drift pylons
and cone slaloms, on keyboard or controller. It has an arcade drift model (Rapier
physics), controller rumble and a follow camera with speed lag. See
[docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

```bash
npm install
npm run dev          # open the printed URL; add ?tune for the live handling panel
npm test             # 32 tests, incl. headless driving scenarios on the real car
npm run build        # typecheck + production build
```

## Controls

| | Keyboard | Controller |
|---|---|---|
| Steer | A / D or ← / → | Left stick |
| Throttle | W or ↑ | RT / R2 |
| Brake / reverse | S or ↓ | LT / L2 |
| Handbrake (drift) | Space | A / Cross |
| Camera: next view + reset | R | Y / Triangle |
| Look around | – | Right stick |
| Reset car | Backspace | View / Share |
| Rumble on/off · help | V · H | – · Menu |

Drift: at speed, pull the handbrake while steering, then hold throttle and counter-steer
toward where the car is travelling to hold the slide and keep your speed. Steer into the
turn for more angle; counter-steer fully or lift off to straighten out. Press any button
once so the browser exposes your controller.

Regenerate the car (Blender 4.2 LTS+ on your `PATH`):

```bash
npm run assets:car   # blender -b -P blender/scripts/cyberpunk_car.py -- --export public/models/cars/player_car.glb
```

Or open `blender/scripts/cyberpunk_car.py` in Blender's Scripting workspace and press
**Run Script** to get the car plus a wet-street preview scene.

## Tech

three.js `WebGPURenderer` + TSL (automatic WebGL2 fallback) · Rapier physics (WASM) ·
TypeScript + Vite · Gamepad API with rumble · Blender Python -> glTF asset pipeline.

## Docs

| | |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Stack, runtime loop, controls, drift model, rendering and atmosphere, game modes, budgets, directory layout |
| [Roadmap](docs/ROADMAP.md) | Phased milestones with exit checks, and risks |
| [Blender pipeline](docs/BLENDER_PIPELINE.md) | Running the generators, naming contract, material rules, export and optimisation |
