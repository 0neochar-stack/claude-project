// Keyboard, gamepad and touch merged into one analogue control state.
const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  clutch: ['ShiftLeft', 'ShiftRight'],
};
const ACTIONS = {
  KeyE: 'shiftUp', KeyQ: 'shiftDown', KeyC: 'camera', KeyR: 'reset', KeyG: 'gearbox',
  KeyT: 'assist', KeyP: 'paint', KeyM: 'mute', KeyH: 'help', Escape: 'help', KeyV: 'view',
};

export class Input {
  constructor() {
    this.down = new Set();
    this.touch = { throttle: 0, brake: 0, left: 0, right: 0, handbrake: 0, clutch: 0 };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, clutch: false };
    this.actions = [];
    this.actions2 = [];
    this.split = false;
    this.padOrder = [];
    this.padState = new Map();
    // Poll pads between frames too, so presses are caught even when frames are slow.
    setInterval(() => this.readPads(null), 16);
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
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.kbSteer) ? 9 : 5;
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
    s.steer = this.kbSteer;
    // Keys feed the throttle in over ~0.12 s so a tap can feather the slide instead of slamming full power.
    this.kbThrottle = Math.max(0, Math.min(1, (this.kbThrottle || 0) + (this.held('throttle') ? 8 : -12) * dt));
    s.throttle = this.kbThrottle;
    s.clutch = this.held('clutch');
    s.brake = this.held('brake') ? 1 : 0;
    s.handbrake = this.held('handbrake');

    this.readPads(s);
    return s;
  }

  // Pads are read on their own 60 Hz timer as well as every frame, so a quick button press is never lost
  // between slow frames. Each pad keeps its own analogue state; player one gets the keyboard and every pad
  // (or, in split screen, the first pad), player two the second pad.
  // Axes only count once they have moved away from where they rested when first seen, so a phantom device
  // (racing pedals, virtual pads, a headset) with a stuck axis cannot hold the steering.
  readPads(s) {
    let pads = [];
    try {
      pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    } catch {
      if (!this.padBlocked) { this.padBlocked = true; this.onPadStatus?.('blocked'); }
      return;
    }
    const live = pads.filter((p) => p && p.connected);
    this.padOrder = live.map((p) => p.index);
    for (const pad of live) {
      let st = this.padState.get(pad.index);
      if (!st || st.id !== pad.id) {
        st = { id: pad.id, rest: pad.axes.slice(), live: new Set(), prev: [], analog: { throttle: 0, brake: 0, steer: 0, handbrake: false, clutch: false }, look: { x: 0, y: 0 } };
        this.padState.set(pad.index, st);
      }
      pad.axes.forEach((v, i) => { if (Math.abs(v - st.rest[i]) > 0.25) st.live.add(i); });
      const axis = (i) => (st.live.has(i) ? pad.axes[i] || 0 : 0);
      const btn = (i) => {
        const b = pad.buttons[i];
        if (!b) return 0;
        return typeof b === 'number' ? b : Math.max(b.value || 0, b.pressed ? 1 : 0);
      };
      // D-pad: buttons 12-15 on standard pads; a hat switch (axis 9) or axes 6/7 on others.
      const dpad = { up: btn(12) > 0.5, down: btn(13) > 0.5, left: btn(14) > 0.5, right: btn(15) > 0.5 };
      if (pad.mapping !== 'standard') {
        const hat = pad.axes[9];
        if (hat !== undefined && hat >= -1.01 && hat <= 1.01 && Math.abs(hat - (st.rest[9] ?? 3.28)) > 0.05 && hat < 1.1) {
          const k = Math.round((hat + 1) * 3.5); // 0 up, 1 up-right, 2 right ... 7 up-left
          dpad.up ||= k === 0 || k === 1 || k === 7; dpad.right ||= k >= 1 && k <= 3; dpad.down ||= k >= 3 && k <= 5; dpad.left ||= k >= 5 && k <= 7;
        }
        if (pad.axes.length > 7) { dpad.left ||= axis(6) < -0.5; dpad.right ||= axis(6) > 0.5; dpad.up ||= axis(7) < -0.5; dpad.down ||= axis(7) > 0.5; }
      }

      // Left stick with a dead zone and a gentle curve for fine drift angle control.
      let x = axis(0);
      const dz = 0.12;
      x = Math.abs(x) < dz ? 0 : Math.sign(x) * ((Math.abs(x) - dz) / (1 - dz)) ** 1.3;
      let steer = -x;
      if (!this.menuMode) { if (dpad.left) steer = 1; if (dpad.right) steer = -1; }
      let gas = btn(7), brake = btn(6);
      if (pad.mapping !== 'standard' && pad.axes.length >= 6) {
        // Many non-standard mappings report triggers as axes 2 and 5, resting at -1.
        const trig = (i) => (st.live.has(i) ? (st.rest[i] < -0.5 ? (pad.axes[i] + 1) / 2 : Math.max(0, pad.axes[i])) : 0);
        gas = Math.max(gas, trig(5));
        brake = Math.max(brake, trig(2));
      }
      const an = st.analog;
      an.steer = steer; an.throttle = gas; an.brake = brake;
      an.handbrake = btn(0) > 0.5 || btn(1) > 0.5;
      an.clutch = btn(2) > 0.5;
      // Right stick: look around / orbit the car in the garage.
      const rs = (i) => { const v = axis(i); return Math.abs(v) < 0.15 ? 0 : v; };
      st.look.x = rs(pad.mapping === 'standard' ? 2 : 3); st.look.y = rs(pad.mapping === 'standard' ? 3 : 4);
      if (Math.abs(steer) > 0 || gas > 0.05 || brake > 0.05 || btn(0) > 0.5) this.lastPad = pad;

      const player2 = this.split && this.padOrder.length > 1 && pad.index === this.padOrder[1];
      const out = player2 && !this.menuMode ? this.actions2 : this.actions;
      // In menus the D-pad and left stick move focus, A confirms, B goes back and the bumpers flip tabs.
      const edges = this.menuMode
        ? { 0: 'confirm', 1: 'back', 9: 'help', 4: 'tabPrev', 5: 'tabNext' }
        : { 0: 'confirm', 9: 'help', 5: 'shiftUp', 4: 'shiftDown', 3: 'camera', 8: 'reset', 12: 'view', 13: 'assist' };
      if (this.menuMode) {
        const sx = pad.axes[0] || 0, sy = pad.axes[1] || 0;
        const dir = dpad.up ? 'navUp' : dpad.down ? 'navDown' : dpad.left ? 'navLeft' : dpad.right ? 'navRight'
          : Math.abs(sy) > 0.6 ? (sy > 0 ? 'navDown' : 'navUp') : Math.abs(sx) > 0.6 ? (sx > 0 ? 'navRight' : 'navLeft') : null;
        const now = performance.now();
        if (!dir) { st.navNext = 0; st.navDir = null; }
        else if (dir !== st.navDir || now >= st.navNext) {
          out.push(dir);
          // First repeat after a pause, then quicker, like holding an arrow key.
          st.navNext = now + (dir === st.navDir ? 130 : 380);
          st.navDir = dir;
        }
      }
      for (const [i, act] of Object.entries(edges)) {
        const pressed = btn(+i) > 0.5;
        if (pressed && !st.prev[i]) out.push(act);
        st.prev[i] = pressed;
      }
    }
    if (!s) return;
    // Merge into player one's controls.
    for (const idx of this.padOrder) {
      if (this.split && this.padOrder.length > 1 && idx !== this.padOrder[0]) continue;
      const an = this.padState.get(idx).analog;
      if (Math.abs(an.steer) > Math.abs(s.steer)) s.steer = an.steer;
      s.throttle = Math.max(s.throttle, an.throttle);
      s.brake = Math.max(s.brake, an.brake);
      s.handbrake = s.handbrake || an.handbrake;
      s.clutch = s.clutch || an.clutch;
    }
  }

  // Player two's controls (split screen): the second connected pad, or nothing.
  poll2() {
    const idx = this.padOrder?.[1];
    const st = idx !== undefined ? this.padState.get(idx) : null;
    return st ? st.analog : { throttle: 0, brake: 0, steer: 0, handbrake: false, clutch: false };
  }

  // Right-stick look from any pad (strongest wins).
  look() {
    let x = 0, y = 0;
    for (const st of this.padState.values()) { if (Math.abs(st.look.x) > Math.abs(x)) x = st.look.x; if (Math.abs(st.look.y) > Math.abs(y)) y = st.look.y; }
    return { x, y };
  }

  get padCount() { return this.padOrder?.length || 0; }

  takeActions2() {
    const a = this.actions2;
    this.actions2 = [];
    return a;
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
