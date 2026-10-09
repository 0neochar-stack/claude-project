// Drift chains: angle x speed builds points, the multiplier climbs while you stay sideways,
// and the chain banks after a short grace period. Hitting a wall mid-chain loses it.
const GRACE = 2.2;
const GRADES = [
  [0, 'DRIFT'], [2500, 'GOOD DRIFT'], [8000, 'GREAT DRIFT'], [20000, 'AWESOME DRIFT'], [45000, 'INSANE DRIFT'], [90000, 'LEGENDARY'],
];

function load(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}
function save(key, v) {
  try { localStorage.setItem(key, String(Math.round(v))); } catch { /* storage blocked */ }
}

export class DriftScore {
  // persist: false for player two in split screen, whose points are not saved.
  constructor(persist = true) {
    this.persist = persist;
    this.total = persist ? load('cd.total') : 0;
    this.best = persist ? load('cd.best') : 0;
    this.chain = 0;
    this.mult = 1;
    this.idle = 0;
    this.active = false;
    this.angle = 0;
    this.events = [];
  }

  get grade() {
    let g = GRADES[0][1];
    for (const [min, name] of GRADES) if (this.chain >= min) g = name;
    return g;
  }

  get graceLeft() {
    return this.active ? 1 : Math.max(0, 1 - this.idle / GRACE);
  }

  update(dt, car, impact) {
    const kmh = car.speed * 3.6;
    const angle = Math.abs(car.beta) * 57.3;
    const drifting = kmh > 25 && angle > 12 && angle < 100 && car.u > 0;
    this.angle = drifting ? angle : 0;

    if (impact > 4.5 && this.chain > 0) {
      this.events.push({ type: 'crash', points: this.chain });
      this.chain = 0;
      this.mult = 1;
      this.idle = 0;
      this.active = false;
      return;
    }

    if (drifting) {
      this.active = true;
      this.idle = 0;
      const angleFactor = Math.min(angle, 70) / 70;
      this.chain += dt * kmh * angleFactor * 38 * this.mult;
      this.mult = Math.min(5, this.mult + dt * 0.14 * (0.5 + angleFactor));
    } else if (this.chain > 0) {
      this.active = false;
      this.idle += dt;
      if (this.idle > GRACE) this.bank();
    }
  }

  bank() {
    const pts = Math.round(this.chain);
    this.total += pts;
    const record = pts > this.best;
    if (record) this.best = pts;
    this.events.push({ type: 'bank', points: pts, record });
    this.chain = 0;
    this.mult = 1;
    this.idle = 0;
    if (this.persist) {
      save('cd.total', this.total);
      save('cd.best', this.best);
    }
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
