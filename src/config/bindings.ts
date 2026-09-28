/**
 * Control bindings. Keyboard uses `KeyboardEvent.code` (physical key position, so
 * WASD works on AZERTY too). Gamepad indices follow the W3C "standard" mapping,
 * which Xbox, PlayStation and Switch Pro pads report in Chromium, Firefox and Safari.
 */

export const KEYBOARD_BINDINGS = {
  steerLeft: ["KeyA", "ArrowLeft"],
  steerRight: ["KeyD", "ArrowRight"],
  throttle: ["KeyW", "ArrowUp"],
  brake: ["KeyS", "ArrowDown"],
  handbrake: ["Space"],
  camera: ["KeyR"],
  resetCar: ["Backspace"],
  toggleHelp: ["KeyH"],
  toggleRumble: ["KeyV"],
} as const;

export type KeyboardAction = keyof typeof KEYBOARD_BINDINGS;

export const GAMEPAD_BINDINGS = {
  steerAxis: 0, // left stick X
  lookXAxis: 2, // right stick X
  lookYAxis: 3, // right stick Y
  throttleButton: 7, // RT / R2 (analogue value)
  brakeButton: 6, // LT / L2 (analogue value)
  handbrakeButton: 0, // A / Cross
  cameraButton: 3, // Y / Triangle
  resetButton: 8, // View / Share / Select
  toggleHelpButton: 9, // Menu / Options / Start
} as const;

export const GAMEPAD_TUNING = {
  stickDeadzone: 0.1,
  stickOuterDeadzone: 0.02,
  steerExponent: 1.5, // >1 = finer control near centre
  lookDeadzone: 0.15,
  triggerDeadzone: 0.04,
} as const;

/** Keyboard is digital; these ramps make it feel analogue. Units: full range per second. */
export const KEYBOARD_RAMPS = {
  steerIn: 4.5,
  steerOut: 7,
  pedalIn: 12,
  pedalOut: 16,
} as const;

/** Shown in the HUD help panel. */
export const CONTROLS_HELP: ReadonlyArray<[action: string, keyboard: string, gamepad: string]> = [
  ["Steer", "A / D  or  ← / →", "Left stick"],
  ["Throttle", "W  or  ↑", "RT / R2"],
  ["Brake / reverse", "S  or  ↓", "LT / L2"],
  ["Handbrake (drift)", "Space", "A / Cross"],
  ["Camera: next view + reset", "R", "Y / Triangle"],
  ["Look around", "–", "Right stick"],
  ["Reset car", "Backspace", "View / Share"],
  ["Rumble on/off", "V", "–"],
  ["Help", "H", "Menu / Options"],
];
