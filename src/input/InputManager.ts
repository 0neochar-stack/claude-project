import { clamp } from "../core/math";
import { GamepadDevice } from "./GamepadDevice";
import { KeyboardDevice } from "./KeyboardDevice";
import type { InputSnapshot } from "./types";

/**
 * Merges keyboard and gamepad into one snapshot per frame. Both work at the same
 * time: analogue values take the stronger of the two, steering sums and clamps.
 */
export class InputManager {
  readonly keyboard: KeyboardDevice;
  readonly gamepad: GamepadDevice;

  constructor(target: Window = window) {
    this.keyboard = new KeyboardDevice(target);
    this.gamepad = new GamepadDevice(target);
  }

  update(dt: number, now = performance.now()): InputSnapshot {
    const kb = this.keyboard.poll(dt);
    const pad = this.gamepad.poll(now);

    const drive = { ...kb.drive };
    if (pad) {
      drive.steer = clamp(kb.drive.steer + pad.drive.steer, -1, 1);
      drive.throttle = Math.max(kb.drive.throttle, pad.drive.throttle);
      drive.brake = Math.max(kb.drive.brake, pad.drive.brake);
      drive.handbrake = kb.drive.handbrake || pad.drive.handbrake;
    }

    return {
      drive,
      look: pad?.look ?? { x: 0, y: 0 },
      cameraPressed: kb.pressed.has("camera") || !!pad?.cameraPressed,
      resetPressed: kb.pressed.has("resetCar") || !!pad?.resetPressed,
      helpPressed: kb.pressed.has("toggleHelp") || !!pad?.helpPressed,
      rumbleTogglePressed: kb.pressed.has("toggleRumble"),
      activeDevice: this.gamepad.lastActiveTime > this.keyboard.lastActiveTime ? "gamepad" : "keyboard",
      gamepadName: pad?.name ?? null,
    };
  }
}
