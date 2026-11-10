// Kassette – Klangerzeugung. Läuft im AudioWorklet (Echtzeit) und im Hauptthread (Mixdown).
// Keine Allokationen in den render-Pfaden.

export const ENGINE = { wave: 0, fm: 1, swarm: 2, pluck: 3, pulse: 4, bend: 5, drum: 6, sampler: 7 };
export const FX = { off: 0, delay: 1, space: 2, filter: 3, drive: 4, chorus: 5 };
export const SEQ = { off: 0, pattern: 1, arp: 2, euclid: 3 };

export const fmRatios = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 7, 9, 11];
const swarmOffsets = [-1, -0.62, -0.28, 0, 0.3, 0.6, 0.97];
const hatFreqs = [410.6, 608.8, 739.2, 1045.4, 1080, 1600];
const drumBaseLength = [1.4, 0.15, 0.6, 0.7, 1.2, 1.1, 0.25, 1.0, 1.2, 0.9, 4.0, 0.6];
const TWO_PI = Math.PI * 2;

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const noteToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
export const expMap = (x, lo, hi) => lo * Math.pow(hi / lo, clamp01(x));
const frac = (x) => x - Math.floor(x);
const wrapPhase = (x) => (x >= 1 ? x - Math.floor(x) : x);
export const quantize = (x, n) => Math.min(n - 1, Math.max(0, Math.floor(x * n)));
const onePoleCoef = (hz, sr) => 1 - Math.exp((-TWO_PI * hz) / sr);
const svfG = (hz, sr) => Math.tan((Math.PI * Math.min(Math.max(hz, 10), sr * 0.45)) / sr);

export const attackTime = (v) => 0.001 + v * v * 4;
export const decayTime = (v) => 0.005 + v * v * 6;
export const releaseTime = (v) => 0.005 + v * v * 8;
export const lfoRate = (v) => expMap(v, 0.05, 20);

function polyBlep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

export function triangle(t) {
  if (t < 0.25) return 4 * t;
  if (t < 0.75) return 2 - 4 * t;
  return 4 * t - 4;
}

// Morph Sinus → Dreieck → Sägezahn → Rechteck
function morphOsc(t, dt, m) {
  const pos = clamp01(m) * 3;
  if (pos <= 1) return lerp(Math.sin(TWO_PI * t), triangle(t), pos);
  const ts = frac(t + 0.5);
  const saw = 2 * ts - 1 - polyBlep(ts, dt);
  if (pos <= 2) return lerp(triangle(t), saw, pos - 1);
  let sq = t < 0.5 ? 1 : -1;
  sq += polyBlep(t, dt);
  sq -= polyBlep(frac(t + 0.5), dt);
  return lerp(saw, sq * 0.8, pos - 2);
}

class Random {
  constructor(seed) { this.s = seed >>> 0 || 1; }
  next() { // -1…1
    let s = this.s;
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    this.s = s;
    return (s / 4294967295) * 2 - 1;
  }
  unit() { return (this.next() + 1) * 0.5; }
}

class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
  reset() { this.ic1 = 0; this.ic2 = 0; }
  process(x, g, k) {
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = x - k * v1 - v2;
  }
}

// stage: 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
class ADSR {
  constructor() { this.stage = 0; this.level = 0; this.aInc = 0.01; this.dCoef = 0.999; this.sus = 0.7; this.rCoef = 0.999; }
  configure(env, sr) {
    this.aInc = 1 / (attackTime(env[0]) * sr);
    this.dCoef = Math.exp(-4.6 / (decayTime(env[1]) * sr));
    this.sus = env[2];
    this.rCoef = Math.exp(-4.6 / (releaseTime(env[3]) * sr));
  }
  gateOn() { this.stage = 1; }
  gateOff() { if (this.stage !== 0) this.stage = 4; }
  kill() { this.stage = 0; this.level = 0; }
  next() {
    switch (this.stage) {
      case 0: return 0;
      case 1:
        this.level += this.aInc;
        if (this.level >= 1) { this.level = 1; this.stage = 2; }
        break;
      case 2:
        this.level = this.sus + (this.level - this.sus) * this.dCoef;
        if (this.level - this.sus < 0.0005) { this.level = this.sus; this.stage = 3; }
        break;
      case 3: this.level = this.sus; break;
      default:
        this.level *= this.rCoef;
        if (this.level < 0.0002) { this.level = 0; this.stage = 0; }
    }
    return this.level;
  }
}

const KS_CAP = 4096;

class Voice {
  constructor(seed) {
    this.note = -1; this.velocity = 0; this.gate = false; this.age = 0;
    this.env = new ADSR(); this.isDrum = false;
    this.ph = new Float64Array(8);
    this.freq = 440; this.modPhase = 0; this.feedback = 0; this.modEnv = 1;
    this.tone = 0;
    this.rng = new Random(seed);
    this.ks = new Float32Array(KS_CAP); this.ksLen = 64; this.ksPos = 0;
    this.drumKind = 0; this.drumTime = 0; this.drumLength = 1; this.drumPhase = 0;
    this.svf = new SVF();
    this.samplePos = 0; this.sampleStart = 0;
  }
  get active() { return this.env.stage !== 0; }

  start(note, velocity, engine, p, sr, sampleCount) {
    const wasIdle = this.env.stage === 0;
    this.note = note; this.velocity = velocity; this.gate = true; this.age = 0;
    this.freq = noteToHz(note); this.modEnv = 1; this.feedback = 0;
    this.isDrum = engine === ENGINE.drum;
    if (wasIdle) {
      for (let k = 0; k < 8; k++) this.ph[k] = this.rng.unit();
      this.modPhase = 0;
    }
    if (engine === ENGINE.pluck) {
      const n = Math.max(2, Math.min(KS_CAP - 1, Math.floor(sr / this.freq - 0.5)));
      this.ksLen = n; this.ksPos = 0;
      let z = 0;
      const coef = 0.05 + p[0] * 0.95;
      for (let i = 0; i < n; i++) { z += coef * (this.rng.next() - z); this.ks[i] = z * velocity; }
    } else if (engine === ENGINE.drum) {
      this.drumKind = ((note % 12) + 12) % 12;
      this.drumTime = 0; this.drumPhase = 0; this.svf.reset();
      this.ph.fill(0);
      this.drumLength = drumBaseLength[this.drumKind] * expMap(p[1], 0.3, 3);
    } else if (engine === ENGINE.sampler) {
      this.sampleStart = p[0] * Math.max(0, sampleCount - 1);
      this.samplePos = this.sampleStart;
      this.tone = 0;
    }
    this.env.gateOn();
  }

