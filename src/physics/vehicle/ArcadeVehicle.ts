import type RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import type { VehicleSpec, WheelId } from "../../assets/vehicleRig";
import type { VehicleTuning } from "../../config/vehicleTuning";
import { approach, clamp, clamp01, damp, lerp, smoothstep } from "../../core/math";
import type { DriveInput } from "../../input/types";
import { Groups } from "../groups";
import type { PhysicsWorld } from "../PhysicsWorld";
import { counterSteerAmount, DriftDetector, driftYawAssist, speedRetention, stabilityYawAssist } from "./DriftAssist";
import { engineForce, lateralGripCurve, lateralLimit, maxSteerAngle } from "./TireModel";

const GRAVITY = 9.81;
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
/** Rapier cylinders run along local Y; tyres need their axle along X. */
const AXLE = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
const IMPACT_EVENT_THRESHOLD = 3_000; // N

export interface Spawn {
  position: Vector3;
  yaw: number;
}

export interface WheelState {
  readonly id: WheelId;
  readonly front: boolean;
  readonly left: boolean;
  readonly radius: number;
  /** Hub position at rest (modelled position), chassis space. */
  readonly rest: Vector3;
  readonly shape: RAPIER.Cylinder;
  /** Tyre-shaped collider on the chassis: hits walls, pylons and cones. */
  readonly collider: RAPIER.Collider;
  contact: boolean;
  /** Suspension mount -> hub distance (m). */
  length: number;
  /** 0 = full droop, 1 = full bump. */
  compression: number;
  /** Normal load (N). */
  load: number;
  readonly contactPoint: Vector3;
  readonly contactNormal: Vector3;
  slipAngle: number;
  spinSpeed: number;
  spinAngle: number;
}

export interface VehicleTelemetry {
  speed: number;
  forwardSpeed: number;
  /** Angle between heading and travel; + = travelling left of the nose. */
  slipAngle: number;
  drifting: boolean;
  driftTime: number;
  groundedWheels: number;
  airTime: number;
  /** Forward acceleration, smoothed (m/s²). */
  accel: number;
  rearSlip: number;
  wheelspin: number;
  brakeLock: number;
  throttle: number;
  braking: boolean;
  gear: 1 | -1;
  steerAngle: number;
  /** Chassis up · world up: 1 upright, <0 upside down. */
  uprightness: number;
}

/**
 * Arcade car on a single Rapier rigid body. Wheels are tyre-shaped colliders on
 * the chassis plus shape-cast suspension (the same cylinder swept down each step),
 * so the car rides ramps and kerbs on real tyre geometry while forces stay authored.
 *
 * Call order per fixed step: step(dt, input) -> PhysicsWorld.step(dt) -> capture().
 */
export class ArcadeVehicle {
  readonly body: RAPIER.RigidBody;
  readonly chassis: RAPIER.Collider;
  readonly wheels: WheelState[];
  readonly drift = new DriftDetector();
  readonly telemetry: VehicleTelemetry = {
    speed: 0, forwardSpeed: 0, slipAngle: 0, drifting: false, driftTime: 0, groundedWheels: 0,
    airTime: 0, accel: 0, rearSlip: 0, wheelspin: 0, brakeLock: 0, throttle: 0, braking: false,
    gear: 1, steerAngle: 0, uprightness: 1,
  };

  /** Pose after the last two physics steps, for render interpolation. */
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly previousPosition = new Vector3();
  readonly previousQuaternion = new Quaternion();

  steerAngle = 0;

  private readonly mass: number;
  private readonly inertia: Vector3;
  private readonly cornerMass: number;
  private readonly springRate: number;
  private readonly damperRate: number;
  private readonly springFreeLength: number;
  private readonly castLength: number;
  private gear: 1 | -1 = 1;
  private rearGrip = 1;
  private handbrakeWasDown = false;
  private previousForwardSpeed = 0;
  private previousSlipAngle = 0;
  /** Seconds left in which a slide counts as an intended drift (set by the handbrake). */
  private driftIntent = 0;
  private impact = 0;
  private landing = 0;

