// Lernmodus: geführte Lektionen. Jeder Schritt erklärt etwas, markiert das passende
// Bedienelement und gilt als erledigt, sobald seine Bedingung erfüllt ist.

const LEARN_KEY = 'kassette.learn.v1';
const KICK = 0, SNARE = 2, HAT = 6;

// ---------- Ziel-Helfer (liefern die Elemente, die markiert werden) ----------

const q = (sel) => () => [...document.querySelectorAll(sel)];
const btn = (id) => q(`.hw[data-id="${id}"]`);
const enc = (i) => q(`.enc:nth-child(${i + 1})`);
const slot = (i) => q(`.slot:nth-child(${i + 1})`);
const chip = (text) => () => [...document.querySelectorAll('.chip')].filter((c) => c.textContent.includes(text));
const screen = q('.screenwrap');
const keyboard = q('#keyboard');
// Tasten nach Tonname (0 = C … 11 = H); markiert die erste passende Taste je Ton
const keys = (...pcs) => (c) => pcs.map((pc) => document.querySelector(`.key[data-index="${(((pc - c.base()) % 12) + 12) % 12}"]`)).filter(Boolean);
const many = (...fns) => (c) => fns.flatMap((f) => f(c));

// ---------- Bedingungs-Helfer ----------

const played = (c) => c.ev.log.slice(c.mark.notes);
const playedPcs = (c) => new Set(played(c).map((n) => ((n % 12) + 12) % 12));
const hasAll = (c, pcs) => { const s = playedPcs(c); return pcs.every((p) => s.has(p)); };
const turned = (c, i, amount = 0.08) => Math.abs(c.ev.turn[i] - c.mark.turn[i]) > amount;
const stepIs = (c, i, pc) => c.S.steps[i] >= 0 && c.S.steps[i] % 12 === pc;
const inOrder = (c, pcs) => {
  let k = 0;
  for (const n of played(c)) if (((n % 12) + 12) % 12 === pcs[k]) { k++; if (k === pcs.length) return true; }
  return false;
};

const DEMO_BEAT = [48, -1, 54, -1, 50, -1, 54, -1, 48, -1, 54, 48, 50, -1, 54, -1];

// ---------- Lektionen ----------