  render(engine, p, sr, ctx) {
    if (this.isDrum) return this.drum(p, sr) * this.velocity;
    const e = this.env.next();
    if (this.env.stage === 0) return 0;
    return this.osc(engine, p, sr, ctx) * e * this.velocity;
  }

  osc(engine, p, sr, ctx) {
    const ph = this.ph;
    const f = this.freq * ctx.pitch;
    const dt = f / sr;
    switch (engine) {
      case ENGINE.wave: {
        const dt2 = dt * (1 + p[2] * 0.02);
        const o1 = morphOsc(ph[0], dt, p[0]);
        const o2 = morphOsc(ph[1], dt2, p[0]);
        const det = Math.min(1, p[2] * 4);
        let s = (o1 + o2 * det) / (1 + det);
        if (p[1] > 0.01) s = Math.sin(s * (1 + p[1] * 5) * 1.5707964);
        const sub = ph[2] < 0.5 ? 1 : -1;
        s = s * (1 - p[3] * 0.4) + sub * p[3] * 0.45;
        ph[0] = wrapPhase(ph[0] + dt); ph[1] = wrapPhase(ph[1] + dt2); ph[2] = wrapPhase(ph[2] + dt * 0.5);
        return s;
      }
      case ENGINE.fm: {
        const ratio = fmRatios[quantize(p[0], fmRatios.length)];
        const mod = Math.sin(TWO_PI * this.modPhase + this.feedback * p[2] * 2.5);
        this.feedback = mod;
        const index = p[1] * p[1] * 10 * this.modEnv;
        const s = Math.sin(TWO_PI * ph[0] + index * mod);
        this.modPhase = wrapPhase(this.modPhase + dt * ratio);
        ph[0] = wrapPhase(ph[0] + dt);
        this.modEnv *= ctx.fmDecay;
        return s;
      }
      case ENGINE.swarm: {
        let sum = 0;
        for (let k = 0; k < 7; k++) {
          const d = dt * (1 + swarmOffsets[k] * p[0] * 0.05);
          const t = ph[k];
          sum += (k === 3 ? 1 : p[1]) * (2 * t - 1 - polyBlep(t, d));
          ph[k] = wrapPhase(t + d);
        }
        sum *= 1 / Math.sqrt(1 + 6 * p[1] * p[1]);
        this.tone += ctx.swarmCoef * (sum - this.tone);
        const s = this.tone + Math.sin(TWO_PI * ph[7]) * p[3] * 0.6;
        ph[7] = wrapPhase(ph[7] + dt * 0.5);
        return s;
      }
      case ENGINE.pluck: {
        const n = this.ksLen, i0 = this.ksPos;
        const i1 = i0 + 1 >= n ? 0 : i0 + 1;
        const a = this.ks[i0], b = this.ks[i1];
        this.ks[i0] = ctx.ksFeedback * (a + (b - a) * ctx.ksBlend);
        this.ksPos = i1;
        let out = a * 1.4;
        if (p[3] > 0.01) out = Math.tanh(out * (1 + p[3] * 6)) * (1 - p[3] * 0.3);
        return out;
      }
      case ENGINE.pulse: {
        const lfo = Math.sin(TWO_PI * ph[3]);
        const w = clamp(0.5 - p[0] * 0.45 + lfo * p[1] * 0.4, 0.03, 0.97);
        const t = ph[0];
        let s = t < w ? 1 : -1;
        s += polyBlep(t, dt);
        s -= polyBlep(frac(t + 1 - w), dt);
        const sub = ph[1] < 0.5 ? 1 : -1;
        s = s * 0.7 + sub * p[2] * 0.5 + this.rng.next() * p[3] * 0.4;
        ph[0] = wrapPhase(t + dt); ph[1] = wrapPhase(ph[1] + dt * 0.5); ph[3] = wrapPhase(ph[3] + 0.7 / sr);
        return s;
      }
      case ENGINE.bend: {
        const t = ph[0];
        const amount = clamp(p[0] + p[3] * this.modEnv * 0.6, 0, 0.98);
        let s;
        const shape = quantize(p[1], 3);
        if (shape === 0) {
          const k = 0.5 - amount * 0.48;
          const q = t < k ? (0.5 * t) / k : 0.5 + (0.5 * (t - k)) / (1 - k);
          s = -Math.cos(TWO_PI * q);
        } else if (shape === 1) {
          const half = t < 0.5 ? t * 2 : (t - 0.5) * 2;
          const q = Math.min(1, half / Math.max(0.02, 1 - amount));
          s = Math.cos(Math.PI * q) * (t < 0.5 ? 1 : -1);
        } else {
          const r = 1 + amount * 12 + p[2] * 6;
          s = (1 - t) * Math.sin(TWO_PI * frac(t * r)) * 1.3;
        }
        this.modEnv *= ctx.bendDecay;
        ph[0] = wrapPhase(t + dt);
        return s;
      }
      case ENGINE.sampler: {
        const data = ctx.sample;
        if (!data || ctx.sampleCount <= 2) return 0;
        const last = ctx.sampleCount - 2;
        const end = Math.min(last, this.sampleStart + Math.max(256, p[1] * (last - this.sampleStart)));
        if (this.samplePos >= end || this.samplePos < 0) {
          if (p[2] > 0.5 && end - this.sampleStart > 16) this.samplePos = this.sampleStart;
          else { this.env.kill(); return 0; }
        }
        const i = Math.floor(this.samplePos);
        const fr = this.samplePos - i;
        const a = data[i], b = data[i + 1];
        this.samplePos += Math.pow(2, (this.note - 60) / 12) * ctx.pitch * ctx.sampleRatio;
        this.tone += ctx.samplerCoef * (a + (b - a) * fr - this.tone);
        return this.tone;
      }
    }
    return 0;
  }

