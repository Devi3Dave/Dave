// Kassette – Bedienlogik und Oberfläche.
import { ENGINE, FX, SEQ, quantize, clamp, clamp01, attackTime, decayTime, releaseTime, lfoRate, bounce, encodeWAV } from './dsp.js';
import * as M from './meta.js';
import { drawScreen, ENC, REC, LANE_TOP, LANE_STRIDE, padRect } from './screen.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'kassette.state.v1';

// ---------- Zustand ----------

const defaults = () => ({
  mode: 'synth', page: 0, slot: 0, drumActive: false,
  patches: M.factoryPatches(), drumPatch: M.factoryDrum(),
  mixer: { levels: [0.8, 0.8, 0.8, 0.8], pans: [0.35, 0.65, 0.45, 0.55], mutes: [false, false, false, false], live: 0.9, masterVolume: 0.8, masterFX: FX.space, masterFXParams: [0.5, 0.4, 0.15, 0.1] },
  seq: { kind: SEQ.off, bpm: 110, swing: 0, steps: [48, -1, 48, -1, 55, -1, 48, 58, -1, 48, -1, 53, 55, -1, 60, -1], length: 16, gate: 0.5,
    arpRate: 2, arpMode: 0, arpOctaves: 1, euclidSteps: 16, euclidPulses: 5, euclidRotate: 0, euclidRate: 2, metronomeLevel: 0.5 },
  tapeSpeed: 0.75, octave: 0, armedTrack: 0, metronomeOn: false, latch: false,
});

const st = Object.assign(defaults(), { isPlaying: false, isRecording: false, isSampling: false, toast: null });
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved && Array.isArray(saved.patches) && saved.patches.length === 8) {
    for (const k of ['slot', 'patches', 'drumPatch', 'mixer', 'seq', 'tapeSpeed', 'octave']) if (saved[k] !== undefined) st[k] = saved[k];
  }
} catch { /* defekter Speicherstand: Werkszustand */ }

// Anzeigezustand aus dem Audio-Thread (wird ~45×/s ersetzt)
let S = {
  sr: 48000, length: 48000 * 120, scope: new Float32Array(380), ov: new Float32Array(280 * 4), hits: new Float32Array(12).fill(99),
  playhead: 0, speed: 0, running: false, recording: false, loopOn: false, loopStart: 0, loopEnd: 0, hasLoop: false, recordedEnd: 0, canUndo: false,
  trackPeaks: [0, 0, 0, 0], livePeak: 0, outPeak: 0, transport: false, beatIndex: 0, lfoPhase: 0, lfoValue: 0, activeVoices: 0,
  capturing: false, captureProgress: 0, sampleCount: 0, cursor: 0, transpose: 0, playingStep: -1, held: [], steps: [...st.seq.steps],
};

const pressed = new Set();     // klingende Noten (für die Tastenbeleuchtung)
const pointerNotes = new Map(); // pointerId → { index, note }
const codeNotes = new Map();    // Tastatur-Code → Note
const accum = [0, 0, 0, 0];
let toastTimer = 0, saveTimer = 0, graceUntil = 0;
const grace = () => { graceUntil = performance.now() + 500; };

const patch = () => (st.drumActive ? st.drumPatch : st.patches[st.slot]);
const baseNote = () => 48 + st.octave * 12;

// ---------- Audio ----------

let ctx = null, node = null, micStream = null, micSource = null;
const tapeRequests = new Map();
let requestId = 0;

const send = (msg, transfer) => { if (node) node.port.postMessage(msg, transfer || []); };

async function startAudio() {
  if (ctx) { await ctx.resume(); return; }
  if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch { /* nicht unterstützt */ } }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('worklet.js');
  node = new AudioWorkletNode(ctx, 'kassette', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  node.port.onmessage = (e) => onWorklet(e.data);
  node.connect(ctx.destination);
  await ctx.resume();
  S.sr = ctx.sampleRate; S.length = Math.floor(ctx.sampleRate) * 120;
  pushAll();
}

function onWorklet(m) {
  if (m.t === 'state') {
    m.sr = S.sr; m.length = S.length;
    S = m;
    if (performance.now() > graceUntil) {
      if (st.isPlaying && S.transport && !S.running && S.playhead >= S.length - 3) stop();
      if (st.isPlaying && !S.transport) st.isPlaying = false;
      if (st.isRecording && !S.recording) st.isRecording = false;
    }
    if (st.isSampling && !S.capturing) endSampling('SAMPLE FERTIG');
  } else if (m.t === 'ready') {
    S.sr = m.sr; S.length = m.length;
  } else if (m.t === 'reply') {
    const texts = {
      lift: ['LIFT ✓', 'ERST LOOP SETZEN'], drop: ['DROP ✓', 'NICHTS GELIFTET'], undo: ['UNDO ✓', 'KEIN UNDO'],
      loop: ['LOOP AN', 'LOOP AUS'], sampleFromTape: ['TAPE → SAMPLER ✓', 'BAND LEER'], setTape: ['BAND GELADEN', 'FEHLER'],
    };
    if (texts[m.op]) flash(texts[m.op][m.ok ? 0 : 1]);
  } else if (m.t === 'tapeData') {
    const resolve = tapeRequests.get(m.id);
    tapeRequests.delete(m.id);
    if (resolve) resolve(m);
  }
}

function pushPatch() { const p = patch(); send({ t: 'patch', patch: { engine: p.engine, params: p.params, env: p.env, fx: p.fx, fxParams: p.fxParams, lfo: p.lfo, volume: p.volume } }); touch(); }
function pushMixer() { send({ t: 'mixer', mixer: st.mixer }); touch(); }
function pushSeq() {
  send({ t: 'seq', seq: { ...st.seq, latch: st.latch, stepInput: st.mode === 'seq' && st.seq.kind === SEQ.pattern, metronomeOn: st.metronomeOn } });
  touch();
}
function pushAll() { pushPatch(); pushMixer(); pushSeq(); send({ t: 'speed', v: speedFrom(st.tapeSpeed) }); send({ t: 'arm', track: st.armedTrack }); }

function touch() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}
function save() {
  const { slot, patches, drumPatch, mixer, seq, tapeSpeed, octave } = st;
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ slot, patches, drumPatch, mixer, seq, tapeSpeed, octave })); } catch { /* Speicher voll/gesperrt */ }
}

function flash(text) {
  st.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { st.toast = null; }, 1400);
}

