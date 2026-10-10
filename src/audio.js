// Synthesised car audio. No audio files.
//
// Engine: for each car, short seamless loops are rendered from real firing patterns. Every cylinder firing is
// a pressure pulse that thumps, rings the exhaust pipe at its resonances and carries a little combustion
// rasp, with cycle-to-cycle variation; the result runs through a muffler filter. Loops are made at five rpm
// points, on and off throttle, and crossfaded by rpm and load while playing back at rpm / loop rpm, which is
// how racing games use recorded engine banks, so pitch never drifts far from a real recording.
//
// On top: turbo whistle, flutter and blow-off; supercharger whine; intake roar; tyre squeal; shift clunk;
// overrun crackle; rain; thunder; and a short street reverb.

// Firing angles in crank degrees over the 720 degree cycle, pulse timing offsets (unequal headers), per
// cylinder strength, exhaust resonances and muffler.
export const ENGINES = {
  // Straight six: even 120 degree firing, smooth and raspy.
  i6: { fire: [0, 120, 240, 360, 480, 600], offs: [0, 0, 0, 0, 0, 0], amp: [1, 0.96, 1, 0.97, 1, 0.95], pipe: 168, pipe2: 345, muffle: 2600, rasp: 0.55, thump: 0.75, gain: 1 },
  // Boxer four: even firing, but unequal-length headers stagger the pulses into the rumble.
  boxer4: { fire: [0, 180, 360, 540], offs: [0, 22, 0, 26], amp: [1, 0.72, 0.96, 0.78], pipe: 118, pipe2: 255, muffle: 1900, rasp: 0.4, thump: 1.05, gain: 1.1 },
  // Cross-plane V8: 90 degree firing, but each bank sees uneven gaps, which makes the burble.
  v8: { fire: [0, 90, 180, 270, 360, 450, 540, 630], offs: [0, 9, 0, 4, 9, 0, 9, 5], amp: [1, 0.68, 1, 0.92, 0.7, 1, 0.74, 0.66], pipe: 92, pipe2: 205, muffle: 1500, rasp: 0.35, thump: 1.35, gain: 1 },
  // Twin-turbo six: the turbines soak up the exhaust, so it is smoother and more muffled.
  i6tt: { fire: [0, 120, 240, 360, 480, 600], offs: [0, 0, 0, 0, 0, 0], amp: [1, 0.97, 1, 0.98, 1, 0.97], pipe: 150, pipe2: 310, muffle: 1700, rasp: 0.3, thump: 0.85, gain: 1.1 },
  // Inline four: two pulses per revolution, buzzy and bright with a hollow exhaust note.
  i4: { fire: [0, 180, 360, 540], offs: [0, 3, 0, 4], amp: [1, 0.9, 0.97, 0.88], pipe: 140, pipe2: 300, muffle: 2300, rasp: 0.5, thump: 0.9, gain: 1.05 },
  // 60 degree V6 (VQ): even firing but each bank's pipes see the other through the Y-pipe, a gravelly howl.
  v6: { fire: [0, 120, 240, 360, 480, 600], offs: [0, 6, 0, 6, 0, 6], amp: [1, 0.82, 0.98, 0.84, 1, 0.8], pipe: 128, pipe2: 290, muffle: 2100, rasp: 0.62, thump: 0.95, gain: 1.05 },
  // Twin-rotor rotary: a sharp port pulse per rotor face, no valves, so it is all rasp and brap.
  rotary: { fire: [0, 180, 360, 540], offs: [0, 0, 0, 0], amp: [1, 1, 1, 1], pipe: 210, pipe2: 470, muffle: 3600, rasp: 0.95, thump: 0.6, gain: 0.95 },
};
const REFS = [1100, 2400, 4000, 5800, 7700];

