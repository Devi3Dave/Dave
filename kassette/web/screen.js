// Zeichnet das Display (Canvas 2D) – je Modus eine eigene Grafik.
import { SEQ, FX, quantize, clamp01, triangle, euclidHit, VOICES } from './dsp.js';
import * as M from './meta.js';

export const ENC = ['#fa6b54', '#f7c438', '#52d1ad', '#9e8cfa'];
export const DIM = '#525252';
export const REC = '#f2403a';
export const PLAY = '#33b373';
export const LANE_TOP = 132, LANE_H = 19, LANE_STRIDE = 22;
export const padRect = (w, h) => ({ x: 18, y: 44, w: w - 36, h: h - 56 });

const ROUND = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

let c; // aktueller Kontext

function txt(s, x, y, size, color = '#fff', align = 'center', mono = false) {
  c.font = `${mono ? 600 : 700} ${size}px ${mono ? MONO : ROUND}`;
  c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle';
  c.fillText(s, x, y);
}
function line(x1, y1, x2, y2, color, width = 1) {
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'butt';
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
}
function rrect(x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, Math.max(0, w), Math.max(0, h), r); }
function circle(x, y, r, color) { c.fillStyle = color; c.beginPath(); c.arc(x, y, Math.max(0, r), 0, Math.PI * 2); c.fill(); }
const alpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const white = (a) => `rgba(255,255,255,${a})`;

function gauge(x, y, r, value, color) {
  const a0 = (135 * Math.PI) / 180;
  c.lineWidth = 7; c.lineCap = 'round';
  c.strokeStyle = white(0.12); c.beginPath(); c.arc(x, y, r, a0, a0 + Math.PI * 1.5); c.stroke();
  c.strokeStyle = color; c.beginPath(); c.arc(x, y, r, a0, a0 + Math.PI * 1.5 * clamp01(value) + 0.001); c.stroke();
}

function gauges(w, title, subtitle, api) {
  txt(title, w / 2, 62, 30);
  txt(subtitle, w / 2, 90, 11, DIM);
  for (let i = 0; i < 4; i++) {
    const info = api.info(i), x = w * (0.17 + 0.22 * i);
    gauge(x, 160, 30, info.value, ENC[i]);
    txt(info.text, x, 160, 10, '#fff', 'center', true);
  }
}

export function drawScreen(ctx, w, h, st, S, time, api) {
  c = ctx;
  c.clearRect(0, 0, w, h);
  if (st.mode === 'synth' || st.mode === 'drum') drawInstrument(w, h, st, S, time, api);
  else if (st.mode === 'tape') drawTape(w, h, st, S);
  else if (st.mode === 'mixer') drawMixer(w, h, st, S, api);
  else drawSeq(w, h, st, S);
  drawHeader(w, st, S, time, api);
  if (st.toast) {
    c.font = `700 13px ${ROUND}`;
    const tw = c.measureText(st.toast).width + 36;
    c.fillStyle = '#fff'; rrect(w / 2 - tw / 2, h - 42, tw, 30, 15); c.fill();
    txt(st.toast, w / 2, h - 27, 13, '#000');
  }
}

