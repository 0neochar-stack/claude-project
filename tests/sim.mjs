// Headless handling checks for the drift physics. Run with `npm test`.
// Every car runs the suite stock and fully upgraded, on the default Medium assist.
import { CarBody } from '../src/physics.js';
import { CARS, UPGRADES, MAX_LEVEL, buildSpec, Profile, upgradeCost } from '../src/garage.js';
import { buildNetwork, bakeHeights, heightAt, roadQuery, crossSection, LOTS, inLot } from '../src/worlds/open/layout.js';

const DT = 1 / 120;
const deg = (r) => (r * 180) / Math.PI;
const kmh = (c) => c.speed * 3.6;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
}

function run(car, seconds, input, onStep) {
  for (let t = 0; t < seconds; t += DT) {
    car.step(DT, typeof input === 'function' ? input(t, car) : input);
    onStep?.(t, car);
  }
}

const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
// The gear a driver would pick for a speed: engine nearest 62% of the redline.
function gearFor(car, speed) {
  const s = car.spec;
  let best = 1, bestErr = Infinity;
  s.gears.forEach((g, i) => {
    const rpm = (speed / s.wheelRadius) * g * s.finalDrive * 9.549;
    const err = Math.abs(rpm - s.redline * 0.62);
    if (rpm < s.redline * 0.92 && err < bestErr) { bestErr = err; best = i + 1; }
  });
  return best;
}
const spunOut = (c) => Math.abs(c.beta) > Math.PI / 2 || c.u < 1;

// Handbrake into a left-hand drift at 70 km/h, then hold `steer` (+ is into the corner) and `throttle`.
function drift(spec, steer, throttle, seconds = 7) {
  const car = new CarBody(spec());
  car.launch(70 / 3.6, gearFor(car, 70 / 3.6));
  const betas = [];
  let spun = false;
  run(car, seconds, (t) => (t < 0.45 ? { throttle: 0.4, brake: 0, steer: 1, handbrake: true } : { ...idle, throttle, steer }), (t, c) => {
    if (t > 1.5) betas.push(Math.abs(c.beta));
    if (spunOut(c)) spun = true;
  });
  return { car, spun, avg: deg(betas.reduce((a, b) => a + b, 0) / betas.length) };
}

