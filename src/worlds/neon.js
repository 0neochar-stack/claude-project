// Neon Tokyo: the rain-soaked grid city. Wraps the city builder, its collision, weather and wet reflections
// behind the world interface main.js uses for every place you can drive.
//
// World interface:
//   root, spawn, env, collide(car), nearestRoad(x, z, h), blocked(x, z, m), groundAt(x, z),
//   drawMinimap(ctx, car, size), placeInfo(car), update(t, dt, frame), render(renderer, scene, camera, frameNo),
//   onReset(), dispose()
import * as THREE from 'three';
import { collide, nearestRoad, SPAWN, BLOCKS, SOLID_BLOCKS, HALF, PILLARS, PLAZA_AREA } from '../world.js';
import { WetReflections } from '../wet.js';
import { buildCity } from '../city.js';
import { makeRain } from '../fx.js';
import { disposeTree } from './util.js';

export function createNeonWorld({ preset, sound, particles }) {
  const root = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0x6f5cff, 0x2a1030, 0.9);
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.35);
  moon.position.set(-60, 120, 40);
  root.add(hemi, moon);

  const refl = new WetReflections();
  refl.scale = preset.reflections ? preset.reflScale : 0.12;
  const city = buildCity(root, refl);
  const rain = makeRain(preset.rain);
  root.add(rain);

  // Minimap: the city pre-drawn at 1 px per metre.
  const mapImg = document.createElement('canvas');
  const off = HALF + 30;
  mapImg.width = mapImg.height = Math.ceil(off * 2);
  {
    const g = mapImg.getContext('2d');
    g.fillStyle = '#1a1030';
    g.fillRect(0, 0, mapImg.width, mapImg.height);
    g.fillStyle = '#5b5680';
    g.fillRect(30, 30, HALF * 2, HALF * 2);
    for (const b of BLOCKS) {
      if (b.plaza) continue;
      g.fillStyle = '#120c22';
      g.fillRect(b.x0 + off, b.z0 + off, b.x1 - b.x0, b.z1 - b.z0);
    }
    g.strokeStyle = '#ff3fb4';
    g.lineWidth = 2;
    g.strokeRect(PLAZA_AREA.x0 + off + 2, PLAZA_AREA.z0 + off + 2, PLAZA_AREA.x1 - PLAZA_AREA.x0 - 4, PLAZA_AREA.z1 - PLAZA_AREA.z0 - 4);
    g.fillStyle = '#ff3fb4';
    for (const p of PILLARS) { g.beginPath(); g.arc(p.x + off, p.z + off, p.r + 1, 0, Math.PI * 2); g.fill(); }
  }

  let flash = 0, nextLightning = 12 + Math.random() * 20, steamAcc = 0;
  const reflEvery = preset.reflections ? preset.reflEvery : 4;

  return {
    id: 'neon',
    name: 'Neon Tokyo',
    root,
    spawn: { ...SPAWN },
    env: {
      background: new THREE.Color(0x0d0718),
      fog: new THREE.FogExp2(0x1a0b24, 0.0068),
      exposure: 1.05,
      bloom: { strength: 0.85, radius: 0.55, threshold: 0.82 },
      far: 1800,
      headlights: true,
      rain: 1,
      wet: 1,
    },
    collide,
    nearestRoad,
    blocked(x, z, m) {
      if (Math.abs(x) > HALF - m || Math.abs(z) > HALF - m) return true;
      for (const b of SOLID_BLOCKS) if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m) return true;
      return false;
    },
    groundAt: () => 0,
    flat: true,
    drawMinimap(g, car, W) {
      const s = W / 2 / 150;
      const ch = Math.cos(car.h), sh = Math.sin(car.h);
      const a = -s * ch, b = -s * sh, c = s * sh, d = -s * ch;
      const px = car.x + off, pz = car.z + off;
      g.setTransform(a, b, c, d, W / 2 - a * px - c * pz, W / 2 - b * px - d * pz);
      g.drawImage(mapImg, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
    },
    placeInfo: () => 'Neo-Shinjuku · 02:14 · heavy rain',
    update(t, dt, { camera, car, playing }) {
      // Lightning now and then, with thunder rolling in after.
      nextLightning -= dt;
      if (nextLightning <= 0) {
        flash = 1;
        nextLightning = 15 + Math.random() * 30;
        sound.thunder(0.6 + Math.random() * 1.5);
      }
      const flicker = flash > 0 ? flash * (0.6 + 0.4 * Math.sin(t * 60)) : 0;
      flash = Math.max(0, flash - dt * 2.2);
      hemi.intensity = 0.9 + flicker * 3;
      rain.material.uniforms.uFlash.value = flicker;
      rain.material.uniforms.uTime.value = t;
      rain.material.uniforms.uCam.value.copy(camera.position);
      refl.uniforms.uTime.value = t;
      city.update(t, camera, flicker);
      city.setPieces.update(t, dt, playing ? car : null, sound);
      // Steam drifting up out of the manholes near the camera.
      steamAcc += dt * 9;
      while (steamAcc >= 1) {
        steamAcc -= 1;
        const v = city.steam[Math.floor(Math.random() * city.steam.length)];
        if (!v || Math.hypot(v.x - camera.position.x, v.z - camera.position.z) > 70) continue;
        particles.emit(v.x + (Math.random() - 0.5) * 0.6, 0.1, v.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, 1.1 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4, 0.8, 1.6, 2.5 + Math.random(), 0.16);
      }
    },
    // The wet roads mirror the city; on lower presets the mirror is refreshed every other frame.
    render(renderer, scene, camera, frameNo) {
      if (frameNo % reflEvery === 0) refl.render(renderer, scene, camera);
    },
    resize(w, h) { refl.setSize(w, h); },
    wetRoad: true,
    onReset() { city.setPieces.resetCones(); },
    dispose() {
      disposeTree(root);
      refl.target.dispose();
    },
    debug: { city },
  };
}
