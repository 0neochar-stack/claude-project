// Cars, upgrades and the saved player profile. Pure data with no three.js import, so tests/sim.mjs can
// build every car's physics spec in node.
import { SPEC, torqueCurve, boostMultiplier } from './physics.js';

// Each car overrides the base spec, sets its look (body proportions, wing, default colours) and engine voice.
export const CARS = [
  {
    id: 'ronin',
    name: 'Ronin RS',
    tagline: 'Turbo six widebody. Balanced, forgiving, sideways all night.',
    price: 0,
    tier: 1,
    spec: { torque: 315, spoolRpm: 3200 },
    engine: 'i6',
    forced: { turbo: 0.48, sc: 0.3 },
    stock: { turbo: true, supercharger: true, induction: 'twin' },
    look: { scale: [1, 1, 1], wing: 'duck', paint: 0, neon: 0, rims: 0, wheels: 'six', exhaust: 'single', decal: 'Ronin', plate: '20-26', cage: 'accent' },
  },
  {
    id: 'kaze',
    name: 'Kaze 86',
    tagline: 'Featherweight high-revver. Less power, more angle, all momentum.',
    price: 15000,
    tier: 0.8,
    spec: {
      mass: 1060, inertia: 1320, a: 1.15, b: 1.3, torque: 300, redline: 8600, shiftUpRpm: 8100, shiftDownRpm: 3600,
      gears: [3.6, 2.4, 1.78, 1.38, 1.1, 0.9], finalDrive: 4.1, muLat: 1.06, maxSteer: 0.88, spoolRpm: 4200,
    },
    engine: 'boxer4',
    forced: { turbo: 0.42, sc: 0.32 },
    stock: { turbo: false, supercharger: false, induction: 'na' },
    look: { scale: [0.93, 0.95, 0.92], wing: 'none', paint: 3, neon: 1, rims: 1, wheels: 'mesh', exhaust: 'center', decal: 'Kaze', plate: '86-86', cage: 'accent' },
  },
  {
    id: 'oni',
    name: 'Oni V8',
    tagline: 'Big-block brute. Lights the rears up in any gear. Heavy on the nose.',
    price: 60000,
    tier: 1.6,
    spec: {
      mass: 1520, inertia: 2150, a: 1.28, b: 1.4, torque: 590, redline: 7000, shiftUpRpm: 6600, shiftDownRpm: 2600,
      gears: [3.0, 2.0, 1.48, 1.18, 0.96, 0.8], finalDrive: 3.5, muLat: 1.1, muLong: 1.22, drag: 0.43, spoolRpm: 3000,
    },
    engine: 'v8',
    forced: { turbo: 0.3, sc: 0.32 },
    stock: { turbo: false, supercharger: false, induction: 'na' },
    look: { scale: [1.07, 1.03, 1.06], wing: 'gt', paint: 6, neon: 2, rims: 2, wheels: 'dish', exhaust: 'quad', decal: 'Oni V8', plate: '66-66', cage: 'paint' },
  },
  {
    id: 'ryujin',
    name: 'Ryujin GT',
    tagline: 'Twin-turbo dragon. Huge grip, huge power, built for long chains at speed.',
    price: 150000,
    tier: 2.5,
    spec: {
      mass: 1360, inertia: 1820, a: 1.22, b: 1.36, torque: 410, spoolRpm: 3600, redline: 8400, shiftUpRpm: 7900, shiftDownRpm: 3300,
      gears: [3.2, 2.15, 1.6, 1.27, 1.03, 0.85], finalDrive: 3.8, muLat: 1.16, muLong: 1.3, drag: 0.37, maxSteer: 0.86,
    },
    engine: 'i6tt',
    forced: { turbo: 0.46, sc: 0.26 },
    stock: { turbo: true, supercharger: false, induction: 'turbo' },
    look: { scale: [1.04, 0.96, 1.08], wing: 'gt', paint: 1, neon: 3, rims: 3, wheels: 'five', exhaust: 'dual', decal: 'Ryujin', plate: '32-32', cage: 'accent' },
  },
  // Street and drift cars, named by chassis code. Base torque is naturally aspirated; boost adds on top.
  {
    id: 'z33', name: 'Z33 Coupe', tagline: '3.5 V6, long hood, short tail. Torquey, balanced, made for third-gear slides.',
    price: 18000, tier: 1.1,
    spec: { mass: 1450, inertia: 1820, a: 1.22, b: 1.43, torque: 352, redline: 7000, shiftUpRpm: 6700, shiftDownRpm: 3000, gears: [3.79, 2.32, 1.62, 1.27, 1.0, 0.79], finalDrive: 3.54, muLat: 1.06, maxSteer: 0.8, spoolRpm: 3000 },
    engine: 'v6', forced: { turbo: 0.45, sc: 0.32 }, stock: { turbo: false, supercharger: false, induction: 'na' },
    look: { body: 'z33', scale: [1.0, 0.98, 0.93], wing: 'none', paint: 7, neon: 2, rims: 1, wheels: 'five', exhaust: 'dual', decal: 'Z33', plate: '35-03', cage: 'none', tail: 'boomerang', lhd: true },
  },
  {
    id: 'v35', name: 'V35 Coupe', tagline: 'The 3.5 V6 grand tourer. Longer and heavier than the Z, smooth once it is sideways.',
    price: 16000, tier: 1.0,
    spec: { mass: 1560, inertia: 2000, a: 1.26, b: 1.59, torque: 350, redline: 7000, shiftUpRpm: 6700, shiftDownRpm: 3000, gears: [3.79, 2.32, 1.62, 1.27, 1.0, 0.79], finalDrive: 3.54, muLat: 1.06, maxSteer: 0.78, spoolRpm: 3000 },
    engine: 'v6', forced: { turbo: 0.45, sc: 0.32 }, stock: { turbo: false, supercharger: false, induction: 'na' },
    look: { body: 'v35', scale: [1.0, 0.99, 1.02], wing: 'none', paint: 8, neon: 0, rims: 0, wheels: 'six', exhaust: 'dual', decal: 'V35', plate: '35-35', cage: 'none', tail: 'bar', lhd: true },
  },
  {
    id: 'v37', name: 'V37 Coupe', tagline: 'Twin-turbo 3.0 V6 from the factory. Heavy, fast, a little lazy to rotate.',
    price: 45000, tier: 1.5,
    spec: { mass: 1730, inertia: 2250, a: 1.3, b: 1.55, torque: 305, redline: 7000, shiftUpRpm: 6700, shiftDownRpm: 2800, gears: [4.7, 3.13, 2.1, 1.67, 1.29, 1.0], finalDrive: 2.94, muLat: 1.1, muLong: 1.24, maxSteer: 0.76, spoolRpm: 2600 },
    engine: 'v6', forced: { turbo: 0.48, sc: 0.3 }, stock: { turbo: true, supercharger: false, induction: 'turbo' },
    look: { body: 'v37', scale: [1.02, 0.97, 1.05], wing: 'none', paint: 9, neon: 3, rims: 1, wheels: 'five', exhaust: 'quad', decal: 'V37', plate: '37-37', cage: 'none', tail: 'bar', lhd: true },
  },
  {
    id: 's15', name: 'S15 Spec-R', tagline: 'SR20 turbo, light and pointy. The drift icon.',
    price: 22000, tier: 1.1,
    spec: { mass: 1250, inertia: 1580, a: 1.17, b: 1.35, torque: 215, redline: 7600, shiftUpRpm: 7200, shiftDownRpm: 3400, gears: [3.32, 1.9, 1.31, 1.0, 0.76, 0.62], finalDrive: 4.39, muLat: 1.06, maxSteer: 0.84, spoolRpm: 3400 },
    engine: 'i4', forced: { turbo: 0.5, sc: 0.34 }, stock: { turbo: true, supercharger: false, induction: 'turbo' },
    look: { body: 's15', scale: [0.94, 0.96, 0.95], wing: 'duck', paint: 10, neon: 1, rims: 3, wheels: 'six', exhaust: 'single', decal: 'S15', plate: '15-15', cage: 'accent', tail: 'square' },
  },
  {
    id: 's13', name: 'S13 Coupe', tagline: 'Old-school SR20 turbo coupe. Cheap, light, endlessly sideways.',
    price: 12000, tier: 0.9,
    spec: { mass: 1200, inertia: 1520, a: 1.16, b: 1.32, torque: 200, redline: 7500, shiftUpRpm: 7100, shiftDownRpm: 3300, gears: [3.32, 1.9, 1.31, 1.0, 0.76, 0.62], finalDrive: 4.11, muLat: 1.04, maxSteer: 0.84, spoolRpm: 3300 },
    engine: 'i4', forced: { turbo: 0.46, sc: 0.32 }, stock: { turbo: true, supercharger: false, induction: 'turbo' },
    look: { body: 's13', scale: [0.93, 0.97, 0.94], wing: 'lip', paint: 3, neon: 4, rims: 2, wheels: 'mesh', exhaust: 'single', decal: 'S13', plate: '13-13', cage: 'accent', tail: 'wide' },
  },
  {
    id: 'xe10', name: 'XE10 Sedan', tagline: 'Four-door with a 3.0 straight six. Sleeper drift sedan.',
    price: 14000, tier: 1.0,
    spec: { mass: 1450, inertia: 1850, a: 1.25, b: 1.42, torque: 300, redline: 6800, shiftUpRpm: 6500, shiftDownRpm: 2900, gears: [3.57, 2.06, 1.38, 1.0, 0.85, 0.72], finalDrive: 3.92, muLat: 1.04, maxSteer: 0.78, spoolRpm: 3200 },
    engine: 'i6', forced: { turbo: 0.5, sc: 0.32 }, stock: { turbo: false, supercharger: false, induction: 'na' },
    look: { body: 'xe10', scale: [0.95, 1.02, 0.98], wing: 'lip', paint: 11, neon: 0, rims: 0, wheels: 'six', exhaust: 'dual', decal: 'XE10', plate: '30-00', cage: 'none', tail: 'clear', lhd: true, doors: 4 },
  },
  {
    id: 'z30', name: 'Z30 Coupe', tagline: 'Smooth 90s grand tourer with the straight six. Long wheelbase, long slides.',
    price: 13000, tier: 1.0,
    spec: { mass: 1560, inertia: 2050, a: 1.3, b: 1.5, torque: 290, redline: 6800, shiftUpRpm: 6500, shiftDownRpm: 2900, gears: [3.29, 1.96, 1.33, 1.0, 0.78], finalDrive: 3.92, muLat: 1.04, maxSteer: 0.78, spoolRpm: 3200 },
    engine: 'i6', forced: { turbo: 0.52, sc: 0.32 }, stock: { turbo: false, supercharger: false, induction: 'na' },
    look: { body: 'z30', scale: [0.99, 0.97, 1.05], wing: 'none', paint: 12, neon: 3, rims: 4, wheels: 'dish', exhaust: 'dual', decal: 'Z30', plate: '30-30', cage: 'none', tail: 'band', lhd: true },
  },
  {
    id: 'b8', name: 'B8 Coupe', tagline: 'German V8 coupe with all-wheel drive. Grips hard, slides with a fight.',
    price: 35000, tier: 1.4,
    spec: { mass: 1730, inertia: 2250, a: 1.22, b: 1.53, torque: 440, redline: 7000, shiftUpRpm: 6700, shiftDownRpm: 2900, gears: [3.67, 2.05, 1.39, 1.03, 0.81, 0.67], finalDrive: 4.24, muLat: 1.1, muLong: 1.24, maxSteer: 0.72, awd: 0.3, spoolRpm: 3000 },
    engine: 'v8', forced: { turbo: 0.35, sc: 0.32 }, stock: { turbo: false, supercharger: false, induction: 'na' },
    look: { body: 'b8', scale: [1.0, 0.98, 1.04], wing: 'none', paint: 13, neon: 0, rims: 1, wheels: 'five', exhaust: 'quad', decal: 'B8', plate: '42-08', cage: 'none', tail: 'bar', lhd: true },
  },
  {
    id: 'jzx100', name: 'JZX100 Sedan', tagline: 'The 1JZ turbo family sedan every drift team loves. Long, stable, smoky.',
    price: 20000, tier: 1.1,
    spec: { mass: 1460, inertia: 1950, a: 1.3, b: 1.43, torque: 255, redline: 7200, shiftUpRpm: 6900, shiftDownRpm: 3000, gears: [3.98, 2.37, 1.56, 1.0, 0.85], finalDrive: 3.92, muLat: 1.04, maxSteer: 0.82, spoolRpm: 3300 },
    engine: 'i6', forced: { turbo: 0.42, sc: 0.3 }, stock: { turbo: true, supercharger: false, induction: 'turbo' },
    look: { body: 'jzx', scale: [0.97, 1.01, 1.05], wing: 'lip', paint: 4, neon: 1, rims: 3, wheels: 'six', exhaust: 'single', decal: 'JZX100', plate: '10-00', cage: 'accent', tail: 'wide', doors: 4 },
  },
];

