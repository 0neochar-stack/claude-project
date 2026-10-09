// Player settings, saved in the browser. Graphics presets trade looks for speed; "auto" starts at a sensible
// preset for the device and lets the adaptive resolution do the rest.

export const QUALITY = {
  low: { label: 'Low', pixelRatio: 0.8, reflections: false, reflScale: 0, reflEvery: 2, bloom: false, shadows: 0, props: 0.45, rain: 2500, particles: 700, far: 900, detail: 0, traffic: 10 },
  medium: { label: 'Medium', pixelRatio: 1.0, reflections: true, reflScale: 0.3, reflEvery: 2, bloom: true, shadows: 0, props: 0.75, rain: 5000, particles: 1300, far: 1500, detail: 1, traffic: 16 },
  high: { label: 'High', pixelRatio: 1.5, reflections: true, reflScale: 0.45, reflEvery: 1, bloom: true, shadows: 1024, props: 1, rain: 9000, particles: 2000, far: 2600, detail: 2, traffic: 22 },
  ultra: { label: 'Ultra', pixelRatio: 2, reflections: true, reflScale: 0.6, reflEvery: 1, bloom: true, shadows: 2048, props: 1, rain: 12000, particles: 2600, far: 4500, detail: 2, traffic: 28 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

const DEFAULTS = {
  quality: 'auto',
  camera: 'chase',
  assist: 2,
  units: 'kmh',
  showFps: false,
  timeOfDay: 'cycle', // cycle | night | dusk | day
  volume: 0.9,
};

function guessQuality() {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (touch) return cores >= 8 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}

export class Settings {
  constructor() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('cd.settings') || '{}'); } catch { /* blocked */ }
    Object.assign(this, DEFAULTS, saved);
    this.listeners = new Set();
  }

  get preset() {
    const q = this.quality === 'auto' ? guessQuality() : this.quality;
    return { id: q, ...QUALITY[q] };
  }

  set(key, value) {
    this[key] = value;
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = this[k];
    try { localStorage.setItem('cd.settings', JSON.stringify(out)); } catch { /* blocked */ }
    for (const fn of this.listeners) fn(key, value);
  }

  onChange(fn) { this.listeners.add(fn); }
}
