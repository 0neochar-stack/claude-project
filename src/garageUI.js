// The garage screen: browse cars, buy and select them, buy upgrades, and style the car you own.
// It only edits the DOM and the profile; main.js swaps the 3D car through the callbacks.
import { CARS, UPGRADES, MAX_LEVEL, NEONS, RIMS, buildSpec, specStats, upgradeCost } from './garage.js';
import { PAINTS } from './car.js';

const fmt = new Intl.NumberFormat('en-US');
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// Bars are scaled against the best value any fully upgraded car reaches.
const maxed = Object.fromEntries(UPGRADES.map((u) => [u.id, MAX_LEVEL]));
const TOP = CARS.map((c) => specStats(buildSpec(c.id, maxed)));
const LIGHTEST = Math.min(...TOP.map((s) => s.mass));
const RANGE = {
  hp: Math.max(...TOP.map((s) => s.hp)),
  grip: Math.max(...TOP.map((s) => s.grip)),
  lock: Math.max(...TOP.map((s) => s.lock)),
};

export class GarageUI {
  constructor(root, profile, { onPreview, onChange, onClose, onToast }) {
    this.root = root;
    this.profile = profile;
    this.onPreview = onPreview;
    this.onChange = onChange;
    this.onClose = onClose;
    this.onToast = onToast;
    this.viewing = profile.current;
    this.$ = (sel) => root.querySelector(sel);

    this.$('[data-g="back"]').addEventListener('click', () => this.close());
    this.$('[data-g="action"]').addEventListener('click', () => this.primaryAction());
    this.$('[data-g="cars"]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-car]');
      if (b) this.view(b.dataset.car);
    });
    this.$('[data-g="upgrades"]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-upgrade]');
      if (!b) return;
      if (this.profile.buyUpgrade(this.viewing, b.dataset.upgrade)) {
        const u = UPGRADES.find((x) => x.id === b.dataset.upgrade);
        this.onToast(`${u.name} level ${this.profile.car(this.viewing).levels[u.id]}`);
        this.onChange(this.viewing, 'spec');
      } else if (!b.disabled) {
        const lv = this.profile.car(this.viewing).levels[b.dataset.upgrade] || 0;
        const cost = upgradeCost(CARS.find((c) => c.id === this.viewing), b.dataset.upgrade, lv);
        this.onToast(`Need ${fmt.format(cost - this.profile.credits)} more CR`);
      }
      this.render();
    });
    this.$('[data-g="style"]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-style]');
      if (!b) return;
      this.profile.setStyle(this.viewing, b.dataset.style, Number(b.dataset.index));
      this.onChange(this.viewing, b.dataset.style);
      this.render();
    });
  }

  get isOpen() { return !this.root.hidden; }

  open() {
    this.viewing = this.profile.current;
    this.root.hidden = false;
    this.render();
    this.$('[data-g="action"]').focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    // Leaving on a car you only previewed puts your own car back.
    if (this.viewing !== this.profile.current) this.onPreview(this.profile.current);
    this.viewing = this.profile.current;
    this.onClose();
  }

  view(id) {
    if (id === this.viewing) return;
    this.viewing = id;
    this.onPreview(id);
    this.render();
  }

  primaryAction() {
    const id = this.viewing, car = CARS.find((c) => c.id === id);
    if (this.profile.owns(id)) {
      if (this.profile.current !== id) {
        this.profile.select(id);
        this.onToast(`Driving the ${car.name}`);
        this.onChange(id, 'select');
      }
    } else if (this.profile.buyCar(id)) {
      this.onToast(`${car.name} is yours`);
      this.onChange(id, 'select');
    } else {
      this.onToast(`Need ${fmt.format(car.price - this.profile.credits)} more CR`);
    }
    this.render();
  }

  render() {
    const p = this.profile, id = this.viewing;
    const car = CARS.find((c) => c.id === id);
    const owned = p.owns(id);
    const state = p.car(id);

    this.$('[data-g="credits"]').textContent = `${fmt.format(p.credits)} CR`;

    this.$('[data-g="cars"]').innerHTML = CARS.map((c) => {
      const status = p.current === c.id ? 'Driving' : p.owns(c.id) ? 'Owned' : `${fmt.format(c.price)} CR`;
      return `<button type="button" class="gcar${c.id === id ? ' is-on' : ''}" data-car="${c.id}" aria-pressed="${c.id === id}">
        <span class="gcar__name">${c.name}</span><span class="gcar__status${p.owns(c.id) ? ' is-owned' : ''}">${status}</span></button>`;
    }).join('');

    this.$('[data-g="name"]').textContent = car.name;
    this.$('[data-g="tagline"]').textContent = car.tagline;

    const s = specStats(owned ? p.spec(id) : buildSpec(id));
    const rows = [
      ['Power', s.hp / RANGE.hp, `${s.hp} hp`],
      ['Weight', LIGHTEST / s.mass, `${fmt.format(s.mass)} kg`],
      ['Grip', s.grip / RANGE.grip, s.grip.toFixed(2)],
      ['Lock', s.lock / RANGE.lock, `${s.lock}°`],
    ];
    this.$('[data-g="stats"]').innerHTML = rows.map(([label, frac, value]) => `
      <div class="gstat"><span class="label">${label}</span>
      <span class="gstat__bar"><i style="transform:scaleX(${Math.min(1, frac).toFixed(3)})"></i></span>
      <span class="gstat__value">${value}</span></div>`).join('');

    const action = this.$('[data-g="action"]');
    if (owned) {
      action.textContent = p.current === id ? 'Driving this car' : 'Drive this car';
      action.disabled = p.current === id;
    } else {
      action.textContent = `Buy · ${fmt.format(car.price)} CR`;
      action.disabled = false;
      action.classList.toggle('is-short', p.credits < car.price);
    }
    if (owned) action.classList.remove('is-short');

    this.$('[data-g="upgrades"]').innerHTML = owned
      ? UPGRADES.map((u) => {
        const lv = state.levels[u.id] || 0;
        const pips = Array.from({ length: MAX_LEVEL }, (_, k) => `<i class="${k < lv ? 'is-on' : ''}"></i>`).join('');
        const cost = lv < MAX_LEVEL ? upgradeCost(car, u.id, lv) : 0;
        const btn = lv >= MAX_LEVEL
          ? '<button type="button" class="btn gup__buy" disabled>Max</button>'
          : `<button type="button" class="btn gup__buy${p.credits < cost ? ' is-short' : ''}" data-upgrade="${u.id}" ${p.credits < cost ? 'aria-disabled="true"' : ''}>${fmt.format(cost)} CR</button>`;
        return `<div class="gup"><div class="gup__text"><b>${u.name}</b><span>${u.blurb}</span></div><div class="gup__pips" aria-label="Level ${lv} of ${MAX_LEVEL}">${pips}</div>${btn}</div>`;
      }).join('')
      : '<p class="garage__note">Buy this car to tune it.</p>';

    const swatches = (key, list, current) => list.map((c, i) => `<button type="button" class="swatch${i === current ? ' is-on' : ''}" data-style="${key}" data-index="${i}" style="--c:${hex(c.color)}" title="${c.name}" aria-label="${c.name}" aria-pressed="${i === current}"></button>`).join('');
    this.$('[data-g="style"]').innerHTML = owned
      ? `<div class="gstyle"><span class="label">Paint</span><div class="swatches">${swatches('paint', PAINTS, state.paint)}</div></div>
         <div class="gstyle"><span class="label">Neon</span><div class="swatches">${swatches('neon', NEONS, state.neon)}</div></div>
         <div class="gstyle"><span class="label">Rims</span><div class="swatches">${swatches('rims', RIMS, state.rims)}</div></div>`
      : '';
  }
}
