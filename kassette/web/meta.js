// Namen, Anzeigeformate und Werksklänge.
import { ENGINE, FX, fmRatios, expMap, quantize } from './dsp.js';

export const ENGINE_TITLES = ['WAVE', 'FM', 'SWARM', 'PLUCK', 'PULSE', 'BEND', 'DRUM', 'SAMPLER'];
export const SYNTH_ENGINES = [ENGINE.wave, ENGINE.fm, ENGINE.swarm, ENGINE.pluck, ENGINE.pulse, ENGINE.bend, ENGINE.sampler];
export const ENGINE_PARAMS = [
  ['SHAPE', 'FOLD', 'DETUNE', 'SUB'], ['RATIO', 'INDEX', 'FEEDBK', 'DECAY'], ['SPREAD', 'VOICES', 'BRIGHT', 'SUB'],
  ['COLOR', 'SUSTAIN', 'DAMP', 'DRIVE'], ['WIDTH', 'PWM', 'SUB', 'NOISE'], ['AMOUNT', 'SHAPE', 'RESO', 'ENV'],
  ['TUNE', 'DECAY', 'TONE', 'PUNCH'], ['START', 'LENGTH', 'LOOP', 'TONE'],
];
export const ENGINE_DEFAULTS = [
  [0.35, 0.1, 0.3, 0.2], [0.3, 0.45, 0.1, 0.5], [0.5, 0.7, 0.6, 0.25], [0.7, 0.7, 0.35, 0.1],
  [0.3, 0.3, 0.4, 0], [0.4, 0, 0.3, 0.5], [0.5, 0.5, 0.5, 0.4], [0, 1, 0, 0.85],
];
export const FX_TITLES = ['OFF', 'DELAY', 'SPACE', 'FILTER', 'DRIVE', 'CHORUS'];
export const FX_PARAMS = [
  ['—', '—', '—', '—'], ['TIME', 'FEEDBK', 'MIX', 'TONE'], ['SIZE', 'DAMP', 'MIX', 'PRE'],
  ['CUTOFF', 'RESO', 'TYPE', 'DRIVE'], ['GAIN', 'BITS', 'RATE', 'MIX'], ['RATE', 'DEPTH', 'MIX', 'FEEDBK'],
];
export const FX_DEFAULTS = [
  [0.5, 0.5, 0.5, 0.5], [0.55, 0.45, 0.3, 0.6], [0.6, 0.4, 0.3, 0.1], [0.55, 0.4, 0, 0.2], [0.35, 0, 0, 1], [0.3, 0.5, 0.5, 0.2],
];
export const SEQ_TITLES = ['OFF', 'PATTERN', 'ARP', 'EUCLID'];
export const LFO_SHAPES = ['SINE', 'TRI', 'SAW', 'SQUARE', 'S&H'];
export const LFO_TARGETS = ['OFF', 'P1', 'P2', 'P3', 'P4', 'PITCH', 'AMP', 'FX'];
export const RATE_NAMES = ['1/4', '1/8', '1/16', '1/32'];
export const ARP_MODES = ['UP', 'DOWN', 'UP/DN', 'RANDOM', 'ORDER'];
export const DRUM_NAMES = ['KICK', 'RIM', 'SNARE', 'CLAP', 'TOM L', 'TOM M', 'HAT C', 'TOM H', 'HAT O', 'BELL', 'CYMBAL', 'ZAP'];
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const lfoTarget = (n) => (n + 0.5) / 8;
export const pct = (v) => String(Math.round(v * 100));
export const noteName = (n) => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
export const secs = (s) => (s < 1 ? Math.floor(s * 1000) + ' ms' : s.toFixed(2) + ' s');
export function clock(s) {
  const t = Math.max(0, s), m = Math.floor(t / 60);
  return m + ':' + (t - m * 60).toFixed(1).padStart(4, '0');
}