  // 12 synthetische Drums pro Oktave
  drum(p, sr) {
    const t = this.drumTime;
    this.drumTime += 1 / sr;
    if (t > this.drumLength) { this.env.kill(); return 0; }
    const tune = Math.pow(2, (p[0] - 0.5) * 2);
    const dec = expMap(p[1], 0.3, 3);
    const tone = p[2], punch = p[3];
    const rng = this.rng, svf = this.svf, ph = this.ph;
    let out = 0;
    switch (this.drumKind) {
      case 0: { // Kick
        const f = 46 * tune + 240 * Math.exp(-t * (18 + punch * 50));
        this.drumPhase = wrapPhase(this.drumPhase + f / sr);
        out = Math.sin(TWO_PI * this.drumPhase) * Math.exp(-t / (0.3 * dec));
        out += rng.next() * Math.exp(-t * 300) * 0.25 * (0.3 + tone);
        out = Math.tanh(out * (1 + punch * 3));
        break;
      }
      case 1: { // Rim
        this.drumPhase = wrapPhase(this.drumPhase + (470 * tune) / sr);
        svf.process(rng.next(), svfG(3200 * tune, sr), 0.4);
        out = (Math.sin(TWO_PI * this.drumPhase) * 0.7 + svf.bp * (0.5 + tone)) * Math.exp((-t * 70) / dec);
        break;
      }
      case 2: { // Snare
        const f = 180 * tune * (1 + 0.4 * Math.exp(-t * 50));
        this.drumPhase = wrapPhase(this.drumPhase + f / sr);
        const body = Math.sin(TWO_PI * this.drumPhase) * Math.exp((-t * 20) / dec);
        svf.process(rng.next(), svfG(4500 * tune, sr), 1.0);
        const noise = (svf.hp * 0.6 + svf.bp * 0.6) * Math.exp((-t * 12) / dec);
        out = Math.tanh((body * (1 - tone * 0.5) + noise * (0.5 + tone)) * (1 + punch * 2));
        break;
      }
      case 3: { // Clap
        svf.process(rng.next(), svfG(1200 * tune, sr), 0.5);
        const n = svf.bp * 2.2;
        let e = Math.exp((-t * 8) / dec) * 0.7;
        for (let b = 0; b < 3; b++) { const tb = t - b * 0.0105; if (tb >= 0) e += Math.exp(-tb * 160); }
        out = Math.tanh(n * e * (0.8 + tone * 0.6) * (1 + punch));
        break;
      }
      case 4: case 5: case 7: { // Toms
        const base = this.drumKind === 4 ? 85 : this.drumKind === 5 ? 125 : 175;
        const f = base * tune * (1 + 0.7 * Math.exp(-t * 16));
        this.drumPhase = wrapPhase(this.drumPhase + f / sr);
        out = Math.sin(TWO_PI * this.drumPhase) * Math.exp((-t * 5) / dec);
        out += rng.next() * Math.exp(-t * 120) * 0.2 * tone;
        out = Math.tanh(out * (1 + punch * 2));
        break;
      }
      case 6: case 8: case 10: { // Hats & Becken
        let m = 0;
        for (let k = 0; k < 6; k++) {
          const x = wrapPhase(ph[k] + (hatFreqs[k] * tune) / sr);
          ph[k] = x;
          m += x < 0.5 ? 1 : -1;
        }
        const mix = m * 0.16 * (1.2 - tone) + rng.next() * (0.25 + tone * 0.5);
        svf.process(mix, svfG((this.drumKind === 10 ? 5500 : 7500) * tune, sr), 0.9);
        const len = this.drumKind === 6 ? 0.04 : this.drumKind === 8 ? 0.3 : 1.1;
        out = svf.hp * Math.exp(-t / (len * dec)) * 1.3;
        break;
      }
      case 9: { // Cowbell
        ph[0] = wrapPhase(ph[0] + (540 * tune) / sr);
        ph[1] = wrapPhase(ph[1] + (800 * tune) / sr);
        const sq = (ph[0] < 0.5 ? 1 : -1) + (ph[1] < 0.5 ? 1 : -1);
        svf.process(sq * 0.5, svfG(2600 * tune, sr), 0.7);
        out = svf.bp * (Math.exp(-t * 40) * 0.5 + Math.exp((-t * 7) / dec) * 0.5) * 1.6;
        break;
      }
      default: { // Zap
        const f = 110 * tune + 2600 * Math.exp(-t * (25 + tone * 60));
        this.drumPhase = wrapPhase(this.drumPhase + f / sr);
        out = Math.sin(TWO_PI * this.drumPhase) * Math.exp((-t * 9) / dec);
      }
    }
    return out;
  }
}

export const VOICES = 8;

export class Instrument {
  constructor(sr) {
    this.sr = sr;
    this.voices = [];
    for (let i = 0; i < VOICES; i++) this.voices.push(new Voice(0x9e3779b9 * (i + 1)));
    this.patch = { engine: 0, params: [0.5, 0.5, 0.5, 0.5], env: [0, 0.3, 0.7, 0.3], fx: 0, fxParams: [0.5, 0.5, 0.5, 0.5], lfo: [0.4, 0, 0, 0], volume: 0.8 };
    this.currentEngine = 0;
    this.rng = new Random(0xbeefcafe);
    this.lfoPhase = 0; this.lfoValue = 0; this.lfoHold = 0;
    this.sampleCap = Math.floor(sr) * 12;
    this.sample = new Float32Array(this.sampleCap);
    this.sampleCount = 0; this.sampleRate = sr;
    this.capturing = false; this.captureWrite = 0;
    this.drumHitClock = new Float64Array(12).fill(-1e9);
    this.activeVoices = 0; this.clock = 0;
    this.p = [0, 0, 0, 0];
    this.ctx = { pitch: 1, fmDecay: 1, bendDecay: 1, swarmCoef: 1, ksFeedback: 0.99, ksBlend: 0.5, samplerCoef: 1, sample: null, sampleCount: 0, sampleRatio: 1 };
    this.makeDefaultSample();
  }

  checkEngine() {
    if (this.patch.engine !== this.currentEngine) {
      for (const v of this.voices) v.env.kill();
      this.currentEngine = this.patch.engine;
    }
  }

  noteOn(note, velocity) {
    this.checkEngine();
    const engine = this.patch.engine, vs = this.voices;
    let chosen = null;
    if (engine === ENGINE.drum) {
      const kind = ((note % 12) + 12) % 12;
      this.drumHitClock[kind] = this.clock;
      if (kind === 6) for (const v of vs) if (v.active && v.isDrum && v.drumKind === 8) v.env.kill();
      for (const v of vs) if (v.active && v.isDrum && v.note === note) { chosen = v; break; }
    } else {
      for (const v of vs) if (v.active && v.note === note) { chosen = v; break; }
    }
    if (!chosen) for (const v of vs) if (!v.active) { chosen = v; break; }
    if (!chosen) { chosen = vs[0]; for (const v of vs) if (v.age > chosen.age) chosen = v; }
    chosen.env.configure(this.patch.env, this.sr);
    chosen.start(note, velocity, engine, this.patch.params, this.sr, this.sampleCount);
  }

  noteOff(note) {
    if (this.patch.engine === ENGINE.drum) return;
    for (const v of this.voices) if (v.gate && v.note === note) { v.gate = false; v.env.gateOff(); }
  }

