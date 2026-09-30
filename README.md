# Cyberpunk Drift

A neon, rain-soaked street drifting game for the browser (three.js). Drift Hunters style handling and chain scoring with a Forza-like presentation.

- **City**: a grid of real roads (avenues up to 30 m wide, side streets, crosswalks, lane paint), raised sidewalks, towers with lit windows and shopfronts, neon signs, street lamps and an open drift lot with pylons.
- **Rain**: GPU rain streaks, lightning, wet asphalt with planar reflections, standing puddles that mirror the city and ripple with raindrops.
- **Handling** (`src/physics.js`): RWD bicycle model with a tyre curve, friction ellipse (throttle breaks the rear loose), weight transfer, handbrake, 6-speed auto/manual gearbox, and drift assist (counter-steer help plus an angle limiter so slides hold instead of spinning).
- **Scoring** (`src/drift.js`): angle × speed builds a chain, the multiplier climbs to ×5 while you stay sideways, the chain banks after 2.2 s, and a wall hit loses it.
- **Controls**: keyboard, gamepad and on-screen touch buttons.

## Develop

```sh
npm install
npm test        # headless handling checks
npm run build   # dist/index.html + dist/game.js (dist/preview.html for local testing)
```