// ---------- tuning ----------
// Everything in Customize is free and reversible: change anything, put it back with Stock.
export const ENGINE_SWAPS = [
  { id: 'stock', name: 'Stock engine' },
  { id: 'sr20', name: 'SR20 2.0 four', sound: 'i4', torque: 215, redline: 7600, massDelta: -25, spoolRpm: 3400 },
  { id: 'ka24', name: 'KA24 2.4 four', sound: 'i4', torque: 228, redline: 6800, massDelta: -10, spoolRpm: 3000 },
  { id: 'fa20', name: 'FA20 2.0 flat-four', sound: 'boxer4', torque: 212, redline: 7500, massDelta: -15, spoolRpm: 3600 },
  { id: 'rb26', name: 'RB26 2.6 six', sound: 'i6', torque: 262, redline: 8200, massDelta: 25, spoolRpm: 3800 },
  { id: '2jz', name: '2JZ 3.0 six', sound: 'i6', torque: 300, redline: 7200, massDelta: 40, spoolRpm: 3400 },
  { id: 'vq35', name: 'VQ35 3.5 V6', sound: 'v6', torque: 352, redline: 7000, massDelta: 10, spoolRpm: 3000 },
  { id: 'ls', name: 'LS 6.2 V8', sound: 'v8', torque: 560, redline: 6600, massDelta: 30, spoolRpm: 2800 },
  { id: 'r13b', name: '13B twin rotor', sound: 'rotary', torque: 190, redline: 9000, massDelta: -40, spoolRpm: 4200 },
];
export const TYRES = [
  { id: 'street', name: 'Street', blurb: 'Soft grip, easy to slide', mu: 0.9, long: 0.92, tail: 0.88, alpha: 0.15 },
  { id: 'sport', name: 'Sport', blurb: 'Balanced', mu: 1, long: 1, tail: null, alpha: null },
  { id: 'semi', name: 'Semi-slick', blurb: 'Huge grip, snappy past the limit', mu: 1.12, long: 1.1, tail: 0.8, alpha: 0.12 },
  { id: 'drift', name: 'Drift', blurb: 'Long, progressive slides', mu: 0.98, long: 1.05, tail: 0.94, alpha: 0.165 },
];
export const DIFFS = [
  { id: 'open', name: 'Open', blurb: 'The inside wheel spins away the power', lock: 0 },
  { id: 'lsd', name: '2-way LSD', blurb: 'Locks under power, frees up off it', lock: 0.55 },
  { id: 'welded', name: 'Welded', blurb: 'Both rears always together. Pure drift', lock: 1 },
];
export const TUNE_RANGES = {
  rideHeight: { min: -10, max: 6, step: 1, unit: 'cm', label: 'Ride height' },
  camberF: { min: -8, max: 0, step: 0.5, unit: '°', label: 'Front camber' },
  camberR: { min: -6, max: 0, step: 0.5, unit: '°', label: 'Rear camber' },
  trackF: { min: 0, max: 8, step: 0.5, unit: 'cm', label: 'Front spacers' },
  trackR: { min: 0, max: 8, step: 0.5, unit: 'cm', label: 'Rear spacers' },
  boost: { min: 0.5, max: 1.6, step: 0.05, unit: '×', label: 'Boost pressure' },
  steerLock: { min: 34, max: 68, step: 1, unit: '°', label: 'Steering lock' },
  finalDrive: { min: 0.85, max: 1.2, step: 0.01, unit: '×', label: 'Final drive' },
  brakeBias: { min: 0.5, max: 0.8, step: 0.01, unit: '% front', label: 'Brake bias' },
  handbrake: { min: 0.6, max: 1.6, step: 0.05, unit: '×', label: 'Handbrake power' },
};
export function stockTune(carId) {
  const c = carById(carId);
  return {
    rideHeight: 0, camberF: -1.5, camberR: -1, trackF: 0, trackR: 0,
    engine: 'stock', induction: c.stock.induction, boost: 1,
    tyre: 'sport', diff: 'welded',
    steerLock: Math.round((((c.spec.maxSteer ?? SPEC.maxSteer) * 180) / Math.PI)), finalDrive: 1, brakeBias: 0.66, handbrake: 1,
  };
}
export const engineSound = (carId, tune) => {
  const e = ENGINE_SWAPS.find((x) => x.id === tune?.engine);
  return e && e.sound ? e.sound : carById(carId).engine;
};

