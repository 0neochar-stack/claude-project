// Headless handling checks for the drift physics. Run with `npm test`.
import { CarBody } from '../src/physics.js';

const DT = 1 / 120;
const deg = (r) => (r * 180) / Math.PI;
const kmh = (c) => c.speed * 3.6;
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

// 1. Straight-line launch.
{
  const car = new CarBody();
  let t100 = null;
  run(car, 25, { ...idle, throttle: 1 }, (t, c) => { if (t100 === null && kmh(c) >= 100) t100 = t; });
  check('0-100 km/h', t100 !== null && t100 > 3.5 && t100 < 8, `${t100?.toFixed(2)} s`);
  check('top speed', kmh(car) > 190 && kmh(car) < 290, `${kmh(car).toFixed(0)} km/h in gear ${car.gear}`);
  check('drives straight', Math.abs(car.x) < 0.5, `lateral drift ${car.x.toFixed(2)} m`);
}

// 2. Braking from 100 km/h.
{
  const car = new CarBody();
  car.vz = 100 / 3.6;
  let dist = 0;
  run(car, 6, { ...idle, brake: 1 }, (t, c) => { dist = Math.max(dist, c.z); });
  check('brakes 100-0', dist > 30 && dist < 60, `${dist.toFixed(1)} m`);
}

// 3. Gentle cornering stays in grip.
{
  const car = new CarBody();
  car.vz = 60 / 3.6;
  let maxBeta = 0;
  run(car, 6, { ...idle, throttle: 0.25, steer: 0.35 }, (t, c) => { if (t > 1) maxBeta = Math.max(maxBeta, Math.abs(c.beta)); });
  check('grip corner at 60 km/h', deg(maxBeta) < 10, `max slip ${deg(maxBeta).toFixed(1)} deg, ${kmh(car).toFixed(0)} km/h`);
}

// 4. Handbrake entry, then hold the drift on throttle with neutral input (assist counter-steers).
function driftHold(label, steerHold, needAngle = true) {
  const car = new CarBody();
  car.vz = 70 / 3.6;
  car.gear = 3;
  const betas = [];
  let spun = false;
  run(car, 7, (t) => {
    if (t < 0.45) return { throttle: 0.4, brake: 0, steer: 1, handbrake: true };
    return { throttle: 0.85, brake: 0, steer: steerHold, handbrake: false };
  }, (t, c) => {
    if (t > 1.5) betas.push(Math.abs(c.beta));
    if (Math.abs(c.beta) > Math.PI / 2 || Math.abs(c.u) < 1) spun = true;
  });
  const avg = betas.reduce((a, b) => a + b, 0) / betas.length;
  check(`${label}`, !spun && (!needAngle || (deg(avg) > 12 && deg(avg) < 65)),
    `avg angle ${deg(avg).toFixed(1)} deg, end ${kmh(car).toFixed(0)} km/h, spun=${spun}`);
  return car;
}
driftHold('handbrake drift held with steer into corner', 0.6);
driftHold('light steer holds a shallower drift', 0.3);
driftHold('neutral stick straightens without spinning', 0, false);
driftHold('full lock into the corner does not spin', 1, false);

// 5. Power-over from second gear.
{
  const car = new CarBody();
  car.vz = 45 / 3.6;
  car.gear = 2;
  let maxBeta = 0;
  run(car, 3, { ...idle, throttle: 1, steer: 1 }, (t, c) => { maxBeta = Math.max(maxBeta, Math.abs(c.beta)); });
  check('power-over initiates a slide', deg(maxBeta) > 12, `max slip ${deg(maxBeta).toFixed(1)} deg`);
}

// 6. Lifting off ends the drift and the car straightens.
{
  const car = driftHold('drift before straighten', 0.4);
  run(car, 3, { ...idle, throttle: 0.2 });
  check('recovers to grip', deg(Math.abs(car.beta)) < 6, `slip ${deg(car.beta).toFixed(1)} deg`);
}

// 7. Reverse.
{
  const car = new CarBody();
  run(car, 3, { ...idle, brake: 1 });
  check('reverses from a stop', car.gear === -1 && car.u < -2, `gear ${car.gear}, u ${car.u.toFixed(1)} m/s`);
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall handling checks passed');