  allNotesOff() { for (const v of this.voices) { v.gate = false; v.env.gateOff(); } }

  lfoShape(shape, t) {
    switch (shape) {
      case 0: return Math.sin(TWO_PI * t);
      case 1: return triangle(t);
      case 2: return 2 * t - 1;
      case 3: return t < 0.5 ? 1 : -1;
      default: return this.lfoHold;
    }
  }

  // Rendert n Samples (Mono) und liefert die LFO-Modulation für den Effekt.
  render(out, n) {
    this.checkEngine();
    const engine = this.currentEngine, patch = this.patch, lfo = patch.lfo, sr = this.sr;
    this.lfoPhase += (lfoRate(lfo[0]) * n) / sr;
    if (this.lfoPhase >= 1) { this.lfoPhase -= Math.floor(this.lfoPhase); this.lfoHold = this.rng.next(); }
    const lv = this.lfoShape(quantize(lfo[2], 5), this.lfoPhase);
    this.lfoValue = lv;
    const depth = lfo[1];
    const p = this.p, ctx = this.ctx;
    p[0] = patch.params[0]; p[1] = patch.params[1]; p[2] = patch.params[2]; p[3] = patch.params[3];
    let amp = 1, fxMod = 0;
    ctx.pitch = 1;
    const target = quantize(lfo[3], 8);
    if (target >= 1 && target <= 4) p[target - 1] = clamp01(p[target - 1] + lv * depth * 0.5);
    else if (target === 5) ctx.pitch = Math.pow(2, lv * depth * depth);
    else if (target === 6) amp = 1 - depth * 0.5 * (1 - lv);
    else if (target === 7) fxMod = lv * depth * 0.5;

    if (engine === ENGINE.fm) ctx.fmDecay = p[3] > 0.97 ? 1 : Math.exp(-1 / (sr * expMap(p[3], 0.02, 5)));
    else if (engine === ENGINE.bend) ctx.bendDecay = Math.exp(-1 / (sr * 0.35));
    else if (engine === ENGINE.swarm) ctx.swarmCoef = onePoleCoef(expMap(p[2], 300, 18000), sr);
    else if (engine === ENGINE.pluck) { ctx.ksFeedback = 0.97 + p[1] * 0.0299; ctx.ksBlend = 0.08 + p[2] * 0.42; }
    else if (engine === ENGINE.sampler) {
      ctx.samplerCoef = onePoleCoef(expMap(p[3], 200, 20000), sr);
      ctx.sample = this.sample; ctx.sampleCount = this.sampleCount; ctx.sampleRatio = this.sampleRate / sr;
    }

    for (let i = 0; i < n; i++) out[i] = 0;
    let count = 0;
    for (const v of this.voices) {
      if (!v.active) continue;
      count++;
      if (!v.isDrum) v.env.configure(patch.env, sr);
      for (let i = 0; i < n; i++) out[i] += v.render(engine, p, sr, ctx);
      v.age += n;
    }
    this.activeVoices = count;
    const gain = patch.volume * patch.volume * amp * 0.5;
    for (let i = 0; i < n; i++) out[i] *= gain;
    return fxMod;
  }

  // Sampler
  beginCapture() { this.sampleCount = 0; this.captureWrite = 0; this.sampleRate = this.sr; this.capturing = true; }
  capture(src, n) {
    if (!this.capturing) return;
    const m = Math.min(this.sampleCap - this.captureWrite, n);
    if (m <= 0) { this.endCapture(); return; }
    for (let i = 0; i < m; i++) this.sample[this.captureWrite + i] = src[i];
    this.captureWrite += m;
  }
  endCapture() { if (!this.capturing) return; this.capturing = false; this.finishSample(this.captureWrite); }
  loadSample(src, start, count) {
    this.sampleCount = 0;
    const n = Math.min(count, this.sampleCap);
    this.sample.set(src.subarray(start, start + n));
    this.sampleRate = this.sr;
    this.finishSample(n);
  }
  finishSample(n) {
    const s = this.sample;
    if (n <= 16) { this.sampleCount = 0; return; }
    let peak = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(s[i]); if (a > peak) peak = a; }
    if (peak <= 0.0001) { this.sampleCount = 0; return; }
    let first = 0;
    while (first < n - 1 && Math.abs(s[first]) < peak * 0.03) first++;
    const length = n - first;
    if (first > 0) s.copyWithin(0, first, n);
    const gain = 0.9 / peak;
    for (let i = 0; i < length; i++) s[i] *= gain;
    const fade = Math.min(length, 256);
    for (let i = 0; i < fade; i++) s[length - 1 - i] *= i / fade;
    this.sampleCount = length;
  }
  makeDefaultSample() { // synthetisches "Aah"
    const sr = this.sr, length = Math.floor(sr * 1.6), f0 = 261.6256;
    const formant = (f, c, bw) => { const x = (f - c) / bw; return 1 / (1 + x * x); };
    const w = [];
    for (let h = 1; h <= 24; h++) { const fh = f0 * h; w.push(formant(fh, 730, 90) + 0.6 * formant(fh, 1090, 110) + 0.3 * formant(fh, 2440, 160)); }
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      let s = 0;
      for (let h = 1; h <= 24; h++) s += Math.sin(TWO_PI * f0 * h * t) * w[h - 1];
      this.sample[i] = s * Math.min(1, t / 0.06) * Math.exp(-t * 1.2);
    }
    this.finishSample(length);
  }
}

class Comb {
  constructor(size) { this.buf = new Float32Array(Math.max(1, size)); this.i = 0; this.store = 0; }
  process(x, fb, damp) {
    const out = this.buf[this.i];
    this.store = out * (1 - damp) + this.store * damp;
    this.buf[this.i] = x + this.store * fb;
    if (++this.i >= this.buf.length) this.i = 0;
    return out;
  }
  clear() { this.buf.fill(0); this.store = 0; }
}

class Allpass {
  constructor(size) { this.buf = new Float32Array(Math.max(1, size)); this.i = 0; }
  process(x) {
    const b = this.buf[this.i];
    this.buf[this.i] = x + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return b - x;
  }
  clear() { this.buf.fill(0); }
}

const CHORUS_CAP = 8192;