function drawHeader(w, st, S, time, api) {
  const patch = api.patch();
  let title;
  if (st.mode === 'synth') title = `SYNTH ${st.slot + 1} · ${patch.name}`;
  else if (st.mode === 'drum') title = `DRUM · ${patch.name}`;
  else if (st.mode === 'tape') title = `TAPE · SPUR ${st.armedTrack + 1}`;
  else if (st.mode === 'mixer') title = ['MIXER · LEVEL', 'MIXER · PAN', 'MIXER · MASTER-FX', 'MIXER · MASTER'][st.page];
  else title = `SEQ · ${M.SEQ_TITLES[st.seq.kind]}`;
  txt(title, 14, 16, 12, DIM, 'left');

  let x = w - 14;
  txt(String(Math.round(st.seq.bpm)), x, 16, 12, DIM, 'right', true);
  x -= 34;
  if (S.recording) { circle(x - 5, 16, 5, alpha(REC, Math.floor(time * 2.5) % 2 === 0 ? 1 : 0.35)); x -= 18; }
  if (S.transport) {
    c.fillStyle = PLAY; c.beginPath(); c.moveTo(x - 9, 10); c.lineTo(x, 16); c.lineTo(x - 9, 22); c.closePath(); c.fill();
  } else { c.fillStyle = DIM; c.fillRect(x - 9, 11, 9, 10); }
  x -= 22;
  if (st.metronomeOn) { txt('♩', x, 16, 13, S.transport && S.beatIndex % 4 === 1 ? ENC[1] : DIM, 'right'); x -= 18; }
  if (st.latch) txt('HOLD', x, 16, 10, ENC[2], 'right');
}

// ---------- Synth / Drum ----------

function drawInstrument(w, h, st, S, time, api) {
  const patch = api.patch();
  if (st.page === 0) { if (st.drumActive) drawPads(w, h, st, S); else drawEngine(w, h, patch, S, time); }
  else if (st.page === 1) drawEnvelope(w, h, patch.env);
  else if (st.page === 2) gauges(w, M.FX_TITLES[patch.fx], patch.fx === FX.off ? 'KEIN EFFEKT – „FX-TYP ›“ ANTIPPEN' : 'EFFEKT', api);
  else drawLFO(w, h, patch, S, api);
}

function drawEngine(w, h, patch, S, time) {
  txt(M.ENGINE_TITLES[patch.engine], 16, 50, 30, '#fff', 'left');
  txt(`${S.activeVoices}/${VOICES} STIMMEN`, w - 16, 50, 10, DIM, 'right');
  const p = patch.params, pulse = Math.min(1, S.livePeak * 2.5), cy = h * 0.62;
  for (let i = 0; i < 4; i++) {
    const cx = w * (0.2 + 0.2 * i), r = 14 + p[i] * 24 + pulse * 6, color = alpha(ENC[i], 0.9);
    if (i === 0) circle(cx, cy, r, color);
    else if (i === 1) {
      c.save(); c.translate(cx, cy); c.rotate(time * 0.5 + S.lfoValue * 0.4);
      c.strokeStyle = color; c.lineWidth = 5; rrect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7, 6); c.stroke(); c.restore();
    } else if (i === 2) {
      c.fillStyle = color; c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx + r * 0.95, cy + r * 0.7); c.lineTo(cx - r * 0.95, cy + r * 0.7); c.closePath(); c.fill();
    } else {
      c.strokeStyle = color; c.lineWidth = 3 + p[i] * 8; c.beginPath(); c.arc(cx, cy, Math.max(1, r - 4), 0, Math.PI * 2); c.stroke();
    }
  }
  // Oszilloskop
  const sc = S.scope, n = sc.length, half = 60, amp = (120 * 0.45) / Math.max(0.12, S.livePeak);
  c.strokeStyle = white(0.9); c.lineWidth = 1.6; c.lineJoin = 'round'; c.beginPath();
  for (let k = 0; k < n; k++) {
    const y = cy - Math.max(-half, Math.min(half, sc[k] * amp)), x = (w * k) / (n - 1);
    if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
}

function drawPads(w, h, st, S) {
  const r = padRect(w, h), cw = r.w / 6, ch = r.h / 2;
  for (let k = 0; k < 12; k++) {
    const x = r.x + (k % 6) * cw + 3, y = r.y + Math.floor(k / 6) * ch + 3, pw = cw - 6, phh = ch - 6;
    const glow = Math.max(0, 1 - S.hits[k] / 0.25), color = ENC[k % 4];
    c.fillStyle = alpha(color, 0.12 + 0.75 * glow); rrect(x, y, pw, phh, 9); c.fill();
    c.strokeStyle = alpha(color, 0.6); c.lineWidth = 1.5; rrect(x, y, pw, phh, 9); c.stroke();
    txt(M.DRUM_NAMES[k], x + pw / 2, y + phh / 2 - 6, 13, glow > 0.5 ? '#000' : '#fff');
    txt(M.noteName(48 + st.octave * 12 + 12 + k), x + pw / 2, y + phh / 2 + 12, 9, glow > 0.5 ? 'rgba(0,0,0,.6)' : DIM);
  }
}