  // Scratch vectors (the step runs 120x per second).
  private readonly pos = new Vector3();
  private readonly rot = new Quaternion();
  private readonly vel = new Vector3();
  private readonly angVel = new Vector3();
  private readonly up = new Vector3();
  private readonly down = new Vector3();
  private readonly fwd = new Vector3();
  private readonly left = new Vector3();
  private readonly com = new Vector3();
  private readonly mount = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tyreFwd = new Vector3();
  private readonly tyreRight = new Vector3();
  private readonly force = new Vector3();
  private readonly lateralForceSum = new Vector3();
  private readonly shapeRotation = new Quaternion();
  private readonly steerRotation = new Quaternion();
  private readonly ray: RAPIER.Ray;

  constructor(
    private readonly physics: PhysicsWorld,
    spec: VehicleSpec,
    readonly tuning: VehicleTuning,
    spawn: Spawn,
  ) {
    const { R, world } = physics;
    const t = tuning;
    this.mass = spec.massKg;

    // Box-approximated inertia from the hull bounds, then artistically scaled.
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < spec.hullPoints.length; i += 3) {
      this.tmp.fromArray(spec.hullPoints, i);
      min.min(this.tmp);
      max.max(this.tmp);
    }
    const size = max.clone().sub(min);
    const m12 = this.mass / 12;
    this.inertia = new Vector3(
      m12 * (size.y ** 2 + size.z ** 2) * t.inertiaScale.pitch,
      m12 * (size.x ** 2 + size.z ** 2) * t.inertiaScale.yaw,
      m12 * (size.x ** 2 + size.y ** 2) * t.inertiaScale.roll,
    );
    const centreOfMass = { x: (min.x + max.x) / 2, y: t.comHeight, z: (min.z + max.z) / 2 };

    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setCcdEnabled(true) // no tunnelling through walls at 250 km/h
        .setAngularDamping(t.angularDamping)
        .setCanSleep(false),
    );
    const hull = R.ColliderDesc.convexHull(spec.hullPoints);
    if (!hull) throw new Error("Vehicle hull points do not form a convex hull");
    this.chassis = world.createCollider(
      hull
        .setMassProperties(this.mass, centreOfMass, this.inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setCollisionGroups(Groups.chassis)
        .setFriction(0.35)
        .setRestitution(0.1)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(IMPACT_EVENT_THRESHOLD),
      this.body,
    );
    physics.onContactForce(this.chassis, (f) => this.recordImpact(f));

    this.wheels = spec.wheels.map((w): WheelState => {
      const collider = world.createCollider(
        R.ColliderDesc.cylinder(w.width / 2, w.radius)
          .setTranslation(w.position.x, w.position.y, w.position.z)
          .setRotation(AXLE)
          .setDensity(0) // mass lives in the chassis collider
          .setCollisionGroups(Groups.wheel)
          .setFriction(0.3)
          .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(IMPACT_EVENT_THRESHOLD),
        this.body,
      );
      physics.onContactForce(collider, (f) => this.recordImpact(f));
      return {
        id: w.id, front: w.front, left: w.left, radius: w.radius,
        rest: w.position.clone(),
        shape: new R.Cylinder(w.width / 2, w.radius),
        collider,
        contact: false, length: t.bumpTravel, compression: 0, load: 0,
        contactPoint: new Vector3(), contactNormal: new Vector3(0, 1, 0),
        slipAngle: 0, spinSpeed: 0, spinAngle: 0,
      };
    });

    // Springs sized so the static corner load sits each hub exactly at its modelled position.
    this.cornerMass = this.mass / this.wheels.length;
    this.springRate = this.cornerMass * (2 * Math.PI * t.springHz) ** 2;
    this.damperRate = 2 * t.dampingRatio * Math.sqrt(this.springRate * this.cornerMass);
    this.springFreeLength = t.bumpTravel + (this.cornerMass * GRAVITY) / this.springRate;
    this.castLength = t.bumpTravel + t.droopTravel;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

    this.reset(spawn);
  }

  reset(spawn: Spawn): void {
    const q = new Quaternion().setFromAxisAngle(Y, spawn.yaw);
    this.body.setTranslation(spawn.position, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.length = this.tuning.bumpTravel;
      w.spinSpeed = 0;
      w.contact = false;
    }
    this.steerAngle = 0;
    this.rearGrip = 1;
    this.gear = 1;
    this.previousForwardSpeed = 0;
    this.previousSlipAngle = 0;
    this.driftIntent = 0;
    this.drift.reset();
    this.telemetry.airTime = 0;
    this.capture();
    this.previousPosition.copy(this.position);
    this.previousQuaternion.copy(this.quaternion);
  }

  /** Record the post-physics pose; call right after PhysicsWorld.step(). */
  capture(): void {
    this.previousPosition.copy(this.position);
    this.previousQuaternion.copy(this.quaternion);
    const p = this.body.translation();
    const r = this.body.rotation();
    this.position.set(p.x, p.y, p.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
  }

  /** Interpolated render pose between the last two physics steps. */
  interpolate(alpha: number, outPosition: Vector3, outQuaternion: Quaternion): void {
    outPosition.lerpVectors(this.previousPosition, this.position, alpha);
    outQuaternion.slerpQuaternions(this.previousQuaternion, this.quaternion, alpha);
  }

  /** Collision / landing strength (0..1) since the last call, for rumble and camera shake. */
  consumeEvents(): { impact: number; landing: number } {
    const events = { impact: this.impact, landing: this.landing };
    this.impact = 0;
    this.landing = 0;
    return events;
  }

  step(dt: number, input: DriveInput): void {
    const t = this.tuning;
    const body = this.body;
    this.readState();
    const { vel, angVel, up, down, fwd, left } = this;

    const speed = vel.length();
    const forwardSpeed = vel.dot(fwd);
    const steerLeft = -input.steer;
    const wasGrounded = this.telemetry.groundedWheels;

    // --- Gear: brake at a standstill engages reverse; throttle returns to drive.
    if (this.gear === 1 && input.brake > 0.2 && input.throttle < 0.1 && forwardSpeed < 0.8 && wasGrounded >= 2) this.gear = -1;
    else if (this.gear === -1 && input.throttle > 0.2 && forwardSpeed > -0.8) this.gear = 1;
    const drivePedal = this.gear === 1 ? input.throttle : input.brake;
    const brakePedal = this.gear === 1 ? input.brake : input.throttle;

    // --- Slip angle (only meaningful going forward).
    const slipAngle = this.gear === 1 && speed > 2 ? Math.atan2(vel.dot(left), Math.max(forwardSpeed, 0.1)) : 0;

    // --- Steering: speed-sensitive lock, rate-limited, plus counter-steer assist in a drift.
    let steerTarget = steerLeft * maxSteerAngle(forwardSpeed, t);
    if (this.drift.drifting) steerTarget += t.counterSteerAssist * slipAngle;
    steerTarget = clamp(steerTarget, -t.maxSteerLow, t.maxSteerLow);
    const returning = Math.abs(steerTarget) < Math.abs(this.steerAngle) || Math.sign(steerTarget) !== Math.sign(this.steerAngle);
    this.steerAngle = approach(this.steerAngle, steerTarget, (returning ? t.steerReturnRate : t.steerRate) * dt);

    // --- Handbrake: kills rear grip; a pull with steering at speed kicks the tail out.
    if (input.handbrake && !this.handbrakeWasDown && wasGrounded >= 2 && speed > 8 && Math.abs(steerLeft) > 0.2) {
      const kick = t.handbrakeKick * Math.sign(steerLeft) * smoothstep(8, 20, speed);
      body.applyTorqueImpulse(this.tmp.copy(up).multiplyScalar(this.inertia.y * kick), true);
    }
    this.handbrakeWasDown = input.handbrake;
    this.driftIntent = input.handbrake ? t.driftIntentWindow : Math.max(0, this.driftIntent - dt);
    const gripTarget = input.handbrake
      ? t.handbrakeRearGrip
      : this.drift.drifting ? lerp(t.driftRearGrip, t.driftRearGripThrottle, drivePedal) : 1;
    this.rearGrip = approach(this.rearGrip, gripTarget, (gripTarget < this.rearGrip ? t.gripDropRate : t.gripRecoverRate) * dt);

    // --- Suspension: sweep each tyre cylinder down from its mount.
    const grounded = this.updateSuspension(dt);

    // --- Tyres.
    const engine = drivePedal * (this.gear === 1
      ? engineForce(forwardSpeed, t)
      : Math.abs(forwardSpeed) < t.reverseTopSpeed ? t.reverseForce : 0);
    const holdStill = speed < 0.35 && drivePedal < 0.05 && brakePedal < 0.05;
    const staticLoad = this.cornerMass * GRAVITY;
    this.body.worldCom(this.com);
    this.lateralForceSum.set(0, 0, 0);
    let wheelspin = 0;
    let brakeLock = 0;

    for (const w of this.wheels) {
      if (!w.contact) {
        const freeSpin = !w.front && drivePedal > 0 ? drivePedal * 45 * this.gear : 0;
        w.spinSpeed = input.handbrake && !w.front ? 0 : damp(w.spinSpeed, freeSpin, 1.5, dt);
        w.spinAngle += w.spinSpeed * dt;
        continue;
      }
      const n = w.contactNormal;
      this.steerRotation.setFromAxisAngle(up, w.front ? this.steerAngle : 0);
      this.tyreFwd.copy(fwd).applyQuaternion(this.steerRotation);
      this.tyreFwd.addScaledVector(n, -this.tyreFwd.dot(n)).normalize();
      this.tyreRight.crossVectors(this.tyreFwd, n);

      body.velocityAtPoint(w.contactPoint, this.tmp);
      const vLong = this.tmp.dot(this.tyreFwd);
      const vLat = this.tmp.dot(this.tyreRight);

      const load = Math.min(w.load, staticLoad * t.maxLoadFactor);
      const maxForce = (w.front ? t.gripFront : t.gripRear) * load;
      const maxLongForce = maxForce * t.gripLongitudinal;
      const rolling = clamp(vLong / 0.5, -1, 1); // smooth sign(vLong) around zero

      // Longitudinal: drive (rear), brakes, handbrake, rolling resistance.
      let fx = 0;
      let spin = 0;
      if (!w.front && engine > 0) {
        const requested = engine / 2;
        const cap = maxLongForce * (this.drift.drifting || input.handbrake ? 1 : t.tractionControl);
        fx += this.gear * Math.min(requested, cap);
        spin = clamp01((requested - maxLongForce * 0.9) / Math.max(maxLongForce, 1));
        wheelspin = Math.max(wheelspin, spin);
      }
      const brake = brakePedal * t.brakeForce * (w.front ? t.brakeFrontBias : 1 - t.brakeFrontBias) / 2;
      fx -= rolling * brake;
      if (brake > maxLongForce && Math.abs(vLong) > 2) brakeLock = Math.max(brakeLock, clamp01(brake / maxLongForce - 1));
      const locked = input.handbrake && !w.front;
      if (locked) fx -= rolling * t.handbrakeForce / 2;
      fx -= vLong * t.rollingResistance;
      if (holdStill) fx = -vLong * this.cornerMass / dt * 0.5;
      fx = clamp(fx, -maxLongForce, maxLongForce);

      // Lateral: slip-angle curve at speed, velocity cancelling near standstill,
      // limited by what the longitudinal force leaves of the friction circle.
      w.slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 1));
      const latMax = maxForce * (w.front ? 1 : this.rearGrip);
      const curve = -Math.sign(vLat) * lateralGripCurve(w.slipAngle, t.peakSlip, t.slideSlip, t.slideRatio) * latMax;
      const cancel = clamp(-vLat * this.cornerMass / dt * 0.5, -latMax, latMax);
      let fy = lerp(cancel, curve, smoothstep(1, 4, Math.abs(vLong)));
      const limit = lateralLimit(latMax, fx, t.combinedSlip);
      fy = clamp(fy, -limit, limit);

      this.force.copy(this.tyreFwd).multiplyScalar(fx).addScaledVector(this.tyreRight, fy);
      this.lateralForceSum.addScaledVector(this.tyreRight, fy);
      // Apply between contact patch and CoM height: same grip, less body roll.
      const lift = this.tmp2.copy(this.com).sub(w.contactPoint).dot(up) * t.tireForceLift;
      this.tmp2.copy(w.contactPoint).addScaledVector(up, lift);
      body.applyImpulseAtPoint(this.force.multiplyScalar(dt), this.tmp2, true);

      w.spinSpeed = locked ? 0 : (vLong + this.gear * spin * 25) / w.radius;
      w.spinAngle += w.spinSpeed * dt;
    }

    // --- Drift layer.
    const powerOver = drivePedal > 0.85 && Math.abs(slipAngle) > t.powerOverAngle;
    this.drift.update(speed, slipAngle, grounded >= 3, this.driftIntent > 0 || powerOver, dt, t);
    // Clamped: the slip angle snaps to 0 below 2 m/s, which must not read as a violent yaw.
    const slipRate = clamp((slipAngle - this.previousSlipAngle) / dt, -10, 10);
    if (this.drift.drifting && this.gear === 1 && grounded >= 2) {
      // Give back part of the speed the sideways tyre forces scrub off; counter-steering keeps more.
      this.tmp.copy(vel).addScaledVector(up, -vel.dot(up));
      if (this.tmp.lengthSq() > 1) {
        this.tmp.normalize();
        const scrub = Math.max(0, -this.lateralForceSum.dot(this.tmp));
        const keep = speedRetention(t, counterSteerAmount(steerLeft, slipAngle), drivePedal);
        body.applyImpulse(this.tmp.multiplyScalar(scrub * keep * dt), true);
      }
      // Hold the drift angle the player is asking for; never let it spin out.
      const yawAccel = driftYawAssist(t, slipAngle, steerLeft, drivePedal, slipRate);
      body.applyTorqueImpulse(this.tmp.copy(up).multiplyScalar(yawAccel * this.inertia.y * dt), true);
    } else if (grounded >= 3 && this.gear === 1 && forwardSpeed > 5) {
      // Not drifting: pull unintended slides back in line, and track straight hands-off.
      let yawAccel = stabilityYawAssist(t, slipAngle, slipRate);
      if (Math.abs(input.steer) < 0.05) yawAccel -= t.straightLineDamping * angVel.dot(up);
      body.applyTorqueImpulse(this.tmp.copy(up).multiplyScalar(yawAccel * this.inertia.y * dt), true);
    }

    // --- Aero: drag everywhere, downforce when on the ground.
    body.applyImpulse(this.tmp.copy(vel).multiplyScalar(-t.dragCoefficient * speed * dt), true);
    if (grounded > 0) body.applyImpulse(this.tmp.copy(down).multiplyScalar(t.downforce * forwardSpeed ** 2 * dt), true);

    // --- Air control: level out and allow a little yaw so jumps land wheels-down.
    if (grounded === 0) {
      this.telemetry.airTime += dt;
      const tilt = this.tmp.crossVectors(up, Y); // axis * sin(tilt angle)
      const spinPerp = this.tmp2.copy(angVel).addScaledVector(up, -angVel.dot(up));
      const tiltInertia = (this.inertia.x + this.inertia.z) / 2;
      tilt.multiplyScalar(t.airRighting).addScaledVector(spinPerp, -t.airDamping).multiplyScalar(tiltInertia * dt);
      tilt.addScaledVector(up, steerLeft * t.airYaw * this.inertia.y * dt);
      body.applyTorqueImpulse(tilt, true);
    } else {
      if (wasGrounded === 0 && this.telemetry.airTime > 0.25) {
        this.landing = Math.max(this.landing, clamp01(Math.abs(vel.y) / 9));
      }
      this.telemetry.airTime = 0;
    }

    // --- Telemetry.
    const tel = this.telemetry;
    tel.speed = speed;
    tel.forwardSpeed = forwardSpeed;
    tel.slipAngle = slipAngle;
    tel.drifting = this.drift.drifting;
    tel.driftTime = this.drift.time;
    tel.groundedWheels = grounded;
    tel.accel = damp(tel.accel, (forwardSpeed - this.previousForwardSpeed) / dt, 8, dt);
    tel.wheelspin = wheelspin;
    tel.rearSlip = Math.max(this.drift.drifting ? clamp01(Math.abs(slipAngle) / (40 * Math.PI / 180)) : 0, wheelspin);
    tel.brakeLock = input.handbrake && speed > 3 && grounded > 0 ? Math.max(brakeLock, 0.6) : brakeLock;
    tel.throttle = drivePedal;
    tel.braking = brakePedal > 0.1 || (input.handbrake && speed > 1);
    tel.gear = this.gear;
    tel.steerAngle = this.steerAngle;
    tel.uprightness = up.dot(Y);
    this.previousForwardSpeed = forwardSpeed;
    this.previousSlipAngle = slipAngle;
  }

  private updateSuspension(dt: number): number {
    const t = this.tuning;
    const { world } = this.physics;
    const { pos, rot, up, down } = this;
    this.shapeRotation.copy(rot).multiply(AXLE);
    let grounded = 0;

    for (const w of this.wheels) {
      this.mount.copy(w.rest).addScaledVector(Y, t.bumpTravel).applyQuaternion(rot).add(pos);
      const hit = world.castShape(
        this.mount, this.shapeRotation, down, w.shape, 0, this.castLength,
        true, // a hub already inside the ground reads as full bump, not "airborne"
        undefined, Groups.suspensionQuery, undefined, this.body,
      );
      let length = this.castLength;
      let distance = -1;
      if (hit) {
        distance = hit.time_of_impact;
        this.tmp.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
        if (this.tmp.lengthSq() < 0.5) this.tmp.copy(up); // started penetrating: no reliable normal
      } else {
        // Cylinder casts occasionally slip through the seam between two ground
        // colliders; a ray from the hub is the robust fallback.
        this.ray.origin = this.mount;
        this.ray.dir = down;
        const rayHit = world.castRayAndGetNormal(
          this.ray, this.castLength + w.radius, true, undefined, Groups.suspensionQuery, undefined, this.body,
        );
        if (rayHit) {
          distance = Math.max(0, rayHit.timeOfImpact - w.radius);
          this.tmp.set(rayHit.normal.x, rayHit.normal.y, rayHit.normal.z);
        }
      }
      // Steep faces (ramp sides) are walls, not road.
      w.contact = distance >= 0 && distance <= this.castLength && this.tmp.dot(up) > 0.35;
      if (w.contact) {
        length = distance;
        w.contactNormal.copy(this.tmp).normalize();
      }
      const extensionSpeed = (length - w.length) / dt;
      w.length = length;
      w.compression = 1 - length / this.castLength;
      w.contactPoint.copy(this.mount).addScaledVector(down, length).addScaledVector(w.contactNormal, -w.radius);

      w.load = 0;
      if (w.contact) {
        grounded++;
        const force = this.springRate * (this.springFreeLength - length) - this.damperRate * extensionSpeed;
        w.load = clamp(force, 0, this.cornerMass * GRAVITY * t.maxLoadFactor);
      }
    }

    // Anti-roll bars move load from the extended to the compressed side of each axle.
    for (const [a, b] of [[0, 1], [2, 3]] as const) {
      const l = this.wheels[a];
      const r = this.wheels[b];
      if (!l || !r) continue;
      const transfer = (l.compression - r.compression) * this.castLength * this.springRate * t.antiRoll;
      if (l.contact) l.load = Math.max(0, l.load + transfer);
      if (r.contact) r.load = Math.max(0, r.load - transfer);
    }

    // Push along the ground normal: a strut-axis force would turn any body pitch into
    // free thrust, since a rolling tyre offers no longitudinal resistance to cancel it.
    for (const w of this.wheels) {
      if (w.load <= 0) continue;
      this.mount.copy(w.rest).addScaledVector(Y, t.bumpTravel).applyQuaternion(rot).add(pos);
      this.body.applyImpulseAtPoint(this.tmp.copy(w.contactNormal).multiplyScalar(w.load * dt), this.mount, true);
    }
    return grounded;
  }

  private readState(): void {
    const b = this.body;
    const p = b.translation();
    const r = b.rotation();
    const v = b.linvel();
    const w = b.angvel();
    this.pos.set(p.x, p.y, p.z);
    this.rot.set(r.x, r.y, r.z, r.w);
    this.vel.set(v.x, v.y, v.z);
    this.angVel.set(w.x, w.y, w.z);
    this.up.copy(Y).applyQuaternion(this.rot);
    this.down.copy(this.up).negate();
    this.fwd.copy(Z).applyQuaternion(this.rot);
    this.left.crossVectors(this.up, this.fwd); // car's left is +X at rest
  }

  private recordImpact(force: number): void {
    // Log scale: a 3 kg cone at 70 km/h ~0.15, a wall at 70 km/h saturates.
    this.impact = Math.max(this.impact, clamp01(Math.log10(force / IMPACT_EVENT_THRESHOLD) / 2.6));
  }
}