// Ein Mono-Effektslot: Delay, Hall, Filter, Drive oder Chorus.
export class FXUnit {
  constructor(sr, spread = 0) {
    this.sr = sr; this.last = 0;
    const scale = sr / 44100;
    this.combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((s) => new Comb(Math.floor((s + spread) * scale)));
    this.allpasses = [556, 441, 341, 225].map((s) => new Allpass(Math.floor((s + spread) * scale)));
    this.delay = new Float32Array(Math.floor(sr * 1.5) + 8); this.dW = 0; this.dTime = 0; this.dTone = 0;
    this.pre = new Float32Array(Math.floor(sr * 0.25) + 2); this.pW = 0;
    this.svf = new SVF();
    this.chorus = new Float32Array(CHORUS_CAP); this.cW = 0; this.cPhase = 0;
    this.hold = 0; this.holdCount = 0;
  }
  reset() {
    this.delay.fill(0); this.pre.fill(0); this.chorus.fill(0);
    for (const c of this.combs) c.clear();
    for (const a of this.allpasses) a.clear();
    this.svf.reset(); this.dTone = 0; this.dTime = 0; this.hold = 0; this.holdCount = 0;
  }
  process(buf, n, kind, p, p0) {
    if (kind !== this.last) { this.reset(); this.last = kind; }
    const sr = this.sr;
    const a = p0 === undefined ? p[0] : p0, b = p[1], c = p[2], d = p[3];
    switch (kind) {
      case FX.delay: {
        const target = expMap(a, 0.03, 1.4) * sr;
        if (this.dTime <= 0) this.dTime = target;
        const fb = b * 0.92, coef = onePoleCoef(expMap(d, 500, 16000), sr);
        const dl = this.delay, cap = dl.length;
        for (let i = 0; i < n; i++) {
          this.dTime += (target - this.dTime) * 0.0007;
          let rp = this.dW - this.dTime;
          if (rp < 0) rp += cap;
          let i0 = Math.floor(rp);
          const fr = rp - i0;
          if (i0 >= cap) i0 -= cap;
          const i1 = i0 + 1 >= cap ? 0 : i0 + 1;
          const y = dl[i0] + (dl[i1] - dl[i0]) * fr;
          const x = buf[i];
          this.dTone += coef * (y - this.dTone);
          dl[this.dW] = x + Math.tanh(this.dTone * fb);
          if (++this.dW >= cap) this.dW = 0;
          buf[i] = x + y * c;
        }
        break;
      }
      case FX.space: {
        const fb = 0.7 + a * 0.28, damp = b * 0.7;
        const pre = this.pre, cap = pre.length;
        const pd = Math.min(cap - 1, Math.floor(d * 0.2 * sr));
        const combs = this.combs, aps = this.allpasses;
        for (let i = 0; i < n; i++) {
          const x = buf[i];
          pre[this.pW] = x;
          let rp = this.pW - pd;
          if (rp < 0) rp += cap;
          const input = pre[rp] * 0.015;
          if (++this.pW >= cap) this.pW = 0;
          let acc = 0;
          for (let k = 0; k < 8; k++) acc += combs[k].process(input, fb, damp);
          for (let k = 0; k < 4; k++) acc = aps[k].process(acc);
          buf[i] = x * (1 - c * 0.5) + acc * 3 * c;
        }
        break;
      }
      case FX.filter: {
        const g = svfG(expMap(a, 40, 18000), sr), k = 2 - b * 1.92;
        const drive = 1 + d * 5, makeup = 1 / Math.sqrt(drive), svf = this.svf;
        for (let i = 0; i < n; i++) {
          const x = d > 0.01 ? Math.tanh(buf[i] * drive) * makeup : buf[i];
          svf.process(x, g, k);
          buf[i] = c < 0.5 ? lerp(svf.lp, svf.bp, c * 2) : lerp(svf.bp, svf.hp, (c - 0.5) * 2);
        }
        break;
      }
      case FX.drive: {
        const gain = 1 + a * a * 30, levels = Math.pow(2, 15 - b * 14);
        const holdLen = 1 + c * c * 40, makeup = 1 / (1 + a * 1.5);
        for (let i = 0; i < n; i++) {
          const x = buf[i];
          let y = Math.tanh(x * gain);
          if (b > 0.01) y = Math.round(y * levels) / levels;
          if (c > 0.01) {
            if (++this.holdCount >= holdLen) { this.holdCount -= holdLen; this.hold = y; }
            y = this.hold;
          }
          buf[i] = lerp(x, y * makeup, d);
        }
        break;
      }
      case FX.chorus: {
        const inc = expMap(a, 0.05, 6) / sr, depthMs = 0.3 + b * 7, fb = d * 0.7;
        const ms = sr / 1000, mask = CHORUS_CAP - 1, ch = this.chorus;
        for (let i = 0; i < n; i++) {
          this.cPhase = wrapPhase(this.cPhase + inc);
          const mod = (Math.sin(TWO_PI * this.cPhase) + 1) * 0.5;
          let rp = this.cW - (8 + depthMs * mod) * ms;
          if (rp < 0) rp += CHORUS_CAP;
          const fl = Math.floor(rp), fr = rp - fl;
          const i0 = fl & mask, i1 = (i0 + 1) & mask;
          const y = ch[i0] + (ch[i1] - ch[i0]) * fr;
          const x = buf[i];
          ch[this.cW] = x + y * fb;
          this.cW = (this.cW + 1) & mask;
          buf[i] = x * (1 - c * 0.4) + y * c * 0.8;
        }
        break;
      }
    }
  }
}

export const TAPE_SECONDS = 120;
export const OV_SHIFT = 10;

// 4-Spur-Band mit Varispeed, Rückwärtslauf, Loop, Overdub, Lift/Drop und Undo.
export class Tape {
  constructor(sr) {
    this.sr = sr;
    this.length = Math.floor(sr) * TAPE_SECONDS;
    this.tracks = [0, 1, 2, 3].map(() => new Float32Array(this.length));
    this.ovCount = (this.length >> OV_SHIFT) + 1;
    this.ov = [0, 1, 2, 3].map(() => new Float32Array(this.ovCount));
    this.undoBuf = null; this.undoTrack = -1;
    this.playhead = 0; this.speed = 0; this.targetSpeed = 1;
    this.running = false; this.recording = false; this.armed = 0;
    this.loopOn = false; this.loopStart = 0; this.loopEnd = 0; this.recordedEnd = 0;
    this.clip = null; this.lastWrite = -1;
    this.speedCoef = 1 - Math.exp(-1 / (0.09 * sr));
    this.o = new Float32Array(4);
  }
  get hasLoop() { return this.loopEnd > this.loopStart + 256; }