function noteOn(n, v = 0.8) { pressed.add(n); send({ t: 'on', n, v }); }
function noteOff(n) {
  for (const p of pointerNotes.values()) if (p.note === n) return;
  for (const c of codeNotes.values()) if (c === n) return;
  pressed.delete(n);
  send({ t: 'off', n });
}

// ---------- Modi, Seiten, Sounds ----------

function selectMode(m) {
  if (m === 'synth' || m === 'drum') {
    if (st.mode === m) st.page = 0;
    st.drumActive = m === 'drum';
  }
  const inst = (x) => x === 'synth' || x === 'drum';
  if (m !== st.mode && !(inst(m) && inst(st.mode))) st.page = 0;
  st.mode = m;
  pushPatch(); pushSeq();
}

function selectPage(i) {
  if (st.mode === 'tape') { st.armedTrack = i; send({ t: 'arm', track: i }); return; }
  if (st.mode === 'seq' && i > 1) return;
  st.page = i;
}

function pageTitles() {
  if (st.mode === 'tape') return ['T1', 'T2', 'T3', 'T4'];
  if (st.mode === 'mixer') return ['LEVEL', 'PAN', 'M-FX', 'MASTER'];
  if (st.mode === 'seq') return ['SEQ', 'EDIT', '', ''];
  return ['ENG', 'ENV', 'FX', 'LFO'];
}

function selectSlot(i) {
  st.slot = i; st.drumActive = false;
  if (st.mode === 'drum') st.mode = 'synth';
  pushPatch();
  flash(`${i + 1} · ${patch().name}`);
}

function nextEngine() {
  const p = patch(), list = M.SYNTH_ENGINES;
  const e = list[(Math.max(0, list.indexOf(p.engine)) + 1) % list.length];
  p.engine = e; p.params = [...M.ENGINE_DEFAULTS[e]];
  pushPatch(); flash(M.ENGINE_TITLES[e]);
}

function nextSeqKind() {
  st.seq.kind = (st.seq.kind + 1) % 4;
  send({ t: 'allOff' }); pushSeq();
}

// ---------- Encoder ----------

const P = (k, i) => ({ k, i });
function params() {
  const four = (k) => [0, 1, 2, 3].map((i) => P(k, i));
  if (st.mode === 'synth' || st.mode === 'drum') return four(['engine', 'env', 'fx', 'lfo'][st.page]);
  if (st.mode === 'tape') return [P('tapeSpeed'), P('tapeJog'), P('loopStart'), P('loopEnd')];
  if (st.mode === 'mixer') {
    if (st.page === 0) return four('level');
    if (st.page === 1) return four('pan');
    if (st.page === 2) return four('masterFX');
    return [P('masterVolume'), P('liveLevel'), P('tempo'), P('metronome')];
  }
  if (st.page === 0) return [P('seqKind'), P('tempo'), P('swing'), P('metronome')];
  if (st.seq.kind === SEQ.pattern) return [P('cursor'), P('gate'), P('length'), P('transpose')];
  if (st.seq.kind === SEQ.arp) return [P('arpRate'), P('arpMode'), P('arpOctaves'), P('gate')];
  if (st.seq.kind === SEQ.euclid) return [P('euclidSteps'), P('euclidPulses'), P('euclidRotate'), P('euclidRate')];
  return [P('none'), P('none'), P('none'), P('none')];
}

const STEP = { seqKind: 0.06, arpRate: 0.06, arpMode: 0.06, arpOctaves: 0.06, euclidRate: 0.06, cursor: 0.035, length: 0.035, transpose: 0.035,
  euclidSteps: 0.035, euclidPulses: 0.035, euclidRotate: 0.035, tempo: 0.012, tapeJog: 0.01, loopStart: 0.01, loopEnd: 0.01 };

function turn(i, delta) {
  const p = params()[i], step = STEP[p.k];
  if (step) {
    accum[i] += delta;
    const s = Math.trunc(accum[i] / step);
    if (s !== 0) { accum[i] -= s * step; stepParam(p, s); }
    return;
  }
  setValue(p, clamp01(value(p) + delta));
}

function stepParam(p, s) {
  const q = st.seq, mod = (a, n) => ((a % n) + n) % n;
  switch (p.k) {
    case 'seqKind': q.kind = mod(q.kind + s, 4); send({ t: 'allOff' }); break;
    case 'tempo': q.bpm = clamp(q.bpm + s, 40, 240); break;
    case 'cursor': S.cursor = mod(S.cursor + s, q.length); send({ t: 'cursor', v: S.cursor }); return;
    case 'length': q.length = clamp(q.length + s, 1, 16); break;
    case 'transpose': S.transpose = clamp(S.transpose + s, -24, 24); send({ t: 'transpose', v: S.transpose }); return;
    case 'arpRate': q.arpRate = clamp(q.arpRate + s, 0, 3); break;
    case 'arpMode': q.arpMode = clamp(q.arpMode + s, 0, 4); break;
    case 'arpOctaves': q.arpOctaves = clamp(q.arpOctaves + s, 1, 3); break;
    case 'euclidSteps': q.euclidSteps = clamp(q.euclidSteps + s, 2, 32); q.euclidPulses = Math.min(q.euclidPulses, q.euclidSteps); q.euclidRotate = mod(q.euclidRotate, q.euclidSteps); break;
    case 'euclidPulses': q.euclidPulses = clamp(q.euclidPulses + s, 0, q.euclidSteps); break;
    case 'euclidRotate': q.euclidRotate = mod(q.euclidRotate + s, q.euclidSteps); break;
    case 'euclidRate': q.euclidRate = clamp(q.euclidRate + s, 0, 3); break;
    case 'tapeJog': send({ t: 'jog', v: s * 0.1 }); return;
    case 'loopStart': send({ t: 'loopStart', v: s * 0.05 }); return;
    case 'loopEnd': send({ t: 'loopEnd', v: s * 0.05 }); return;
  }
  pushSeq();
}