export const UPGRADES = [
  { id: 'engine', name: 'Engine', blurb: '+8% torque per level', costs: [4000, 9000, 18000] },
  { id: 'tyres', name: 'Tyres', blurb: 'More grip, faster drift entries', costs: [3000, 7000, 14000] },
  { id: 'weight', name: 'Weight', blurb: '−5% mass per level', costs: [3500, 8000, 16000] },
  { id: 'angle', name: 'Angle kit', blurb: 'More steering lock, deeper angle', costs: [2500, 6000, 12000] },
];
export const MAX_LEVEL = 3;

// Forced induction kits. Once you own a kit you can switch between what you have fitted for free.
export const KITS = [
  { id: 'turbo', name: 'Turbo kit', blurb: 'Spools up with lag, big top end, flutter and blow-off', cost: 9000 },
  { id: 'supercharger', name: 'Supercharger', blurb: 'Instant boost from idle, and that whine', cost: 8000 },
];
export const INDUCTIONS = [
  { id: 'na', name: 'Natural', needs: [] },
  { id: 'turbo', name: 'Turbo', needs: ['turbo'] },
  { id: 'sc', name: 'Supercharged', needs: ['supercharger'] },
  { id: 'twin', name: 'Twin-charged', needs: ['turbo', 'supercharger'] },
];
export const kitCost = (car, kitId) => Math.round((KITS.find((k) => k.id === kitId).cost * car.tier) / 100) * 100;