export const LESSONS = [
  {
    title: 'Erste Töne',
    intro: 'Klaviatur, Oktaven und dein erster Akkord.',
    setup: (a) => { a.selectSlot(0); a.selectMode('synth'); a.setSeqKind(0); },
    steps: [
      { text: 'Willkommen! Musik beginnt mit einem Ton. Spiele <b>5 beliebige Tasten</b> auf der Klaviatur – je weiter unten du eine Taste triffst, desto lauter klingt sie.', target: keyboard, done: (c) => played(c).length >= 5 },
      { text: 'Die weißen Tasten heißen C D E F G A H – danach wiederholt sich alles eine <b>Oktave</b> höher. Schalte mit <b>OKT +</b> eine Oktave nach oben und spiele wieder.', target: btn('octUp'), done: (c) => c.st.octave > c.mark.octave && played(c).length >= 1 },
      { text: 'Hoch klingt hell, tief klingt warm. Gehe mit <b>OKT −</b> wieder zurück auf Oktave 0.', target: btn('octDown'), done: (c) => c.st.octave === 0 },
      { text: 'Jetzt eine kleine Melodie: Spiele nacheinander <b>C – D – E – C</b>. Die Tasten sind markiert.', target: keys(0, 2, 4), done: (c) => inOrder(c, [0, 2, 4, 0]) },
      { text: 'Mehrere Töne zusammen ergeben einen <b>Akkord</b>. Spiele <b>C, E und G</b> – am besten gleichzeitig. Das ist C-Dur, der fröhliche Grundakkord.', target: keys(0, 4, 7), done: (c) => hasAll(c, [0, 4, 7]) },
      { text: 'Rechts findest du <b>8 Sounds</b>. Tippe auf <b>Sound 2</b> (eine Glocke) und spiele denselben Akkord noch einmal.', target: slot(1), done: (c) => c.st.slot === 1 && played(c).length >= 2 },
      { text: 'Probiere noch <b>Sound 4</b> – eine gezupfte Saite. Jeder Sound gibt derselben Melodie einen anderen Charakter.', target: slot(3), done: (c) => c.st.slot === 3 && played(c).length >= 2 },
    ],
  },
  {
    title: 'Klang formen',
    intro: 'Engine, Hüllkurve, Effekt und LFO – so entsteht dein eigener Sound.',
    setup: (a) => { a.selectSlot(0); a.selectMode('synth'); a.selectPage(0); a.setSeqKind(0); },
    steps: [
      { text: 'Die vier farbigen Regler steuern immer die vier gleichfarbigen Werte im Display. Halte eine Taste und <b>ziehe am roten Regler</b> nach oben: SHAPE verwandelt die Welle von weich zu scharf.', target: enc(0), done: (c) => turned(c, 0) },
      { text: 'Drehe jetzt den <b>gelben Regler</b> (FOLD). Die weiße Linie im Display ist dein Klang – du siehst, wie er sich verformt.', target: enc(1), done: (c) => turned(c, 1) },
      { text: 'Eine <b>Engine</b> ist die Art der Klangerzeugung. Tippe auf <b>ENGINE ›</b> und höre dir die nächste an.', target: chip('ENGINE'), done: (c) => c.patch().engine !== c.mark.engine },
      { text: 'Wechsle mit Taste <b>2 · ENV</b> zur Hüllkurve. Sie bestimmt, wie ein Ton über die Zeit verläuft.', target: btn('page1'), done: (c) => c.st.page === 1 },
      { text: '<b>ATTACK</b> ist die Einschwingzeit. Drehe den roten Regler hoch, bis der Ton langsam anschwillt (über 300 ms) – so klingen Flächen und Streicher.', target: enc(0), done: (c) => c.patch().env[0] > 0.27 },
      { text: '<b>RELEASE</b> (lila) ist das Ausklingen nach dem Loslassen. Drehe ihn hoch und tippe kurz eine Taste an – der Ton schwebt nach.', target: enc(3), done: (c) => c.patch().env[3] > 0.5 && played(c).length >= 1 },
      { text: 'Weiter zu Taste <b>3 · FX</b>: Effekte geben dem Klang Raum.', target: btn('page2'), done: (c) => c.st.page === 2 },
      { text: 'Tippe auf <b>FX-TYP ›</b> und schalte durch: DELAY ist ein Echo, SPACE ein Hall, FILTER macht dumpf oder hell, DRIVE verzerrt, CHORUS macht breit.', target: chip('FX-TYP'), done: (c) => c.patch().fx !== c.mark.fx },
      { text: 'Zuletzt Taste <b>4 · LFO</b>: Der LFO dreht für dich automatisch an einem Regler – das bringt Bewegung in den Klang.', target: btn('page3'), done: (c) => c.st.page === 3 },
      { text: 'Drehe <b>DEPTH</b> (gelb) auf und wähle mit <b>ZIEL ›</b>, was der LFO bewegt. Halte dabei einen Ton. PITCH ergibt Vibrato, AMP ein Tremolo.', target: many(enc(1), chip('ZIEL')), done: (c) => c.patch().lfo[1] > 0.3 && turned(c, 1, 0.02) },
    ],
  },
  {
    title: 'Dein erster Beat',
    intro: 'Kick, Snare und Hi-Hat im Step-Sequencer programmieren.',
    setup: (a) => { a.setSeqKind(0); a.stopAll(); },
    steps: [
      { text: 'Ein Beat ist das Fundament fast jedes Songs. Drücke <b>DRUM</b> – jetzt liegt auf jeder Taste ein Schlagzeug-Sound.', target: btn('drum'), done: (c) => c.st.mode === 'drum' && c.st.drumActive },
      { text: 'Die drei wichtigsten: <b>KICK</b> (tiefer Bumms), <b>SNARE</b> (der Knall) und <b>HAT C</b> (das Zischen). Spiele alle drei einmal an.', target: keys(KICK, SNARE, HAT), done: (c) => hasAll(c, [KICK, SNARE, HAT]) },
      { text: 'Der Sequencer spielt den Beat für dich in Schleife. Drücke <b>SEQ</b>.', target: btn('seq'), done: (c) => c.st.mode === 'seq' },
      { text: 'Tippe auf <b>MODUS ›</b>, bis oben <b>PATTERN</b> steht. Du siehst 16 Steps = ein Takt in Sechzehnteln.', target: chip('MODUS'), done: (c) => c.st.seq.kind === 1 },
      { text: 'Wir fangen leer an: Tippe auf <b>LEEREN</b>.', target: chip('LEEREN'), done: (c) => c.S.steps.every((s) => s < 0) },
      { text: 'Der weiße Rahmen zeigt, wohin geschrieben wird. Er steht auf Step 1 – spiele die <b>KICK</b>. Die Kick auf der „Eins“ gibt den Puls.', target: keys(KICK), done: (c) => stepIs(c, 0, KICK) },
      { text: 'Tippe im Display auf <b>Step 5</b> und spiele die <b>SNARE</b>. Die Snare ist die Antwort auf die Kick.', target: many(screen, keys(SNARE)), done: (c) => stepIs(c, 4, SNARE) },
      { text: 'Das Ganze noch einmal: <b>KICK auf Step 9</b>, <b>SNARE auf Step 13</b>. Kick – Snare – Kick – Snare ist der Grundbeat von Pop, Rock und Hip-Hop.', target: many(screen, keys(KICK, SNARE)), done: (c) => stepIs(c, 8, KICK) && stepIs(c, 12, SNARE) },
      { text: 'Jetzt die Hi-Hat für den Antrieb: Setze <b>HAT C</b> auf mindestens drei der Steps <b>3, 7, 11, 15</b> (Step antippen, dann Taste spielen).', target: many(screen, keys(HAT)), done: (c) => [2, 6, 10, 14].filter((i) => stepIs(c, i, HAT)).length >= 3 },
      { text: 'Drücke <b>PLAY</b> und höre dir deinen Beat an!', target: btn('play'), done: (c) => c.S.transport },
      { text: 'Taste <b>1 · SEQ</b> zeigt die Grundeinstellungen. Drehe am gelben Regler das <b>TEMPO</b>: 90 BPM ist entspannt, 120 tanzbar, 170 hektisch.', target: many(btn('page0'), enc(1)), done: (c) => c.st.page === 0 && Math.abs(c.st.seq.bpm - c.mark.bpm) >= 8 },
      { text: 'Der grüne Regler <b>SWING</b> verschiebt jeden zweiten Schlag leicht nach hinten – der Beat „groovt“ statt zu marschieren. Probiere es aus.', target: enc(2), done: (c) => c.st.seq.swing > 0.15 },
      { text: 'Sehr gut! Drücke <b>STOP</b>. Dein Pattern bleibt gespeichert.', target: btn('stop'), done: (c) => !c.S.transport },
    ],
  },
  {
    title: 'Aufnehmen',
    intro: 'Beat und Bass nacheinander auf zwei Bandspuren aufnehmen.',
    setup: (a, c) => {
      a.stopAll();
      a.armTrack(0);
      a.selectMode('drum');
      if (c.S.steps.every((s) => s < 0) || c.st.seq.kind !== 1) a.setPattern(DEMO_BEAT);
      a.setSeqKind(1);
    },
    steps: [
      { text: 'Ein Song entsteht Schicht für Schicht: erst der Beat, dann der Bass, dann die Melodie. Dafür gibt es das Band mit 4 Spuren. Drücke <b>TAPE</b>.', target: btn('tape'), done: (c) => c.st.mode === 'tape' },
      { text: 'Spur 1 ist ausgewählt, dein Beat steht bereit. Drücke <b>REC</b> – die Aufnahme startet sofort und der Beat läuft aufs Band.', target: btn('rec'), done: (c) => c.S.recording },
      { text: 'Lass etwa <b>8 Sekunden</b> laufen (die Zeit steht groß im Display), dann drücke <b>STOP</b>.', target: btn('stop'), done: (c) => !c.S.transport && c.S.recordedEnd > c.S.sr * 6 },
      { text: 'Drücke <b>STOP</b> noch einmal – im Stillstand spult das Band zum Anfang zurück.', target: btn('stop'), done: (c) => c.S.playhead < c.S.sr * 0.3 },
      { text: 'Der Beat ist jetzt auf dem Band, der Sequencer wird nicht mehr gebraucht. Drücke <b>SEQ</b> und tippe <b>MODUS ›</b>, bis <b>OFF</b> dasteht.', target: many(btn('seq'), chip('MODUS')), done: (c) => c.st.seq.kind === 0 },
      { text: 'Jetzt der Bass: Tippe auf <b>Sound 5</b>.', target: slot(4), done: (c) => !c.st.drumActive && c.st.slot === 4 },
      { text: 'Der Bass spielt tiefe, einfache Töne und verbindet Rhythmus mit Harmonie. Gehe mit <b>OKT −</b> eine Oktave tiefer und probiere ein paar Töne.', target: btn('octDown'), done: (c) => c.st.octave < 0 && played(c).length >= 3 },
      { text: 'Zurück zu <b>TAPE</b> und wähle mit Taste <b>T2</b> die zweite Spur – sonst würdest du über den Beat aufnehmen.', target: many(btn('tape'), btn('page1')), done: (c) => c.st.mode === 'tape' && c.st.armedTrack === 1 },
      { text: 'Drücke <b>REC</b> und spiele zum Beat einen Bass. Tipp: Bleib bei <b>C</b> und spiele im Takt der Kick – weniger ist mehr. Spiele mindestens 6 Töne.', target: many(btn('rec'), keys(0)), done: (c) => c.S.recording && played(c).length >= 6 },
      { text: 'Drücke <b>STOP</b>.', target: btn('stop'), done: (c) => !c.S.transport },
      { text: 'Zweimal Schluss, einmal los: <b>STOP</b> spult zurück, <b>PLAY</b> spielt beide Spuren zusammen ab. Hör dir dein erstes Arrangement an!', target: many(btn('stop'), btn('play')), done: (c) => c.S.transport && !c.S.recording && c.S.trackPeaks[0] + c.S.trackPeaks[1] > 0.02 },
      { text: 'Nicht zufrieden? <b>UNDO</b> nimmt die letzte Aufnahme zurück, <b>SPUR LÖSCHEN</b> leert die gewählte Spur. Drücke <b>STOP</b>, wenn du fertig gehört hast.', target: btn('stop'), done: (c) => !c.S.transport },
    ],
  },
  {
    title: 'Akkorde & Melodie',
    intro: 'Tonleiter, die vier wichtigsten Akkorde und der Arpeggiator.',
    setup: (a) => { a.stopAll(); a.setSeqKind(0); a.selectSlot(6); a.selectMode('synth'); a.setOctave(0); },
    steps: [
      { text: 'Die <b>C-Dur-Tonleiter</b> besteht nur aus weißen Tasten. Spiele sie von C aufwärts: <b>C D E F G A H C</b>. Melodien aus diesen Tönen klingen immer „richtig“ zusammen.', target: keys(0, 2, 4, 5, 7, 9, 11), done: (c) => inOrder(c, [0, 2, 4, 5, 7, 9, 11, 0]) },
      { text: 'Ein Akkord entsteht, wenn du von einem Ton aus <b>immer eine weiße Taste überspringst</b>. Spiele <b>C – E – G</b>: C-Dur.', target: keys(0, 4, 7), done: (c) => hasAll(c, [0, 4, 7]) },
      { text: 'Dasselbe Muster von A aus: <b>A – C – E</b> ist <b>a-Moll</b>. Moll klingt nachdenklich, Dur klingt hell.', target: keys(9, 0, 4), done: (c) => hasAll(c, [9, 0, 4]) },
      { text: 'Von F aus: <b>F – A – C</b> ist <b>F-Dur</b>.', target: keys(5, 9, 0), done: (c) => hasAll(c, [5, 9, 0]) },
      { text: 'Und von G aus: <b>G – H – D</b> ist <b>G-Dur</b>. Mit <b>C · a-Moll · F · G</b> kannst du tausende bekannte Songs begleiten.', target: keys(7, 11, 2), done: (c) => hasAll(c, [7, 11, 2]) },
      { text: 'Der <b>Arpeggiator</b> spielt die Töne eines Akkords nacheinander – sofort eine Melodie. Drücke <b>SEQ</b> und tippe <b>MODUS ›</b>, bis <b>ARP</b> dasteht.', target: many(btn('seq'), chip('MODUS')), done: (c) => c.st.mode === 'seq' && c.st.seq.kind === 2 },
      { text: 'Schalte <b>HOLD</b> ein, damit der Akkord weiterläuft, wenn du loslässt.', target: chip('HOLD'), done: (c) => c.st.latch },
      { text: 'Spiele jetzt <b>C – E – G</b>. Der Arpeggiator übernimmt.', target: keys(0, 4, 7), done: (c) => c.S.held.length >= 3 },
      { text: 'Taste <b>2 · EDIT</b> zeigt die Arp-Regler. Ändere <b>MODE</b> (gelb): UP, DOWN, UP/DN, RANDOM. Mit OCTAVES (grün) wird das Muster größer.', target: many(btn('page1'), enc(1)), done: (c) => c.st.page === 1 && c.st.seq.arpMode !== c.mark.arpMode },
      { text: 'Spiele nun nacheinander die vier Akkorde <b>C · a-Moll · F · G</b>. Jeder neue Akkord ersetzt den alten – das ist schon eine Songbegleitung.', target: keyboard, done: (c) => hasAll(c, [0, 4, 7, 9, 5, 11, 2]) },
      { text: 'Schalte <b>HOLD</b> wieder aus – dann ist Ruhe. Tipp: Nimm so einen Arp auf Spur 3 auf!', target: chip('HOLD'), done: (c) => !c.st.latch },
    ],
  },
  {
    title: 'Mischen & Export',
    intro: 'Lautstärke, Panorama, Master-Effekt und der fertige Song als Datei.',
    setup: (a) => { a.stopAll(); a.setSeqKind(0); },
    steps: [
      { text: 'Beim Mischen bringst du die Spuren ins Gleichgewicht. Drücke <b>MIXER</b>. (Am besten hast du vorher in „Aufnehmen“ etwas aufs Band gebracht.)', target: btn('mixer'), done: (c) => c.st.mode === 'mixer' },
      { text: 'Starte mit <b>PLAY</b> – die weißen Striche neben den Balken zeigen, was auf jeder Spur passiert.', target: btn('play'), done: (c) => c.S.transport },
      { text: 'Jeder Regler ist die Lautstärke seiner Spur. Ziehe <b>eine Spur leiser</b>. Faustregel: Kick und Bass sind das Fundament, alles andere ordnet sich unter.', target: many(enc(0), enc(1)), done: (c) => [0, 1, 2, 3].some((i) => turned(c, i)) },
      { text: 'Encoder <b>antippen</b> schaltet eine Spur stumm (MUTE) – ideal, um einzelne Spuren zu prüfen. Tippe einen an und wieder zurück.', target: enc(0), done: (c) => c.ev.mutes - c.mark.mutes >= 2 },
      { text: 'Taste <b>2 · PAN</b>: Hier verteilst du die Spuren zwischen links und rechts.', target: btn('page1'), done: (c) => c.st.page === 1 },
      { text: 'Schiebe eine Spur zur Seite. Bass und Kick bleiben in der Mitte, Melodien und Hi-Hats dürfen an den Rand – so wird der Mix breit.', target: many(enc(2), enc(3)), done: (c) => [0, 1, 2, 3].some((i) => turned(c, i)) },
      { text: 'Taste <b>3 · M-FX</b> ist ein Effekt auf dem ganzen Song. Etwas SPACE (Hall) verbindet alle Spuren zu einem Raum. Drehe am grünen Regler <b>MIX</b>.', target: many(btn('page2'), enc(2)), done: (c) => c.st.page === 2 && turned(c, 2, 0.04) },
      { text: 'Drücke <b>STOP</b>. Jetzt wird exportiert!', target: btn('stop'), done: (c) => !c.S.transport },
      { text: 'Öffne <b>ALBUM</b> und tippe auf <b>„Band als WAV abmischen“</b>. Die Datei kannst du speichern und verschicken. Mit „Band sichern“ bleibt dein Projekt im Browser erhalten.', target: btn('album'), done: (c) => c.ev.exports > c.mark.exports },
    ],
  },
  {
    title: 'Band-Tricks',
    intro: 'Loop, halbe Geschwindigkeit und rückwärts – das Band als Instrument.',
    setup: (a) => { a.stopAll(); a.setSeqKind(0); a.selectMode('tape'); },
    steps: [
      { text: 'Das Band kann mehr als aufnehmen. Dafür brauchst du etwas darauf – sonst erst die Lektion „Aufnehmen“ machen. Drücke <b>PLAY</b>.', target: btn('play'), done: (c) => c.S.transport },
      { text: 'Drehe <b>SPEED</b> (rot) langsam herunter. Das Band wird langsamer <b>und tiefer</b> – wie bei einer echten Kassette. Bei ×0.50 klingt alles eine Oktave tiefer.', target: enc(0), done: (c) => c.S.speed > 0 && c.S.speed < 0.7 },
      { text: 'Drehe weiter, bis das Band <b>rückwärts</b> läuft (◀). Rückwärts-Becken und -Hall sind ein klassischer Studiotrick.', target: enc(0), done: (c) => c.S.speed < -0.2 },
      { text: '<b>Tippe den roten Regler an</b> – das stellt wieder normale Geschwindigkeit ein.', target: enc(0), done: (c) => Math.abs(c.S.speed - 1) < 0.05 },
      { text: 'Tippe auf <b>LOOP</b>: Ein Takt ab der aktuellen Stelle wird endlos wiederholt. Loops sind die Basis von elektronischer Musik und Hip-Hop.', target: chip('LOOP'), done: (c) => c.S.loopOn },
      { text: 'Mit <b>LOOP IN</b> (grün) und <b>LOOP OUT</b> (lila) verschiebst du Anfang und Ende. Verändere die Loop-Länge.', target: many(enc(2), enc(3)), done: (c) => turned(c, 2, 0.02) || turned(c, 3, 0.02) },
      { text: '<b>LIFT</b> schneidet den Loop aus der gewählten Spur heraus und merkt ihn sich. Tippe darauf.', target: chip('LIFT'), done: (c) => c.ev.lifts > c.mark.lifts },
      { text: 'Schalte <b>LOOP</b> aus, drehe <b>POSITION</b> (gelb) an eine andere Stelle und tippe auf <b>DROP</b> – so kopierst und arrangierst du Teile deines Songs.', target: many(chip('LOOP'), enc(1), chip('DROP')), done: (c) => c.ev.drops > c.mark.drops },
      { text: 'Geschafft – du kennst jetzt das ganze Gerät. Drücke <b>STOP</b> und mach deinen eigenen Song!', target: btn('stop'), done: (c) => !c.S.transport },
    ],
  },
];