function suite(tag, spec) {
  // Straight line.
  {
    const car = new CarBody(spec());
    let t100 = null;
    run(car, 30, { ...idle, throttle: 1 }, (t, c) => { if (t100 === null && kmh(c) >= 100) t100 = t; });
    check(`${tag} 0-100 km/h`, t100 !== null && t100 > 3.3 && t100 < 7.5, `${t100?.toFixed(2)} s`);
    check(`${tag} top speed`, kmh(car) > 190 && kmh(car) < 330, `${kmh(car).toFixed(0)} km/h in gear ${car.gear}`);
    check(`${tag} drives straight`, Math.abs(car.x) < 0.5, `lateral drift ${car.x.toFixed(2)} m`);
  }
  {
    const car = new CarBody(spec());
    car.launch(100 / 3.6, 5);
    let dist = 0;
    run(car, 6, { ...idle, brake: 1 }, (t, c) => { dist = Math.max(dist, c.z); });
    check(`${tag} brakes 100-0`, dist > 28 && dist < 50, `${dist.toFixed(1)} m`);
  }
  // Grip driving: a gentle corner stays planted, and a hard one pulls real lateral g.
  {
    const car = new CarBody(spec());
    car.launch(60 / 3.6, 2);
    let maxBeta = 0;
    run(car, 6, { ...idle, throttle: 0.25, steer: 0.35 }, (t, c) => { if (t > 1) maxBeta = Math.max(maxBeta, Math.abs(c.beta)); });
    check(`${tag} grip corner at 60 km/h`, deg(maxBeta) < 8, `max slip ${deg(maxBeta).toFixed(1)} deg`);
  }
  {
    const car = new CarBody(spec());
    car.launch(70 / 3.6, gearFor(car, 70 / 3.6));
    let ay = 0;
    run(car, 4, (t, c) => ({ ...idle, throttle: 0.15, steer: 0.6 }), (t, c) => { if (t > 1.5) ay = Math.max(ay, Math.abs(c.ay)); });
    check(`${tag} cornering grip`, ay / 9.81 > 0.75 && ay / 9.81 < 1.3, `${(ay / 9.81).toFixed(2)} g`);
  }
  // Drifting: holds without spinning, and the angle answers the inputs.
  const light = drift(spec, 0.3, 0.85), firm = drift(spec, 0.6, 0.85), full = drift(spec, 1, 0.85);
  check(`${tag} holds a drift on light steer`, !light.spun && light.avg > 25 && light.avg < 65, `avg ${light.avg.toFixed(0)} deg, end ${kmh(light.car).toFixed(0)} km/h`);
  check(`${tag} more steer gives more angle`, !firm.spun && firm.avg > light.avg + 3, `${light.avg.toFixed(0)} -> ${firm.avg.toFixed(0)} deg`);
  check(`${tag} full lock does not spin`, !full.spun, `avg ${full.avg.toFixed(0)} deg, end ${kmh(full.car).toFixed(0)} km/h`);
  const soft = drift(spec, 0.5, 0.5), hard = drift(spec, 0.5, 1);
  check(`${tag} more throttle gives more angle`, !soft.spun && !hard.spun && hard.avg > soft.avg + 5, `${soft.avg.toFixed(0)} -> ${hard.avg.toFixed(0)} deg`);
  check(`${tag} drift keeps speed`, kmh(light.car) > 45, `${kmh(light.car).toFixed(0)} km/h after 7 s`);
  const neutral = drift(spec, 0, 0.85);
  check(`${tag} neutral stick straightens`, !neutral.spun && deg(Math.abs(neutral.car.beta)) < 10, `slip ${deg(neutral.car.beta).toFixed(1)} deg at the end`);
  {
    const car = drift(spec, 0.4, 0.85, 4).car;
    run(car, 3, { ...idle, throttle: 0.2 });
    check(`${tag} lift-off recovers to grip`, deg(Math.abs(car.beta)) < 6, `slip ${deg(car.beta).toFixed(1)} deg`);
  }
  // Transition: drift left, flick right, carry it into a right-hand drift.
  {
    const car = new CarBody(spec());
    car.launch(70 / 3.6, gearFor(car, 70 / 3.6));
    let spun = false, before = 0;
    run(car, 8, (t) => (t < 0.45 ? { throttle: 0.4, brake: 0, steer: 1, handbrake: true } : t < 3.5 ? { ...idle, throttle: 0.85, steer: 0.5 } : { ...idle, throttle: t < 4 ? 0.3 : 0.9, steer: -0.6 }),
      (t, c) => { if (spunOut(c)) spun = true; if (Math.abs(t - 3) < DT) before = c.beta; });
    check(`${tag} transition to the other side`, !spun && Math.sign(before) !== Math.sign(car.beta) && deg(Math.abs(car.beta)) > 20, `${deg(before).toFixed(0)} -> ${deg(car.beta).toFixed(0)} deg`);
  }
  {
    const car = new CarBody(spec());
    car.launch(45 / 3.6, 2);
    let maxBeta = 0;
    run(car, 3, { ...idle, throttle: 1, steer: 1 }, (t, c) => { maxBeta = Math.max(maxBeta, Math.abs(c.beta)); });
    check(`${tag} power-over starts a slide`, deg(maxBeta) > 15, `max slip ${deg(maxBeta).toFixed(1)} deg`);
  }
  {
    const car = new CarBody(spec());
    run(car, 3, { ...idle, brake: 1 });
    check(`${tag} reverses from a stop`, car.gear === -1 && car.u < -2, `gear ${car.gear}, u ${car.u.toFixed(1)} m/s`);
  }
  {
    const car = new CarBody(spec());
    run(car, 3, idle);
    check(`${tag} does not creep at idle`, car.speed < 0.2, `${car.speed.toFixed(2)} m/s`);
  }
}