export function engineDisplay(engine, i, v) {
  if (engine === ENGINE.fm && i === 0) { const r = fmRatios[quantize(v, fmRatios.length)]; return '×' + r; }
  if (engine === ENGINE.bend && i === 1) return ['SAW', 'PULSE', 'RESO'][quantize(v, 3)];
  if (engine === ENGINE.sampler && i === 2) return v > 0.5 ? 'LOOP' : 'ONCE';
  if (engine === ENGINE.drum && i === 0) { const s = Math.round((v - 0.5) * 24); return s > 0 ? '+' + s : String(s); }
  return pct(v);
}

export function fxDisplay(fx, i, v) {
  if (fx === FX.off) return '—';
  if (fx === FX.delay && i === 0) return Math.floor(expMap(v, 0.03, 1.4) * 1000) + ' ms';
  if (fx === FX.space && i === 3) return Math.floor(v * 200) + ' ms';
  if (fx === FX.filter && i === 0) { const hz = expMap(v, 40, 18000); return hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : String(Math.floor(hz)); }
  if (fx === FX.filter && i === 2) return v < 0.2 ? 'LP' : v < 0.4 ? 'LP/BP' : v < 0.6 ? 'BP' : v < 0.8 ? 'BP/HP' : 'HP';
  if (fx === FX.drive && i === 1) return v < 0.01 ? 'OFF' : Math.floor(16 - v * 14) + ' BIT';
  if (fx === FX.drive && i === 2) return v < 0.01 ? 'OFF' : '÷' + Math.floor(1 + v * v * 40);
  if (fx === FX.chorus && i === 0) return expMap(v, 0.05, 6).toFixed(2) + ' Hz';
  return pct(v);
}

const P = (name, engine, params, env, fx = 0, fxParams = null, lfo = [0.4, 0, 0, 0], volume = 0.8) =>
  ({ name, engine, params, env, fx, fxParams: fxParams || [...FX_DEFAULTS[fx]], lfo, volume });

export const factoryPatches = () => [
  P('GLAS', ENGINE.wave, [0.15, 0.2, 0.35, 0.2], [0.1, 0.45, 0.6, 0.45], FX.space, [0.65, 0.35, 0.3, 0.1], [0.3, 0.35, 0, lfoTarget(2)]),
  P('GLOCKE', ENGINE.fm, [0.55, 0.5, 0.1, 0.45], [0, 0.55, 0.15, 0.5], FX.delay, [0.5, 0.4, 0.3, 0.6]),
  P('WOLKE', ENGINE.swarm, [0.5, 0.75, 0.6, 0.3], [0.35, 0.5, 0.8, 0.6], FX.chorus, [0.25, 0.5, 0.45, 0.2]),
  P('SAITE', ENGINE.pluck, [0.75, 0.75, 0.35, 0.1], [0, 0.5, 1, 0.3], FX.space, [0.45, 0.5, 0.25, 0.05]),
  P('BASS', ENGINE.pulse, [0.2, 0.2, 0.7, 0], [0, 0.3, 0.5, 0.15], FX.filter, [0.42, 0.55, 0, 0.3], [0.35, 0.4, 0, lfoTarget(7)]),
  P('KRISTALL', ENGINE.bend, [0.35, 0.9, 0.4, 0.5], [0, 0.45, 0.4, 0.4], FX.delay, [0.62, 0.5, 0.25, 0.4]),
  P('E-PIANO', ENGINE.fm, [0.1, 0.3, 0.05, 0.4], [0, 0.6, 0.3, 0.4], FX.chorus, [0.35, 0.3, 0.35, 0], [0.5, 0.15, 0, lfoTarget(6)]),
  P('SAMPLER', ENGINE.sampler, [0, 1, 0, 0.85], [0, 0.5, 1, 0.3], FX.space, [0.5, 0.4, 0.2, 0.1]),
];
export const factoryDrum = () => P('KIT', ENGINE.drum, [0.5, 0.5, 0.5, 0.4], [0, 0, 1, 0.2], FX.drive, [0.15, 0, 0, 1], [0.4, 0, 0, 0], 0.85);
