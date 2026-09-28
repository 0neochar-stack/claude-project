import { DEG } from "../core/math";

/**
 * Every number that shapes how the car drives. Units are SI (m, s, kg, N, rad)
 * unless noted. Tuned with the headless scenarios in ArcadeVehicle.test.ts.
 */
export const VEHICLE_TUNING = {
  // --- Chassis ---------------------------------------------------------
  /** Centre of mass above the ground (m). Lower = harder to roll over. */
  comHeight: 0.4,
  /** Multipliers on a box-approximated inertia tensor. Lower yaw = snappier rotation. */
  inertiaScale: { pitch: 1.1, yaw: 0.85, roll: 1.3 },
  angularDamping: 0.3,

  // --- Suspension (shape-cast cylinders from the WHEEL_* sockets) -------
  bumpTravel: 0.1, // wheel can rise this far above its modelled position
  droopTravel: 0.14, // ...and hang this far below it
  springHz: 1.9, // natural frequency per corner
  dampingRatio: 0.5,
  /** Anti-roll bar stiffness as a fraction of the spring rate. */
  antiRoll: 0.6,
  /** Cap on suspension force, in multiples of the static corner load. */
  maxLoadFactor: 3.5,

  // --- Engine, brakes, aero (rear-wheel drive) -------------------------
  enginePower: 380_000, // W: sets acceleration at speed and, with drag, top speed
  maxDriveForce: 9_800, // N: launch traction limit (~0-100 km/h in 3.6 s)
  reverseForce: 4_200,
  reverseTopSpeed: 12,
  brakeForce: 15_000, // N total
  brakeFrontBias: 0.62,
  handbrakeForce: 5_500, // N total on the rear axle
  rollingResistance: 2.5, // N per (m/s) per wheel
  dragCoefficient: 0.95, // N per (m/s)^2
  downforce: 1.1, // N per (m/s)^2, keeps the car planted at speed
  /** Speed used to normalise HUD / rumble (m/s). */
  topSpeed: 73,

  // --- Tyres -------------------------------------------------------------
  gripFront: 1.3, // friction coefficient
  gripRear: 1.2,
  /** Longitudinal (drive / brake) grip relative to lateral: arcade tyres launch hard. */
  gripLongitudinal: 1.35,
  peakSlip: 7 * DEG, // slip angle of maximum lateral grip
  slideSlip: 22 * DEG, // beyond this the tyre is fully sliding
  slideRatio: 0.78, // grip left while sliding, as a fraction of peak
  /** How strongly drive/brake force eats into lateral grip (friction circle). */
  combinedSlip: 0.55,
  /** Drive force capped at this fraction of rear grip when not drifting (soft traction control). */
  tractionControl: 0.85,
  /** Tyre forces act this fraction of the way from contact patch up to the CoM (less body roll). */
  tireForceLift: 0.6,

  // --- Steering ------------------------------------------------------------
  maxSteerLow: 34 * DEG,
  maxSteerHigh: 8 * DEG,
  steerFadeSpeed: 42, // speed where max steer reaches its high-speed value
  steerRate: 3.4, // rad/s turning in
  steerReturnRate: 5.5, // rad/s returning / reversing

  // --- Drift ---------------------------------------------------------------
  driftEnterAngle: 14 * DEG,
  driftExitAngle: 10 * DEG,
  driftEnterSpeed: 9,
  driftExitSpeed: 5,
  driftExitHold: 0.3, // s below exit angle before the drift ends
  /**
   * Drift mode (lower rear grip + angle assist) needs intent: a handbrake pull within
   * this window, or a full-throttle power-over past `powerOverAngle`. Accidental slides
   * get the stability assist instead.
   */
  driftIntentWindow: 0.75,
  powerOverAngle: 15 * DEG,
  /** Rear lateral grip multiplier while the handbrake is held (traction loss). */
  handbrakeRearGrip: 0.38,
  /** Rear lateral grip while drifting, off throttle -> full throttle. */
  driftRearGrip: 0.82,
  driftRearGripThrottle: 0.68,
  gripDropRate: 10, // /s toward a lower grip target
  gripRecoverRate: 2.2, // /s back toward full grip
  /** Yaw-rate kick (rad/s) when the handbrake is pulled with steering at speed. */
  handbrakeKick: 0.55,
  /** Front wheels auto-steer this fraction of the slide angle toward the direction of travel. */
  counterSteerAssist: 0.5,
  /**
   * Speed retention: while drifting, this fraction of the speed the tyres scrub off is
   * given back along the direction of travel. Counter-steering raises it.
   */
  retentionBase: 0.3,
  retentionCounterSteer: 0.55,
  retentionNoThrottle: 0.35, // multiplier when off the throttle
  /**
   * Drift angle the assist steers toward. Throttle sets the base (off -> on); counter-steering
   * pulls it down toward `driftAngleCounter` (a full counter-steer exits the drift); steering
   * into the turn pushes it up to `driftAngleInto`.
   */
  driftAngleOffThrottle: 6 * DEG,
  driftAngleNeutral: 30 * DEG,
  driftAngleCounter: 6 * DEG,
  driftAngleInto: 46 * DEG,
  driftMaxAngle: 62 * DEG,
  angleHold: 5, // rad/s^2 of yaw per rad of angle error
  spinGuard: 30, // rad/s^2 per rad beyond driftMaxAngle
  /** Damps how fast the slide angle changes (not the yaw rate, so steady drifts can rotate). */
  driftAngleDamping: 2, // 1/s
  /** Yaw-rate damping when grounded, not steering and not drifting: holds a straight line. */
  straightLineDamping: 2.5, // 1/s
  /** Outside drift mode, slides beyond the deadband are gently pulled back in line. */
  stabilityGain: 4, // rad/s^2 per rad
  stabilityDeadband: 3 * DEG,

  // --- Air control -----------------------------------------------------------
  airRighting: 6, // rad/s^2 per rad of tilt
  airDamping: 1.8, // 1/s
  airYaw: 1.2, // rad/s^2 at full steer
};

export type VehicleTuning = typeof VEHICLE_TUNING;
