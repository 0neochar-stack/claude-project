import { GAMEPAD_BINDINGS as B, GAMEPAD_TUNING as T } from "../config/bindings";
import { applyDeadzone, applyRadialDeadzone, applyResponseCurve } from "./curves";
import type { DriveInput } from "./types";

export interface GamepadFrame {
  drive: DriveInput;
  look: { x: number; y: number };
  cameraPressed: boolean;
  resetPressed: boolean;
  helpPressed: boolean;
  name: string;
  standardMapping: boolean;
}

const ACTIVITY_AXIS = 0.3;
const ACTIVITY_BUTTON = 0.2;

/**
 * Polls the Gamepad API once per frame (the API has no input events, only
 * connect/disconnect). The pad that produced input most recently is the active one,
 * so a second controller can take over simply by pressing something.
 */
export class GamepadDevice {
  lastActiveTime = -Infinity;
  /** Most recently read snapshot of the active pad, for haptics. */
  active: Gamepad | null = null;

  private activeIndex: number | null = null;
  private readonly previousButtons = new Map<number, boolean[]>();

  constructor(target: Window) {
    target.addEventListener("gamepadconnected", (e) => {
      if (this.activeIndex === null) this.activeIndex = e.gamepad.index;
    });
    target.addEventListener("gamepaddisconnected", (e) => {
      this.previousButtons.delete(e.gamepad.index);
      if (this.activeIndex === e.gamepad.index) this.activeIndex = null;
    });
  }

  poll(now: number): GamepadFrame | null {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];

    for (const pad of pads) {
      if (!pad?.connected) continue;
      if (this.hasActivity(pad)) {
        this.activeIndex = pad.index;
        this.lastActiveTime = now;
      } else if (this.activeIndex === null) {
        this.activeIndex = pad.index;
      }
    }

    const pad = this.activeIndex !== null ? pads[this.activeIndex] : null;
    if (!pad?.connected) {
      this.active = null;
      return null;
    }
    this.active = pad;

    const edges = this.buttonEdges(pad);
    const rawSteer = pad.axes[B.steerAxis] ?? 0;
    const steer = applyResponseCurve(applyDeadzone(rawSteer, T.stickDeadzone, T.stickOuterDeadzone), T.steerExponent);
    const look = applyRadialDeadzone(pad.axes[B.lookXAxis] ?? 0, pad.axes[B.lookYAxis] ?? 0, T.lookDeadzone);

    return {
      drive: {
        steer,
        throttle: applyDeadzone(buttonValue(pad, B.throttleButton), T.triggerDeadzone),
        brake: applyDeadzone(buttonValue(pad, B.brakeButton), T.triggerDeadzone),
        handbrake: buttonValue(pad, B.handbrakeButton) > 0.5,
      },
      look,
      cameraPressed: edges.has(B.cameraButton),
      resetPressed: edges.has(B.resetButton),
      helpPressed: edges.has(B.toggleHelpButton),
      name: cleanName(pad.id),
      standardMapping: pad.mapping === "standard",
    };
  }

  private hasActivity(pad: Gamepad): boolean {
    return pad.buttons.some((b) => b.value > ACTIVITY_BUTTON || b.pressed)
      || pad.axes.some((a) => Math.abs(a) > ACTIVITY_AXIS);
  }

  /** Indices of buttons that went down since the previous poll. */
  private buttonEdges(pad: Gamepad): Set<number> {
    const now = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const before = this.previousButtons.get(pad.index) ?? [];
    this.previousButtons.set(pad.index, now);
    const edges = new Set<number>();
    now.forEach((down, i) => {
      if (down && !before[i]) edges.add(i);
    });
    return edges;
  }
}

/** Analogue value; `pressed` is only a fallback because triggers set it at ~10% travel. */
function buttonValue(pad: Gamepad, index: number): number {
  const button = pad.buttons[index];
  if (!button) return 0;
  return button.value > 0 ? button.value : button.pressed ? 1 : 0;
}

/** "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)" -> "Xbox Wireless Controller" */
function cleanName(id: string): string {
  return id.replace(/\s*\(.*\)\s*$/, "").trim() || id;
}
