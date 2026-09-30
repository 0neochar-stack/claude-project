// Keyboard, gamepad and touch merged into one analogue control state.
const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
};
const ACTIONS = {
  KeyE: 'shiftUp', KeyQ: 'shiftDown', KeyC: 'camera', KeyR: 'reset', KeyG: 'gearbox',
  KeyT: 'assist', KeyP: 'paint', KeyM: 'mute', KeyH: 'help', Escape: 'help',
};

export class Input {
  constructor() {
    this.down = new Set();
    this.touch = { throttle: 0, brake: 0, left: 0, right: 0, handbrake: 0 };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.actions = [];
    this.padPrev = [];
    this.usingPad = false;
    this.kbSteer = 0;
    addEventListener('keydown', (e) => {
      if (e.code in ACTIONS && !e.repeat) this.actions.push(ACTIONS[e.code]);
      if (Object.values(KEYS).flat().includes(e.code)) e.preventDefault();
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  bindTouch(root) {
    for (const el of root.querySelectorAll('[data-touch]')) {
      const key = el.dataset.touch;
      const on = (e) => { e.preventDefault(); this.touch[key] = 1; el.classList.add('is-down'); };
      const off = (e) => { e.preventDefault(); this.touch[key] = 0; el.classList.remove('is-down'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    }
  }

  held(name) {
    return KEYS[name].some((k) => this.down.has(k)) || this.touch[name] > 0;
  }

  poll(dt) {
    const s = this.state;
    const left = this.held('left'), right = this.held('right');
    const target = (left ? 1 : 0) - (right ? 1 : 0);
    // Digital steering ramps in, and snaps back faster, so taps can feather a drift.
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.kbSteer) ? 7 : 3.6;
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
    s.steer = this.kbSteer;
    s.throttle = this.held('throttle') ? 1 : 0;
    s.brake = this.held('brake') ? 1 : 0;
    s.handbrake = this.held('handbrake');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const b = (i) => pad.buttons[i] ? pad.buttons[i].value : 0;
      let x = pad.axes[0] || 0;
      x = Math.abs(x) < 0.08 ? 0 : Math.sign(x) * ((Math.abs(x) - 0.08) / 0.92) ** 1.4;
      const active = Math.abs(x) > 0 || b(7) > 0.05 || b(6) > 0.05;
      if (active) this.usingPad = true;
      if (!this.usingPad) continue;
      if (Math.abs(x) > Math.abs(s.steer)) s.steer = -x;
      s.throttle = Math.max(s.throttle, b(7));
      s.brake = Math.max(s.brake, b(6));
      s.handbrake = s.handbrake || b(0) > 0.5 || b(2) > 0.5;
      const edges = { 5: 'shiftUp', 4: 'shiftDown', 3: 'camera', 8: 'reset', 9: 'help', 1: 'paint' };
      for (const [i, act] of Object.entries(edges)) {
        const pressed = b(+i) > 0.5;
        if (pressed && !this.padPrev[i]) this.actions.push(act);
        this.padPrev[i] = pressed;
      }
      break;
    }
    return s;
  }

  takeActions() {
    const a = this.actions;
    this.actions = [];
    return a;
  }
}
