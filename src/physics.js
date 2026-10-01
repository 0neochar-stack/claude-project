// Drift car dynamics: a four-wheel model with load transfer, a combined-slip tyre, and an engine, clutch and
// locked diff driving the rear axle. Assists sit on top of the physics, Drift Hunters style: auto counter-steer
// (steer relative to where the car is travelling), a soft angle limiter and drift speed hold.
// Pure math with no three.js import, so tests/sim.mjs can run it in node.
// The world is the x/z plane. Heading h: forward = (sin h, cos h), left = (cos h, -sin h).
// A positive yaw rate turns the car left. In the car frame u is forward speed and v is speed to the left.

export const SPEC = {
  mass: 1250,
  inertia: 1900, // yaw
  a: 1.2, // centre of mass to front axle (m)
  b: 1.35, // centre of mass to rear axle (m)
  trackF: 1.58,
  trackR: 1.56,
  cgHeight: 0.46,
  rollFront: 0.56, // share of lateral load transfer taken by the front axle
  wheelRadius: 0.33,
  wheelInertia: 2.6, // rear axle, both wheels and the diff
  gears: [3.35, 2.2, 1.62, 1.28, 1.04, 0.86],
  reverseRatio: 3.2,
  finalDrive: 3.7,
  idleRpm: 950,
  redline: 7800,
  shiftUpRpm: 7300,
  shiftDownRpm: 3200,
  torque: 440, // peak Nm
  engineInertia: 0.2,
  engineBrake: 0.16, // friction torque at redline, as a share of peak torque
  clutchCap: 1.8, // clutch kick capacity, as a share of peak torque
  muLat: 1.08,
  muLong: 1.18,
  loadSens: 0.1,
  alphaPeak: 0.13, // slip angle of peak lateral grip (rad)
  slipPeak: 0.12, // slip ratio of peak traction
  tail: 0.9, // grip left once a tyre is fully sliding, as a share of peak
  maxSteer: 0.84, // rad at the wheels (drift cars run big lock)
  brakeTorque: 4300, // all four wheels, Nm
  brakeBias: 0.66,
  handbrakeTorque: 2600,
  drag: 0.4,
  rolling: 10,
  angleBonus: 0,
};

const G = 9.81;
const VREF = 3; // slip denominators never drop below this, so slow-speed slips stay finite
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const RPM = 60 / (2 * Math.PI);

export function torqueCurve(rpm, redline) {
  const x = rpm / redline;
  return clamp(0.55 + 1.25 * x - 0.95 * x * x, 0.3, 1);
}

// Normalised tyre curve: rises to 1 at the peak slip, then eases down to `tail` once fully sliding.
function grip(x, tail) {
  return x < 1 ? x * (2 - x) : tail + (1 - tail) * Math.exp(-(x - 1) * 0.8);
}

// Assist presets. The menu sets assist to 0 (Off), 0.35 (Low), 0.75 (Medium) or 1 (High); values between blend.
//   counter     how much the front wheels follow the travel direction on their own (auto counter-steer)
//   steady      damps the drift angle swinging
//   holdAngle   pulls the slide toward the angle your throttle and steering ask for
//   limit       soft maximum drift angle (rad)
//   hold        drift speed hold
const ASSIST_LEVELS = [
  [0, { counter: 0, steady: 0, holdAngle: 0, limit: Infinity, hold: 0 }],
  [0.35, { counter: 0.92, steady: 0.7, holdAngle: 0.35, limit: 1.25, hold: 0 }],
  [0.75, { counter: 1, steady: 1.2, holdAngle: 0.8, limit: 1.06, hold: 0.6 }],
  [1, { counter: 1, steady: 1.6, holdAngle: 1, limit: 0.98, hold: 1 }],
];
export function assistParams(assist) {
  let i = 0;
  while (i < ASSIST_LEVELS.length - 2 && assist > ASSIST_LEVELS[i + 1][0]) i++;
  const [a0, p0] = ASSIST_LEVELS[i], [a1, p1] = ASSIST_LEVELS[i + 1];
  const t = clamp((assist - a0) / (a1 - a0), 0, 1);
  const out = {};
  for (const k of Object.keys(p0)) out[k] = !Number.isFinite(p0[k]) ? (t > 0 ? p1[k] : Infinity) : lerp(p0[k], p1[k], t);
  return out;
}

