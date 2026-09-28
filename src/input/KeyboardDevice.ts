import { KEYBOARD_BINDINGS, KEYBOARD_RAMPS, type KeyboardAction } from "../config/bindings";
import { approach } from "../core/math";
import type { DriveInput } from "./types";

const ALL_BOUND_CODES = new Set<string>(Object.values(KEYBOARD_BINDINGS).flat());

export interface KeyboardFrame {
  drive: DriveInput;
  pressed: Set<KeyboardAction>;
}

/** Digital keys smoothed into analogue-feeling steering and pedals. */
export class KeyboardDevice {
  /** `performance.now()` of the last key event, for active-device detection. */
  lastActiveTime = -Infinity;

  private readonly held = new Set<string>();
  private readonly pressedCodes = new Set<string>();
  private steer = 0;
  private throttle = 0;
  private brake = 0;

  constructor(target: Window) {
    target.addEventListener("keydown", (e) => {
      if (!ALL_BOUND_CODES.has(e.code)) return;
      e.preventDefault(); // arrows and space must not scroll the page
      if (!e.repeat) this.pressedCodes.add(e.code);
      this.held.add(e.code);
      this.lastActiveTime = performance.now();
    });
    target.addEventListener("keyup", (e) => this.held.delete(e.code));
    target.addEventListener("blur", () => this.held.clear()); // no stuck keys after alt-tab
  }

  poll(dt: number): KeyboardFrame {
    const left = this.isHeld("steerLeft");
    const right = this.isHeld("steerRight");
    const steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
    // Returning toward centre (or reversing direction) is faster than steering in.
    const steerRate = steerTarget === 0 || Math.sign(steerTarget) !== Math.sign(this.steer)
      ? KEYBOARD_RAMPS.steerOut
      : KEYBOARD_RAMPS.steerIn;
    this.steer = approach(this.steer, steerTarget, steerRate * dt);
    this.throttle = this.ramp(this.throttle, this.isHeld("throttle"), dt);
    this.brake = this.ramp(this.brake, this.isHeld("brake"), dt);

    const pressed = new Set<KeyboardAction>();
    for (const [action, codes] of Object.entries(KEYBOARD_BINDINGS) as [KeyboardAction, readonly string[]][]) {
      if (codes.some((c) => this.pressedCodes.has(c))) pressed.add(action);
    }
    this.pressedCodes.clear();

    return {
      drive: {
        steer: this.steer,
        throttle: this.throttle,
        brake: this.brake,
        handbrake: this.isHeld("handbrake"),
      },
      pressed,
    };
  }

  private isHeld(action: KeyboardAction): boolean {
    return KEYBOARD_BINDINGS[action].some((c) => this.held.has(c));
  }

  private ramp(value: number, held: boolean, dt: number): number {
    return approach(value, held ? 1 : 0, (held ? KEYBOARD_RAMPS.pedalIn : KEYBOARD_RAMPS.pedalOut) * dt);
  }
}