  // Ein Sample-Schritt; Ergebnis steht in this.o[0..3].
  tick(input) {
    const o = this.o;
    this.speed += ((this.running ? this.targetSpeed : 0) - this.speed) * this.speedCoef;
    if (!this.running && Math.abs(this.speed) < 0.0005) { this.speed = 0; o[0] = o[1] = o[2] = o[3] = 0; return; }
    const i = Math.floor(this.playhead);
    if (i >= 0 && i < this.length - 1) {
      const f = this.playhead - i, tr = this.tracks;
      o[0] = tr[0][i] + (tr[0][i + 1] - tr[0][i]) * f;
      o[1] = tr[1][i] + (tr[1][i + 1] - tr[1][i]) * f;
      o[2] = tr[2][i] + (tr[2][i + 1] - tr[2][i]) * f;
      o[3] = tr[3][i] + (tr[3][i + 1] - tr[3][i]) * f;
      if (this.recording && this.running && i !== this.lastWrite) {
        this.lastWrite = i;
        const d = tr[this.armed];
        const v = clamp(d[i] + input, -4, 4);
        d[i] = v;
        const b = i >> OV_SHIFT, a = Math.abs(v), ov = this.ov[this.armed];
        if (a > ov[b]) ov[b] = a;
        if (i > this.recordedEnd) this.recordedEnd = i;
      }
    } else { o[0] = o[1] = o[2] = o[3] = 0; }
    this.playhead += this.speed;
    if (this.loopOn && this.hasLoop) {
      const len = this.loopEnd - this.loopStart;
      if (this.speed > 0 && this.playhead >= this.loopEnd) this.playhead -= len;
      if (this.speed < 0 && this.playhead < this.loopStart) this.playhead += len;
    }
    if (this.playhead < 0) this.playhead = 0;
    if (this.playhead >= this.length - 2) { this.playhead = this.length - 2; this.running = false; this.recording = false; }
  }

  snapshot(t) {
    if (!this.undoBuf) this.undoBuf = new Float32Array(this.length);
    this.undoBuf.set(this.tracks[t]);
    this.undoTrack = t;
  }
  undo() {
    if (this.undoTrack < 0) return false;
    this.tracks[this.undoTrack].set(this.undoBuf);
    this.rebuildOverview(this.undoTrack);
    this.undoTrack = -1;
    return true;
  }
  lift() {
    if (!this.hasLoop) return false;
    this.snapshot(this.armed);
    this.clip = this.tracks[this.armed].slice(this.loopStart, this.loopEnd);
    this.tracks[this.armed].fill(0, this.loopStart, this.loopEnd);
    this.rebuildOverview(this.armed, this.loopStart, this.loopEnd);
    return true;
  }
  drop() {
    if (!this.clip || !this.clip.length) return false;
    const start = Math.floor(this.playhead);
    const n = Math.min(this.clip.length, this.length - 2 - start);
    if (n <= 0) return false;
    this.snapshot(this.armed);
    const d = this.tracks[this.armed];
    for (let i = 0; i < n; i++) d[start + i] += this.clip[i];
    this.recordedEnd = Math.max(this.recordedEnd, start + n);
    this.rebuildOverview(this.armed, start, start + n);
    return true;
  }
  clear(t) { this.snapshot(t); this.tracks[t].fill(0); this.ov[t].fill(0); }
  rebuildOverview(t, from = 0, to = this.length) {
    const end = Math.min(this.length, to), d = this.tracks[t], block = 1 << OV_SHIFT;
    for (let b = Math.max(0, from) >> OV_SHIFT; b < this.ovCount && b * block < end; b++) {
      const e = Math.min(this.length, b * block + block);
      let m = 0;
      for (let i = b * block; i < e; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
      this.ov[t][b] = m;
    }
  }
  recomputeEnd() {
    let end = 0;
    for (let t = 0; t < 4; t++) {
      let b = this.ovCount - 1;
      while (b > 0 && this.ov[t][b] < 0.0001) b--;
      if (b > 0 || this.ov[t][0] >= 0.0001) end = Math.max(end, Math.min(this.length - 1, (b + 1) << OV_SHIFT));
    }
    this.recordedEnd = end;
  }
}

export const RATE_MULT = [4, 2, 1, 0.5];
const OFF_SLOTS = 32;

// Pattern (16 Steps), Arpeggiator, euklidischer Rhythmus.
export class Sequencer {
  constructor(sr) {
    this.sr = sr;
    this.kind = 0; this.bpm = 110; this.swing = 0;
    this.steps = new Int16Array(16).fill(-1);
    this.length = 16; this.gate = 0.5; this.transpose = 0; this.cursor = 0; this.stepInput = false;
    this.arpRate = 2; this.arpMode = 0; this.arpOctaves = 1;
    this.euclidSteps = 16; this.euclidPulses = 5; this.euclidRotate = 0; this.euclidRate = 2;
    this.latch = false; this.transportRunning = false;
    this.held = new Int16Array(16); this.heldCount = 0; this.physicalDown = 0;
    this.sorted = new Int16Array(16);
    this.counter = 0; this.tick = 0; this.position = 0; this.playingStep = -1; this.arpIndex = 0; this.wasActive = false;
    this.offNote = new Int16Array(OFF_SLOTS).fill(-1);
    this.offTime = new Float64Array(OFF_SLOTS);
    this.rng = new Random(0xc0ffee11);
  }
  stepLength(rate) { return (60 / Math.max(20, this.bpm) / 4) * this.sr * RATE_MULT[clamp(rate, 0, 3)]; }

  press(note) {
    if (this.latch && this.physicalDown === 0) this.heldCount = 0;
    this.physicalDown++;
    for (let k = 0; k < this.heldCount; k++) if (this.held[k] === note) return;
    if (this.heldCount < 16) this.held[this.heldCount++] = note;
  }
  release(note) {
    this.physicalDown = Math.max(0, this.physicalDown - 1);
    if (this.latch) return;
    let k = 0;
    while (k < this.heldCount) {
      if (this.held[k] === note) { for (let j = k; j < this.heldCount - 1; j++) this.held[j] = this.held[j + 1]; this.heldCount--; }
      else k++;
    }
  }
  clearHeld() { this.heldCount = 0; this.physicalDown = 0; }
  writeStep(note) {
    const len = clamp(this.length, 1, 16), c = clamp(this.cursor, 0, len - 1);
    this.steps[c] = note;
    this.cursor = (c + 1) % len;
  }
  start() { this.transportRunning = true; this.counter = 0; this.position = 0; this.tick = 0; }
  stop(inst) {
    this.transportRunning = false; this.playingStep = -1;
    for (let k = 0; k < OFF_SLOTS; k++) if (this.offNote[k] >= 0) { inst.noteOff(this.offNote[k]); this.offNote[k] = -1; }
  }

