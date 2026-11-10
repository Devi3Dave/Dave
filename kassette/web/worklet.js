// Audio-Thread: besitzt das Studio, empfängt Befehle und schickt ~45×/s den Anzeigezustand.
import { Studio, SCOPE, OV_SHIFT, clamp } from './dsp.js';

const OV_COLS = 280;      // Spalten der Wellenform-Anzeige
const WINDOW_SEC = 12;    // sichtbarer Bandausschnitt
const SCOPE_OUT = 380;

class KassetteProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.studio = new Studio(sampleRate);
    this.blocks = 0;
    this.port.onmessage = (e) => this.handle(e.data);
    this.port.postMessage({ t: 'ready', sr: sampleRate, length: this.studio.tape.length });
  }

  reply(op, ok) { this.port.postMessage({ t: 'reply', op, ok }); }

  handle(m) {
    const s = this.studio, tape = s.tape, seq = s.seq, inst = s.instrument;
    switch (m.t) {
      case 'on': s.noteOn(m.n, m.v); break;
      case 'off': s.noteOff(m.n); break;
      case 'allOff': s.allOff(); break;
      case 'play': s.play(); break;
      case 'stop': s.stop(); break;
      case 'patch': Object.assign(inst.patch, m.patch); break;
      case 'mixer': Object.assign(s.mixer, m.mixer); break;
      case 'seq': {
        const q = m.seq;
        for (let i = 0; i < 16; i++) seq.steps[i] = i < q.steps.length ? q.steps[i] : -1;
        seq.kind = q.kind; seq.bpm = q.bpm; seq.swing = q.swing; seq.length = q.length; seq.gate = q.gate;
        seq.arpRate = q.arpRate; seq.arpMode = q.arpMode; seq.arpOctaves = q.arpOctaves;
        seq.euclidSteps = q.euclidSteps; seq.euclidPulses = q.euclidPulses; seq.euclidRotate = q.euclidRotate; seq.euclidRate = q.euclidRate;
        seq.latch = q.latch; seq.stepInput = q.stepInput;
        seq.cursor = clamp(seq.cursor, 0, Math.max(0, q.length - 1));
        s.metronomeOn = q.metronomeOn; s.metronomeLevel = q.metronomeLevel;
        break;
      }
      case 'cursor': seq.cursor = clamp(m.v, 0, 15); break;
      case 'transpose': seq.transpose = clamp(m.v, -24, 24); break;
      case 'rec': tape.armed = m.track; s.setRecording(m.on); break;
      case 'arm': tape.armed = m.track; if (tape.recording) tape.snapshot(m.track); break;
      case 'speed': tape.targetSpeed = m.v; break;
      case 'seek': tape.playhead = clamp(m.v, 0, tape.length - 2); break;
      case 'jog': tape.playhead = clamp(tape.playhead + m.v * sampleRate, 0, tape.length - 2); break;
      case 'rewind': tape.playhead = tape.loopOn && tape.hasLoop ? tape.loopStart : 0; break;
      case 'loopStart': tape.loopStart = Math.floor(clamp(m.set ? tape.playhead : tape.loopStart + m.v * sampleRate, 0, tape.length - 2)); break;
      case 'loopEnd':
        tape.loopEnd = Math.floor(clamp(m.set ? tape.playhead : tape.loopEnd + m.v * sampleRate, 0, tape.length - 2));
        if (m.set && tape.hasLoop) tape.loopOn = true;
        break;
      case 'loopToggle':
        if (!tape.hasLoop) {
          tape.loopStart = Math.floor(tape.playhead);
          tape.loopEnd = Math.min(tape.length - 2, tape.loopStart + Math.floor((60 / seq.bpm) * 4 * sampleRate));
        }
        tape.loopOn = !tape.loopOn;
        this.reply('loop', tape.loopOn);
        break;
      case 'lift': this.reply('lift', tape.lift()); break;
      case 'drop': this.reply('drop', tape.drop()); break;
      case 'undo': this.reply('undo', tape.undo()); break;
      case 'clear': tape.clear(m.track); break;
      case 'erase':
        s.stop();
        for (let t = 0; t < 4; t++) { tape.tracks[t].fill(0); tape.ov[t].fill(0); }
        tape.undoTrack = -1; tape.recordedEnd = 0; tape.playhead = 0; tape.loopOn = false; tape.loopStart = 0; tape.loopEnd = 0;
        break;
      case 'capture':
        if (m.on) inst.beginCapture(); else inst.endCapture();
        break;
      case 'sampleFromTape': this.reply('sampleFromTape', s.sampleFromTape()); break;
      case 'getTape': {
        const n = Math.min(tape.length, tape.recordedEnd + 1);
        const tracks = tape.tracks.map((tr) => tr.slice(0, tape.recordedEnd > 0 ? n : 0));
        this.port.postMessage({ t: 'tapeData', id: m.id, tracks, recordedEnd: tape.recordedEnd, sr: sampleRate }, tracks.map((x) => x.buffer));
        break;
      }
      case 'setTape': {
        s.stop();
        for (let t = 0; t < 4; t++) {
          tape.tracks[t].fill(0);
          const src = m.tracks[t];
          if (src) tape.tracks[t].set(src.subarray(0, Math.min(src.length, tape.length)));
          tape.rebuildOverview(t);
        }
        tape.recomputeEnd(); tape.playhead = 0; tape.undoTrack = -1;
        this.reply('setTape', true);
        break;
      }
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const s = this.studio;
    const input = inputs[0];
    if (s.instrument.capturing && input && input[0]) s.instrument.capture(input[0], input[0].length);
    if (out.length >= 2) s.render(out[0], out[1], out[0].length);
    else if (out.length === 1) { if (!this.tmp) this.tmp = new Float32Array(out[0].length); s.render(out[0], this.tmp, out[0].length); }
    if (++this.blocks % 8 === 0) this.postState();
    return true;
  }

  postState() {
    const s = this.studio, tape = s.tape, seq = s.seq, inst = s.instrument;
    // Oszilloskop: am Nulldurchgang triggern, damit das Bild steht
    const scope = new Float32Array(SCOPE_OUT), mask = SCOPE - 1, sc = s.scope;
    const start = (s.scopeW - 700 + SCOPE * 2) & mask;
    let from = start;
    for (let k = 0; k < 300; k++) {
      if (sc[(start + k) & mask] <= 0 && sc[(start + k + 1) & mask] > 0) { from = (start + k) & mask; break; }
    }
    for (let k = 0; k < SCOPE_OUT; k++) scope[k] = sc[(from + k) & mask];

    // Wellenform-Ausschnitt um den Abspielkopf
    const ov = new Float32Array(OV_COLS * 4);
    const win = WINDOW_SEC * sampleRate, startPos = tape.playhead - win / 2;
    for (let x = 0; x < OV_COLS; x++) {
      const pos = startPos + (x / OV_COLS) * win;
      if (pos < 0 || pos >= tape.length) continue;
      const bin = Math.min(tape.ovCount - 1, Math.floor(pos) >> OV_SHIFT);
      for (let t = 0; t < 4; t++) ov[t * OV_COLS + x] = tape.ov[t][bin];
    }
    const hits = new Float32Array(12);
    for (let k = 0; k < 12; k++) hits[k] = (s.clock - inst.drumHitClock[k]) / sampleRate;

    this.port.postMessage({
      t: 'state', scope, ov, hits,
      playhead: tape.playhead, speed: tape.speed, running: tape.running, recording: tape.recording,
      loopOn: tape.loopOn, loopStart: tape.loopStart, loopEnd: tape.loopEnd, hasLoop: tape.hasLoop, recordedEnd: tape.recordedEnd,
      canUndo: tape.undoTrack >= 0,
      trackPeaks: Array.from(s.trackPeaks), livePeak: s.livePeak, outPeak: s.outPeak,
      transport: s.transportRunning, beatIndex: s.beatIndex,
      lfoPhase: inst.lfoPhase, lfoValue: inst.lfoValue, activeVoices: inst.activeVoices,
      capturing: inst.capturing, captureProgress: inst.captureWrite / inst.sampleCap, sampleCount: inst.sampleCount,
      cursor: seq.cursor, transpose: seq.transpose, playingStep: seq.playingStep,
      held: Array.from(seq.held.subarray(0, seq.heldCount)), steps: Array.from(seq.steps),
    }, [scope.buffer, ov.buffer, hits.buffer]);
  }
}

registerProcessor('kassette', KassetteProcessor);