function drawEnvelope(w, h, env) {
  const left = 24, top = 52, bottom = h - 24, seg = (w - 2 * left) / 4.2;
  const susY = bottom - env[2] * (bottom - top);
  const pts = [[left, bottom]];
  pts.push([pts[0][0] + (0.08 + env[0]) * seg, top]);
  pts.push([pts[1][0] + (0.08 + env[1]) * seg, susY]);
  pts.push([pts[2][0] + seg, susY]);
  pts.push([pts[3][0] + (0.08 + env[3]) * seg, bottom]);
  line(left, bottom, w - left, bottom, white(0.15));
  for (let i = 0; i < 4; i++) {
    c.strokeStyle = ENC[i]; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(pts[i][0], pts[i][1]);
    if (i === 1 || i === 3) c.quadraticCurveTo(pts[i][0] + 4, pts[i + 1][1], pts[i + 1][0], pts[i + 1][1]);
    else c.lineTo(pts[i + 1][0], pts[i + 1][1]);
    c.stroke();
  }
  for (let i = 1; i < 5; i++) circle(pts[i][0], pts[i][1], 5, ENC[i - 1]);
  txt('HÜLLKURVE', w - 16, 44, 11, DIM, 'right');
}

function drawLFO(w, h, patch, S, api) {
  const lfo = patch.lfo, shape = quantize(lfo[2], 5), depth = Math.max(0.08, lfo[1]);
  const mid = h * 0.58, amp = h * 0.28 * depth, left = 20, width = w - 40, steps = 200;
  let hold = 0.6;
  c.strokeStyle = ENC[2]; c.lineWidth = 3; c.lineJoin = 'round'; c.beginPath();
  for (let k = 0; k <= steps; k++) {
    const ph = ((k / steps) * 2) % 1;
    let v;
    if (shape === 0) v = Math.sin(Math.PI * 2 * ph);
    else if (shape === 1) v = triangle(ph);
    else if (shape === 2) v = 2 * ph - 1;
    else if (shape === 3) v = ph < 0.5 ? 1 : -1;
    else { if (k % 25 === 0) hold = Math.sin(k * 12.9898) * 0.9; v = hold; }
    const x = left + (width * k) / steps, y = mid - v * amp;
    if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
  circle(left + (width * S.lfoPhase) / 2, mid - S.lfoValue * amp, 7, '#fff');
  txt(`LFO → ${api.info(3).text}`, 16, 50, 22, '#fff', 'left');
}

// ---------- Tape ----------

function drawReel(x, y, r, angle) {
  circle(x, y, r, white(0.1));
  c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 15, 0, Math.PI * 2); c.stroke();
  for (let k = 0; k < 3; k++) { const a = angle + (k * 2 * Math.PI) / 3; line(x, y, x + Math.cos(a) * 15, y + Math.sin(a) * 15, '#fff', 2.5); }
  circle(x, y, 3, '#08080a');
}