export const NEONS = [
  { name: 'Cyan', color: 0x22e6ff },
  { name: 'Magenta', color: 0xff2bd6 },
  { name: 'Amber', color: 0xffa21f },
  { name: 'Violet', color: 0x8a4bff },
  { name: 'Toxic', color: 0x6dff3a },
  { name: 'Red', color: 0xff2a3a },
];
export const RIMS = [
  { name: 'Silver', color: 0x9aa0ad },
  { name: 'Black', color: 0x1b1c22 },
  { name: 'Bronze', color: 0x9a6a2e },
  { name: 'Gold', color: 0xc9a23a },
  { name: 'White', color: 0xe6e8ee },
];

// Credits paid per banked drift point.
export const CREDIT_RATE = 0.1;
export const START_CREDITS = 5000;

export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];
export const upgradeCost = (car, upgradeId, level) => {
  const u = UPGRADES.find((x) => x.id === upgradeId);
  return Math.round((u.costs[level] * car.tier) / 100) * 100;
};

// The physics spec for a car with its upgrade levels and tune applied.
export function buildSpec(carId, levels = {}, induction = carById(carId).stock.induction, tune = null) {
  const car = carById(carId);
  const s = { ...SPEC, ...car.spec };
  const t = { ...stockTune(carId), ...(tune || {}), induction: tune?.induction ?? induction };
  const swap = ENGINE_SWAPS.find((x) => x.id === t.engine && x.id !== 'stock');
  if (swap) {
    s.torque = swap.torque;
    s.redline = swap.redline;
    s.shiftUpRpm = swap.redline - 350;
    s.shiftDownRpm = Math.round(swap.redline * 0.42);
    s.spoolRpm = swap.spoolRpm;
    s.mass += swap.massDelta;
  }
  const ind = INDUCTIONS.find((x) => x.id === t.induction) || INDUCTIONS[0];
  const forced = swap ? { turbo: 0.5, sc: 0.33 } : car.forced;
  s.turboGain = ind.needs.includes('turbo') ? forced.turbo * t.boost : 0;
  s.scGain = ind.needs.includes('supercharger') ? forced.sc * t.boost : 0;
  s.gears = [...s.gears];
  // Heavier cars come with bigger brakes.
  if (!car.spec.brakeTorque) s.brakeTorque = SPEC.brakeTorque * Math.max(1, s.mass / 1250);
  // Tyres and diff.
  const tyre = TYRES.find((x) => x.id === t.tyre) || TYRES[1];
  s.muLat *= tyre.mu;
  s.muLong *= tyre.long;
  if (tyre.tail) s.tail = tyre.tail;
  if (tyre.alpha) s.alphaPeak = tyre.alpha;
  s.diffLock = (DIFFS.find((x) => x.id === t.diff) || DIFFS[2]).lock;
  // Stance: lower is calmer (less load transfer); front camber bites harder when sliding, lots of rear camber
  // gives the rear up early; spacers widen the track.
  s.cgHeight += t.rideHeight * 0.006;
  s.muLatF = 1 + 0.012 * Math.min(8, -t.camberF) - 0.004 * Math.max(0, -t.camberF - 5) ** 2;
  s.muLatR = 1 - 0.009 * Math.max(0, -t.camberR - 1.5);
  s.trackF += t.trackF * 0.02;
  s.trackR += t.trackR * 0.02;
  // Handling.
  s.maxSteer = (t.steerLock * Math.PI) / 180;
  s.finalDrive *= t.finalDrive;
  s.brakeBias = t.brakeBias;
  s.handbrakeTorque *= t.handbrake;
  const lv = (k) => Math.min(MAX_LEVEL, Math.max(0, levels[k] || 0));
  s.torque *= 1 + 0.08 * lv('engine');
  s.muLat *= 1 + 0.04 * lv('tyres');
  s.muLong *= 1 + 0.05 * lv('tyres');
  s.mass *= 1 - 0.05 * lv('weight');
  s.inertia *= 1 - 0.05 * lv('weight');
  s.maxSteer += 0.05 * lv('angle');
  s.angleBonus = 0.04 * lv('angle');
  return s;
}

