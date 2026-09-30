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
    this.padState = new Map();
    this.padBlocked = false;
    this.lastPad = null;
    this.onPadStatus = null;
    addEventListener('gamepadconnected', (e) => this.onPadStatus?.('connected', e.gamepad.id));
    addEventListener('gamepaddisconnected', (e) => {
      this.padState.delete(e.gamepad.index);
      this.onPadStatus?.('disconnected', e.gamepad.id);
    });
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

    this.readPads(s);
    return s;
  }

  // Every connected pad is read and merged. Axes only count once they have moved away from where they
  // rested when first seen, so a phantom device (racing pedals, virtual pads, a headset) with a stuck
  // axis cannot hold the steering or hide the real controller.
  readPads(s) {
    let pads = [];
    try {
      pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    } catch {
      if (!this.padBlocked) { this.padBlocked = true; this.onPadStatus?.('blocked'); }
      return;
    }
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      let st = this.padState.get(pad.index);
      if (!st || st.id !== pad.id) {
        st = { id: pad.id, rest: pad.axes.slice(), live: new Set(), prev: [] };
        this.padState.set(pad.index, st);
      }
      pad.axes.forEach((v, i) => { if (Math.abs(v - st.rest[i]) > 0.25) st.live.add(i); });
      const axis = (i) => (st.live.has(i) ? pad.axes[i] || 0 : 0);
      const btn = (i) => {
        const b = pad.buttons[i];
        if (!b) return 0;
        return typeof b === 'number' ? b : Math.max(b.value || 0, b.pressed ? 1 : 0);
      };

      // Left stick with a dead zone and a gentle curve for fine drift angle control.
      let x = axis(0);
      const dz = 0.12;
      x = Math.abs(x) < dz ? 0 : Math.sign(x) * ((Math.abs(x) - dz) / (1 - dz)) ** 1.3;
      let steer = -x;
      if (btn(14) > 0.5) steer = 1;
      if (btn(15) > 0.5) steer = -1;

      let gas = btn(7), brake = btn(6);
      if (pad.mapping !== 'standard' && pad.axes.length >= 6) {
        // Many non-standard mappings report triggers as axes 2 and 5, resting at -1.
        const trig = (i) => (st.live.has(i) ? (st.rest[i] < -0.5 ? (pad.axes[i] + 1) / 2 : Math.max(0, pad.axes[i])) : 0);
        gas = Math.max(gas, trig(5));
        brake = Math.max(brake, trig(2));
      }

      if (Math.abs(steer) > Math.abs(s.steer)) s.steer = steer;
      s.throttle = Math.max(s.throttle, gas);
      s.brake = Math.max(s.brake, brake);
      s.handbrake = s.handbrake || btn(0) > 0.5 || btn(1) > 0.5 || btn(2) > 0.5;
      if (Math.abs(steer) > 0 || gas > 0.05 || brake > 0.05 || btn(0) > 0.5) this.lastPad = pad;

      const edges = { 0: 'confirm', 9: 'help', 5: 'shiftUp', 4: 'shiftDown', 3: 'camera', 8: 'reset', 12: 'paint', 13: 'assist' };
      for (const [i, act] of Object.entries(edges)) {
        const pressed = btn(+i) > 0.5;
        if (pressed && !st.prev[i]) this.actions.push(act);
        st.prev[i] = pressed;
      }
    }
  }

  rumble(strong, weak, ms) {
    const act = this.lastPad?.vibrationActuator;
    if (!act?.playEffect) return;
    try {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    } catch { /* rumble unsupported */ }
  }

  takeActions() {
    const a = this.actions;
    this.actions = [];
    return a;
  }
}