function value(p) {
  const pa = patch(), q = st.seq, m = st.mixer;
  switch (p.k) {
    case 'engine': return pa.params[p.i];
    case 'env': return pa.env[p.i];
    case 'fx': return pa.fxParams[p.i];
    case 'lfo': return pa.lfo[p.i];
    case 'tapeSpeed': return st.tapeSpeed;
    case 'tapeJog': return S.playhead / S.length;
    case 'loopStart': return S.loopStart / S.length;
    case 'loopEnd': return S.loopEnd / S.length;
    case 'level': return m.levels[p.i];
    case 'pan': return m.pans[p.i];
    case 'masterFX': return m.masterFXParams[p.i];
    case 'masterVolume': return m.masterVolume;
    case 'liveLevel': return m.live;
    case 'seqKind': return q.kind / 3;
    case 'tempo': return (q.bpm - 40) / 200;
    case 'swing': return q.swing;
    case 'metronome': return q.metronomeLevel;
    case 'cursor': return S.cursor / Math.max(1, q.length - 1);
    case 'gate': return q.gate;
    case 'length': return (q.length - 1) / 15;
    case 'transpose': return (S.transpose + 24) / 48;
    case 'arpRate': return q.arpRate / 3;
    case 'arpMode': return q.arpMode / 4;
    case 'arpOctaves': return (q.arpOctaves - 1) / 2;
    case 'euclidSteps': return (q.euclidSteps - 2) / 30;
    case 'euclidPulses': return q.euclidPulses / Math.max(1, q.euclidSteps);
    case 'euclidRotate': return q.euclidRotate / Math.max(1, q.euclidSteps - 1);
    case 'euclidRate': return q.euclidRate / 3;
  }
  return 0;
}

function setValue(p, v) {
  const pa = patch(), m = st.mixer;
  switch (p.k) {
    case 'engine': pa.params[p.i] = v; pushPatch(); break;
    case 'env': pa.env[p.i] = v; pushPatch(); break;
    case 'fx': pa.fxParams[p.i] = v; pushPatch(); break;
    case 'lfo': pa.lfo[p.i] = v; pushPatch(); break;
    case 'tapeSpeed': st.tapeSpeed = v; send({ t: 'speed', v: speedFrom(v) }); touch(); break;
    case 'level': m.levels[p.i] = v; pushMixer(); break;
    case 'pan': m.pans[p.i] = v; pushMixer(); break;
    case 'masterFX': m.masterFXParams[p.i] = v; pushMixer(); break;
    case 'masterVolume': m.masterVolume = v; pushMixer(); break;
    case 'liveLevel': m.live = v; pushMixer(); break;
    case 'swing': st.seq.swing = v; pushSeq(); break;
    case 'metronome': st.seq.metronomeLevel = v; pushSeq(); break;
    case 'gate': st.seq.gate = v; pushSeq(); break;
  }
}

function label(p) {
  const pa = patch();
  switch (p.k) {
    case 'engine': return M.ENGINE_PARAMS[pa.engine][p.i];
    case 'env': return ['ATTACK', 'DECAY', 'SUSTAIN', 'RELEASE'][p.i];
    case 'fx': return M.FX_PARAMS[pa.fx][p.i];
    case 'lfo': return ['RATE', 'DEPTH', 'SHAPE', 'TARGET'][p.i];
    case 'level': return `TRACK ${p.i + 1}`;
    case 'pan': return `PAN ${p.i + 1}`;
    case 'masterFX': return M.FX_PARAMS[st.mixer.masterFX][p.i];
  }
  return { tapeSpeed: 'SPEED', tapeJog: 'POSITION', loopStart: 'LOOP IN', loopEnd: 'LOOP OUT', masterVolume: 'MASTER', liveLevel: 'MONITOR',
    seqKind: 'MODE', tempo: 'TEMPO', swing: 'SWING', metronome: 'CLICK', cursor: 'STEP', gate: 'GATE', length: 'LENGTH', transpose: 'TRANSP',
    arpRate: 'RATE', euclidRate: 'RATE', arpMode: 'MODE', arpOctaves: 'OCTAVES', euclidSteps: 'STEPS', euclidPulses: 'PULSES', euclidRotate: 'ROTATE', none: '—' }[p.k];
}

function text(p) {
  const pa = patch(), q = st.seq, m = st.mixer;
  switch (p.k) {
    case 'engine': return M.engineDisplay(pa.engine, p.i, pa.params[p.i]);
    case 'env': { const v = pa.env[p.i]; return p.i === 0 ? M.secs(attackTime(v)) : p.i === 1 ? M.secs(decayTime(v)) : p.i === 2 ? M.pct(v) : M.secs(releaseTime(v)); }
    case 'fx': return M.fxDisplay(pa.fx, p.i, pa.fxParams[p.i]);
    case 'lfo': {
      const v = pa.lfo[p.i];
      if (p.i === 0) return lfoRate(v).toFixed(2) + ' Hz';
      if (p.i === 1) return M.pct(v);
      if (p.i === 2) return M.LFO_SHAPES[quantize(v, 5)];
      const t = quantize(v, 8);
      return t >= 1 && t <= 4 ? M.ENGINE_PARAMS[pa.engine][t - 1] : M.LFO_TARGETS[t];
    }
    case 'tapeSpeed': { const s = speedFrom(st.tapeSpeed); return (s < 0 ? '◀ ' : '') + '×' + Math.abs(s).toFixed(2); }
    case 'tapeJog': return M.clock(S.playhead / S.sr);
    case 'loopStart': return M.clock(S.loopStart / S.sr);
    case 'loopEnd': return M.clock(S.loopEnd / S.sr);
    case 'level': return m.mutes[p.i] ? 'MUTE' : M.pct(m.levels[p.i]);
    case 'pan': { const x = Math.round((m.pans[p.i] - 0.5) * 200); return x === 0 ? 'C' : x < 0 ? 'L' + -x : 'R' + x; }
    case 'masterFX': return M.fxDisplay(m.masterFX, p.i, m.masterFXParams[p.i]);
    case 'masterVolume': return M.pct(m.masterVolume);
    case 'liveLevel': return M.pct(m.live);
    case 'seqKind': return M.SEQ_TITLES[q.kind];
    case 'tempo': return `${Math.round(q.bpm)} BPM`;
    case 'swing': return M.pct(q.swing);
    case 'metronome': return st.metronomeOn ? M.pct(q.metronomeLevel) : 'AUS';
    case 'cursor': return `${S.cursor + 1}/${q.length}`;
    case 'gate': return M.pct(q.gate);
    case 'length': return String(q.length);
    case 'transpose': return S.transpose > 0 ? '+' + S.transpose : String(S.transpose);
    case 'arpRate': return M.RATE_NAMES[q.arpRate];
    case 'arpMode': return M.ARP_MODES[q.arpMode];
    case 'arpOctaves': return String(q.arpOctaves);
    case 'euclidSteps': return String(q.euclidSteps);
    case 'euclidPulses': return String(q.euclidPulses);
    case 'euclidRotate': return String(q.euclidRotate);
    case 'euclidRate': return M.RATE_NAMES[q.euclidRate];
  }
  return '';
}

