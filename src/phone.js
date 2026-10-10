// The phone: slides up from the bottom right while you drive (D-pad up or F), steered with the D-pad or
// arrow keys, A or Enter to pick, B or Backspace to go back. Apps: Contacts (call Lester to lose the
// police, the mechanic to get back on the road, Hao for a tune tip), Sky, Clock, Camera and Stats.
const CSS = `
.phone { position: fixed; right: max(18px, 3vw); bottom: -560px; z-index: 12; width: 250px; height: 500px; border-radius: 34px; padding: 12px; background: linear-gradient(160deg, #2a2a33, #0d0d12); box-shadow: 0 0 0 2px #3a3a46, 0 30px 80px rgba(0,0,0,0.6); transition: bottom 0.35s cubic-bezier(.2,.9,.25,1.1); pointer-events: none; }
.phone.is-open { bottom: max(18px, 4vh); pointer-events: auto; }
.phone__screen { position: relative; height: 100%; border-radius: 24px; overflow: hidden; background: radial-gradient(120% 90% at 20% 0%, #3b1f6e 0%, #141032 45%, #07060f 100%); color: #fff; font-family: var(--sans, system-ui, sans-serif); }
.phone__bar { display: flex; justify-content: space-between; padding: 10px 16px 6px; font: 600 12px/1 var(--mono, monospace); opacity: 0.9; }
.phone__title { padding: 6px 16px 10px; font: italic 800 22px/1 var(--display, sans-serif); letter-spacing: 0.04em; text-transform: uppercase; }
.phone__grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 8px; padding: 6px 12px; }
.app { display: grid; justify-items: center; gap: 6px; font: 600 10px/1.1 var(--mono, monospace); text-align: center; opacity: 0.85; }
.app i { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 15px; font: normal 800 22px/1 var(--display, sans-serif); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,0.25); }
.app.is-sel { opacity: 1; }
.app.is-sel i { outline: 3px solid #fff; outline-offset: 2px; transform: scale(1.06); }
.phone__list { display: grid; gap: 4px; padding: 4px 10px; }
.row-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 12px; background: rgba(255,255,255,0.05); font: 600 13px/1.2 var(--sans, system-ui, sans-serif); }
.row-item b { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 50%; font: 800 13px/1 var(--display, sans-serif); }
.row-item small { display: block; opacity: 0.6; font-size: 11px; font-weight: 500; }
.row-item.is-sel { background: rgba(255,255,255,0.18); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.7); }
.row-item.is-on::after { content: "●"; margin-left: auto; color: #2ef2ff; }
.phone__call { display: grid; justify-items: center; align-content: center; gap: 12px; height: 78%; text-align: center; padding: 0 16px; }
.phone__call .avatar { display: grid; place-items: center; width: 96px; height: 96px; border-radius: 50%; font: 800 40px/1 var(--display, sans-serif); box-shadow: 0 0 0 6px rgba(255,255,255,0.08); }
.phone__call .avatar.is-ringing { animation: ring 0.9s ease-in-out infinite; }
@keyframes ring { 50% { box-shadow: 0 0 0 16px rgba(46,242,255,0.15); } }
.phone__call h3 { margin: 0; font: italic 800 26px/1 var(--display, sans-serif); text-transform: uppercase; }
.phone__call p { margin: 0; font: 500 13px/1.45 var(--sans, system-ui, sans-serif); opacity: 0.85; }
.phone__hint { position: absolute; left: 0; right: 0; bottom: 10px; text-align: center; font: 600 10px/1 var(--mono, monospace); opacity: 0.5; letter-spacing: 0.08em; }
`;

const APPS = [
  { id: 'contacts', name: 'Contacts', icon: '☎', color: '#2fbf5a' },
  { id: 'sky', name: 'Sky', icon: '✦', color: '#7a4dff' },
  { id: 'clock', name: 'Clock', icon: '◷', color: '#ff8a2a' },
  { id: 'camera', name: 'Camera', icon: '◉', color: '#3a3a46' },
  { id: 'stats', name: 'Stats', icon: '▲', color: '#e0306a' },
  { id: 'music', name: 'Mute', icon: '♪', color: '#2a8aff' },
];

const CONTACTS = [
  { id: 'lester', name: 'Lester', note: 'Makes the police go away', initial: 'L', color: '#5a6a3a' },
  { id: 'mechanic', name: 'Mechanic', note: 'Back on the road', initial: 'M', color: '#c0602a' },
  { id: 'hao', name: 'Hao', note: 'Tuner, Sakura Pass', initial: 'H', color: '#c02a4a' },
  { id: 'lamar', name: 'Lamar', note: 'Your boy', initial: 'L', color: '#3a7ad0' },
];

export class Phone {
  // hooks: { call(id) -> reply text, skies() -> [{id, name}], sky() -> id, setSky(id), times() -> [{id, name}],
  //          time() -> id, setTime(id), photo(), stats() -> [[label, value]], mute() -> text }
  constructor(hooks) {
    this.hooks = hooks;
    this.open = false;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'phone';
    this.el.innerHTML = '<div class="phone__screen"></div>';
    this.screen = this.el.firstChild;
    document.body.appendChild(this.el);
    this.page = 'home';
    this.sel = 0;
    this.callTimer = null;
  }