// ---------- Ablauf ----------

export function createLearn(app) {
  const $ = (id) => document.getElementById(id);
  const ev = { log: [], turn: [0, 0, 0, 0], exports: 0, mutes: 0, lifts: 0, drops: 0 };
  let done = [];
  try { done = JSON.parse(localStorage.getItem(LEARN_KEY) || '[]'); } catch { done = []; }
  let lesson = -1, step = 0, mark = null, doneAt = 0, finished = false, marked = [];

  const ctx = () => ({ st: app.st, S: app.S(), ev, mark, patch: app.patch, base: app.baseNote });
  const snapshot = () => {
    const p = app.patch();
    mark = { notes: ev.log.length, turn: [...ev.turn], exports: ev.exports, mutes: ev.mutes, lifts: ev.lifts, drops: ev.drops,
      octave: app.st.octave, engine: p.engine, fx: p.fx, bpm: app.st.seq.bpm, arpMode: app.st.seq.arpMode };
  };

  function clearMarks() { for (const el of marked) el.classList.remove('hl'); marked = []; }

  function render() {
    const L = LESSONS[lesson];
    if (finished) {
      $('coachTitle').textContent = `LEKTION ${lesson + 1} · ${L.title.toUpperCase()} · GESCHAFFT`;
      const next = LESSONS[lesson + 1];
      $('coachText').innerHTML = next ? `Stark! Als Nächstes: <b>${next.title}</b> – ${next.intro}` : 'Du hast alle Lektionen abgeschlossen. Jetzt bist du dran – viel Spaß beim Musikmachen!';
      $('coachSkip').textContent = next ? 'Nächste Lektion ›' : 'Fertig';
      $('coachBack').disabled = true;
      $('coachDots').innerHTML = '';
      return;
    }
    $('coachTitle').textContent = `LEKTION ${lesson + 1} · ${L.title.toUpperCase()} · SCHRITT ${step + 1}/${L.steps.length}`;
    $('coachText').innerHTML = L.steps[step].text;
    $('coachSkip').textContent = 'Überspringen ›';
    $('coachBack').disabled = step === 0;
    $('coachDots').innerHTML = L.steps.map((_, i) => `<i class="${i < step ? 'd' : i === step ? 'c' : ''}"></i>`).join('');
  }

  function goto(i) { step = i; doneAt = 0; finished = false; snapshot(); $('coach').classList.remove('ok'); render(); }

  function start(i) {
    lesson = i; ev.log.length = 0; finished = false;
    $('coach').hidden = false;
    document.body.classList.add('learning');
    snapshot();
    if (LESSONS[i].setup) LESSONS[i].setup(app, ctx());
    goto(0);
    app.layout();
  }

  function quit() {
    lesson = -1; clearMarks();
    $('coach').hidden = true;
    document.body.classList.remove('learning');
    app.layout();
  }

  function advance() {
    const L = LESSONS[lesson];
    if (finished) { if (LESSONS[lesson + 1]) start(lesson + 1); else quit(); return; }
    if (step + 1 < L.steps.length) { goto(step + 1); return; }
    finished = true; clearMarks();
    if (!done.includes(lesson)) { done.push(lesson); try { localStorage.setItem(LEARN_KEY, JSON.stringify(done)); } catch { /* egal */ } }
    $('coach').classList.remove('ok');
    render();
  }

  // Wird in jedem Bild aufgerufen: Bedingung prüfen und Ziel markieren.
  function tick(now) {
    if (lesson < 0 || finished) return;
    const s = LESSONS[lesson].steps[step], c = ctx();
    let els = [];
    try { els = doneAt ? [] : s.target ? s.target(c) : []; } catch { els = []; }
    if (els.length !== marked.length || els.some((e, i) => e !== marked[i])) {
      clearMarks();
      for (const el of els) el.classList.add('hl');
      marked = els;
    }
    if (doneAt) { if (now - doneAt > 900) advance(); return; }
    let ok = false;
    try { ok = !!s.done(c); } catch { ok = false; }
    if (ok) { doneAt = now; $('coach').classList.add('ok'); }
  }

  function renderMenu() {
    $('lessonList').innerHTML = LESSONS.map((L, i) =>
      `<button class="lesson${done.includes(i) ? ' done' : ''}" data-i="${i}"><b>${done.includes(i) ? '✓' : i + 1}</b><span><strong>${L.title}</strong><small>${L.intro} · ${L.steps.length} Schritte</small></span></button>`).join('');
  }
  function open() { renderMenu(); $('learn').showModal(); }

  $('lessonList').addEventListener('click', (e) => {
    const b = e.target.closest('.lesson');
    if (!b) return;
    $('learn').close();
    start(+b.dataset.i);
  });
  $('coachSkip').addEventListener('click', advance);
  $('coachBack').addEventListener('click', () => { if (step > 0) goto(step - 1); });
  $('coachQuit').addEventListener('click', quit);
  $('coachMenu').addEventListener('click', open);

  return {
    open, start, quit, tick,
    get active() { return lesson >= 0; },
    get state() { return { lesson, step, finished, done: [...done] }; },
    firstOpen: () => start(done.length < LESSONS.length ? LESSONS.findIndex((_, i) => !done.includes(i)) : 0),
    onNote: (n) => { if (lesson >= 0) ev.log.push(n); },
    onTurn: (i, d) => { ev.turn[i] += d; },
    onEvent: (name) => { ev[name] = (ev[name] || 0) + 1; },
  };
}