const info = (i) => { const p = params()[i]; return { label: label(p), value: value(p), text: text(p) }; };

function nextFX() {
  const p = patch();
  p.fx = (p.fx + 1) % 6; p.fxParams = [...M.FX_DEFAULTS[p.fx]];
  pushPatch(); flash(`FX: ${M.FX_TITLES[p.fx]}`);
}
function nextLFOTarget() { const p = patch(); p.lfo[3] = M.lfoTarget((quantize(p.lfo[3], 8) + 1) % 8); pushPatch(); }
function nextMasterFX() {
  const m = st.mixer;
  m.masterFX = (m.masterFX + 1) % 6; m.masterFXParams = [...M.FX_DEFAULTS[m.masterFX]];
  pushMixer(); flash(`MASTER FX: ${M.FX_TITLES[m.masterFX]}`);
}

// Encoder antippen = drücken
function pressEncoder(i) {
  if (st.mode === 'synth' || st.mode === 'drum') {
    if (st.page === 0 && i === 0 && !st.drumActive) nextEngine();
    else if (st.page === 2) nextFX();
    else if (st.page === 3 && i === 3) nextLFOTarget();
  } else if (st.mode === 'tape') {
    if (i === 0) { st.tapeSpeed = 0.75; send({ t: 'speed', v: 1 }); flash('SPEED ×1'); }
    else if (i === 1) send({ t: 'rewind' });
    else if (i === 2) { send({ t: 'loopStart', set: true }); flash('LOOP IN'); }
    else { send({ t: 'loopEnd', set: true }); flash('LOOP OUT'); }
  } else if (st.mode === 'mixer') {
    if (st.page <= 1) { st.mixer.mutes[i] = !st.mixer.mutes[i]; pushMixer(); }
    else if (st.page === 2) nextMasterFX();
    else if (i === 3) toggleMetronome();
  } else if (st.page === 0) {
    if (i === 0) nextSeqKind();
    else if (i === 3) toggleMetronome();
  } else if (st.seq.kind === SEQ.pattern) {
    if (i === 0) setStep(S.cursor, -1);
    else if (i === 3) { S.transpose = 0; send({ t: 'transpose', v: 0 }); }
  }
}

// ---------- Pattern ----------

function setStep(i, note) { if (i < 0 || i > 15) return; st.seq.steps[i] = note; S.steps[i] = note; pushSeq(); }
function clearPattern() { st.seq.steps = new Array(16).fill(-1); S.steps = [...st.seq.steps]; pushSeq(); flash('PATTERN LEER'); }
function randomPattern() {
  const scale = [0, 3, 5, 7, 10, 12, 15];
  st.seq.steps = Array.from({ length: 16 }, () => (Math.random() < 0.6 ? 48 + scale[Math.floor(Math.random() * scale.length)] : -1));
  S.steps = [...st.seq.steps]; pushSeq(); flash('ZUFALL');
}

// ---------- Transport ----------

function play() { send({ t: 'play' }); st.isPlaying = true; grace(); }
function stop() {
  if (st.isPlaying) { send({ t: 'stop' }); st.isPlaying = false; st.isRecording = false; }
  else send({ t: 'rewind' });
}
function togglePlay() { if (st.isPlaying) stop(); else play(); }
function toggleRecord() {
  if (st.isRecording) { send({ t: 'rec', on: false, track: st.armedTrack }); st.isRecording = false; return; }
  send({ t: 'rec', on: true, track: st.armedTrack });
  st.isRecording = true; grace();
  if (!st.isPlaying) play();
}
function toggleMetronome() { st.metronomeOn = !st.metronomeOn; pushSeq(); flash(st.metronomeOn ? 'CLICK AN' : 'CLICK AUS'); }
function toggleLatch() { st.latch = !st.latch; if (!st.latch) send({ t: 'allOff' }); pushSeq(); flash(st.latch ? 'HOLD AN' : 'HOLD AUS'); }
function shiftOctave(d) { st.octave = clamp(st.octave + d, -3, 3); touch(); flash(`OKTAVE ${st.octave > 0 ? '+' : ''}${st.octave}`); }

const speedFrom = (v) => { const s = (v - 0.5) * 4; return Math.abs(s - 1) < 0.05 ? 1 : Math.abs(s + 1) < 0.05 ? -1 : s; };

// ---------- Sampling ----------

