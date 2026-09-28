import { clamp01 } from "../core/math";

/** Vehicle signals the rumble mix is built from (all per frame). */
export interface HapticSignals {
  throttle: number; // 0..1
  /** Forward acceleration in m/s², smoothed. */
  accel: number;
  grounded: boolean;
  /** Rear tyre slip while drifting / spinning, 0..1. */
  rearSlip: number;
  wheelspin: number; // 0..1
  brakeLock: number; // 0..1
  /** Strongest collision since last frame, 0..1. */
  impact: number;
  /** Hard landing since last frame, 0..1. */
  landing: number;
}

export interface RumbleLevels {
  weak: number;
  strong: number;
  leftTrigger: number;
  rightTrigger: number;
}

/** Subset of the Gamepad haptics API we use; `effects` and trigger params are newer than some DOM typings. */
interface HapticActuator {
  effects?: readonly string[];
  playEffect(type: string, params: Record<string, number>): Promise<unknown>;
  reset?(): Promise<unknown>;
}
interface LegacyActuator {
  pulse(value: number, duration: number): Promise<boolean>;
}

const SEND_INTERVAL_MS = 50;
const EFFECT_DURATION_MS = 110; // slightly longer than the interval so effects overlap without gaps

/**
 * Controller rumble: acceleration surge and engine buzz on the weak motor, drift
 * slip on the strong motor, collision and landing bursts on both. Uses Chromium's
 * "trigger-rumble" (Xbox impulse triggers) when the pad advertises it, "dual-rumble"
 * otherwise, and Firefox's legacy `hapticActuators` as a last resort.
 */
export class Haptics {
  enabled = true;
  intensity = 1;
  /** Last levels sent, for the HUD. */
  readonly levels: RumbleLevels = { weak: 0, strong: 0, leftTrigger: 0, rightTrigger: 0 };

  private impactEnvelope = 0;
  private landingEnvelope = 0;
  private lastSend = -Infinity;
  private silent = true;

  update(pad: Gamepad | null, s: HapticSignals, dt: number, now: number): void {
    this.impactEnvelope = Math.max(this.impactEnvelope * Math.exp(-7 * dt), s.impact);
    this.landingEnvelope = Math.max(this.landingEnvelope * Math.exp(-9 * dt), s.landing);

    const accelSurge = s.grounded ? clamp01(s.accel / 7) : 0;
    let weak = s.throttle * (s.grounded ? 0.08 + 0.4 * accelSurge : 0.04);
    let strong = 0.6 * s.rearSlip;
    weak += 0.22 * s.rearSlip;
    strong = Math.max(strong, this.impactEnvelope, 0.8 * this.landingEnvelope);
    weak = Math.max(weak, 0.7 * this.impactEnvelope, 0.5 * this.landingEnvelope);

    const k = this.enabled ? this.intensity : 0;
    this.levels.weak = clamp01(weak * k);
    this.levels.strong = clamp01(strong * k);
    this.levels.rightTrigger = clamp01((0.55 * s.wheelspin + 0.25 * s.throttle * accelSurge) * k);
    this.levels.leftTrigger = clamp01(0.6 * s.brakeLock * k);

    if (!pad || now - this.lastSend < SEND_INTERVAL_MS) return;
    const quiet = this.levels.weak < 0.01 && this.levels.strong < 0.01
      && this.levels.leftTrigger < 0.01 && this.levels.rightTrigger < 0.01;
    if (quiet && this.silent) return;
    this.lastSend = now;
    this.silent = quiet;
    this.send(pad, quiet);
  }

  /** Silence the pad immediately (pause, blur, rumble toggled off). */
  stop(pad: Gamepad | null): void {
    const actuator = pad?.vibrationActuator as HapticActuator | null | undefined;
    actuator?.reset?.().catch(() => {});
    this.silent = true;
  }

  private send(pad: Gamepad, quiet: boolean): void {
    const actuator = pad.vibrationActuator as HapticActuator | null | undefined;
    const { weak, strong, leftTrigger, rightTrigger } = this.levels;
    if (actuator) {
      const duration = quiet ? 0 : EFFECT_DURATION_MS;
      const base = { startDelay: 0, duration, weakMagnitude: weak, strongMagnitude: strong };
      const effect = actuator.effects?.includes("trigger-rumble")
        ? actuator.playEffect("trigger-rumble", { ...base, leftTrigger, rightTrigger })
        : actuator.playEffect("dual-rumble", base);
      effect.catch(() => {}); // "preempted" rejections are expected when we update mid-effect
      return;
    }
    const legacy = (pad as Gamepad & { hapticActuators?: LegacyActuator[] }).hapticActuators?.[0];
    legacy?.pulse(Math.max(weak, strong), quiet ? 0 : EFFECT_DURATION_MS).catch(() => {});
  }
}