const maxed = Object.fromEntries(UPGRADES.map((u) => [u.id, MAX_LEVEL]));
for (const car of CARS) {
  suite(`[${car.id}]`, () => buildSpec(car.id));
  suite(`[${car.id}+max]`, () => buildSpec(car.id, maxed));
  console.log('');
}

// Clutch kick: in 4th at 100 km/h a gentle corner stays planted on throttle alone; a kick throws it sideways.
for (const c of CARS) {
  const corner = (kick) => {
    const car = new CarBody(buildSpec(c.id));
    car.autoGear = false;
    car.launch(90 / 3.6, gearFor(car, 90 / 3.6));
    let maxBeta = 0;
    run(car, 2.5, (t) => ({ throttle: t > 0.4 ? 0.7 : 0.3, brake: 0, steer: 0.15, handbrake: false, clutch: kick && t > 0.4 && t < 0.7 }),
      (t, car) => { if (t > 0.3) maxBeta = Math.max(maxBeta, Math.abs(car.beta)); });
    return deg(maxBeta);
  };
  const plain = corner(false), kicked = corner(true);
  check(`[${c.id}] clutch kick throws it sideways`, plain < 8 && kicked > 20, `${plain.toFixed(1)} deg without, ${kicked.toFixed(1)} deg with`);
}

// Assists off: a quick driver who balances throttle and counter-steer (0.12 s reactions) can hold a drift,
// clutch-kicking to keep it alive when the angle fades, as drivers do in lower-powered cars.
for (const c of CARS) {
  const car = new CarBody(buildSpec(c.id));
  car.assist = 0;
  car.launch(70 / 3.6, gearFor(car, 70 / 3.6));
  const hist = [], betas = [];
  const delay = Math.round(0.12 / DT);
  let spun = false, kickUntil = -1, lastKick = -9;
  run(car, 12, (t, k) => {
    if (t > 0.45 && t > kickUntil && Math.abs(hist[hist.length - 1 - delay]?.beta ?? 1) < 0.22 && t - lastKick > 1.2) { kickUntil = t + 0.25; lastKick = t; }
    const kicking = t <= kickUntil;
    const s = k.spec;
    hist.push({ travel: k.u > 2 ? Math.atan2(k.v + s.a * k.r, k.u) : 0, beta: k.beta });
    const o = hist[Math.max(0, hist.length - 1 - delay)], p = hist[Math.max(0, hist.length - 7 - delay)];
    const side = -Math.sign(o.beta) || 1;
    const err = 0.6 - Math.abs(o.beta), rate = (Math.abs(o.beta) - Math.abs(p.beta)) / (6 * DT);
    if (t < 0.45) return { throttle: 0.4, brake: 0, steer: 1, handbrake: true };
    return { throttle: kicking ? 1 : clamp(0.55 + 1.2 * err - 0.25 * rate, 0, 1), brake: 0, handbrake: false, clutch: kicking,
      steer: clamp((o.travel + side * clamp(0.25 * err - 0.12 * rate, -0.3, 0.3)) / s.maxSteer, -1, 1) };
  }, (t, k) => { if (t > 2) betas.push(Math.abs(k.beta)); if (spunOut(k)) spun = true; });
  const avg = deg(betas.reduce((a, b) => a + b, 0) / betas.length);
  check(`[${c.id}] assists off: a skilled driver holds it`, !spun && avg > 12, `avg ${avg.toFixed(0)} deg, end ${kmh(car).toFixed(0)} km/h`);
}

// Stability: two minutes of random inputs on every car and assist level, with random knocks.
{
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let ok = true, peak = 0;
  for (const c of CARS) for (const assist of [0, 0.35, 0.75, 1]) {
    const car = new CarBody(buildSpec(c.id, maxed));
    car.assist = assist;
    let inp = { ...idle };
    run(car, 120, () => {
      if (rnd() < 0.02) inp = { throttle: rnd() < 0.7 ? rnd() : 0, brake: rnd() < 0.2 ? rnd() : 0, steer: rnd() * 2 - 1, handbrake: rnd() < 0.1, clutch: rnd() < 0.05 };
      if (rnd() < 0.001) car.applyImpulse(0.5, 1.3, (rnd() - 0.5) * 20000, (rnd() - 0.5) * 20000);
      return inp;
    }, (t, k) => {
      if (!Number.isFinite(k.x + k.vx + k.r + k.omega + k.engW + k.rpm)) ok = false;
      peak = Math.max(peak, k.speed);
    });
  }
  check('random inputs stay finite and sane', ok && peak < 100, `peak ${(peak * 3.6).toFixed(0)} km/h`);
}

