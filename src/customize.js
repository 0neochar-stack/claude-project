// Customize: pick and buy cars, then tune the one you are looking at. Every tab has its own colour; every
// setting is free and shows where stock is, and any tab (or the whole car) goes back to stock in one press.
// This module only edits the DOM and the profile; main.js updates the 3D car, physics and sound through
// the callbacks.
import {
  CARS, UPGRADES, MAX_LEVEL, NEONS, RIMS, KITS, INDUCTIONS, ENGINE_SWAPS, TYRES, DIFFS, TUNE_RANGES,
  buildSpec, specStats, upgradeCost, kitCost, stockTune, carById,
} from './garage.js';
import { PAINTS } from './car.js';

const fmt = new Intl.NumberFormat('en-US');
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export const TABS = [
  { id: 'cars', name: 'Cars', color: 'var(--cyan)' },
  { id: 'paint', name: 'Paint', color: 'var(--pink)' },
  { id: 'stance', name: 'Stance', color: 'var(--lime)', keys: ['rideHeight', 'camberF', 'camberR', 'trackF', 'trackR'] },
  { id: 'engine', name: 'Engine', color: 'var(--orange)', keys: ['engine'] },
  { id: 'boost', name: 'Boost', color: 'var(--red)', keys: ['induction', 'boost'] },
  { id: 'traction', name: 'Traction', color: 'var(--yellow)', keys: ['tyre', 'diff'] },
  { id: 'handling', name: 'Handling', color: 'var(--violet)', keys: ['steerLock', 'finalDrive', 'brakeBias', 'handbrake'] },
];
const STYLE_KEYS = ['paint', 'neon', 'rims', 'wheels', 'wing'];
const WHEELS = [['six', 'Six-spoke'], ['mesh', 'Mesh'], ['dish', 'Deep dish'], ['five', 'Five-spoke']];
const WINGS = [['none', 'None'], ['lip', 'Lip'], ['duck', 'Street wing'], ['gt', 'GT wing']];

// Stat bars are scaled against the best any fully upgraded car reaches.
const maxed = Object.fromEntries(UPGRADES.map((u) => [u.id, MAX_LEVEL]));
const TOP = CARS.map((c) => specStats(buildSpec(c.id, maxed, 'twin', { ...stockTune(c.id), boost: 1.6 })));
const RANGE = {
  hp: Math.max(...TOP.map((s) => s.hp)),
  grip: Math.max(...TOP.map((s) => s.grip)),
  lock: 72,
  mass: Math.max(...TOP.map((s) => s.mass)),
};
const chassis = (c) => (c.look.doors === 4 ? 'Four-door' : 'Coupe') + (c.spec.awd ? ' · AWD' : ' · RWD');