async function toggleSampling() {
  if (st.isSampling) { send({ t: 'capture', on: false }); endSampling('SAMPLE FERTIG'); return; }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    micSource = ctx.createMediaStreamSource(micStream);
    micSource.connect(node);
    send({ t: 'capture', on: true });
    S.capturing = true;
    st.isSampling = true;
    flash('AUFNAHME…');
  } catch { flash('KEIN MIKROFON'); }
}
function endSampling(message) {
  st.isSampling = false;
  if (micSource) { micSource.disconnect(); micSource = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  flash(message);
}

// ---------- Oberfläche aufbauen ----------

const ICONS = {
  synth: '<path d="M2 11h2v2H2zm3-4h2v10H5zm3 2h2v6H8zm3-6h2v18h-2zm3 4h2v10h-2zm3 2h2v6h-2zm3 2h2v2h-2z"/>',
  drum: '<path d="M3 3h5v5H3zm6.5 0h5v5h-5zM16 3h5v5h-5zM3 9.5h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5zM3 16h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5z"/>',
  tape: '<path d="M6.5 7a5 5 0 1 0 0 10h11a5 5 0 1 0-4.6-7H11.1A5 5 0 0 0 6.5 7zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm11 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" fill-rule="evenodd"/>',
  mixer: '<path d="M5 3h2v8H5zm0 13h2v5H5zM3.5 12h5v3h-5zM11 3h2v3h-2zm0 8h2v10h-2zM9.5 7h5v3h-5zM17 3h2v10h-2zm0 15h2v3h-2zm-1.5-4h5v3h-5z"/>',
  seq: '<path d="M2 5h4v4H2zm5.3 0h4v4h-4zm5.4 0h4v4h-4zM18 5h4v4h-4zM2 10h4v4H2zm5.3 0h4v4h-4zm5.4 0h4v4h-4zM18 10h4v4h-4zM2 15h4v4H2zm5.3 0h4v4h-4zm5.4 0h4v4h-4zM18 15h4v4h-4z"/>',
  rec: '<circle cx="12" cy="12" r="8"/>', play: '<path d="M7 4l13 8-13 8z"/>', stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  down: '<path d="M4 8.5L6.5 6l5.5 5.5L17.500 6 20 8.500l-8 8z"/>', up: '<path d="M4 15.500L6.500 18l5.500-5.500 5.500 5.500 2.500-2.500-8-8z"/>',
  click: '<path d="M9 2h6l5 20H4zm1.600 2L7 18h10l-.800-3.200-3.300-2.700 2.600-3.200L13.400 4zm3.100 7.600 2.700-3.400.400 1.600-1.700 2.100 2.100 1.700.300 1.400z" fill-rule="evenodd"/>',
  hold: '<path d="M8 3h3v8h2V2h3v9h1V5h3v11a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.700L3 13l2-2 3 2.500z"/>',
  album: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 6.500a3.500 3.500 0 1 1 0 7 3.500 3.500 0 0 1 0-7zm0 2.500a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill-rule="evenodd"/>',
  help: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 14h2v2h-2zm1-10a4 4 0 0 1 4 4c0 2.500-3 2.800-3 5h-2c0-3.300 3-3.500 3-5a2 2 0 0 0-4 0H8a4 4 0 0 1 4-4z" fill-rule="evenodd"/>',
};

const hw = [];
function addButton(parent, spec) {
  const b = document.createElement('button');
  b.className = 'hw' + (spec.icon ? '' : ' text');
  if (spec.color) b.style.setProperty('--c', spec.color);
  b.innerHTML = (spec.icon ? `<svg viewBox="0 0 24 24">${ICONS[spec.icon]}</svg>` : '') + `<span>${spec.title || ''}</span>`;
  b.addEventListener('click', () => { spec.action(); });
  parent.appendChild(b);
  hw.push({ el: b, span: b.querySelector('span'), spec });
}
function addGap(parent) { const g = document.createElement('div'); g.className = 'gap'; parent.appendChild(g); }

function buildButtons() {
  const row = $('buttons');
  const modes = [['synth', 'SYNTH', 0], ['drum', 'DRUM', 1], ['tape', 'TAPE', 2], ['mixer', 'MIXER', 3], ['seq', 'SEQ', 0]];
  for (const [m, title, c] of modes) addButton(row, { icon: m, title, color: ENC[c], action: () => selectMode(m), on: () => st.mode === m });
  addGap(row);
  for (let i = 0; i < 4; i++) {
    addButton(row, { color: ENC[i], action: () => selectPage(i), on: () => (st.mode === 'tape' ? st.armedTrack === i : st.page === i),
      title: () => pageTitles()[i] || '—', disabled: () => !pageTitles()[i] });
  }
  addGap(row);
  addButton(row, { icon: 'rec', title: 'REC', color: REC, action: toggleRecord, on: () => st.isRecording });
  addButton(row, { icon: 'play', title: 'PLAY', color: '#33b373', action: play, on: () => st.isPlaying });
  addButton(row, { icon: 'stop', title: 'STOP', action: stop });
  addGap(row);
  addButton(row, { icon: 'down', title: 'OKT −', action: () => shiftOctave(-1) });
  addButton(row, { icon: 'up', title: 'OKT +', action: () => shiftOctave(1) });
  addButton(row, { icon: 'click', title: 'CLICK', color: ENC[1], action: toggleMetronome, on: () => st.metronomeOn });
  addButton(row, { icon: 'hold', title: 'HOLD', color: ENC[2], action: toggleLatch, on: () => st.latch });
  addButton(row, { icon: 'album', title: 'ALBUM', action: () => openDialog('album') });
  addButton(row, { icon: 'help', title: 'HILFE', action: () => openDialog('help') });
}

const encEls = [];
function buildEncoders() {
  const box = $('encoders');
  for (let i = 0; i < 4; i++) {
    const el = document.createElement('div');
    el.className = 'enc';
    el.style.setProperty('--c', ENC[i]);
    el.innerHTML = '<div class="knob"><i></i></div><span></span>';
    box.appendChild(el);
    const knob = el.firstChild;
    const e = { el, knob, span: el.lastChild, angle: 0, x: 0, y: 0, moved: 0, active: false };
    encEls.push(e);
    el.addEventListener('pointerdown', (ev) => { el.setPointerCapture(ev.pointerId); e.active = true; e.x = ev.clientX; e.y = ev.clientY; e.moved = 0; });
    el.addEventListener('pointermove', (ev) => {
      if (!e.active) return;
      const amount = (ev.clientX - e.x - (ev.clientY - e.y)) / scale;
      e.x = ev.clientX; e.y = ev.clientY; e.moved += Math.abs(amount);
      if (e.moved < 3) return;
      e.angle += amount * 1.4; knob.style.transform = `rotate(${e.angle}deg)`;
      turn(i, amount / 240);
    });
    const end = (ev) => { if (!e.active) return; e.active = false; if (e.moved < 3 && ev.type === 'pointerup') pressEncoder(i); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (ev) => { ev.preventDefault(); const a = -ev.deltaY * 0.4; e.angle += a * 1.4; knob.style.transform = `rotate(${e.angle}deg)`; turn(i, a / 240); }, { passive: false });
  }
}

const slotEls = [];
function buildSlots() {
  for (let i = 0; i < 8; i++) {
    const b = document.createElement('button');
    b.className = 'slot'; b.style.setProperty('--c', ENC[i % 4]);
    b.innerHTML = `<b>${i + 1}</b><small></small>`;
    b.addEventListener('click', () => selectSlot(i));
    $('slots').appendChild(b);
    slotEls.push(b);
  }
}

const legendEls = [];
function buildLegend() {
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('div');
    d.className = 'lg';
    d.innerHTML = `<span class="ll" style="color:${ENC[i]}"><i></i><b></b></span><span class="lv"></span>`;
    $('legend').appendChild(d);
    legendEls.push({ label: d.querySelector('b'), value: d.querySelector('.lv') });
  }
}

// ---------- Klaviatur ----------