// Display stats for the garage bars.
export function specStats(s) {
  let peak = 0;
  for (let rpm = 1000; rpm <= s.redline; rpm += 100) {
    const sc = Math.min(1, rpm / (s.redline * 0.62));
    const tb = Math.min(1, Math.max(0, (rpm - s.spoolRpm * 0.55) / (s.spoolRpm * 0.8)));
    peak = Math.max(peak, s.torque * torqueCurve(rpm, s.redline) * boostMultiplier(s, tb, sc) * rpm);
  }
  const hp = Math.round((peak / 9549) * 1.341);
  return {
    hp,
    mass: Math.round(s.mass),
    grip: s.muLat,
    lock: Math.round((s.maxSteer * 180) / Math.PI),
    powerToWeight: hp / s.mass,
  };
}

// ---------- saved profile ----------
const KEY = 'cd.profile';

function storage() {
  try { return window.localStorage; } catch { return null; }
}

export class Profile {
  constructor(store = storage()) {
    this.store = store;
    let saved = null;
    try { saved = JSON.parse(store?.getItem(KEY) || 'null'); } catch { /* corrupt or blocked */ }
    if (!saved) {
      // First run: carry over points already earned before the garage existed.
      let earned = 0;
      try { earned = Number(store?.getItem('cd.total')) || 0; } catch { /* blocked */ }
      let paint = 0;
      try { paint = Number(store?.getItem('cd.paint')) || 0; } catch { /* blocked */ }
      saved = { credits: START_CREDITS + Math.floor(earned * CREDIT_RATE), current: 'ronin', cars: { ronin: { ...this.freshCar('ronin'), paint } } };
    }
    this.credits = Math.max(0, Math.floor(saved.credits || 0));
    this.cars = saved.cars && typeof saved.cars === 'object' ? saved.cars : {};
    if (!this.cars.ronin) this.cars.ronin = this.freshCar('ronin');
    // Saves from before induction kits existed get each car's stock kit.
    for (const [id, c] of Object.entries(this.cars)) {
      const fresh = this.freshCar(id);
      if (!c.kits) c.kits = fresh.kits;
      if (!c.induction) c.induction = fresh.induction;
      // Saves from before tuning existed start from stock, keeping the induction they had fitted.
      if (!c.tune) c.tune = { ...fresh.tune, induction: c.induction };
    }
    this.current = this.owns(saved.current) ? saved.current : 'ronin';
  }