function drawTape(w, h, st, S) {
  const sr = S.sr, progress = S.playhead / S.length, angle = (S.playhead / sr) * 2.2;
  const lx = w * 0.22, rx = w * 0.78, ry = 78, rl = 22 + 22 * (1 - progress), rr = 22 + 22 * progress;
  drawReel(lx, ry, rl, angle); drawReel(rx, ry, rr, angle);
  c.strokeStyle = white(0.35); c.lineWidth = 1.5; c.beginPath();
  c.moveTo(lx, ry + rl); c.lineTo(w / 2 - 20, 118); c.lineTo(w / 2 + 20, 118); c.lineTo(rx, ry + rr); c.stroke();

  txt(M.clock(S.playhead / sr), w / 2, 66, 26, S.recording ? REC : '#fff', 'center', true);
  const status = S.recording ? '● REC' : S.running ? '▶ PLAY' : '■ STOP';
  txt(status + (Math.abs(S.speed) < 0.01 ? '' : `  ×${S.speed.toFixed(2)}`), w / 2, 94, 11, S.recording ? REC : DIM);

  const win = 12 * sr, startPos = S.playhead - win / 2, left = 26, width = w - left - 10;
  const cols = S.ov.length / 4;
  for (let t = 0; t < 4; t++) {
    const y = LANE_TOP + t * LANE_STRIDE, armed = st.armedTrack === t, muted = st.mixer.mutes[t];
    c.fillStyle = armed ? alpha(ENC[t], 0.16) : white(0.05); rrect(left, y, width, LANE_H, 4); c.fill();
    txt(String(t + 1), 13, y + LANE_H / 2, 11, armed ? ENC[t] : DIM);
    c.strokeStyle = muted ? DIM : armed ? ENC[t] : white(0.7); c.lineWidth = 1.4; c.beginPath();
    for (let k = 0; k < cols; k++) {
      const v = Math.min(1, S.ov[t * cols + k]);
      if (v <= 0.004) continue;
      const x = left + (k / cols) * width, hh = Math.max(0.6, v * LANE_H * 0.5);
      c.moveTo(x, y + LANE_H / 2 - hh); c.lineTo(x, y + LANE_H / 2 + hh);
    }
    c.stroke();
  }
  const bottom = LANE_TOP + 4 * LANE_STRIDE;
  if (S.hasLoop) {
    const x1 = left + ((S.loopStart - startPos) / win) * width, x2 = left + ((S.loopEnd - startPos) / win) * width;
    const a = Math.max(left, x1), b = Math.min(left + width, x2);
    if (b > a) { c.fillStyle = alpha(ENC[1], S.loopOn ? 0.16 : 0.06); c.fillRect(a, LANE_TOP - 4, b - a, bottom - LANE_TOP + 2); }
    for (const x of [x1, x2]) if (x >= left && x <= left + width) line(x, LANE_TOP - 6, x, bottom, alpha(ENC[1], S.loopOn ? 1 : 0.4), 2);
  }
  line(left + width / 2, LANE_TOP - 8, left + width / 2, bottom + 2, S.recording ? REC : '#fff', 2);
}

// ---------- Mixer ----------

function drawMixer(w, h, st, S, api) {
  if (st.page === 2) return gauges(w, M.FX_TITLES[st.mixer.masterFX], 'MASTER-EFFEKT AUF DER SUMME', api);
  if (st.page === 3) return gauges(w, 'MASTER', 'LAUTSTÄRKE · MONITOR · TEMPO · CLICK', api);
  const top = 46, bottom = h - 34, full = bottom - top, bw = 30;
  for (let i = 0; i < 4; i++) {
    const x = w * (0.14 + 0.18 * i), muted = st.mixer.mutes[i], color = muted ? DIM : ENC[i];
    c.fillStyle = white(0.06); rrect(x - bw / 2, top, bw, full, 5); c.fill();
    const lv = st.mixer.levels[i];
    c.fillStyle = alpha(color, st.page === 0 ? 0.85 : 0.35); rrect(x - bw / 2, bottom - full * lv, bw, full * lv, 5); c.fill();
    const pk = Math.min(1, S.trackPeaks[i]);
    c.fillStyle = '#fff'; c.fillRect(x + bw / 2 + 4, bottom - full * pk, 4, full * pk);
    line(x - 24, bottom + 14, x + 24, bottom + 14, white(0.2), 2);
    circle(x - 24 + 48 * st.mixer.pans[i], bottom + 14, 5, st.page === 1 ? color : white(0.6));
    txt(muted ? 'M' : String(i + 1), x, top + 14, 13, muted ? REC : lv > 0.92 ? '#000' : '#fff');
  }
  const ox = w * 0.9, out = Math.min(1, S.outPeak), live = Math.min(1, S.livePeak * 2);
  c.fillStyle = '#fff'; c.fillRect(ox - 10, bottom - full * out, 8, full * out);
  c.fillStyle = ENC[2]; c.fillRect(ox + 2, bottom - full * live, 8, full * live);
  txt('OUT', ox, bottom + 14, 9, DIM);
}