export class CarBody {
  constructor(spec = SPEC) {
    this.spec = spec;
    this.assist = 0.75;
    this.autoGear = true;
    this.load = new Float64Array(4);
    this.slip = new Float64Array(4); // per-wheel sliding speed (m/s) for smoke and marks: FL, FR, RL, RR
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    Object.assign(this, {
      x, z, h: heading, vx: 0, vz: 0, r: 0,
      steer: 0, gear: 1, rpm: this.spec.idleRpm, shiftTimer: 0, reverseHold: 0,
      ax: 0, ay: 0, beta: 0, speed: 0, u: 0, v: 0,
      wheelspin: 0, rearSlip: 0, frontSlip: 0, driveThrottle: 0, braking: 0, handbrake: false,
      wheelSpinAngle: 0, clutch: false, kick: 0, limiterHold: 0,
      omega: 0, engW: this.spec.idleRpm / RPM, locked: false,
    });
    this.load.fill(0);
    this.slip.fill(0);
  }

  // Puts the car in motion straight ahead at `speed` m/s in `gear`, wheels and engine turning to match.
  launch(speed, gear = this.gear) {
    this.vx = Math.sin(this.h) * speed;
    this.vz = Math.cos(this.h) * speed;
    this.gear = gear;
    this.omega = speed / this.spec.wheelRadius;
    this.engW = Math.max(this.spec.idleRpm / RPM, Math.abs(this.omega * this.ratio));
    this.locked = true;
  }

  get ratio() {
    const s = this.spec;
    return (this.gear === -1 ? -s.reverseRatio : s.gears[this.gear - 1]) * s.finalDrive;
  }

  shift(dir) {
    if (this.shiftTimer > 0) return;
    const next = clamp(this.gear + dir, -1, this.spec.gears.length);
    this.gear = next === 0 ? (dir > 0 ? 1 : -1) : next;
    this.shiftTimer = 0.12;
  }

  // Impulse at a world-space point offset (px, pz) from the centre of mass.
  applyImpulse(px, pz, jx, jz) {
    this.vx += jx / this.spec.mass;
    this.vz += jz / this.spec.mass;
    this.r += (pz * jx - px * jz) / this.spec.inertia;
    // The wheels roll with the car, so a hit that kills speed slows them too.
    const u = this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
    if (Math.abs(this.omega * this.spec.wheelRadius) > Math.abs(u) + 2) this.omega = (u + Math.sign(this.omega) * 2) / this.spec.wheelRadius;
  }

  step(dt, input) {
    // Two substeps keep the stiff tyre forces stable at the 120 Hz outer step.
    const h = dt / 2;
    this.substep(h, input);
    this.substep(h, input);
  }