  process(n, inst) {
    for (let k = 0; k < OFF_SLOTS; k++) {
      if (this.offNote[k] < 0) continue;
      this.offTime[k] -= n;
      if (this.offTime[k] <= 0) { inst.noteOff(this.offNote[k]); this.offNote[k] = -1; }
    }
    const kind = this.kind;
    const active = kind === SEQ.pattern ? this.transportRunning : kind === SEQ.off ? false : this.heldCount > 0;
    if (!active) {
      if (this.wasActive) { this.wasActive = false; this.playingStep = -1; }
      this.counter = 0;
      return;
    }
    if (!this.wasActive) {
      this.wasActive = true; this.counter = 0;
      if (kind !== SEQ.pattern) { this.position = 0; this.arpIndex = 0; this.tick = 0; }
    }
    this.counter -= n;
    let guard = 0;
    while (this.counter <= 0 && guard++ < 8) {
      let len = this.stepLength(kind === SEQ.arp ? this.arpRate : kind === SEQ.euclid ? this.euclidRate : 2);
      this.fire(inst, len);
      if (this.swing > 0) len *= this.tick % 2 === 0 ? 1 + this.swing * 0.5 : 1 - this.swing * 0.5;
      this.tick++;
      this.counter += len;
    }
  }

  fire(inst, len) {
    const dur = len * (0.05 + this.gate * 0.9);
    if (this.kind === SEQ.pattern) {
      const count = clamp(this.length, 1, 16), pos = this.position % count;
      this.playingStep = pos;
      const note = this.steps[pos];
      if (note >= 0) this.trigger(inst, note + this.transpose, dur);
      this.position = (pos + 1) % count;
    } else if (this.kind === SEQ.arp) {
      const hc = this.heldCount;
      if (hc <= 0) return;
      this.sortHeld();
      const total = hc * clamp(this.arpOctaves, 1, 3);
      let idx;
      switch (this.arpMode) {
        case 1: idx = total - 1 - (this.arpIndex % total); break;
        case 2: { const period = Math.max(1, total * 2 - 2), m = this.arpIndex % period; idx = m < total ? m : period - m; break; }
        case 3: idx = Math.min(total - 1, Math.floor(this.rng.unit() * total)); break;
        default: idx = this.arpIndex % total;
      }
      idx = clamp(idx, 0, total - 1);
      const base = this.arpMode === 4 ? this.held[idx % hc] : this.sorted[idx % hc];
      this.playingStep = idx;
      this.arpIndex++;
      this.trigger(inst, base + 12 * Math.floor(idx / hc), dur);
    } else if (this.kind === SEQ.euclid) {
      const count = clamp(this.euclidSteps, 1, 32), pulses = clamp(this.euclidPulses, 0, count);
      const pos = this.position % count;
      this.playingStep = pos;
      if (euclidHit(pos, count, pulses, this.euclidRotate)) for (let k = 0; k < this.heldCount; k++) this.trigger(inst, this.held[k], dur);
      this.position = (pos + 1) % count;
    }
  }

  trigger(inst, note, duration) {
    const n = clamp(note, 0, 127);
    for (let k = 0; k < OFF_SLOTS; k++) if (this.offNote[k] === n) { inst.noteOff(n); this.offNote[k] = -1; }
    inst.noteOn(n, 0.85);
    for (let k = 0; k < OFF_SLOTS; k++) if (this.offNote[k] < 0) { this.offNote[k] = n; this.offTime[k] = Math.max(64, duration); return; }
  }

  sortHeld() {
    const s = this.sorted, hc = this.heldCount;
    for (let k = 0; k < hc; k++) s[k] = this.held[k];
    for (let i = 1; i < hc; i++) {
      const v = s[i];
      let j = i - 1;
      while (j >= 0 && s[j] > v) { s[j + 1] = s[j]; j--; }
      s[j + 1] = v;
    }
  }
}

export function euclidHit(i, n, k, rotate) {
  if (k <= 0 || n <= 0) return false;
  const j = (((i + rotate) % n) + n) % n;
  return (j * k) % n < k;
}

export function mixGains(m) {
  const gl = [0, 0, 0, 0], gr = [0, 0, 0, 0];
  for (let t = 0; t < 4; t++) {
    const lv = m.levels[t] * m.levels[t] * (m.mutes[t] ? 0 : 1);
    const a = clamp01(m.pans[t]) * Math.PI * 0.5;
    gl[t] = Math.cos(a) * lv * 1.414;
    gr[t] = Math.sin(a) * lv * 1.414;
  }
  return [gl, gr];
}

const BLOCK = 32;
export const SCOPE = 1024;

// Signalfluss: Instrument → Effekt → (Live + 4 Bandspuren) → Mixer → Master-Effekt → Limiter.
export class Studio {
  constructor(sr) {
    this.sr = sr;
    this.instrument = new Instrument(sr);
    this.fx = new FXUnit(sr);
    this.tape = new Tape(sr);
    this.seq = new Sequencer(sr);
    this.masterL = new FXUnit(sr, 0);
    this.masterR = new FXUnit(sr, 23);
    this.mixer = { levels: [0.8, 0.8, 0.8, 0.8], pans: [0.5, 0.5, 0.5, 0.5], mutes: [false, false, false, false], live: 0.9, masterVolume: 0.8, masterFX: FX.space, masterFXParams: [0.5, 0.4, 0.15, 0.1] };
    this.metronomeOn = false; this.metronomeLevel = 0.5;
    this.trackPeaks = new Float32Array(4); this.livePeak = 0; this.outPeak = 0;
    this.clock = 0; this.transportRunning = false; this.beatIndex = 0;
    this.scope = new Float32Array(SCOPE); this.scopeW = 0;
    this.mono = new Float32Array(BLOCK);
    this.bufL = new Float32Array(BLOCK); this.bufR = new Float32Array(BLOCK);
    this.beatCounter = 0; this.clickEnv = 0; this.clickPhase = 0; this.clickFreq = 1000;
  }