const keyEls = [];
function buildKeyboard() {
  const kb = $('keyboard'), whites = [0, 2, 4, 5, 7, 9, 11], blacks = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]];
  const make = (index, black, leftPct, widthPct) => {
    const k = document.createElement('div');
    k.className = 'key ' + (black ? 'b' : 'w');
    k.style.left = leftPct + '%'; k.style.width = widthPct + '%';
    k.style.setProperty('--c', ENC[Math.floor(index / 3) % 4]);
    k.dataset.index = index;
    k.innerHTML = '<span></span><i></i>';
    kb.appendChild(k);
    keyEls[index] = { el: k, span: k.firstChild };
  };
  const w = 100 / 15;
  for (let k = 0; k < 15; k++) make(Math.floor(k / 7) * 12 + whites[k % 7], false, k * w + 0.2, w - 0.4);
  for (let k = 0; k < 10; k++) { const o = Math.floor(k / 5), [semi, after] = blacks[k % 5]; make(o * 12 + semi, true, (o * 7 + after + 1) * w - w * 0.31, w * 0.62); }

  const keyAt = (ev) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const key = el && el.closest ? el.closest('.key') : null;
    if (!key) return null;
    const r = key.getBoundingClientRect();
    return { index: +key.dataset.index, velocity: clamp(((ev.clientY - r.top) / r.height) * 0.85 + 0.25, 0.25, 1) };
  };
  const down = (ev) => {
    const k = keyAt(ev);
    if (!k) return;
    const note = baseNote() + k.index;
    pointerNotes.set(ev.pointerId, { index: k.index, note });
    noteOn(note, k.velocity);
  };
  const up = (ev) => {
    const p = pointerNotes.get(ev.pointerId);
    if (!p) return;
    pointerNotes.delete(ev.pointerId);
    noteOff(p.note);
  };
  kb.addEventListener('pointerdown', (ev) => { ev.preventDefault(); kb.setPointerCapture(ev.pointerId); down(ev); });
  kb.addEventListener('pointermove', (ev) => { // Glissando
    const p = pointerNotes.get(ev.pointerId);
    if (!p) return;
    const k = keyAt(ev);
    if (k && k.index !== p.index) { up(ev); down(ev); }
  });
  kb.addEventListener('pointerup', up);
  kb.addEventListener('pointercancel', up);
}

// Tastatur des Rechners – nach Tastenposition, unabhängig vom Layout
const CODE_NOTES = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16 };
function onKey(ev) {
  if (ev.metaKey || ev.ctrlKey || ev.altKey || document.querySelector('dialog[open]')) return;
  const down = ev.type === 'keydown';
  if (ev.code in CODE_NOTES) {
    ev.preventDefault();
    if (down) {
      if (ev.repeat || codeNotes.has(ev.code)) return;
      const note = baseNote() + 12 + CODE_NOTES[ev.code];
      codeNotes.set(ev.code, note);
      noteOn(note, 0.8);
    } else {
      const note = codeNotes.get(ev.code);
      if (note === undefined) return;
      codeNotes.delete(ev.code);
      noteOff(note);
    }
    return;
  }
  if (!down || ev.repeat) return;
  const actions = {
    Space: togglePlay, KeyR: toggleRecord, KeyZ: () => shiftOctave(-1), KeyX: () => shiftOctave(1), KeyM: toggleMetronome, KeyB: toggleLatch,
    Digit1: () => selectPage(0), Digit2: () => selectPage(1), Digit3: () => selectPage(2), Digit4: () => selectPage(3),
    Digit5: () => selectMode('synth'), Digit6: () => selectMode('drum'), Digit7: () => selectMode('tape'), Digit8: () => selectMode('mixer'), Digit9: () => selectMode('seq'),
  };
  if (actions[ev.code]) { ev.preventDefault(); actions[ev.code](); }
}

// ---------- Display: Chips und Touch ----------

function chipSpecs() {
  const c = [];
  if (st.mode === 'tape') {
    c.push(['LOOP', () => send({ t: 'loopToggle' }), ENC[1], S.loopOn], ['LIFT', () => send({ t: 'lift' })], ['DROP', () => send({ t: 'drop' })], ['UNDO', () => send({ t: 'undo' })],
      ['SPUR LÖSCHEN', () => { send({ t: 'clear', track: st.armedTrack }); flash(`SPUR ${st.armedTrack + 1} GELÖSCHT`); }, REC]);
  } else if (st.mode === 'synth' || st.mode === 'drum') {
    if (st.page === 0 && !st.drumActive) {
      c.push(['ENGINE ›', nextEngine, ENC[0]]);
      if (patch().engine === ENGINE.sampler) c.push([st.isSampling ? '■ STOP' : '● MIC', toggleSampling, REC, st.isSampling], ['TAPE → SAMPLE', () => send({ t: 'sampleFromTape' })]);
    } else if (st.page === 2) c.push(['FX-TYP ›', nextFX, ENC[0]]);
    else if (st.page === 3) c.push(['ZIEL ›', nextLFOTarget, ENC[3]]);
  } else if (st.mode === 'mixer') {
    if (st.page === 2) c.push(['MASTER-FX ›', nextMasterFX, ENC[0]]);
    else if (st.page <= 1) c.push(['ENCODER ANTIPPEN = MUTE', () => {}]);
  } else {
    c.push(['MODUS ›', nextSeqKind, ENC[0]]);
    if (st.seq.kind === SEQ.pattern) c.push(['PAUSE', () => setStep(S.cursor, -1)], ['ZUFALL', randomPattern], ['LEEREN', clearPattern, REC]);
    if (st.seq.kind === SEQ.arp || st.seq.kind === SEQ.euclid) c.push(['HOLD', toggleLatch, ENC[2], st.latch]);
  }
  return c;
}

let chipKey = '', chipActions = [];
function renderChips() {
  const specs = chipSpecs(), key = specs.map((s) => s[0] + (s[3] ? '1' : '0')).join('|');
  chipActions = specs.map((s) => s[1]);
  if (key === chipKey) return;
  chipKey = key;
  $('chips').innerHTML = specs.map((s, i) => `<button class="chip${s[3] ? ' on' : ''}" data-i="${i}" style="--c:${s[2] || '#fff'}">${s[0]}</button>`).join('');
}

