// Arcade drift car dynamics. Pure math with no three.js import, so tests/sim.mjs can run it in node.
// The world is the x/z plane. Heading h: forward = (sin h, cos h), left = (cos h, -sin h).
// A positive yaw rate turns the car left.

export const SPEC = {
  mass: 1250,
  inertia: 1650,
  a: 1.2, // centre of mass to front axle (m)
  b: 1.35, // centre of mass to rear axle (m)
  cgHeight: 0.45,
  wheelRadius: 0.33,
  gears: [3.35, 2.2, 1.62, 1.28, 1.04, 0.86],
  reverseRatio: 3.2,
  finalDrive: 3.7,
  idleRpm: 950,
  redline: 7800,
  shiftUpRpm: 7250,
  shiftDownRpm: 3000,
  torque: 440, // peak Nm
  muLat: 1.08,
  muLong: 1.25,
  tireB: 9,
  tireC: 1.45,
  maxSteer: 0.62, // rad at the wheels
  brakeForce: 12500,
  handbrakeGrip: 0.3,
  drag: 0.4,
  rolling: 10,
};

const G = 9.81;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function torqueCurve(rpm, redline) {
  const x = rpm / redline;
  return clamp(0.55 + 1.25 * x - 0.95 * x * x, 0.3, 1);
}

// Magic-formula style lateral force: grips up to ~12 degrees, then falls off gently so slides stay catchable.
function tireForce(alpha, peak, spec) {
  return peak * Math.sin(spec.tireC * Math.atan(spec.tireB * alpha));
}

export class CarBody {
  constructor(spec = SPEC) {
    this.spec = spec;
    this.assist = 0.75; // 0 = raw, 1 = heavy counter-steer help
    this.autoGear = true;
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    Object.assign(this, {
      x, z, h: heading, vx: 0, vz: 0, r: 0,
      steer: 0, gear: 1, rpm: this.spec.idleRpm, shiftTimer: 0, reverseHold: 0,
      ax: 0, beta: 0, prevBeta: 0, speed: 0, u: 0, v: 0,
      wheelspin: 0, rearSlip: 0, frontSlip: 0, driveThrottle: 0, braking: 0, handbrake: false,
      wheelSpinAngle: 0,
    });
  }

  shift(dir) {
    if (this.shiftTimer > 0) return;
    const next = clamp(this.gear + dir, -1, this.spec.gears.length);
    if (next === 0) {
      this.gear = dir > 0 ? 1 : -1;
    } else this.gear = next;
    this.shiftTimer = 0.14;
  }

  // Impulse at a world-space point offset (px, pz) from the centre of mass.
  applyImpulse(px, pz, jx, jz) {
    this.vx += jx / this.spec.mass;
    this.vz += jz / this.spec.mass;
    this.r += (pz * jx - px * jz) / this.spec.inertia;
  }

  step(dt, input) {
    const s = this.spec;
    const L = s.a + s.b;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    const u = this.vx * sh + this.vz * ch;
    const v = this.vx * ch - this.vz * sh;
    const speed = Math.hypot(u, v);
    this.u = u; this.v = v; this.speed = speed;
    this.beta = speed > 2 ? Math.atan2(v, Math.abs(u)) : 0;

    // Gear logic: brake from a stop selects reverse; throttle selects first again.
    let throttle = input.throttle, brake = input.brake;
    if (this.gear === -1) [throttle, brake] = [brake, throttle];
    if (this.gear > 0 && speed < 1.2 && input.brake > 0.1 && input.throttle < 0.05) {
      this.reverseHold += dt;
      if (this.reverseHold > 0.3) { this.gear = -1; this.reverseHold = 0; }
    } else if (this.gear === -1 && speed < 1.2 && input.throttle > 0.1) {
      this.gear = 1;
    } else this.reverseHold = 0;

    // Steering: speed-sensitive lock while gripping, full lock once sliding, plus counter-steer assist.
    const sliding = smooth(0.08, 0.3, Math.abs(this.beta)) * smooth(3, 8, speed);
    const lock = s.maxSteer * lerp(lerp(1, 0.32, smooth(5, 45, speed)), 1, sliding);
    let target = input.steer * lock;
    if (u > 1) target += clamp(this.beta, -s.maxSteer, s.maxSteer) * this.assist * sliding;
    target = clamp(target, -s.maxSteer, s.maxSteer);
    this.steer += clamp(target - this.steer, -5.5 * dt, 5.5 * dt);
    const d = this.steer;

    // Static load with longitudinal weight transfer.
    const transfer = (s.mass * this.ax * s.cgHeight) / L;
    const Nf = Math.max(s.mass * G * s.b / L - transfer, 800);
    const Nr = Math.max(s.mass * G * s.a / L + transfer, 800);

    // Engine.
    const ratio = this.gear === -1 ? s.reverseRatio : s.gears[this.gear - 1];
    const toRpm = (ratio * s.finalDrive * 60) / (2 * Math.PI * s.wheelRadius);
    const wheelRpm = Math.abs(u) * toRpm;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.autoGear && this.gear > 0 && this.shiftTimer <= 0) {
      if (wheelRpm > s.shiftUpRpm && this.gear < s.gears.length && this.wheelspin < 0.5) this.shift(1);
      else if (wheelRpm < s.shiftDownRpm && this.gear > 1 && (Math.abs(this.beta) < 0.25 || this.gear > 2)) this.shift(-1);
    }
    const shifting = this.shiftTimer > 0;
    const engineRpm = this.wheelspin > 0.5 ? Math.max(this.rpm, wheelRpm) : Math.max(wheelRpm, s.idleRpm);
    const limiter = engineRpm >= s.redline;
    const effThrottle = shifting || limiter ? 0 : throttle;
    const dir = this.gear === -1 ? -1 : 1;
    let drive = dir * s.torque * torqueCurve(engineRpm, s.redline) * effThrottle * ratio * s.finalDrive / s.wheelRadius * 0.85;

