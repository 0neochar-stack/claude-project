import { CONTROLS_HELP } from "../config/bindings";
import type { CameraMode } from "../camera/ChaseCamera";
import type { RumbleLevels } from "../input/Haptics";
import type { DriveInput, InputDevice } from "../input/types";
import "./hud.css";

export interface HudFrame {
  speedKmh: number;
  gear: 1 | -1;
  drifting: boolean;
  driftAngleDeg: number;
  driftTime: number;
  input: DriveInput;
  device: InputDevice;
  gamepadName: string | null;
  rumble: RumbleLevels;
  rumbleEnabled: boolean;
  cameraMode: CameraMode;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

/** DOM overlay: speedometer, drift badge, live input/rumble monitor, controls help. */
export class Hud {
  private readonly speed = el("span", "hud-speed__value", "0");
  private readonly gear = el("span", "hud-speed__gear", "D");
  private readonly drift = el("div", "hud-drift");
  private readonly driftAngle = el("span", "hud-drift__angle");
  private readonly device = el("div", "hud-input__device");
  private readonly steer = el("i", "");
  private readonly throttle = el("i", "");
  private readonly brake = el("i", "");
  private readonly handbrake = el("b", "hud-pip");
  private readonly rumbleWeak = el("i", "");
  private readonly rumbleStrong = el("i", "");
  private readonly rumbleLabel = el("span", "", "Rumble");
  private readonly camera = el("div", "hud-input__camera");
  private readonly help = el("div", "hud-help");
  private readonly toastBox = el("div", "hud-toast");
  private toastTimer = 0;
  private lastText = new Map<HTMLElement, string>();

  constructor(parent: HTMLElement) {
    const root = el("div", "hud");

    const speedo = el("div", "hud-speed");
    speedo.append(this.speed, el("span", "hud-speed__unit", "km/h"), this.gear);

    this.drift.append(el("span", "hud-drift__label", "DRIFT"), this.driftAngle);

    const panel = el("div", "hud-input");
    const row = (label: string | HTMLElement, content: HTMLElement) => {
      const r = el("div", "hud-input__row");
      r.append(typeof label === "string" ? el("span", "", label) : label, content);
      return r;
    };
    const bar = (fill: HTMLElement, extra = "") => {
      const b = el("div", `hud-bar ${extra}`);
      b.append(fill);
      return b;
    };
    const rumble = el("div", "hud-bar hud-bar--dual");
    rumble.append(this.rumbleWeak, this.rumbleStrong);
    panel.append(
      this.device,
      row("Steer", bar(this.steer, "hud-bar--steer")),
      row("Throttle", bar(this.throttle)),
      row("Brake", bar(this.brake, "hud-bar--brake")),
      row("Handbrake", this.handbrake),
      row(this.rumbleLabel, rumble),
      this.camera,
    );

    const table = el("table", "");
    table.append(...[["", "Keyboard", "Controller"] as const, ...CONTROLS_HELP].map((cells, i) => {
      const tr = el("tr", i === 0 ? "hud-help__head" : "");
      tr.append(...cells.map((c) => el(i === 0 ? "th" : "td", "", c)));
      return tr;
    }));
    this.help.append(el("h2", "", "Test pad controls"), table, el("p", "", "H / Menu to hide"));

    root.append(speedo, this.drift, panel, this.help, this.toastBox);
    parent.append(root);
  }

  toggleHelp(): void {
    this.help.classList.toggle("is-hidden");
  }

  toast(text: string, seconds = 1.8): void {
    this.toastBox.textContent = text;
    this.toastBox.classList.add("is-visible");
    this.toastTimer = seconds;
  }

  update(f: HudFrame, dt: number): void {
    this.text(this.speed, Math.round(f.speedKmh).toString());
    this.text(this.gear, f.gear === 1 ? "D" : "R");
    this.drift.classList.toggle("is-active", f.drifting);
    if (f.drifting) this.text(this.driftAngle, `${Math.round(f.driftAngleDeg)}°  ${f.driftTime.toFixed(1)}s`);

    const pad = f.gamepadName ? `🎮 ${f.gamepadName}` : "🎮 No controller - press any button";
    this.text(this.device, f.device === "gamepad" && f.gamepadName ? pad : `⌨ Keyboard   |   ${pad}`);

    const s = f.input.steer;
    this.steer.style.transform = `translateX(${s < 0 ? -100 : 0}%) scaleX(${Math.abs(s)})`;
    this.steer.style.transformOrigin = s < 0 ? "right" : "left";
    this.throttle.style.transform = `scaleX(${f.input.throttle})`;
    this.brake.style.transform = `scaleX(${f.input.brake})`;
    this.handbrake.classList.toggle("is-on", f.input.handbrake);
    this.rumbleWeak.style.transform = `scaleX(${f.rumble.weak})`;
    this.rumbleStrong.style.transform = `scaleX(${f.rumble.strong})`;
    this.text(this.rumbleLabel, f.rumbleEnabled ? "Rumble" : "Rumble (off)");
    this.text(this.camera, `Camera: ${f.cameraMode}`);

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastBox.classList.remove("is-visible");
    }
  }

  /** Only touch the DOM when the text changes. */
  private text(node: HTMLElement, value: string): void {
    if (this.lastText.get(node) === value) return;
    this.lastText.set(node, value);
    node.textContent = value;
  }
}