function screenTap(ev) {
  const r = screenCanvas.getBoundingClientRect(), w = 600, h = 222;
  const x = ((ev.clientX - r.left) / r.width) * w, y = ((ev.clientY - r.top) / r.height) * h;
  if (st.mode === 'tape') {
    const idx = Math.floor((y - LANE_TOP) / LANE_STRIDE);
    if (y >= LANE_TOP && idx >= 0 && idx < 4) selectPage(idx);
  } else if (st.mode === 'seq') {
    if (st.seq.kind !== SEQ.pattern || y <= 40) return;
    const idx = Math.floor((x - 16) / ((w - 32) / 16));
    if (idx >= 0 && idx < 16) { S.cursor = Math.min(idx, st.seq.length - 1); send({ t: 'cursor', v: S.cursor }); }
  } else if (st.mode === 'synth') {
    if (st.page === 0 && y < 80) nextEngine();
  } else if (st.mode === 'drum') {
    if (st.page !== 0) return;
    const p = padRect(w, h);
    if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) return;
    const kind = clamp(Math.floor((y - p.y) / (p.h / 2)) * 6 + Math.floor((x - p.x) / (p.w / 6)), 0, 11);
    send({ t: 'on', n: baseNote() + 12 + kind, v: 0.9 });
    send({ t: 'off', n: baseNote() + 12 + kind });
  } else if (st.mode === 'mixer' && st.page <= 1) {
    const idx = Math.floor((x - w * 0.05) / (w * 0.18));
    if (idx >= 0 && idx < 4) pressEncoder(idx);
  }
}

// ---------- Zeichnen ----------

const screenCanvas = $('screen'), sctx = screenCanvas.getContext('2d');
const grill = $('grill'), gctx = grill.getContext('2d');
const ledEls = [...$('leds').children];
let scale = 1, pixelRatio = 0;

function layout() {
  const sw = window.innerWidth, sh = window.innerHeight;
  scale = Math.min(sw / 1200, sh / 700);
  $('device').style.transform = `scale(${scale})`;
  const pr = Math.min(3, Math.max(1, (window.devicePixelRatio || 1) * scale));
  if (pr !== pixelRatio) { pixelRatio = pr; screenCanvas.width = Math.round(600 * pr); screenCanvas.height = Math.round(222 * pr); }
}

const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
const api = { info, patch };

function frame(now) {
  requestAnimationFrame(frame);
  sctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawScreen(sctx, 600, 222, st, S, now / 1000, api);

  for (let i = 0; i < 4; i++) {
    const f = info(i);
    setText(legendEls[i].label, f.label); setText(legendEls[i].value, f.text); setText(encEls[i].span, f.label);
  }
  renderChips();
  for (const b of hw) {
    b.el.classList.toggle('on', !!(b.spec.on && b.spec.on()));
    if (typeof b.spec.title === 'function') setText(b.span, b.spec.title());
    if (b.spec.disabled) b.el.disabled = b.spec.disabled();
  }
  for (let i = 0; i < 8; i++) {
    slotEls[i].classList.toggle('on', !st.drumActive && st.slot === i);
    setText(slotEls[i].lastChild, M.ENGINE_TITLES[st.patches[i].engine].slice(0, 4));
  }
  setText($('slotTitle'), st.drumActive ? 'DRUM KIT AKTIV · SOUNDS' : 'SOUNDS');
  setText($('octValue'), st.octave > 0 ? '+' + st.octave : String(st.octave));
  setText($('octNote'), M.noteName(baseNote()));
  const base = baseNote();
  for (let i = 0; i < keyEls.length; i++) {
    const k = keyEls[i], note = base + i;
    k.el.classList.toggle('on', pressed.has(note));
    setText(k.span, st.drumActive ? M.DRUM_NAMES[((note % 12) + 12) % 12] : i % 12 === 0 ? M.noteName(note) : '');
  }
  $('vol').firstElementChild.firstElementChild.style.transform = `rotate(${st.mixer.masterVolume * 270 - 135}deg)`;
  for (let i = 0; i < 4; i++) ledEls[i].style.opacity = 0.25 + 0.75 * Math.min(1, S.trackPeaks[i] * 2);

  // Lautsprechergitter
  const peak = Math.min(1, S.outPeak), gs = 300, n = 9, stepPx = gs / n;
  gctx.clearRect(0, 0, gs, gs);
  gctx.fillStyle = 'rgba(41,41,46,.7)';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = (c - (n - 1) / 2) * stepPx, y = (r - (n - 1) / 2) * stepPx, d = Math.hypot(x, y);
    if (d >= stepPx * 4.4) continue;
    gctx.beginPath(); gctx.arc(gs / 2 + x, gs / 2 + y, stepPx * 0.2 + stepPx * 0.12 * peak * (1 - d / (stepPx * 4.4)), 0, 7); gctx.fill();
  }
}

// ---------- Album ----------

function openDialog(id) { $(id).showModal(); }

function getTape() {
  return new Promise((resolve) => { const id = ++requestId; tapeRequests.set(id, resolve); send({ t: 'getTape', id }); });
}