  noteOn(n, v) {
    const seq = this.seq;
    if (seq.kind === SEQ.arp || seq.kind === SEQ.euclid) seq.press(n);
    else if (seq.kind === SEQ.pattern) {
      if (seq.transportRunning) seq.transpose = n - 60;
      else { this.instrument.noteOn(n, v); if (seq.stepInput) seq.writeStep(n); }
    } else this.instrument.noteOn(n, v);
  }
  noteOff(n) {
    if (this.seq.kind === SEQ.arp || this.seq.kind === SEQ.euclid) this.seq.release(n);
    else this.instrument.noteOff(n);
  }
  allOff() { this.instrument.allNotesOff(); this.seq.clearHeld(); }
  play() { this.transportRunning = true; this.tape.running = true; this.seq.start(); this.beatCounter = 0; this.beatIndex = 0; }
  stop() { this.transportRunning = false; this.tape.running = false; this.tape.recording = false; this.seq.stop(this.instrument); }
  setRecording(on) {
    if (on && !this.tape.recording) this.tape.snapshot(this.tape.armed);
    this.tape.recording = on;
  }
  sampleFromTape() {
    const tape = this.tape;
    let start = Math.floor(tape.playhead), end = start + Math.floor(this.sr * 3);
    if (tape.loopOn && tape.hasLoop) { start = tape.loopStart; end = tape.loopEnd; }
    end = Math.min(end, tape.length - 1);
    if (end - start <= 256) return false;
    this.instrument.loadSample(tape.tracks[tape.armed], start, end - start);
    return this.instrument.sampleCount > 0;
  }

  render(left, right, frames) {
    let offset = 0;
    while (offset < frames) {
      const n = Math.min(BLOCK, frames - offset);
      this.renderBlock(left, right, offset, n);
      offset += n;
    }
  }

  renderBlock(left, right, offset, n) {
    const inst = this.instrument, tape = this.tape, mono = this.mono, l = this.bufL, r = this.bufR, m = this.mixer, sr = this.sr;
    inst.clock = this.clock;
    this.seq.process(n, inst);
    const fxMod = inst.render(mono, n);
    this.fx.process(mono, n, inst.patch.fx, inst.patch.fxParams, clamp01(inst.patch.fxParams[0] + fxMod));

    const [gl, gr] = this._gains(m);
    const live = m.live * m.live, o = tape.o, pk = this.trackPeaks, scope = this.scope;
    let lp = this.livePeak, sw = this.scopeW;
    for (let i = 0; i < n; i++) {
      const x = mono[i];
      tape.tick(x);
      l[i] = x * live + o[0] * gl[0] + o[1] * gl[1] + o[2] * gl[2] + o[3] * gl[3];
      r[i] = x * live + o[0] * gr[0] + o[1] * gr[1] + o[2] * gr[2] + o[3] * gr[3];
      for (let t = 0; t < 4; t++) { const a = Math.abs(o[t]), d = pk[t] * 0.9997; pk[t] = a > d ? a : d; }
      const ax = Math.abs(x); lp = lp * 0.9997; if (ax > lp) lp = ax;
      scope[sw] = x; sw = (sw + 1) & (SCOPE - 1);
    }
    this.livePeak = lp; this.scopeW = sw;

    this.masterL.process(l, n, m.masterFX, m.masterFXParams);
    this.masterR.process(r, n, m.masterFX, m.masterFXParams);

    const vol = m.masterVolume * m.masterVolume * 1.4;
    const beatLen = (60 / Math.max(20, this.seq.bpm)) * sr;
    const click = this.metronomeOn ? this.metronomeLevel * 0.45 : 0;
    let op = this.outPeak;
    for (let i = 0; i < n; i++) {
      let a = Math.tanh(l[i] * vol), b = Math.tanh(r[i] * vol);
      if (this.transportRunning) {
        this.beatCounter -= 1;
        if (this.beatCounter <= 0) {
          this.beatCounter += beatLen; this.clickEnv = 1; this.clickPhase = 0;
          this.clickFreq = this.beatIndex % 4 === 0 ? 1760 : 1180;
          this.beatIndex++;
        }
      }
      if (this.clickEnv > 0.001) {
        this.clickPhase = wrapPhase(this.clickPhase + this.clickFreq / sr);
        const c = Math.sin(TWO_PI * this.clickPhase) * this.clickEnv * click;
        a += c; b += c;
        this.clickEnv *= 0.9985;
      }
      left[offset + i] = a; right[offset + i] = b;
      op *= 0.9998; const mx = Math.max(Math.abs(a), Math.abs(b)); if (mx > op) op = mx;
    }
    this.outPeak = op;
    this.clock += n;
  }

  _gains(m) {
    if (!this._gl) { this._gl = [0, 0, 0, 0]; this._gr = [0, 0, 0, 0]; this._g = [this._gl, this._gr]; }
    for (let t = 0; t < 4; t++) {
      const lv = m.levels[t] * m.levels[t] * (m.mutes[t] ? 0 : 1);
      const a = clamp01(m.pans[t]) * Math.PI * 0.5;
      this._gl[t] = Math.cos(a) * lv * 1.414;
      this._gr[t] = Math.sin(a) * lv * 1.414;
    }
    return this._g;
  }
}

// Mixdown des Bandes zu 16-Bit-Stereo (läuft im Hauptthread, in Häppchen).
export async function bounce(tracks, recordedEnd, sr, mixer, onProgress) {
  const frames = Math.min(tracks[0].length, recordedEnd + Math.floor(sr * 2));
  const pcm = new Int16Array(Math.max(0, frames) * 2);
  if (frames <= 0) return pcm;
  const fl = new FXUnit(sr, 0), fr = new FXUnit(sr, 23);
  const [gl, gr] = mixGains(mixer);
  const vol = mixer.masterVolume * mixer.masterVolume * 1.4;
  const block = 1024, bl = new Float32Array(block), br = new Float32Array(block);
  let pos = 0, blocks = 0;
  while (pos < frames) {
    const n = Math.min(block, frames - pos);
    for (let i = 0; i < n; i++) {
      let a = 0, b = 0;
      for (let t = 0; t < 4; t++) { const s = pos + i < tracks[t].length ? tracks[t][pos + i] : 0; a += s * gl[t]; b += s * gr[t]; }
      bl[i] = a; br[i] = b;
    }
    fl.process(bl, n, mixer.masterFX, mixer.masterFXParams);
    fr.process(br, n, mixer.masterFX, mixer.masterFXParams);
    for (let i = 0; i < n; i++) {
      pcm[(pos + i) * 2] = Math.round(clamp(Math.tanh(bl[i] * vol), -1, 1) * 32767);
      pcm[(pos + i) * 2 + 1] = Math.round(clamp(Math.tanh(br[i] * vol), -1, 1) * 32767);
    }
    pos += n;
    if (++blocks % 256 === 0) { if (onProgress) onProgress(pos / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  return pcm;
}

export function encodeWAV(pcm, channels, sr) {
  const dataSize = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataSize), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * channels * 2, true);
  v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  new Int16Array(buf, 44).set(pcm);
  return buf;
}