// Forced induction: the turbo lags then builds big boost, the supercharger is instant, twin-charging has both.
{
  const pull = (induction) => {
    const car = new CarBody(buildSpec('ronin', {}, induction));
    car.autoGear = false;
    car.launch(40 / 3.6, 3);
    const boost = [];
    let bov = 0;
    run(car, 4, (t) => ({ ...idle, throttle: t < 3 ? 1 : 0 }), (t, c) => { boost.push(c.boostBar); if (c.bovEvent) bov = c.bovEvent; });
    return { early: boost[Math.round(0.15 / DT)], late: boost[Math.round(2.5 / DT)], kmh: kmh(car), bov };
  };
  const na = pull('na'), tb = pull('turbo'), sc = pull('sc'), twin = pull('twin');
  check('turbo lags, then builds boost', tb.early < tb.late * 0.5 && tb.late > 0.5, `${tb.early.toFixed(2)} -> ${tb.late.toFixed(2)} bar`);
  check('supercharger boost is there at once', sc.early > 0.12 && sc.early > tb.early * 5 && sc.late > 0.25, `${sc.early.toFixed(2)} bar at 0.15 s (turbo ${tb.early.toFixed(2)})`);
  check('twin-charging fills the turbo lag', twin.early > tb.early + 0.1, `${tb.early.toFixed(2)} vs ${twin.early.toFixed(2)} bar early`);
  check('boost makes it faster', tb.kmh > na.kmh + 3 && sc.kmh > na.kmh + 3 && twin.kmh >= Math.max(tb.kmh, sc.kmh) - 2,
    `NA ${na.kmh.toFixed(0)}, turbo ${tb.kmh.toFixed(0)}, SC ${sc.kmh.toFixed(0)}, twin ${twin.kmh.toFixed(0)} km/h`);
  check('lifting off fires the blow-off valve', tb.bov > 0.3 && na.bov === 0, `boost at lift ${tb.bov.toFixed(2)}`);
}

// Profile: earning, buying and upgrading, saved through storage.
{
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  mem.set('cd.total', '100000');
  const p = new Profile(store);
  check('profile starts with credits and the starter car', p.credits === 15000 && p.owns('ronin') && p.current === 'ronin', `${p.credits} CR`);
  check('cannot buy an unaffordable car', !p.buyCar('ryujin') && !p.owns('ryujin'), '');
  check('buys a car and selects it', p.buyCar('kaze') && p.current === 'kaze' && p.credits === 0, `${p.credits} CR left`);
  p.earn(50000);
  const cost = upgradeCost(CARS[1], 'engine', 0);
  check('buys an upgrade', p.buyUpgrade('kaze', 'engine') && p.car('kaze').levels.engine === 1 && p.credits === 5000 - cost, `cost ${cost}`);
  check('upgrade raises torque', p.spec('kaze').torque > buildSpec('kaze').torque, `${buildSpec('kaze').torque} -> ${p.spec('kaze').torque.toFixed(0)} Nm`);
  check('kits: cannot fit a kit you have not bought', !p.setInduction('kaze', 'sc') && p.car('kaze').induction === 'na', '');
  p.earn(400000);
  check('kits: buy a supercharger and it is fitted', p.buyKit('kaze', 'supercharger') && p.car('kaze').induction === 'sc' && p.spec('kaze').scGain > 0, '');
  check('kits: buying both makes it twin-charged', p.buyKit('kaze', 'turbo') && p.car('kaze').induction === 'twin' && p.spec('kaze').turboGain > 0 && p.spec('kaze').scGain > 0, '');
  check('kits: can switch back to one', p.setInduction('kaze', 'turbo') && p.spec('kaze').scGain === 0 && p.spec('kaze').turboGain > 0, '');
  const again = new Profile(store);
  check('profile survives a reload', again.current === 'kaze' && again.credits === p.credits && again.car('kaze').levels.engine === 1 && again.car('kaze').induction === 'turbo', '');
  check('starter car comes twin-charged', new Profile({ getItem: () => null, setItem() {} }).car('ronin').induction === 'twin', '');
}