function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('kassette', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('tape');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dbPut(value) {
  const d = await db();
  return new Promise((resolve, reject) => { const tx = d.transaction('tape', 'readwrite'); tx.objectStore('tape').put(value, 'current'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}
async function dbGet() {
  const d = await db();
  return new Promise((resolve, reject) => { const r = d.transaction('tape').objectStore('tape').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function setupAlbum() {
  const msg = (s) => { $('albumMsg').textContent = s; };
  $('bounceBtn').addEventListener('click', async () => {
    if (!node) return;
    const bar = $('bounceProgress');
    $('bounceBtn').disabled = true; bar.hidden = false; bar.value = 0;
    const tape = await getTape();
    if (tape.recordedEnd <= 0) { msg('Das Band ist leer.'); }
    else {
      const pcm = await bounce(tape.tracks, tape.recordedEnd, tape.sr, st.mixer, (p) => { bar.value = p; });
      const blob = new Blob([encodeWAV(pcm, 2, Math.round(tape.sr))], { type: 'audio/wav' });
      const d = new Date(), z = (n) => String(n).padStart(2, '0');
      const name = `Kassette ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}.wav`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.textContent = '⬇ ' + name;
      $('exports').prepend(a);
      msg('Mixdown fertig – antippen zum Speichern.');
    }
    bar.hidden = true; $('bounceBtn').disabled = false;
  });
  $('saveTape').addEventListener('click', async () => {
    if (!node) return;
    try { const t = await getTape(); await dbPut({ tracks: t.tracks, recordedEnd: t.recordedEnd, sr: t.sr }); msg('Band gesichert.'); }
    catch { msg('Speichern fehlgeschlagen.'); }
  });
  $('loadTape').addEventListener('click', async () => {
    try {
      const t = await dbGet();
      if (!t) { msg('Kein gesichertes Band gefunden.'); return; }
      st.isPlaying = false; st.isRecording = false;
      send({ t: 'setTape', tracks: t.tracks });
      msg('Band geladen.');
    } catch { msg('Laden fehlgeschlagen.'); }
  });
  $('eraseTape').addEventListener('click', () => {
    if (!confirm('Alle 4 Spuren löschen?')) return;
    st.isPlaying = false; st.isRecording = false;
    send({ t: 'erase' }); msg('Band gelöscht.');
  });
  $('resetSounds').addEventListener('click', () => { st.patches = M.factoryPatches(); st.drumPatch = M.factoryDrum(); pushPatch(); msg('Werksklänge wiederhergestellt.'); });
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());

  const help = [
    ['Grundprinzip', ['Die vier farbigen Encoder steuern immer die vier gleichfarbigen Werte im Display.', 'Ziehen (hoch/runter, links/rechts) oder Mausrad = drehen. Antippen = drücken.', 'Die Tasten 1–4 wählen die Seite – im TAPE-Modus die Spur.']],
    ['Synth & Drum', ['8 Sound-Slots, Engines WAVE, FM, SWARM, PLUCK, PULSE, BEND, SAMPLER.', 'Seiten: ENG (Klang), ENV (Hüllkurve), FX (Delay, Space, Filter, Drive, Chorus), LFO.', 'DRUM: 12 synthetische Drums pro Oktave, die Pads im Display sind antippbar.', 'SAMPLER: „● MIC“ nimmt bis zu 12 s auf, „TAPE → SAMPLE“ holt den Loop der aktiven Spur.']],
    ['Tape', ['4 Spuren à 2 Minuten. Spur wählen mit 1–4 oder durch Antippen.', 'REC nimmt auf der gewählten Spur auf (Overdub). STOP im Stillstand spult zurück.', 'Encoder: SPEED (auch rückwärts), POSITION, LOOP IN, LOOP OUT – antippen setzt den Punkt an der aktuellen Position.', 'LIFT schneidet den Loop aus, DROP fügt ihn am Abspielkopf ein, UNDO nimmt den letzten Schritt zurück.']],
    ['Mixer', ['LEVEL und PAN je Spur, Encoder antippen = Mute.', 'M-FX: Effekt auf der Summe. MASTER: Lautstärke, Monitor, Tempo, Click.']],
    ['Sequencer', ['PATTERN: 16 Steps. Im Stillstand schreiben Tasten in den gewählten Step, beim Abspielen transponieren sie.', 'ARP: gehaltene Tasten werden arpeggiert. EUCLID: gehaltene Tasten spielen einen euklidischen Rhythmus.', 'HOLD hält Akkorde fest.']],
    ['Tastatur', ['<kbd>A W S E D F T G Z H U J K O L P</kbd> Klaviertasten (deutsche Tastatur)', '<kbd>Y</kbd> / <kbd>X</kbd> Oktave runter / hoch · <kbd>Leertaste</kbd> Play/Stop · <kbd>R</kbd> Record', '<kbd>1</kbd>–<kbd>4</kbd> Seiten · <kbd>5</kbd> Synth · <kbd>6</kbd> Drum · <kbd>7</kbd> Tape · <kbd>8</kbd> Mixer · <kbd>9</kbd> Seq · <kbd>M</kbd> Click · <kbd>B</kbd> Hold', 'MIDI-Keyboards werden in Chrome und Edge automatisch erkannt.']],
    ['Als App installieren', ['iPad: Teilen-Symbol → „Zum Home-Bildschirm“.', 'Mac (Safari): Ablage → „Zum Dock hinzufügen“. Chrome: Installieren-Symbol in der Adressleiste.']],
  ];
  $('helpBody').innerHTML = help.map(([t, lines]) => `<h3>${t}</h3><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`).join('');
}

// ---------- MIDI ----------

function setupMIDI() {
  if (!navigator.requestMIDIAccess) return;
  navigator.requestMIDIAccess().then((access) => {
    const bind = () => { for (const input of access.inputs.values()) input.onmidimessage = onMIDI; };
    access.onstatechange = bind;
    bind();
  }).catch(() => { /* kein MIDI-Zugriff */ });
}
function onMIDI(e) {
  const [status, a, b] = e.data, type = status & 0xf0;
  if (type === 0x90 && b > 0) { pressed.add(a); send({ t: 'on', n: a, v: b / 127 }); }
  else if (type === 0x80 || type === 0x90) { pressed.delete(a); send({ t: 'off', n: a }); }
  else if (type === 0xb0 && (a === 120 || a === 123)) send({ t: 'allOff' });
}

// ---------- Start ----------

buildButtons(); buildEncoders(); buildSlots(); buildLegend(); buildKeyboard(); setupAlbum();
layout();
window.addEventListener('resize', layout);
window.addEventListener('keydown', onKey);
window.addEventListener('keyup', onKey);
window.addEventListener('pagehide', save);
window.addEventListener('blur', () => { for (const [code, note] of codeNotes) { codeNotes.delete(code); noteOff(note); } });
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Zoom sperren (Safari ignoriert user-scalable=no): Pinch-Gesten und Doppeltipp abfangen.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (!e.target.closest('dialog')) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0, touchStartX = 0, touchStartY = 0;
document.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (e.target.closest('dialog')) return;
  const now = performance.now(), quick = now - lastTouchEnd < 400;
  lastTouchEnd = now;
  if (!quick || !e.cancelable) return;
  // Zweiter schneller Tipp: Standardverhalten (Zoom) unterdrücken, den Klick aber selbst auslösen.
  e.preventDefault();
  const t = e.changedTouches[0];
  if (Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) < 12) {
    e.target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY }));
  }
}, { passive: false });
document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume(); });
screenCanvas.addEventListener('click', screenTap);
$('chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) chipActions[+b.dataset.i](); });

$('vol').addEventListener('pointerdown', (ev) => {
  const el = $('vol'); el.setPointerCapture(ev.pointerId);
  let y = ev.clientY;
  const move = (e) => { st.mixer.masterVolume = clamp01(st.mixer.masterVolume - (e.clientY - y) / scale / 200); y = e.clientY; pushMixer(); };
  const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
});

$('startBtn').addEventListener('click', async () => {
  $('startMsg').textContent = 'Lade Klangerzeugung…';
  try {
    await startAudio();
    $('start').hidden = true;
    setupMIDI();
  } catch (err) {
    $('startMsg').textContent = 'Der Ton konnte nicht gestartet werden: ' + (err && err.message ? err.message : err);
  }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
requestAnimationFrame(frame);

// Für Tests und zum Experimentieren in der Konsole
window.kassette = { st, send, get S() { return S; }, selectMode, selectPage, selectSlot, turn, pressEncoder, play, stop, toggleRecord, noteOn, noteOff };