  toggle() { if (this.open) this.close(); else this.show(); }

  show() {
    this.open = true;
    this.openedAt = performance.now();
    this.page = 'home';
    this.sel = 0;
    this.el.classList.add('is-open');
    this.render();
  }

  close() {
    this.open = false;
    this.el.classList.remove('is-open');
    clearTimeout(this.callTimer);
  }

  // Input from the D-pad / arrow keys / A / B.
  action(a) {
    if (!this.open) return false;
    // The press that opened the phone shouldn't also move the selection.
    if (a.startsWith('nav') && performance.now() - this.openedAt < 300) return true;
    const n = this.items().length;
    const cols = this.page === 'home' ? 3 : 1;
    if (a === 'navUp') this.sel = (this.sel - cols + n) % n;
    else if (a === 'navDown') this.sel = (this.sel + cols) % n;
    else if (a === 'navLeft' && cols > 1) this.sel = (this.sel - 1 + n) % n;
    else if (a === 'navRight' && cols > 1) this.sel = (this.sel + 1) % n;
    else if (a === 'confirm') this.pick();
    else if (a === 'back') { if (this.page === 'home') this.close(); else { this.page = 'home'; this.sel = 0; } }
    else return false;
    if (this.open) this.render();
    return true;
  }

  items() {
    const h = this.hooks;
    if (this.page === 'home') return APPS;
    if (this.page === 'contacts') return CONTACTS;
    if (this.page === 'sky') return h.skies();
    if (this.page === 'clock') return h.times();
    if (this.page === 'stats') return h.stats().map(([name, value]) => ({ name, note: value }));
    return [{}];
  }

  pick() {
    const h = this.hooks;
    const it = this.items()[this.sel];
    if (this.page === 'home') {
      if (it.id === 'camera') { this.close(); h.photo(); return; }
      if (it.id === 'music') { this.flash(h.mute()); return; }
      this.page = it.id;
      this.sel = it.id === 'sky' ? Math.max(0, h.skies().findIndex((s) => s.id === h.sky())) : it.id === 'clock' ? Math.max(0, h.times().findIndex((s) => s.id === h.time())) : 0;
    } else if (this.page === 'contacts') this.call(it);
    else if (this.page === 'sky') h.setSky(it.id);
    else if (this.page === 'clock') h.setTime(it.id);
  }

  flash(text) {
    this.page = 'msg';
    this.msg = text;
    this.render();
    clearTimeout(this.callTimer);
    this.callTimer = setTimeout(() => { if (this.page === 'msg') { this.page = 'home'; this.render(); } }, 1400);
  }

  call(c) {
    this.page = 'call';
    this.caller = c;
    this.callState = 'ringing';
    this.render();
    clearTimeout(this.callTimer);
    this.callTimer = setTimeout(() => {
      this.callState = 'talking';
      this.reply = this.hooks.call(c.id);
      this.render();
      this.callTimer = setTimeout(() => { if (this.page === 'call') { this.close(); } }, 3200);
    }, 1300);
  }

  render() {
    const now = new Date();
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const bar = `<div class="phone__bar"><span>${clock}</span><span>5G ▮▮▮▯</span></div>`;
    const hint = '<div class="phone__hint">D-PAD · A SELECT · B BACK</div>';
    const sel = (i) => (i === this.sel ? ' is-sel' : '');
    let body = '';
    if (this.page === 'home') {
      body = `<div class="phone__title">iFruit</div><div class="phone__grid">${APPS.map((a, i) => `<div class="app${sel(i)}"><i style="background:${a.color}">${a.icon}</i>${a.name}</div>`).join('')}</div>`;
    } else if (this.page === 'contacts') {
      body = `<div class="phone__title">Contacts</div><div class="phone__list">${CONTACTS.map((c, i) => `<div class="row-item${sel(i)}"><b style="background:${c.color}">${c.initial}</b><div>${c.name}<small>${c.note}</small></div></div>`).join('')}</div>`;
    } else if (this.page === 'sky' || this.page === 'clock') {
      const cur = this.page === 'sky' ? this.hooks.sky() : this.hooks.time();
      body = `<div class="phone__title">${this.page === 'sky' ? 'Sky' : 'Clock'}</div><div class="phone__list">${this.items().map((s, i) => `<div class="row-item${sel(i)}${s.id === cur ? ' is-on' : ''}"><div>${s.name}${s.note ? `<small>${s.note}</small>` : ''}</div></div>`).join('')}</div>`;
    } else if (this.page === 'stats') {
      body = `<div class="phone__title">Stats</div><div class="phone__list">${this.items().map((s, i) => `<div class="row-item${sel(i)}"><div>${s.name}<small>${s.note}</small></div></div>`).join('')}</div>`;
    } else if (this.page === 'call') {
      const c = this.caller;
      body = `<div class="phone__call"><div class="avatar${this.callState === 'ringing' ? ' is-ringing' : ''}" style="background:${c.color}">${c.initial}</div><h3>${c.name}</h3><p>${this.callState === 'ringing' ? 'Calling…' : this.reply}</p></div>`;
    } else if (this.page === 'msg') {
      body = `<div class="phone__call"><p>${this.msg}</p></div>`;
    }
    this.screen.innerHTML = bar + body + hint;
  }
}