    // Rear axle: drive, brake and handbrake share one friction ellipse.
    const rearLong = u;
    const rearLat = v - s.b * this.r;
    const rollDir = Math.abs(rearLong) > 0.3 ? Math.sign(rearLong) : 0;
    let fxr = drive - rollDir * brake * s.brakeForce * 0.38;
    if (input.handbrake) fxr -= rollDir * Math.min(s.muLong * Nr * 0.75, 9000);
    if (Math.abs(rearLong) < 0.6 && throttle < 0.05) fxr -= rearLong * s.mass * 2; // hold still
    const capR = s.muLong * Nr;
    let latScaleR;
    if (Math.abs(fxr) > capR) {
      fxr = Math.sign(fxr) * capR * 0.92;
      latScaleR = 0.5;
      this.wheelspin = Math.min(1, this.wheelspin + dt * 6);
    } else {
      latScaleR = Math.max(0.5, Math.sqrt(1 - (fxr / capR) ** 2));
      this.wheelspin = Math.max(0, this.wheelspin - dt * 4);
    }
    if (input.handbrake) latScaleR *= s.handbrakeGrip;
    const alphaR = Math.atan2(rearLat, Math.max(Math.abs(rearLong), 4));
    const fyr = -tireForce(alphaR, s.muLat * Nr * latScaleR, s);

    // Front axle, in the steered wheel's own frame.
    const fu = u, fv = v + s.a * this.r;
    const cd = Math.cos(d), sd = Math.sin(d);
    const wLong = fu * cd + fv * sd;
    const wLat = -fu * sd + fv * cd;
    const alphaF = Math.atan2(wLat, Math.max(Math.abs(wLong), 4));
    const fDir = Math.abs(wLong) > 0.3 ? Math.sign(wLong) : 0;
    let fxfW = -fDir * brake * s.brakeForce * 0.62;
    const capF = s.muLong * Nf;
    fxfW = clamp(fxfW, -capF, capF);
    const latScaleF = Math.max(0.35, Math.sqrt(1 - (fxfW / capF) ** 2));
    const fyfW = -tireForce(alphaF, s.muLat * Nf * latScaleF, s);
    // Wheel frame back into the car frame.
    const fxf = fxfW * cd - fyfW * sd;
    const fyf = fxfW * sd + fyfW * cd;

    let Fu = fxr + fxf;
    let Fv = fyr + fyf;
    let torque = s.a * fyf - s.b * fyr;

    // Low-speed lateral damping so the car does not creep sideways when parked.
    if (speed < 3) Fv -= v * s.mass * 3 * (1 - speed / 3);

    // Drift assist: stop the tail swinging past ~62 degrees and damp yaw while gripping.
    const betaMax = lerp(1.6, 1.08, this.assist);
    const betaRate = (this.beta - this.prevBeta) / dt;
    this.prevBeta = this.beta;
    if (speed > 4) {
      // Resist the angle growing once it is deep, then clamp hard past betaMax.
      const deep = smooth(betaMax * 0.5, betaMax, Math.abs(this.beta)) * this.assist;
      if (this.beta * betaRate > 0) torque += betaRate * deep * 7 * s.inertia;
      if (Math.abs(this.beta) > betaMax) torque += Math.sign(this.beta) * (Math.abs(this.beta) - betaMax) * 40 * s.inertia;
    }
    torque -= this.r * s.inertia * lerp(0.4, 0.05, sliding);

    // Keep some drive through long slides so chains do not bleed all their speed.
    if (sliding > 0 && throttle > 0 && u > 3) Fu += sliding * throttle * s.mass * 1.6 * this.assist;

    // To world, plus aero drag and rolling resistance.
    let Fx = Fu * sh + Fv * ch;
    let Fz = Fu * ch - Fv * sh;
    Fx -= this.vx * (s.drag * speed + s.rolling);
    Fz -= this.vz * (s.drag * speed + s.rolling);

    this.vx += (Fx / s.mass) * dt;
    this.vz += (Fz / s.mass) * dt;
    this.r += (torque / s.inertia) * dt;
    if (speed < 0.5 && Math.abs(this.r) < 0.5) this.r *= 0.9;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.h += this.r * dt;

    this.ax = lerp(this.ax, clamp(Fu / s.mass, -12, 12), Math.min(1, dt * 8));
    const targetRpm = this.wheelspin > 0.5
      ? Math.max(wheelRpm, s.idleRpm + (s.redline - s.idleRpm) * (0.55 + 0.4 * throttle))
      : Math.max(wheelRpm, s.idleRpm + throttle * (shifting ? 900 : 0));
    this.rpm = clamp(lerp(this.rpm, targetRpm, Math.min(1, dt * 10)), s.idleRpm, s.redline + 150);
    if (limiter) this.rpm -= 250;

    this.rearSlip = Math.abs(rearLat) + this.wheelspin * 6 + (input.handbrake && speed > 3 ? 4 : 0);
    this.frontSlip = Math.abs(wLat);
    this.driveThrottle = effThrottle;
    this.braking = brake;
    this.handbrake = !!input.handbrake;
    this.wheelSpinAngle += (u / s.wheelRadius + this.wheelspin * 40 * dir) * dt;
  }
}