// ---------- Sequencer ----------

function drawSeq(w, h, st, S) {
  const q = st.seq;
  if (q.kind === SEQ.off) {
    txt('SEQUENCER AUS', w / 2, 100, 26);
    txt('„MODUS ›“ ANTIPPEN: PATTERN · ARP · EUCLID', w / 2, 136, 10, DIM);
  } else if (q.kind === SEQ.pattern) {
    const left = 16, cw = (w - 32) / 16, top = 46, bottom = h - 16, ch = bottom - top;
    for (let i = 0; i < 16; i++) {
      const x = left + i * cw + 2, inRange = i < q.length, playing = S.playingStep === i && S.transport;
      c.fillStyle = white(playing ? 0.28 : inRange ? 0.07 : 0.02); rrect(x, top, cw - 4, ch, 5); c.fill();
      const note = S.steps[i] ?? -1;
      if (note >= 0 && inRange) {
        const bh = 14 + (Math.min(Math.max(note - 24, 0), 72) / 72) * (ch - 40);
        c.fillStyle = ENC[Math.floor(i / 4) % 4]; rrect(x + 4, bottom - bh - 4, cw - 12, bh, 3); c.fill();
        txt(M.noteName(note + S.transpose), x + (cw - 4) / 2, top + 11, 8);
      }
      if (S.cursor === i && !S.transport) { c.strokeStyle = '#fff'; c.lineWidth = 2; rrect(x, top, cw - 4, ch, 5); c.stroke(); }
    }
    if (S.transport) txt('TASTE = TRANSPONIEREN', w / 2, 36, 9, DIM);
    else txt(`TASTEN SCHREIBEN IN STEP ${S.cursor + 1}`, w / 2, 36, 9, ENC[0]);
  } else if (q.kind === SEQ.arp) {
    txt(`ARP · ${M.ARP_MODES[q.arpMode]} · ${M.RATE_NAMES[q.arpRate]}`, 16, 50, 20, '#fff', 'left');
    const count = S.held.length;
    if (!count) { txt('AKKORD AUF DER TASTATUR HALTEN', w / 2, 140, 12, DIM); return; }
    const sorted = q.arpMode === 4 ? S.held : [...S.held].sort((a, b) => a - b);
    const total = count * Math.max(1, q.arpOctaves), cw = (w - 40) / total;
    for (let k = 0; k < total; k++) {
      const note = sorted[k % count] + 12 * Math.floor(k / count), on = S.playingStep === k;
      circle(20 + k * cw + cw / 2, h - 30 - (Math.min(Math.max(note - 24, 0), 84) / 84) * 120, on ? 11 : 7, on ? '#fff' : ENC[k % 4]);
    }
  } else {
    const cx = w * 0.36, cy = h * 0.58, radius = 72, n = Math.max(1, q.euclidSteps);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2, hit = euclidHit(i, n, q.euclidPulses, q.euclidRotate);
      const on = S.playingStep === i && S.held.length > 0;
      circle(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, on ? 9 : hit ? 7 : 3, on ? '#fff' : hit ? ENC[2] : DIM);
    }
    txt(`${q.euclidPulses}/${n}`, cx, cy, 22, '#fff', 'center', true);
    txt('EUKLIDISCH', w * 0.72, 90, 18);
    txt(S.held.length ? `${S.held.length} TASTE(N)` : 'TASTEN HALTEN', w * 0.72, 118, 11, DIM);
  }
}
