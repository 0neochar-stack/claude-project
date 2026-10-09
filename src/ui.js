// Menu screens: one visible at a time, navigable with mouse, keyboard (arrows, Enter, Esc) or a controller
// (D-pad, A, B). Each screen is a [data-screen] element; focusable items inside carry [data-nav].
export class Screens {
  constructor() {
    this.stack = [];
    this.handlers = new Map(); // screen id -> { onBack, onShow }
    document.addEventListener('keydown', (e) => {
      if (!this.current) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowRight') { this.move(k === 'ArrowDown' ? 'down' : 'right'); e.preventDefault(); }
      else if (k === 'ArrowUp' || k === 'ArrowLeft') { this.move(k === 'ArrowUp' ? 'up' : 'left'); e.preventDefault(); }
      else if (k === 'Escape' || k === 'Backspace') { if (k === 'Backspace' && e.target.tagName === 'INPUT') return; this.back(); e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  get current() { return this.stack[this.stack.length - 1] || null; }
  el(id) { return document.querySelector(`[data-screen="${id}"]`); }
  on(id, h) { this.handlers.set(id, { ...this.handlers.get(id), ...h }); }

  // Replace everything with one screen (or none).
  set(id) {
    for (const s of this.stack) this.el(s).hidden = true;
    this.stack = id ? [id] : [];
    if (id) this.reveal(id);
  }

  push(id) {
    if (this.current) this.el(this.current).hidden = true;
    this.stack.push(id);
    this.reveal(id);
  }

  back() {
    const id = this.current;
    if (!id) return;
    const h = this.handlers.get(id);
    if (h?.onBack) { h.onBack(); return; }
    this.pop();
  }

  pop() {
    const id = this.stack.pop();
    if (id) this.el(id).hidden = true;
    if (this.current) this.reveal(this.current, false);
  }

  reveal(id, focusFirst = true) {
    const el = this.el(id);
    el.hidden = false;
    el.classList.remove('is-entering');
    void el.offsetWidth;
    el.classList.add('is-entering');
    this.handlers.get(id)?.onShow?.();
    const items = this.items();
    const keep = items.find((i) => i === el.querySelector('[data-nav].is-last'));
    (focusFirst ? items.find((i) => !i.disabled) : keep || items.find((i) => !i.disabled))?.focus({ preventScroll: true });
  }

  items() {
    const el = this.current && this.el(this.current);
    return el ? [...el.querySelectorAll('[data-nav]')].filter((n) => n.offsetParent !== null) : [];
  }

  // Spatial move: pick the nearest focusable item in the pressed direction.
  move(dir) {
    const items = this.items().filter((i) => !i.disabled || i.dataset.soon !== undefined);
    if (!items.length) return;
    const cur = document.activeElement;
    if (!items.includes(cur)) { items[0].focus(); return; }
    if (cur.type === 'range' && (dir === 'left' || dir === 'right')) {
      if (dir === 'right') cur.stepUp(); else cur.stepDown();
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const it of items) {
      if (it === cur) continue;
      const b = it.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = dir === 'down' ? dy : dir === 'up' ? -dy : dir === 'right' ? dx : -dx;
      const across = dir === 'down' || dir === 'up' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 4) continue;
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    best?.focus({ preventScroll: false });
    best?.scrollIntoView?.({ block: 'nearest' });
  }

  // Controller actions while a menu is open.
  action(a) {
    if (a === 'navUp') this.move('up');
    else if (a === 'navDown') this.move('down');
    else if (a === 'navLeft') this.move('left');
    else if (a === 'navRight') this.move('right');
    else if (a === 'confirm') document.activeElement?.click?.();
    else if (a === 'back' || a === 'help') this.back();
  }
}
