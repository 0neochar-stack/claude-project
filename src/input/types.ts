/** What the car reads each physics step. Devices are merged into this. */
export interface DriveInput {
  /** -1 = full left, +1 = full right (deadzoned and curved). */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1; reverses once the car has stopped. */
  brake: number;
  handbrake: boolean;
}

export type InputDevice = "keyboard" | "gamepad";

/** One frame of input: held values plus buttons pressed since the last frame. */
export interface InputSnapshot {
  drive: DriveInput;
  /** Right stick, -1..1, deadzoned. */
  look: { x: number; y: number };
  cameraPressed: boolean;
  resetPressed: boolean;
  helpPressed: boolean;
  rumbleTogglePressed: boolean;
  /** The device that produced input most recently (drives HUD prompts). */
  activeDevice: InputDevice;
  gamepadName: string | null;
}

export const neutralDrive = (): DriveInput => ({ steer: 0, throttle: 0, brake: 0, handbrake: false });