function rand32(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Renders one seamless loop of the engine at `rpm`. `load` 1 = on throttle, 0 = coasting.
export function renderEngineLoop(def, rpm, load, sr, seed = 1) {
  const rnd = rand32(seed * 7919 + rpm);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 0.8;
  const cycle = (120 / rpm) * sr; // samples per 720 degrees
  const n = Math.max(4, Math.round((0.36 * sr) / cycle));
  const L = Math.round(n * cycle);
  const out = new Float32Array(L);
  const tau0 = 0.00035 * sr, tau1 = 0.0026 * sr, tau2 = 0.0065 * sr, tauN = 0.0016 * sr;
  const w1 = (2 * Math.PI * def.pipe) / sr, w2 = (2 * Math.PI * def.pipe2) / sr;
  const len = Math.ceil(tau2 * 6);
  const idleLumpy = 1 - Math.min(1, (rpm - 900) / 2500);
  const A0 = 0.35 + 0.65 * load;
  for (let c = 0; c < n; c++) {
    def.fire.forEach((deg, k) => {
      const start = (c + (deg + def.offs[k]) / 720) * cycle;
      // Combustion varies cycle to cycle, more so at idle and off throttle. Off throttle some cycles barely fire.
      let A = A0 * def.amp[k] * (1 + gauss() * (0.06 + 0.16 * idleLumpy + 0.12 * (1 - load)));
      if (load < 0.5 && rnd() < 0.12) A *= 0.25;
      const ph = rnd() * 0.6;
      for (let j = 0; j < len; j++) {
        const t = j + (1 - (start % 1));
        const thump = (Math.exp(-t / tau1) - Math.exp(-t / tau0)) * def.thump;
        const ring = Math.exp(-t / tau2) * (Math.sin(w1 * t) * 0.8 + Math.sin(w2 * t + ph) * 0.35);
        const rasp = Math.exp(-t / tauN) * (rnd() * 2 - 1) * def.rasp * (0.4 + 0.6 * load);
        out[(Math.floor(start) + j) % L] += A * (thump + ring * 0.9 + rasp);
      }
    });
  }
  // Exhaust: DC block, then a two-pole muffler low-pass. Run twice so the loop starts in steady state.
  const fc = def.muffle * (0.55 + 0.45 * load) * (1 + rpm / 16000);
  const k = Math.tan((Math.PI * Math.min(fc, sr * 0.45)) / sr), q = 0.75;
  const a0 = 1 + k / q + k * k;
  const b0 = (k * k) / a0, b1 = (2 * k * k) / a0, b2 = b0, a1 = (2 * (k * k - 1)) / a0, a2 = (1 - k / q + k * k) / a0;
  const hp = Math.exp((-2 * Math.PI * 28) / sr);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, dcX = 0, dcY = 0;
  const res = new Float32Array(L);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < L; i++) {
      const x = out[i];
      dcY = x - dcX + hp * dcY;
      dcX = x;
      const y = b0 * dcY + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = dcY; y2 = y1; y1 = y;
      if (pass) res[i] = y;
    }
  }
  // Normalise loudness, then a soft saturation for body.
  let rms = 0;
  for (let i = 0; i < L; i++) rms += res[i] * res[i];
  rms = Math.sqrt(rms / L) || 1;
  const g = (0.22 / rms) * def.gain;
  for (let i = 0; i < L; i++) res[i] = Math.tanh(res[i] * g * 1.4) / 1.4;
  return res;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineType = 'i6';
    this.bank = null;
    this.lastGear = 1;
    this.crackle = 0;
    this.buffers = new Map(); // engine type -> rendered loops, so switching cars back is instant
    this.volume = 0.9;
    this.amb = { rain: 1, wet: 1, wind: 0, water: 0, siren: 0 };
  }

  // World ambience: rain 0..1, wet road 0..1, wind 0..1, waterfall 0..1, siren 0..1.
  setAmbience(a) {
    Object.assign(this.amb, a);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rainG.gain.setTargetAtTime(0.06 * this.amb.rain, t, 0.3);
    this.waterG.gain.setTargetAtTime(0.16 * this.amb.water, t, 0.2);
    this.sirenG.gain.setTargetAtTime(0.05 * this.amb.siren, t, 0.1);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // Short street reverb: early slaps off the buildings and a dark tail.
    const verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, Math.round(ctx.sampleRate * 1.3), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 4.2) * (t < 0.012 ? 0 : 1) * 0.5;
      }
      for (const [ms, a] of [[23, 0.6], [41, 0.45], [67, 0.35], [96, 0.25]]) d[Math.round((ms + ch * 3) * ctx.sampleRate / 1000)] += a;
    }
    verb.buffer = ir;
    const verbLp = ctx.createBiquadFilter();
    verbLp.type = 'lowpass';
    verbLp.frequency.value = 2400;
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.22;
    this.verbSend.connect(verb).connect(verbLp).connect(master);

    // Everything car-related goes through one bus with a little reverb.
    this.carBus = ctx.createGain();
    this.carBus.connect(master);
    this.carBus.connect(this.verbSend);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const noise = () => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      n.loopStart = Math.random();
      n.start();
      return n;
    };
    const filter = (type, f, q = 1) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const osc = (type, f) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.start();
      return o;
    };

    // Intake roar: the induction note you hear on full throttle.
    this.intakeF = filter('bandpass', 400, 1.4);
    this.intakeG = gain();
    noise().connect(this.intakeF).connect(this.intakeG).connect(this.carBus);

    // Turbo: a whistle from the compressor wheel plus a breathy whoosh of air.
    this.turboO1 = osc('sine', 2000);
    this.turboO2 = osc('sine', 3000);
    this.turboG = gain();
    const tO2g = gain(0.35);
    this.turboO1.connect(this.turboG);
    this.turboO2.connect(tO2g).connect(this.turboG);
    this.turboG.connect(this.carBus);
    this.whooshF = filter('bandpass', 3000, 2.5);
    this.whooshG = gain();
    noise().connect(this.whooshF).connect(this.whooshG).connect(this.carBus);

    // Supercharger: a rotor whine with a harmonic, plus the gear rattle of its drive.
    this.scO1 = osc('triangle', 600);
    this.scO2 = osc('sine', 1200);
    this.scO3 = osc('sawtooth', 600);
    this.scG = gain();
    const s2 = gain(0.45), s3 = gain(0.06);
    const scLp = filter('lowpass', 5000, 0.7);
    this.scO1.connect(this.scG);
    this.scO2.connect(s2).connect(this.scG);
    this.scO3.connect(s3).connect(this.scG);
    this.scG.connect(scLp).connect(this.carBus);

    // Straight-cut gearbox whine, very quiet.
    this.gearO = osc('triangle', 300);
    this.gearG = gain();
    this.gearO.connect(this.gearG).connect(this.carBus);

    // Tyres: a pitched squeal (three wobbling voices) over band-passed scrub noise.
    this.squeal = [osc('sawtooth', 720), osc('sawtooth', 760), osc('sawtooth', 690)];
    this.squealF = filter('bandpass', 900, 5);
    this.squealG = gain();
    this.squeal.forEach((o) => o.connect(this.squealF));
    this.squealF.connect(this.squealG).connect(this.carBus);
    this.tyreF = filter('bandpass', 1100, 3);
    this.tyreG = gain();
    noise().connect(this.tyreF).connect(this.tyreG).connect(this.carBus);

    // Rain bed and wet road hiss.
    this.rainG = gain(0.06 * this.amb.rain);
    noise().connect(filter('lowpass', 2600)).connect(filter('highpass', 400)).connect(this.rainG).connect(master);
    // Wind in the trees and the roar of falling water, both set by the world.
    this.windF = filter('lowpass', 420, 0.7);
    this.windG = gain(0);
    noise().connect(this.windF).connect(this.windG).connect(master);
    this.waterG = gain(0.16 * this.amb.water);
    noise().connect(filter('lowpass', 1800)).connect(filter('highpass', 120)).connect(this.waterG).connect(master);
    // Police siren: a sawtooth through a horn-like band-pass, wailing up and down.
    this.sirenO = osc('sawtooth', 700);
    this.sirenF = filter('bandpass', 1100, 1.2);
    this.sirenG = gain(0.05 * this.amb.siren);
    this.sirenO.connect(this.sirenF).connect(this.sirenG).connect(master);
    this.hissF = filter('bandpass', 3200, 0.8);
    this.hissG = gain();
    noise().connect(this.hissF).connect(this.hissG).connect(this.carBus);

    this.buildBank(this.engineType);
  }

  // Engine loops for the current car: 5 rpm points x on/off throttle, all playing, gains crossfaded.
  setEngine(type) {
    this.engineType = ENGINES[type] ? type : 'i6';
    if (this.ctx) this.buildBank(this.engineType);
  }

  buildBank(type) {
    const ctx = this.ctx, def = ENGINES[type];
    const t = ctx.currentTime;
    if (this.bank) {
      const old = this.bank;
      old.out.gain.setTargetAtTime(0, t, 0.08);
      setTimeout(() => old.voices.forEach((v) => { try { v.src.stop(); } catch { /* already stopped */ } }), 500);
    }
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, t, 0.1);
    out.connect(this.carBus);
    const voices = [];
    if (!this.buffers.has(type)) {
      const list = [];
      REFS.forEach((ref, i) => {
        for (const load of [1, 0]) {
          const data = renderEngineLoop(def, ref, load, ctx.sampleRate, i * 2 + load + 1);
          const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
          buf.copyToChannel(data, 0);
          list.push(buf);
        }
      });
      this.buffers.set(type, list);
    }
    const bufs = this.buffers.get(type);
    REFS.forEach((ref, i) => {
      for (const load of [1, 0]) {
        const buf = bufs[i * 2 + (load ? 0 : 1)];
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(out);
        src.start(t, Math.random() * buf.duration);
        voices.push({ src, g, ref, load });
      }
    });
    this.bank = { out, voices };
  }

  burst({ freq, type = 'lowpass', q = 1, gain, attack = 0.005, decay, delay = 0, sweepTo = 0, dest = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(dest || this.carBus);
    src.start(t, Math.random());
    src.stop(t + attack + decay + 0.05);
  }

  crash(strength) {
    this.burst({ freq: 240, gain: Math.min(1, 0.25 + strength * 0.06), decay: 0.45 });
    this.burst({ freq: 2400, type: 'bandpass', q: 2, gain: Math.min(0.5, strength * 0.03), decay: 0.25 });
    this.burst({ freq: 5200, type: 'highpass', q: 0.7, gain: Math.min(0.25, strength * 0.02), decay: 0.6, delay: 0.03 }); // glass and trim
  }

  // Exhaust pop: a sharp crack with a low thump behind it.
  pop(strength = 1) {
    const s = 0.7 + Math.random() * 0.6;
    this.burst({ freq: 140 * s, type: 'lowpass', gain: 0.55 * strength, attack: 0.001, decay: 0.08 });
    this.burst({ freq: 1800 * s, type: 'bandpass', q: 1.2, gain: 0.32 * strength, attack: 0.001, decay: 0.035 });
  }

  // Blow-off valve: a sharp hiss that falls in pitch, then the compressor flutters as it settles.
  blowOff(boost) {
    this.burst({ freq: 4200, sweepTo: 900, type: 'bandpass', q: 1.1, gain: 0.35 * boost, attack: 0.008, decay: 0.55 });
    for (let k = 0; k < 7; k++) {
      this.burst({ freq: 1500 - k * 90, type: 'bandpass', q: 3, gain: 0.12 * boost * (1 - k / 8), attack: 0.004, decay: 0.03, delay: 0.05 + k * 0.042 });
    }
  }

  thunder(delay) {
    this.burst({ freq: 110, gain: 0.8, attack: 0.25, decay: 3.5, delay, dest: this.master });
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  update(car, dt) {
    if (!this.ctx || !this.bank) return;
    const t = this.ctx.currentTime;
    const s = car.spec;
    const rpm = Math.max(500, car.rpm);
    const th = car.driveThrottle;

    // Engine bank: equal-power crossfade between the two loops either side of the rpm, and on/off load.
    const lr = Math.log(rpm);
    let i = 0;
    while (i < REFS.length - 2 && rpm > REFS[i + 1]) i++;
    const f = Math.min(1, Math.max(0, (lr - Math.log(REFS[i])) / (Math.log(REFS[i + 1]) - Math.log(REFS[i]))));
    const load = Math.min(1, th * 1.3 + (car.wheelspin > 0.5 ? 0.3 : 0));
    const level = 0.42 + 0.35 * load + 0.25 * (rpm / s.redline);
    for (const v of this.bank.voices) {
      const idx = REFS.indexOf(v.ref);
      const wr = idx === i ? Math.cos((f * Math.PI) / 2) : idx === i + 1 ? Math.sin((f * Math.PI) / 2) : 0;
      const wl = v.load ? Math.sqrt(load) : Math.sqrt(1 - load);
      v.g.gain.setTargetAtTime(wr * wl * level, t, 0.025);
      v.src.playbackRate.setTargetAtTime(rpm / v.ref, t, 0.012);
    }

    // Intake roar opens up with throttle.
    this.intakeF.frequency.setTargetAtTime(220 + rpm * 0.09, t, 0.04);
    this.intakeG.gain.setTargetAtTime(th * (0.03 + 0.06 * (rpm / s.redline)), t, 0.05);

    // Turbo: shaft speed follows boost; the whistle sits high and climbs as it spools.
    const tb = car.boost || 0;
    this.turboO1.frequency.setTargetAtTime(1900 + tb * 5200, t, 0.06);
    this.turboO2.frequency.setTargetAtTime((1900 + tb * 5200) * 1.52, t, 0.06);
    this.turboG.gain.setTargetAtTime(s.turboGain ? tb * tb * (0.022 + 0.03 * th) : 0, t, 0.06);
    this.whooshF.frequency.setTargetAtTime(1500 + tb * 3000, t, 0.08);
    this.whooshG.gain.setTargetAtTime(s.turboGain ? tb * 0.09 * th : 0, t, 0.08);
    if (car.bovEvent > 0) {
      this.blowOff(car.bovEvent);
      car.bovEvent = 0;
    }

    // Supercharger whine: rotor speed is tied to the crank by the belt, so it sings with every rev.
    const scf = rpm * 0.34;
    this.scO1.frequency.setTargetAtTime(scf, t, 0.015);
    this.scO2.frequency.setTargetAtTime(scf * 2, t, 0.015);
    this.scO3.frequency.setTargetAtTime(scf, t, 0.015);
    this.scG.gain.setTargetAtTime(s.scGain ? (0.012 + 0.05 * th) * (0.35 + 0.65 * smooth(900, s.redline, rpm)) : 0, t, 0.03);

    // Gearbox whine follows road speed.
    this.gearO.frequency.setTargetAtTime(Math.abs(car.omega || 0) * Math.abs(car.ratio || 3) * 4.2 + 40, t, 0.03);
    this.gearG.gain.setTargetAtTime(Math.min(1, car.speed / 30) * (0.004 + 0.008 * th), t, 0.05);

    // Tyres: squeal when the rears slide, scrub under it, wet hiss with speed.
    const slip = smooth(2, 10, car.rearSlip) * Math.min(1, car.speed / 6);
    const wob = Math.sin(t * 23) * 25 + Math.sin(t * 37) * 15;
    this.squeal.forEach((o, k) => o.frequency.setTargetAtTime(640 + k * 38 + slip * 160 + wob, t, 0.02));
    this.squealF.frequency.setTargetAtTime(820 + slip * 380, t, 0.04);
    this.squealG.gain.setTargetAtTime(slip * 0.05, t, 0.04);
    this.tyreF.frequency.setTargetAtTime(900 + slip * 500 + Math.random() * 80, t, 0.03);
    this.tyreG.gain.setTargetAtTime(slip * 0.13, t, 0.05);
    this.hissG.gain.setTargetAtTime(Math.min(1, car.speed / 40) * (0.012 + 0.038 * this.amb.wet), t, 0.1);
    // Wind gusts and the siren's wail.
    const gust = 0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1);
    this.windG.gain.setTargetAtTime(this.amb.wind * 0.05 * gust + Math.min(1, car.speed / 60) * 0.02, t, 0.3);
    this.windF.frequency.setTargetAtTime(300 + gust * 250 + car.speed * 6, t, 0.3);
    if (this.amb.siren > 0) {
      const wail = 0.5 + 0.5 * Math.sin(t * Math.PI * 0.8);
      this.sirenO.frequency.setTargetAtTime(640 + wail * 720, t, 0.02);
      this.sirenF.frequency.setTargetAtTime(900 + wail * 700, t, 0.02);
    }

    // Shifts: a clunk through the drivetrain.
    if (car.gear !== this.lastGear) {
      this.burst({ freq: 180, type: 'lowpass', gain: 0.18, attack: 0.002, decay: 0.07 });
      this.lastGear = car.gear;
    }
    // Overrun crackle: off throttle at high revs the exhaust spits and pops.
    if (th < 0.05 && rpm > 3800 && car.speed > 6) {
      this.crackle += dt * (rpm / s.redline) * 9;
      if (this.crackle > 1) {
        this.crackle = -Math.random() * 1.5;
        this.pop(0.35 + Math.random() * 0.4);
      }
    } else this.crackle = 0;
  }
}