// ---------- open world layout ----------
{
  console.log('\nopen world');
  const t0 = performance.now();
  const net = buildNetwork();
  const h = bakeHeights(net);
  const ms = performance.now() - t0;
  check('world layout builds quickly', ms < 4000, `${ms.toFixed(0)} ms`);
  const limits = { highway: 0.065, coast: 0.07, touge: 0.125, ridge: 0.105 };
  for (const r of net.roads) {
    if (!limits[r.kind]) continue;
    const S = r.samples;
    let worst = 0;
    // Grade over 12 m windows (single 3 m steps exaggerate rounding at the ends).
    for (let i = 4; i < S.length; i++) worst = Math.max(worst, Math.abs(S[i].y - S[i - 4].y) / (S[i].s - S[i - 4].s));
    check(`${r.name}: grade within limit`, worst <= limits[r.kind], `${(worst * 100).toFixed(1)}% (limit ${(limits[r.kind] * 100).toFixed(1)}%)`);
  }
  let poke = 0, where = null;
  for (const r of net.roads) for (const p of r.samples) for (const f of [-1, 0, 1]) {
    const lat = f * (r.hw + (r.gutter || 0));
    const x = p.x - p.tz * lat, z = p.z + p.tx * lat;
    const d = heightAt(h, x, z) - p.y;
    if (d > poke) { poke = d; where = `${r.id} ${x.toFixed(0)},${z.toFixed(0)}`; }
  }
  check('terrain never pokes through a road', poke <= 0.01, poke > 0 ? `${poke.toFixed(2)} m at ${where}` : 'clear');
  // Hairpins tight enough to drift, open enough to make.
  const touge = net.byId.touge;
  let minR = Infinity;
  for (let i = 3; i < touge.samples.length - 3; i++) {
    const a = touge.samples[i - 3], c = touge.samples[i + 3];
    const turn = Math.abs(Math.atan2(a.tx * c.tz - a.tz * c.tx, a.tx * c.tx + a.tz * c.tz));
    if (turn > 1e-3) minR = Math.min(minR, (c.s - a.s) / turn);
  }
  check('touge hairpins are drivable', minR > 14 && minR < 30, `tightest radius ${minR.toFixed(1)} m`);
  check('touge climbs the mountain', touge.samples[touge.samples.length - 1].y - touge.samples[0].y > 120, `${(touge.samples[touge.samples.length - 1].y - touge.samples[0].y).toFixed(0)} m`);
  for (const lot of LOTS) {
    const cx = lot.shape === 'circle' ? lot.x : (lot.x0 + lot.x1) / 2, cz = lot.shape === 'circle' ? lot.z : (lot.z0 + lot.z1) / 2;
    const off = Math.abs(heightAt(h, cx, cz) - (lot.y - 0.1));
    check(`${lot.name} is flat at its road's height`, off < 0.3 && inLot(lot, cx, cz), `${off.toFixed(2)} m off`);
  }
  // Gutters dip and come back up; curbs step up.
  const q = {};
  roadQuery(net, touge.samples[200].x, touge.samples[200].z, q);
  check('gutter dips past the touge edge', crossSection(touge, touge.hw + touge.gutter / 2) < -0.1 && crossSection(touge, touge.hw + touge.gutter + 0.5) === null && q.road === touge, '');
  check('town curbs step up to the sidewalk', crossSection(net.byId.st0, net.byId.st0.hw + 1) > 0.1, '');
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall handling checks passed');