  substep(dt, input) {
    const s = this.spec;
    const L = s.a + s.b;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    const u = this.vx * sh + this.vz * ch;
    const v = this.vx * ch - this.vz * sh;
    const r = this.r;
    const speed = Math.hypot(u, v);
    this.u = u; this.v = v; this.speed = speed;
    this.beta = speed > 2 ? Math.atan2(v, Math.abs(u)) : 0;
    const A = assistParams(this.assist);

    // ---------- gear selection ----------
    let throttle = input.throttle, brake = input.brake;
    if (this.gear === -1) [throttle, brake] = [brake, throttle];
    if (this.gear > 0 && speed < 1.2 && input.brake > 0.1 && input.throttle < 0.05) {
      this.reverseHold += dt;
      if (this.reverseHold > 0.3) { this.gear = -1; this.reverseHold = 0; }
    } else if (this.gear === -1 && speed < 1.2 && input.throttle > 0.1) {
      this.gear = 1;
    } else this.reverseHold = 0;

    const groundRpm = (speed / s.wheelRadius) * Math.abs(this.ratio) * RPM;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) { // auto-blip: the engine meets the new gear
        const want = this.omega * this.ratio;
        if (want > s.idleRpm / RPM) { this.engW = want; this.locked = true; }
      }
    } else if (this.autoGear && this.gear > 0 && !input.clutch) {
      this.limiterHold = this.rpm > s.redline - 120 ? this.limiterHold + dt : 0;
      if (this.gear < s.gears.length && (groundRpm > s.shiftUpRpm || this.limiterHold > 0.45)) this.shift(1);
      // Downshift only when the engine itself is bogging, so a drift with the rears spinning keeps its gear.
      else if (this.gear > 1 && groundRpm < s.shiftDownRpm && this.rpm < s.shiftDownRpm + 300) {
        const lower = s.gears[this.gear - 2] * s.finalDrive;
        if ((speed / s.wheelRadius) * lower * RPM < s.shiftUpRpm - 900) this.shift(-1);
      }
    }

    // ---------- steering ----------
    const fu = u, fv = v + s.a * r;
    const travel = fu > 2 ? Math.atan2(fv, fu) : 0; // direction the front axle is moving, relative to the nose
    const sliding = smooth(0.06, 0.24, Math.abs(this.beta)) * smooth(3, 8, speed);
    const maxSteer = s.maxSteer;
    // While gripping, lock shrinks with speed to what the front tyres can use; sliding, full lock is available.
    const gripLock = clamp((L * s.muLat * G) / Math.max(u * u, 1) + s.alphaPeak * 1.4, 0.1, maxSteer);
    // Sliding with auto counter-steer, the stick sets the front tyres' slip angle around the travel direction,
    // so half stick is half the front's pull rather than a saturated tyre.
    const slideLock = lerp(maxSteer, s.alphaPeak * 2.4, A.counter);
    const lock = lerp(gripLock, slideLock, sliding);
    let target = input.steer * lock + travel * A.counter;
    target = clamp(target, -maxSteer, maxSteer);
    this.steer += clamp(target - this.steer, -9 * dt, 9 * dt);
    const d = this.steer, cd = Math.cos(d), sd = Math.sin(d);

    // ---------- loads ----------
    const m = s.mass;
    const N0 = (m * G) / 4;
    const nf = (m * G * s.b) / L / 2, nr = (m * G * s.a) / L / 2;
    const dx = (m * this.ax * s.cgHeight) / L / 2;
    const dyt = m * this.ay * s.cgHeight;
    const dyf = (dyt * s.rollFront) / s.trackF, dyr = (dyt * (1 - s.rollFront)) / s.trackR;
    const load = this.load;
    load[0] = Math.max(150, nf - dx - dyf); // FL
    load[1] = Math.max(150, nf - dx + dyf); // FR
    load[2] = Math.max(150, nr + dx - dyr); // RL
    load[3] = Math.max(150, nr + dx + dyr); // RR
    const muScale = (N) => 1 - s.loadSens * (N / N0 - 1);

    // ---------- front tyres (free rolling, ABS brakes) ----------
    let Fu = 0, Fv = 0, Tq = 0;
    const brakeF = (brake * s.brakeTorque * s.brakeBias) / s.wheelRadius / 2;
    for (let i = 0; i < 2; i++) {
      const py = i === 0 ? s.trackF / 2 : -s.trackF / 2;
      const wu = u - r * py, wv = v + r * s.a;
      const lng = wu * cd + wv * sd;
      const lat = -wu * sd + wv * cd;
      const N = load[i], k = muScale(N);
      const sy = Math.atan2(lat, Math.max(Math.abs(lng), VREF)) / s.alphaPeak;
      const muY = s.muLat * k * N, muX = s.muLong * k * N;
      let fy = -Math.sign(sy) * muY * grip(Math.abs(sy), s.tail);
      let fx = 0;
      if (brakeF > 0 && Math.abs(lng) > 0.05) {
        fx = -Math.sign(lng) * Math.min(brakeF, muX * 0.88);
        fy *= Math.sqrt(Math.max(0, 1 - (fx / muX) ** 2));
      } else if (brakeF > 0) fx = -lng * m * 0.5; // hold still
      // Wheel frame to car frame.
      const cu = fx * cd - fy * sd, cv = fx * sd + fy * cd;
      Fu += cu; Fv += cv;
      Tq += s.a * cv - py * cu;
      this.slip[i] = Math.abs(lat) * smooth(1, 2.5, Math.abs(sy));
    }

    // ---------- engine, clutch, rear axle ----------
    const ratio = this.ratio;
    const eff = 0.88;
    const idleW = s.idleRpm / RPM, redW = s.redline / RPM;
    const pedal = !!input.clutch || input.handbrake; // handbrake dips the clutch, like a driver would
    // Clutch kick: releasing the pedal with the engine revved high gives a short surge at the rear wheels.
    if (this.clutch && !input.clutch && this.gear > 0) {
      this.kick = 0.35;
      this.kickPower = clamp((this.engW - this.omega * this.ratio) / (0.35 * s.redline / RPM), 0, 1);
    }
    this.clutch = !!input.clutch;
    this.kick = Math.max(0, this.kick - dt);
    const engaged = !pedal && this.shiftTimer <= 0;
    const rpmNow = this.engW * RPM;
    if (rpmNow >= s.redline) this.cut = true;
    else if (rpmNow < s.redline - 250) this.cut = false;
    const effThrottle = this.shiftTimer > 0 || this.cut ? 0 : throttle;
    const engineTorque = (w) => {
      const rpm = Math.max(w * RPM, 1);
      let t = effThrottle * s.torque * torqueCurve(rpm, s.redline);
      t -= s.torque * s.engineBrake * clamp((rpm - s.idleRpm) / (s.redline - s.idleRpm), 0, 1) * (1 - effThrottle);
      if (w < idleW) t += (idleW - w) * 8; // idle governor
      return t;
    };

    // Rear tyre forces for a given axle speed (locked diff: both rears turn together).
    const rear = [0, 0, 0, 0, 0]; // fu0, fv0, fu1, fv1, sum of longitudinal force
    const rearForces = (omega, out) => {
      let sum = 0;
      for (let j = 0; j < 2; j++) {
        const py = j === 0 ? s.trackR / 2 : -s.trackR / 2;
        const lng = u - r * py, lat = v - r * s.b;
        const N = load[2 + j], k = muScale(N);
        const den = Math.max(Math.abs(lng), VREF);
        const sx = (omega * s.wheelRadius - lng) / den / s.slipPeak;
        const sy = Math.atan2(lat, den) / s.alphaPeak;
        const sig = Math.hypot(sx, sy);
        let fx = 0, fy = 0;
        if (sig > 1e-9) {
          const g = grip(sig, s.tail);
          fx = s.muLong * k * N * g * (sx / sig);
          fy = -s.muLat * k * N * g * (sy / sig);
        }
        out[j * 2] = fx; out[j * 2 + 1] = fy;
        sum += fx;
      }
      out[4] = sum;
      return sum;
    };

    // Clutch capacity: none with the pedal down or mid-shift; a kick slams it in; pulling away from a stop the
    // auto-clutch feeds in with the throttle so the car never creeps with your foot off; otherwise fully home.
    const wheelEng = this.omega * ratio; // engine speed the wheels ask for (signed)
    let cap = 0;
    if (engaged) {
      if (this.kick > 0) cap = s.clutchCap * s.torque;
      else if (wheelEng < idleW * 1.05) cap = s.torque * 1.25 * smooth(0, 0.35, throttle);
      else cap = s.torque * 3;
    }
    if (!engaged || wheelEng < idleW * 0.8) this.locked = false;

    // Semi-implicit axle update so stiff tyre forces cannot blow it up.
    const R = s.wheelRadius;
    const F0 = rearForces(this.omega, rear);
    const eps = 0.05;
    const F1 = rearForces(this.omega + eps, [0, 0, 0, 0, 0]);
    const gain = Math.max(0, (F1 - F0) / eps);
    const brakeR = brake * s.brakeTorque * (1 - s.brakeBias) + (input.handbrake ? s.handbrakeTorque : 0);
    const axle = (driveT, inertia) => {
      const den = inertia + dt * R * gain;
      let nw = this.omega + (dt * (driveT - R * F0)) / den;
      const dB = (dt * brakeR) / den;
      if (Math.abs(nw) <= dB) nw = 0;
      else nw -= Math.sign(nw) * dB;
      return nw;
    };

    const surge = this.kick > 0 ? (this.kickPower || 0) * (this.kick / 0.35) * s.torque * 1.6 * ratio * eff : 0;
    let w;
    if (this.locked) {
      // Engine and wheels turn as one.
      const te = engineTorque(this.engW);
      w = axle(te * ratio * eff + surge, s.wheelInertia + s.engineInertia * ratio * ratio);
      const newEng = w * ratio;
      // The clutch slips if holding them together takes more torque than it can carry.
      const needed = te - (s.engineInertia * (newEng - this.engW)) / dt;
      if (Math.abs(needed) > cap) this.locked = false;
      this.engW = newEng;
    } else {
      // Engine spins on its own; the clutch passes its capacity across the speed gap.
      const gap = this.engW - wheelEng;
      const tc = Math.sign(gap) * cap;
      const te = engineTorque(this.engW);
      this.engW = Math.max(idleW * 0.5, this.engW + ((te - tc) / s.engineInertia) * dt);
      w = axle(tc * ratio * eff + surge, s.wheelInertia);
      // Lock up when the speeds cross, if the wheels are quick enough for the engine to run in gear.
      if (cap > 0 && Math.sign(this.engW - w * ratio) !== Math.sign(gap) && w * ratio > idleW * 0.95) {
        this.locked = true;
        this.engW = w * ratio;
      }
    }
    this.omega = w;
    rearForces(w, rear);
    for (let j = 0; j < 2; j++) {
      const py = j === 0 ? s.trackR / 2 : -s.trackR / 2;
      const fx = rear[j * 2], fy = rear[j * 2 + 1];
      Fu += fx; Fv += fy;
      Tq += -s.b * fy - py * fx;
      const lng = u - r * py, lat = v - r * s.b;
      this.slip[2 + j] = Math.hypot(w * R - lng, lat) * smooth(0.6, 2, Math.hypot(w * R - lng, lat));
    }

    // ---------- assists ----------
    const betaRate = (this.beta - (this.prevBeta ?? this.beta)) / dt;
    this.prevBeta = this.beta;
    // Angle steadiness: damp changes in drift angle while sliding.
    if (speed > 4 && sliding > 0) Tq += betaRate * A.steady * sliding * s.inertia;
    // Angle hold: throttle and steering into the slide ask for more angle, counter-steer for less.
    if (speed > 5 && sliding > 0 && A.holdAngle > 0) {
      const side = -Math.sign(this.beta); // +1 when the car is rotated left of its travel
      const into = clamp(input.steer * side, -1, 1);
      const want = clamp(0.36 + 0.3 * throttle + 0.36 * into, 0.06, 1.15) + (s.angleBonus || 0);
      this.targetAngle = want;
      Tq += Math.sign(this.beta) * (Math.abs(this.beta) - want) * 9 * A.holdAngle * sliding * s.inertia;
    }
    if (speed > 4 && Number.isFinite(A.limit)) {
      const limit = A.limit + (s.angleBonus || 0);
      const deep = smooth(limit * 0.7, limit, Math.abs(this.beta));
      if (this.beta * betaRate > 0) Tq += betaRate * deep * 3 * s.inertia;
      if (Math.abs(this.beta) > limit) Tq += Math.sign(this.beta) * (Math.abs(this.beta) - limit) * 22 * s.inertia;
    }
    // Drift speed hold: with power on, scrub from a slide costs less speed.
    if (sliding > 0 && throttle > 0.2 && u > 4 && A.hold > 0) Fu += A.hold * sliding * throttle * m * 1.5;

    // ---------- integrate ----------
    let Fx = Fu * sh + Fv * ch;
    let Fz = Fu * ch - Fv * sh;
    Fx -= this.vx * (s.drag * speed + s.rolling);
    Fz -= this.vz * (s.drag * speed + s.rolling);
    if (speed < 0.6 && throttle < 0.05) { Fx -= this.vx * m * 4; Fz -= this.vz * m * 4; }

    this.vx += (Fx / m) * dt;
    this.vz += (Fz / m) * dt;
    this.r += (Tq / s.inertia) * dt;
    if (speed < 0.5 && Math.abs(this.r) < 0.5) this.r *= 0.9;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.h += this.r * dt;

    // Load transfer follows the chassis accelerations through a little suspension lag.
    const k = Math.min(1, dt / 0.07);
    this.ax += (clamp(Fu / m, -14, 14) - this.ax) * k;
    this.ay += (clamp(Fv / m, -14, 14) - this.ay) * k;

    // ---------- outputs for sound, effects and HUD ----------
    this.rpm = clamp(this.engW * RPM, s.idleRpm * 0.6, s.redline + 200);
    this.engW = Math.min(this.engW, redW * 1.03);
    const rearLng = w * R - u;
    this.wheelspin = clamp((Math.abs(rearLng) - 1.5) / 6, 0, 1);
    this.rearSlip = Math.max(this.slip[2], this.slip[3]);
    this.frontSlip = Math.max(this.slip[0], this.slip[1]);
    this.driveThrottle = effThrottle;
    this.braking = brake;
    this.handbrake = !!input.handbrake;
    this.wheelSpinAngle += w * dt;
  }
}
