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
];

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

// The physics spec for a car with its upgrade levels applied.
export function buildSpec(carId, levels = {}, induction = carById(carId).stock.induction) {
  const car = carById(carId);
  const s = { ...SPEC, ...car.spec };
  const ind = INDUCTIONS.find((x) => x.id === induction) || INDUCTIONS[0];
  s.turboGain = ind.needs.includes('turbo') ? car.forced.turbo : 0;
  s.scGain = ind.needs.includes('supercharger') ? car.forced.sc : 0;
  s.gears = [...s.gears];
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
    }
    this.current = this.owns(saved.current) ? saved.current : 'ronin';
  }

  freshCar(id) {
    const { look, stock } = carById(id);
    return {
      levels: { engine: 0, tyres: 0, weight: 0, angle: 0 }, paint: look.paint, neon: look.neon, rims: look.rims,
      kits: { turbo: stock.turbo, supercharger: stock.supercharger }, induction: stock.induction,
    };
  }

  owns(id) { return !!this.cars[id]; }
  car(id = this.current) { return this.cars[id] || this.freshCar(id); }
  spec(id = this.current) { return buildSpec(id, this.car(id).levels, this.car(id).induction); }

  buyKit(id, kitId) {
    if (!this.owns(id) || this.cars[id].kits[kitId]) return false;
    const cost = kitCost(carById(id), kitId);
    if (this.credits < cost) return false;
    this.credits -= cost;
    this.cars[id].kits[kitId] = true;
    // Fit it straight away, alongside whatever is already fitted.
    const k = this.cars[id].kits;
    this.cars[id].induction = k.turbo && k.supercharger ? 'twin' : k.turbo ? 'turbo' : 'sc';
    this.save();
    return true;
  }

  setInduction(id, indId) {
    const ind = INDUCTIONS.find((x) => x.id === indId);
    if (!this.owns(id) || !ind || !ind.needs.every((k) => this.cars[id].kits[k])) return false;
    this.cars[id].induction = indId;
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
