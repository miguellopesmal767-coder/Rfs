// ============================================================================
// audio.js — Áudio sintetizado (WebAudio): motor a pistão, turbofan,
// vento, chuva, alarme de estol, trovão. Posicional (pan/volume por câmera).
// ============================================================================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class SoundSystem {
  constructor() {
    this.enabled = true;
    this.ready = false;
    this.ctx = null;
  }

  init() {
    if (this.ready) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(ctx.destination);

      // -------- motor --------
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      this.engPan = ctx.createStereoPanner();
      this.engGain.connect(this.engPan).connect(this.master);

      if (true) { // criado por tipo no setEngineType
        this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
        this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
        this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass';
        const g1 = ctx.createGain(); g1.gain.value = 0.5;
        const g2 = ctx.createGain(); g2.gain.value = 0.22;
        this.osc1.connect(g1).connect(this.engFilter);
        this.osc2.connect(g2).connect(this.engFilter);
        this.engFilter.connect(this.engGain);
        this.osc1.start(); this.osc2.start();
      }

      // -------- jato (ruído filtrado + apito) --------
      const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      this.noiseBuf = noiseBuf;

      this.jetSrc = ctx.createBufferSource();
      this.jetSrc.buffer = noiseBuf; this.jetSrc.loop = true;
      this.jetFilter = ctx.createBiquadFilter(); this.jetFilter.type = 'bandpass';
      this.jetFilter.Q.value = 0.7;
      this.whine = ctx.createOscillator(); this.whine.type = 'sine'; this.whine.frequency.value = 2000;
      this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
      this.jetGain = ctx.createGain(); this.jetGain.gain.value = 0;
      this.jetPan = ctx.createStereoPanner();
      this.jetSrc.connect(this.jetFilter).connect(this.jetGain);
      this.whine.connect(this.whineGain).connect(this.jetGain);
      this.jetGain.connect(this.jetPan).connect(this.master);
      this.jetSrc.start(); this.whine.start();

      // -------- vento --------
      this.windSrc = ctx.createBufferSource();
      this.windSrc.buffer = noiseBuf; this.windSrc.loop = true;
      this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass';
      this.windFilter.frequency.value = 400;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
      this.windSrc.start();

      // -------- chuva --------
      this.rainSrc = ctx.createBufferSource();
      this.rainSrc.buffer = noiseBuf; this.rainSrc.loop = true;
      this.rainFilter = ctx.createBiquadFilter(); this.rainFilter.type = 'highpass';
      this.rainFilter.frequency.value = 2500;
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
      this.rainSrc.connect(this.rainFilter).connect(this.rainGain).connect(this.master);
      this.rainSrc.start();

      // -------- alarme de estol --------
      this.alarmGain = ctx.createGain(); this.alarmGain.gain.value = 0;
      this.alarmGain.connect(this.master);
      this.alarmOsc = null;
      this._alarmPhase = 0;

      this.ready = true;
    } catch (e) {
      console.warn('Audio indisponível', e);
    }
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.ready) this.master.gain.value = v ? 0.8 : 0;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  update(dt, st) {
    // st: {type, rpm, throttle, airspeedMS, rainAmt, stall, onGround, camDist, pan, cockpit, thunder}
    if (!this.ready) return;
    const T = this.ctx.currentTime;

    let distAtt = st.cockpit ? 1 : THREE_att(st.camDist);
    function THREE_att(d) { return 1 / (1 + d / 40); }

    // alarme de estol: bip intermitente
    if (st.stall) {
      this._alarmPhase += dt * 3.4;
      const on = (this._alarmPhase % 1) < 0.5;
      if (on && !this.alarmOsc) {
        this.alarmOsc = this.ctx.createOscillator();
        this.alarmOsc.type = 'square';
        this.alarmOsc.frequency.value = 880;
        this.alarmOsc.connect(this.alarmGain);
        this.alarmOsc.start();
      } else if (!on && this.alarmOsc) {
        this.alarmOsc.stop(); this.alarmOsc = null;
      }
      this.alarmGain.gain.setTargetAtTime(on ? 0.06 * distAtt : 0, T, 0.02);
    } else {
      if (this.alarmOsc) { this.alarmOsc.stop(); this.alarmOsc = null; }
      this.alarmGain.gain.setTargetAtTime(0, T, 0.05);
    }

    const r = st.rpm;
    if (st.type === 'prop') {
      const f = 38 + r * 74;
      this.osc1.frequency.setTargetAtTime(f, T, 0.05);
      this.osc2.frequency.setTargetAtTime(f * 0.503, T, 0.05);
      this.engFilter.frequency.setTargetAtTime(180 + r * 900, T, 0.05);
      this.engGain.gain.setTargetAtTime((0.05 + r * 0.22) * distAtt, T, 0.06);
      this.jetGain.gain.setTargetAtTime(0, T, 0.1);
      this.whineGain.gain.setTargetAtTime(0, T, 0.1);
    } else {
      this.jetFilter.frequency.setTargetAtTime(220 + r * 1500, T, 0.08);
      this.whine.frequency.setTargetAtTime(1400 + r * 3200, T, 0.08);
      this.whineGain.gain.setTargetAtTime((0.015 + r * 0.045) * distAtt, T, 0.08);
      this.jetGain.gain.setTargetAtTime((0.04 + r * 0.3) * distAtt, T, 0.08);
      this.engGain.gain.setTargetAtTime(0, T, 0.1);
    }

    const air = st.airspeedMS;
    this.windGain.gain.setTargetAtTime(Math.min(0.4, Math.pow(air / 120, 2) * 0.5) * (st.cockpit ? 1 : 0.7), T, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + air * 9, T, 0.1);

    this.rainGain.gain.setTargetAtTime(st.rainAmt * 0.12 * (st.cockpit ? 0.6 : 1), T, 0.4);

    // pan pela posição relativa da aeronave à câmera
    const pan = clamp(st.pan, -1, 1);
    this.engPan.pan.setTargetAtTime(st.cockpit ? 0 : pan, T, 0.1);
    this.jetPan.pan.setTargetAtTime(st.cockpit ? 0 : pan, T, 0.1);
  }

  thunder() {
    if (!this.ready) return;
    const ctx = this.ctx, T = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, T);
    g.gain.linearRampToValueAtTime(0.55, T + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, T + 2.8);
    src.connect(f).connect(g).connect(this.master);
    src.start(); src.stop(T + 3);
  }

  click() {
    if (!this.ready) return;
    const ctx = this.ctx, T = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, T);
    g.gain.exponentialRampToValueAtTime(0.001, T + 0.09);
    o.connect(g).connect(this.master);
    o.start(); o.stop(T + 0.1);
  }
}