export class Customize {
  constructor(root, profile, cb) {
    this.root = root;
    this.profile = profile;
    this.cb = cb; // { onPreview(id), onTune(id, what), onSelect(id), onStyle(id, key), onDrive(), onBack(), onToast(text), onRev() }
    this.tab = 'cars';
    this.viewing = profile.current;
    this.$ = (sel) => root.querySelector(`[data-c="${sel}"]`);

    this.$('tabs').innerHTML = TABS.map((t) => `<button class="tab" role="tab" type="button" data-nav data-tab="${t.id}" style="--tab:${t.color}">${t.name}</button>`).join('');
    this.$('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) this.setTab(b.dataset.tab);
    });
    this.$('back').addEventListener('click', () => cb.onBack());
    this.$('action').addEventListener('click', () => this.primary());
    this.$('reset-tab').addEventListener('click', () => this.resetTab());
    this.$('reset-all').addEventListener('click', () => this.resetAll());
    const body = this.$('body');
    body.addEventListener('click', (e) => this.click(e));
    body.addEventListener('input', (e) => {
      const r = e.target.closest('input[type="range"][data-tune]');
      if (r) this.slide(r);
    });
  }

  get id() { return this.viewing; }
  get owned() { return this.profile.owns(this.viewing); }

  open(fromPause = false) {
    this.fromPause = fromPause;
    this.viewing = this.profile.current;
    this.render();
  }

  // Leaving on a car you only looked at puts your own car back.
  close() {
    if (this.viewing !== this.profile.current) this.cb.onPreview(this.profile.current);
    this.viewing = this.profile.current;
  }

  setTab(id) {
    this.tab = id;
    this.render();
    this.root.querySelector(`[data-tab="${id}"]`)?.focus({ preventScroll: true });
    this.$('body').scrollTop = 0;
  }

  // Controller shoulder buttons step through tabs.
  stepTab(dir) {
    const i = TABS.findIndex((t) => t.id === this.tab);
    this.setTab(TABS[(i + dir + TABS.length) % TABS.length].id);
  }

  primary() {
    const id = this.viewing, car = carById(id);
    if (this.owned) {
      if (this.profile.current !== id) {
        this.profile.select(id);
        this.cb.onSelect(id);
        this.cb.onToast(`Driving the ${car.name}`);
        this.render();
        return;
      }
      this.cb.onDrive();
    } else if (this.profile.buyCar(id)) {
      this.cb.onSelect(id);
      this.cb.onToast(`${car.name} is yours`);
      this.render();
    } else this.cb.onToast(`Need ${fmt.format(car.price - this.profile.credits)} more CR`);
  }

  resetTab() {
    if (!this.owned) return;
    const t = TABS.find((x) => x.id === this.tab);
    if (t.id === 'paint') {
      const look = carById(this.id).look;
      for (const k of STYLE_KEYS) this.profile.setStyle(this.id, k, look[k]);
      this.cb.onStyle(this.id, 'all');
    } else if (t.keys) {
      this.profile.resetTune(this.id, t.keys);
      this.cb.onTune(this.id, t.id);
    } else return;
    this.cb.onToast(`${t.name} back to stock`);
    this.render();
  }

  resetAll() {
    if (!this.owned) return;
    this.profile.resetTune(this.id);
    const look = carById(this.id).look;
    for (const k of STYLE_KEYS) this.profile.setStyle(this.id, k, look[k]);
    this.cb.onStyle(this.id, 'all');
    this.cb.onTune(this.id, 'all');
    this.cb.onToast('Everything back to stock');
    this.render();
  }

  tune(key, value, what) {
    if (!this.owned) { this.cb.onToast('Buy this car to tune it'); return; }
    this.profile.setTune(this.id, key, value);
    this.cb.onTune(this.id, what);
  }

  slide(r) {
    const key = r.dataset.tune, v = Number(r.value);
    this.tune(key, v, this.tab);
    this.paintSlider(r);
    const row = r.closest('.slider');
    row.querySelector('.slider__val').textContent = this.fmtTune(key, v);
    row.querySelector('.slider__reset').dataset.stock = String(v === stockTune(this.id)[key]);
    this.renderStats();
  }

  paintSlider(r) {
    const pct = ((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100;
    r.style.setProperty('--pct', `${pct}%`);
  }

  click(e) {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset, id = this.id, p = this.profile;
    if (d.car) {
      if (d.car !== this.viewing) { this.viewing = d.car; this.cb.onPreview(d.car); this.render(); }
      return;
    }
    if (d.reset) {
      this.tune(d.reset, stockTune(id)[d.reset], this.tab);
      this.render();
      return;
    }
    if (d.style) {
      if (!this.owned) { this.cb.onToast('Buy this car to restyle it'); return; }
      const v = d.value !== undefined ? d.value : Number(d.index);
      p.setStyle(id, d.style, v);
      this.cb.onStyle(id, d.style);
      this.render();
      return;
    }
    if (d.engine) { this.tune('engine', d.engine, 'engine'); this.render(); return; }
    if (d.tyre) { this.tune('tyre', d.tyre, 'traction'); this.render(); return; }
    if (d.diff) { this.tune('diff', d.diff, 'traction'); this.render(); return; }
    if (d.ind) {
      if (!this.owned) { this.cb.onToast('Buy this car to tune it'); return; }
      if (p.setInduction(id, d.ind)) { this.cb.onTune(id, 'boost'); this.cb.onToast(INDUCTIONS.find((x) => x.id === d.ind).name); }
      else this.cb.onToast('Buy the kit first');
      this.render();
      return;
    }
    if (d.kit) {
      if (p.buyKit(id, d.kit)) { this.cb.onTune(id, 'boost'); this.cb.onToast(`${KITS.find((k) => k.id === d.kit).name} fitted`); }
      else if (this.owned) this.cb.onToast(`Need ${fmt.format(kitCost(carById(id), d.kit) - p.credits)} more CR`);
      else this.cb.onToast('Buy this car first');
      this.render();
      return;
    }
    if (d.upgrade) {
      if (p.buyUpgrade(id, d.upgrade)) {
        const u = UPGRADES.find((x) => x.id === d.upgrade);
        this.cb.onTune(id, 'upgrade');
        this.cb.onToast(`${u.name} level ${p.car(id).levels[u.id]}`);
      } else if (this.owned) {
        const lv = p.car(id).levels[d.upgrade] || 0;
        this.cb.onToast(`Need ${fmt.format(upgradeCost(carById(id), d.upgrade, lv) - p.credits)} more CR`);
      }
      this.render();
      return;
    }
    if (d.rev !== undefined) this.cb.onRev();
  }

  // ---------- rendering ----------
  fmtTune(key, v) {
    const r = TUNE_RANGES[key];
    if (key === 'brakeBias') return `${Math.round(v * 100)}% F`;
    if (r.unit === '×') return `${v.toFixed(2)}×`;
    if (r.unit === '°') return `${v.toFixed(r.step < 1 ? 1 : 0)}°`;
    return `${v > 0 && key === 'rideHeight' ? '+' : ''}${v.toFixed(r.step < 1 ? 1 : 0)} ${r.unit}`;
  }

  slider(key, note = '') {
    const r = TUNE_RANGES[key], t = this.profile.car(this.id).tune || stockTune(this.id), stock = stockTune(this.id)[key];
    const v = t[key] ?? stock;
    const stockPct = ((stock - r.min) / (r.max - r.min)) * 100;
    return `<div class="slider">
      <span class="slider__label">${r.label}${note ? ` <span class="label">${note}</span>` : ''}</span>
      <span class="slider__val">${this.fmtTune(key, v)}</span>
      <button class="slider__reset" type="button" data-reset="${key}" data-stock="${v === stock}" aria-label="${r.label} back to stock" title="Back to stock">↺</button>
      <div class="slider__track"><input type="range" data-nav data-tune="${key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" aria-label="${r.label}" ${this.owned ? '' : 'disabled'}><span class="slider__stock" style="left:${stockPct}%"></span></div>
    </div>`;
  }

  level(upId) {
    const u = UPGRADES.find((x) => x.id === upId), car = carById(this.id);
    const lv = this.profile.car(this.id).levels[upId] || 0;
    const maxedOut = lv >= MAX_LEVEL;
    const cost = maxedOut ? 0 : upgradeCost(car, upId, lv);
    const pips = Array.from({ length: MAX_LEVEL }, (_, k) => `<i class="${k < lv ? 'is-on' : ''}"></i>`).join('');
    return `<div class="level">
      <div class="level__text"><b>${u.name}</b><span>${u.blurb}</span></div>
      <div class="pips">${pips}</div>
      <button class="btn btn--sm" type="button" data-nav data-upgrade="${upId}" ${maxedOut || !this.owned ? 'disabled' : ''}>${maxedOut ? 'Maxed' : `${fmt.format(cost)} CR`}</button>
    </div>`;
  }

  group(title, inner, note = '') {
    return `<section class="group"><div class="group__head"><h3 class="group__title">${title}</h3></div>${note ? `<p class="group__note">${note}</p>` : ''}${inner}</section>`;
  }

  renderBody() {
    const id = this.id, p = this.profile, car = carById(id), st = p.car(id), t = st.tune || stockTune(id);
    const lockNote = this.owned ? '' : `<p class="group__note">You are looking at the ${car.name}. Buy it to tune and restyle it.</p>`;
    switch (this.tab) {
      case 'cars': {
        const tiles = CARS.map((c) => {
          const owned = p.owns(c.id), cur = p.current === c.id;
          const state = cur ? 'Driving' : owned ? 'Owned' : c.price ? `${fmt.format(c.price)} CR` : 'Free';
          const s = specStats(p.owns(c.id) ? p.spec(c.id) : buildSpec(c.id));
          return `<button class="ccar ${c.id === id ? 'is-on' : ''}" type="button" data-nav data-car="${c.id}">
            <span class="ccar__name">${c.name}</span>
            <span class="ccar__meta"><span>${s.hp} hp · ${chassis(c)}</span><span class="ccar__state ${cur ? 'is-current' : owned ? 'is-owned' : ''}">${state}</span></span>
          </button>`;
        }).join('');
        return this.group('Choose a car', `<div class="cars">${tiles}</div>`, car.tagline);
      }
      case 'paint': {
        const sw = (key, list, cur) => `<div class="swatches">${list.map((x, i) => `<button class="swatch ${i === cur ? 'is-on' : ''}" type="button" data-nav data-style="${key}" data-index="${i}" style="--c:${hex(x.color)}" aria-label="${x.name}" title="${x.name}"></button>`).join('')}</div>`;
        const opt = (key, list, cur) => `<div class="opts">${list.map(([v, name]) => `<button class="opt ${v === cur ? 'is-on' : ''}" type="button" data-nav data-style="${key}" data-value="${v}"><b>${name}</b></button>`).join('')}</div>`;
        return lockNote
          + this.group(`Body · ${PAINTS[st.paint]?.name || ''}`, sw('paint', PAINTS, st.paint))
          + this.group(`Wheels · ${RIMS[st.rims]?.name || ''}`, sw('rims', RIMS, st.rims) + opt('wheels', WHEELS, st.wheels || car.look.wheels))
          + this.group('Rear wing', opt('wing', WINGS, st.wing || car.look.wing))
          + this.group(`Underglow · ${NEONS[st.neon]?.name || ''}`, sw('neon', NEONS, st.neon));
      }
      case 'stance':
        return lockNote
          + this.group('Ride height', this.slider('rideHeight'), 'Lower is calmer through transitions and looks meaner.')
          + this.group('Camber', this.slider('camberF') + this.slider('camberR'), 'More front camber bites harder at full lock. Too much rear camber lets the back step out early.')
          + this.group('Wheel spacers', this.slider('trackF') + this.slider('trackR'), 'A wider track rolls less and sits flush with the arches.');
      case 'engine': {
        const swaps = ENGINE_SWAPS.map((e) => {
          const on = (t.engine || 'stock') === e.id;
          const base = buildSpec(id);
          const meta = e.id === 'stock' ? `${Math.round(car.spec.torque ?? base.torque)} Nm · ${base.redline} rpm` : `${e.torque} Nm · ${e.redline} rpm`;
          return `<button class="opt ${on ? 'is-on' : ''}" type="button" data-nav data-engine="${e.id}"><b>${e.id === 'stock' ? `Stock · ${car.engine.toUpperCase()}` : e.name}</b><em>${meta}</em></button>`;
        }).join('');
        return lockNote
          + this.group('Engine swap', `<div class="opts opts--grid">${swaps}</div>`, 'Swaps are free and change the sound, power band and weight.')
          + this.group('Performance', this.level('engine'))
          + `<button class="btn" type="button" data-nav data-rev>Rev it</button>`;
      }
      case 'boost': {
        const inds = INDUCTIONS.map((x) => {
          const have = x.needs.every((k) => st.kits[k]);
          const on = (t.induction || st.induction) === x.id;
          return `<button class="opt ${on ? 'is-on' : ''} ${have ? '' : 'is-locked'}" type="button" data-nav data-ind="${x.id}"><b>${x.name}</b></button>`;
        }).join('');
        const kits = KITS.map((k) => {
          const have = st.kits[k.id];
          return `<div class="level"><div class="level__text"><b>${k.name}</b><span>${k.blurb}</span></div><span></span>
            <button class="btn btn--sm" type="button" data-nav data-kit="${k.id}" ${have || !this.owned ? 'disabled' : ''}>${have ? 'Owned' : `${fmt.format(kitCost(car, k.id))} CR`}</button></div>`;
        }).join('');
        return lockNote
          + this.group('Induction', `<div class="opts">${inds}</div>`, 'Switch between the kits you own for free.')
          + this.group('Boost pressure', this.slider('boost'))
          + this.group('Kits', kits);
      }
      case 'traction': {
        const ty = TYRES.map((x) => `<button class="opt ${t.tyre === x.id ? 'is-on' : ''}" type="button" data-nav data-tyre="${x.id}"><b>${x.name}</b><span>${x.blurb}</span></button>`).join('');
        const df = DIFFS.map((x) => `<button class="opt ${t.diff === x.id ? 'is-on' : ''}" type="button" data-nav data-diff="${x.id}"><b>${x.name}</b><span>${x.blurb}</span></button>`).join('');
        return lockNote
          + this.group('Tyre compound', `<div class="opts opts--grid">${ty}</div>`)
          + this.group('Differential', `<div class="opts opts--grid">${df}</div>`)
          + this.group('Tyre upgrade', this.level('tyres'));
      }
      case 'handling':
        return lockNote
          + this.group('Steering', this.slider('steerLock'), 'More lock holds deeper angle.')
          + this.group('Gearing', this.slider('finalDrive'), 'Shorter (higher) is punchier, longer reaches a higher top speed.')
          + this.group('Brakes', this.slider('brakeBias') + this.slider('handbrake'))
          + this.group('Parts', this.level('weight') + this.level('angle'));
      default: return '';
    }
  }

  renderStats() {
    const p = this.profile, id = this.id;
    const s = specStats(p.owns(id) ? p.spec(id) : buildSpec(id));
    const base = specStats(buildSpec(id));
    const cls = (a, b, invert = false) => (Math.abs(a - b) < 1e-6 ? '' : (a > b) !== invert ? 'is-up' : 'is-down');
    const items = [
      ['Power', `${s.hp} hp`, s.hp / RANGE.hp, cls(s.hp, base.hp)],
      ['Weight', `${fmt.format(s.mass)} kg`, s.mass / RANGE.mass, cls(s.mass, base.mass, true)],
      ['Grip', `${s.grip.toFixed(2)} g`, s.grip / RANGE.grip, cls(s.grip, base.grip)],
      ['Lock', `${s.lock}°`, s.lock / RANGE.lock, cls(s.lock, base.lock)],
    ];
    this.$('stats').innerHTML = items.map(([k, v, f, c]) => `<div class="stat"><span class="label">${k}</span><span class="stat__v ${c}">${v}</span><span class="stat__bar"><i style="transform:scaleX(${Math.min(1, f).toFixed(3)})"></i></span></div>`).join('');
  }

  render() {
    const p = this.profile, car = carById(this.id);
    const tab = TABS.find((t) => t.id === this.tab);
    this.root.style.setProperty('--accent', tab.color);
    for (const b of this.root.querySelectorAll('[data-tab]')) b.classList.toggle('is-on', b.dataset.tab === this.tab);
    this.$('credits').textContent = `${fmt.format(p.credits)} CR`;
    this.$('name').textContent = car.name;
    this.$('chassis').textContent = `${chassis(car)} · ${car.engine.toUpperCase()}`;
    this.renderStats();
    const focusKey = document.activeElement?.closest?.('[data-c="body"]') ? this.focusKey(document.activeElement) : null;
    this.$('body').innerHTML = this.renderBody();
    for (const r of this.$('body').querySelectorAll('input[type="range"]')) this.paintSlider(r);
    if (focusKey) this.$('body').querySelector(focusKey)?.focus({ preventScroll: true });
    const owned = this.owned;
    const act = this.$('action');
    act.textContent = !owned ? (car.price ? `Buy · ${fmt.format(car.price)} CR` : 'Get') : p.current !== this.id ? 'Drive this car' : this.fromPause ? 'Back to driving' : 'Drive';
    act.disabled = !owned && p.credits < car.price;
    this.$('reset-tab').disabled = !owned || !(tab.keys || tab.id === 'paint');
    this.$('reset-all').disabled = !owned;
  }

  // Keeps keyboard and controller focus on the same control when a tab re-renders.
  focusKey(el) {
    for (const k of ['car', 'tune', 'style', 'engine', 'tyre', 'diff', 'ind', 'kit', 'upgrade', 'reset']) {
      if (el.dataset[k] !== undefined) {
        const extra = el.dataset.index !== undefined ? `[data-index="${el.dataset.index}"]` : el.dataset.value !== undefined ? `[data-value="${el.dataset.value}"]` : '';
        return `[data-${k}="${el.dataset[k]}"]${extra}`;
      }
    }
    return null;
  }
}
