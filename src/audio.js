// Synthesised sound: engine, turbo, tyre squeal, rain and thunder. No audio files.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastThrottle = 0;
    this.boost = 0;
    this.voice = { pitch: 1.5, sub: 0.5, bright: 1 };
  }

  // Engine character per car: firing pitch per rev, square sub-octave weight and filter brightness.
  setVoice(voice) {
    this.voice = { ...this.voice, ...voice };
    if (this.subGain) this.subGain.gain.value = this.voice.sub;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const noise = () => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      n.start();
      return n;
    };

    // Engine: three detuned oscillators through soft clipping and a throttle-opened filter.
    this.engineOsc = [ctx.createOscillator(), ctx.createOscillator(), ctx.createOscillator()];
    const [o1, o2, o3] = this.engineOsc;
    o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sawtooth';
    const g2 = (this.subGain = ctx.createGain()); g2.gain.value = this.voice.sub;
    const g3 = ctx.createGain(); g3.gain.value = 0.18;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(x * 2.6); }
    shaper.curve = curve;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 3;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    o1.connect(shaper); o2.connect(g2).connect(shaper); o3.connect(g3).connect(shaper);
    shaper.connect(this.engineFilter).connect(this.engineGain).connect(master);
    this.engineOsc.forEach((o) => o.start());

    // Turbo whistle and blow-off.
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain).connect(master);
    this.turboOsc.start();

    // Tyres: band-passed noise.
    const tyre = noise();
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 1100;
    this.tyreFilter.Q.value = 6;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    tyre.connect(this.tyreFilter).connect(this.tyreGain).connect(master);

    // Rain bed.
    const rain = noise();
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 2600;
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 400;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.07;
    rain.connect(rainLp).connect(rainHp).connect(rainGain).connect(master);

    // Wet road hiss that rises with speed.
    const hiss = noise();
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 3200;
    this.hissFilter.Q.value = 0.8;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(this.hissFilter).connect(this.hissGain).connect(master);
  }

  burst({ freq, type = 'lowpass', q = 1, gain, attack = 0.005, decay, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + attack + decay + 0.05);
  }

  crash(strength) {
    this.burst({ freq: 260, gain: Math.min(1, 0.25 + strength * 0.06), decay: 0.45 });
    this.burst({ freq: 2400, type: 'bandpass', q: 2, gain: Math.min(0.5, strength * 0.03), decay: 0.25 });
  }

  pop() {
    this.burst({ freq: 180, type: 'lowpass', gain: 0.5, attack: 0.002, decay: 0.09 });
    this.burst({ freq: 1400, type: 'bandpass', q: 1.5, gain: 0.25, attack: 0.002, decay: 0.05 });
  }

  thunder(delay) {
    this.burst({ freq: 110, gain: 0.8, attack: 0.25, decay: 3.5, delay });
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  update(car, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = car.rpm;
    const f = (rpm / 60) * this.voice.pitch;
    this.engineOsc[0].frequency.setTargetAtTime(f, t, 0.02);
    this.engineOsc[1].frequency.setTargetAtTime(f * 0.5, t, 0.02);
    this.engineOsc[2].frequency.setTargetAtTime(f * 2.01, t, 0.02);
    const th = car.driveThrottle;
    this.engineFilter.frequency.setTargetAtTime((300 + th * 2400 + rpm * 0.25) * this.voice.bright, t, 0.04);
    this.engineGain.gain.setTargetAtTime(0.09 + th * 0.13, t, 0.05);

    this.boost += ((th > 0.5 && rpm > 3500 ? 1 : 0) - this.boost) * Math.min(1, dt * 1.6);
    this.turboOsc.frequency.setTargetAtTime(1800 + this.boost * 3200, t, 0.05);
    this.turboGain.gain.setTargetAtTime(this.boost * 0.018, t, 0.05);
    if (this.lastThrottle > 0.6 && th < 0.2 && this.boost > 0.6) {
      this.burst({ freq: 3000, type: 'bandpass', q: 1.2, gain: 0.22, attack: 0.01, decay: 0.35 });
      this.boost = 0;
    }
    this.lastThrottle = th;

    const slip = Math.max(0, Math.min(1, (car.rearSlip - 2.5) / 7)) * Math.min(1, car.speed / 6);
    this.tyreGain.gain.setTargetAtTime(slip * 0.16, t, 0.05);
    this.tyreFilter.frequency.setTargetAtTime(900 + slip * 500 + Math.random() * 80, t, 0.03);
    this.hissGain.gain.setTargetAtTime(Math.min(1, car.speed / 40) * 0.05, t, 0.1);
  }
}