  freshCar(id) {
    const { look, stock } = carById(id);
    return {
      levels: { engine: 0, tyres: 0, weight: 0, angle: 0 }, paint: look.paint, neon: look.neon, rims: look.rims,
      kits: { turbo: stock.turbo, supercharger: stock.supercharger }, induction: stock.induction,
      tune: stockTune(id),
    };
  }

  owns(id) { return !!this.cars[id]; }
  car(id = this.current) { return this.cars[id] || this.freshCar(id); }
  spec(id = this.current) { const c = this.car(id); return buildSpec(id, c.levels, c.tune?.induction ?? c.induction, c.tune); }

  // Tuning is free: set any value, or put a whole section (or everything) back to stock.
  setTune(id, key, value) {
    if (!this.owns(id)) return false;
    this.cars[id].tune[key] = value;
    if (key === 'induction') this.cars[id].induction = value;
    this.save();
    return true;
  }

  resetTune(id, keys = null) {
    if (!this.owns(id)) return;
    const stock = stockTune(id);
    for (const k of keys || Object.keys(stock)) this.cars[id].tune[k] = stock[k];
    this.cars[id].induction = this.cars[id].tune.induction;
    this.save();
  }

  buyKit(id, kitId) {
    if (!this.owns(id) || this.cars[id].kits[kitId]) return false;
    const cost = kitCost(carById(id), kitId);
    if (this.credits < cost) return false;
    this.credits -= cost;
    this.cars[id].kits[kitId] = true;
    // Fit it straight away, alongside whatever is already fitted.
    const k = this.cars[id].kits;
    this.cars[id].induction = k.turbo && k.supercharger ? 'twin' : k.turbo ? 'turbo' : 'sc';
    this.cars[id].tune.induction = this.cars[id].induction;
    this.save();
    return true;
  }

