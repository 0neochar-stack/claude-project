// The in-game HUD: score, drift chain, tach, boost, minimap, police heat, banners and toasts.
// Text only changes when its value does, and the minimap redraws at 30 Hz, so the HUD costs next to nothing.
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

const TACH = { cx: 100, cy: 100, r: 84, a0: 135, sweep: 270 };
function arcPath(f0, f1, r = TACH.r) {
  const ang = (f) => ((TACH.a0 + TACH.sweep * f) * Math.PI) / 180;
  const p = (f) => [TACH.cx + r * Math.cos(ang(f)), TACH.cy + r * Math.sin(ang(f))];
  const [x0, y0] = p(f0), [x1, y1] = p(f1);
  const large = (f1 - f0) * TACH.sweep > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      total: $('total'), best: $('best'), chain: $('chain'), grade: $('grade'), points: $('points'), mult: $('mult'),
      angle: $('angle'), grace: $('grace'), speed: $('speed'), units: $('units'), gear: $('gear'), banner: $('banner'),
      toast: $('toast'), credits: $('credits'), place: $('place'), fps: $('fps'),
      boost: $('boost'), boostV: $('boost-value'), boostBar: $('boost-bar'), boostL: $('boost-label'),
      heat: $('heat'), heatState: $('heat-state'), heatNote: $('heat-note'), heatBar: $('heat-bar'), splash: $('splash'),
    };
    this.last = {};
    this.boostShown = 0;
    this.tachMax = 0;
    this.mini = $('minimap').getContext('2d');
    this.miniTimer = 0;
    this.toastTimer = 0;
  }

  set(key, text) {
    if (this.last[key] !== text) { this.el[key].textContent = text; this.last[key] = text; }
  }

  // The tach is redrawn when the redline changes (a different car or engine).
  drawTach(redline) {
    const max = Math.ceil((redline + 600) / 1000) * 1000;
    if (max === this.tachMax) return;
    this.tachMax = max;
    let svg = `<circle class="dash__bg" cx="100" cy="100" r="98"/><path class="dash__track" d="${arcPath(0, 1)}"/>`;
    svg += `<path class="dash__red" d="${arcPath(redline / max, 1)}"/>`;
    svg += `<path class="dash__rpm" id="rpm" pathLength="1" stroke-dasharray="0 1" d="${arcPath(0, 1)}"/>`;
    const n = max / 1000;
    for (let k = 0; k <= n; k++) {
      const a = ((TACH.a0 + (TACH.sweep * k) / n) * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      svg += `<line class="dash__tick" x1="${100 + c * 72}" y1="${100 + s * 72}" x2="${100 + c * 78}" y2="${100 + s * 78}"/>`;
      svg += `<text class="dash__num" x="${100 + c * 62}" y="${100 + s * 62}">${k}</text>`;
    }
    $('tach').innerHTML = svg;
    this.rpmArc = $('rpm');
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('is-shown');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('is-shown'), 1700);
  }

  banner(text, kind) {
    const b = this.el.banner;
    b.textContent = text;
    b.className = `banner banner--${kind}`;
    void b.offsetWidth;
    b.classList.add('is-shown');
  }

  // Police: hidden while there is no heat; pulses red and blue during a chase.
  setHeat(h) {
    const show = h && (h.level > 0.02 || h.state !== 'calm');
    if (this.el.heat.hidden === !!show) this.el.heat.hidden = !show;
    if (!show) return;
    const label = h.state === 'chase' ? 'PURSUIT' : h.state === 'evading' ? 'EVADING' : h.state === 'search' ? 'SEARCHING' : 'HEAT';
    this.set('heatState', label);
    this.set('heatNote', h.note || 'Police');
    this.el.heatBar.style.transform = `scaleX(${Math.min(1, h.level).toFixed(3)})`;
    this.el.heat.classList.toggle('is-chase', h.state === 'chase');
  }

  update(dt, { car, score, profile, settings, world }) {
    const e = this.el;
    this.set('total', fmt.format(Math.round(score.total)));
    this.set('best', fmt.format(Math.round(score.best)));
    this.set('credits', `${fmt.format(profile.credits)} CR`);
    this.set('place', world.placeInfo(car));
    const showChain = score.chain > 0;
    e.chain.classList.toggle('is-idle', !showChain);
    if (showChain) {
      this.set('grade', score.grade);
      this.set('points', fmt.format(Math.round(score.chain)));
      this.set('mult', `×${score.mult.toFixed(1)}`);
      this.set('angle', `${Math.round(score.angle)}°`);
      e.grace.style.transform = `scaleX(${score.graceLeft.toFixed(3)})`;
    }
    const mph = settings.units === 'mph';
    this.set('speed', String(Math.round(car.speed * (mph ? 2.237 : 3.6))));
    this.set('units', mph ? 'mph' : 'km/h');
    const forced = car.spec.turboGain > 0 || car.spec.scGain > 0;
    if (e.boost.hidden === forced) e.boost.hidden = !forced;
    if (forced) {
      this.boostShown += (car.boostBar - this.boostShown) * 0.25;
      this.set('boostV', `${this.boostShown.toFixed(2)} bar`);
      e.boostBar.style.transform = `scaleX(${Math.min(1, this.boostShown / 1.4).toFixed(3)})`;
      this.set('boostL', car.spec.turboGain && car.spec.scGain ? 'Twin-charge' : car.spec.turboGain ? 'Turbo' : 'Supercharger');
    }
    this.set('gear', car.gear === -1 ? 'R' : car.autoGear ? `${car.gear}` : `M${car.gear}`);
    this.drawTach(car.spec.redline);
    // Shift lights: fill green, yellow, red over the top quarter of the revs; all flash blue on the limiter.
    const lights = this.lights ||= [...document.querySelectorAll('#shiftlights i')];
    const sl = document.getElementById('shiftlights');
    const lim = car.rpm > car.spec.redline - 120;
    const lit = lim ? 0 : Math.max(0, Math.min(10, Math.floor(((car.rpm - car.spec.redline * 0.72) / (car.spec.redline * 0.27)) * 10)));
    if (this.last.lit !== lit) { lights.forEach((el, k) => { el.className = k < lit ? (k < 5 ? 'g' : k < 8 ? 'y' : 'r') : ''; }); this.last.lit = lit; }
    const flashOn = lim && Math.floor(performance.now() / 70) % 2 === 0;
    if (this.last.flash !== flashOn) { sl.classList.toggle('is-limit', flashOn); this.last.flash = flashOn; }
    const frac = Math.min(1, car.rpm / this.tachMax);
    this.rpmArc.setAttribute('stroke-dasharray', `${frac.toFixed(3)} 1`);
    this.rpmArc.classList.toggle('is-hot', car.rpm > car.spec.redline - 300);
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 1 / 30;
      this.drawMinimap(car, world);
    }
  }

  drawMinimap(car, world) {
    const g = this.mini, W = g.canvas.width;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0a0814';
    g.fillRect(0, 0, W, W);
    world.drawMinimap(g, car, W);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#2ef2ff';
    g.shadowColor = '#2ef2ff';
    g.shadowBlur = 12;
    g.beginPath();
    g.moveTo(W / 2, W / 2 - 14);
    g.lineTo(W / 2 + 9, W / 2 + 10);
    g.lineTo(W / 2, W / 2 + 5);
    g.lineTo(W / 2 - 9, W / 2 + 10);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
  }

  fps(text) {
    if (this.el.fps.hidden !== !text) this.el.fps.hidden = !text;
    if (text) this.set('fps', text);
  }
}