  setInduction(id, indId) {
    const ind = INDUCTIONS.find((x) => x.id === indId);
    if (!this.owns(id) || !ind || !ind.needs.every((k) => this.cars[id].kits[k])) return false;
    this.cars[id].induction = indId;
    this.cars[id].tune.induction = indId;
    this.save();
    return true;
  }

  earn(points) {
    const cr = Math.max(0, Math.floor(points * CREDIT_RATE));
    this.credits += cr;
    this.save();
    return cr;
  }

  buyCar(id) {
    const c = carById(id);
    if (this.owns(id) || this.credits < c.price) return false;
    this.credits -= c.price;
    this.cars[id] = this.freshCar(id);
    this.current = id;
    this.save();
    return true;
  }

  select(id) {
    if (!this.owns(id)) return false;
    this.current = id;
    this.save();
    return true;
  }

  buyUpgrade(id, upgradeId) {
    if (!this.owns(id)) return false;
    const lv = this.cars[id].levels[upgradeId] || 0;
    if (lv >= MAX_LEVEL) return false;
    const cost = upgradeCost(carById(id), upgradeId, lv);
    if (this.credits < cost) return false;
    this.credits -= cost;
    this.cars[id].levels[upgradeId] = lv + 1;
    this.save();
    return true;
  }

  setStyle(id, key, index) {
    if (!this.owns(id)) return;
    this.cars[id][key] = index;
    this.save();
  }

  save() {
    try { this.store?.setItem(KEY, JSON.stringify({ credits: this.credits, current: this.current, cars: this.cars })); } catch { /* storage blocked */ }
  }
}
