# Kassette – 4-Spur-Synth-Studio für iPad & Mac

Ein tragbares Synthesizer-Studio als App, inspiriert vom Workflow kompakter
Hardware-Synths mit eingebautem Bandgerät (wie dem OP-1): Klang bauen,
auf ein 4-Spur-Band aufnehmen, mischen, exportieren – alles mit vier farbigen
Encodern. Design, Name und Klangerzeugung sind eigenständig; es werden keine
Marken, Logos oder Gehäuseformen eines Herstellers kopiert.

## Im Browser starten (empfohlen)

Die Web-App liegt in `web/` und wird über GitHub Pages veröffentlicht – wie ChartAI:

**https://devi3dave.github.io/Dave/kassette/**

- Läuft in Safari und Chrome auf Mac und iPad, ohne Installation.
- Als App installierbar: iPad → Teilen → „Zum Home-Bildschirm“, Mac (Safari) → Ablage → „Zum Dock hinzufügen“.
- Funktioniert danach auch offline. Klänge und Einstellungen werden im Browser gespeichert, das Band über **ALBUM → Band sichern**.
- Kein Build-Schritt: reines HTML/CSS/JavaScript mit Web Audio (AudioWorklet).

Lokal testen: `cd kassette/web && python3 -m http.server 8000`, dann `http://localhost:8000` öffnen.

## Native Variante (optional)

`Kassette.swiftpm` enthält dieselbe App als SwiftUI-Projekt für Xcode / Swift Playgrounds
(iPadOS 17+, Mac mit Apple-Chip). Diese Variante wurde bisher nicht kompiliert.

## Aufbau des Geräts

```
┌──────────────────────────────────────────────────────────────────────┐
│ VOL  ·· Lautsprecher ··  │      DISPLAY (Grafik + Legende)     │ ● ● ● ●  (4 Encoder)
│ LEDs                     │                                     │ Sound-Slots 1–8
├──────────────────────────────────────────────────────────────────────┤
│ SYNTH DRUM TAPE MIXER SEQ │ 1 2 3 4 │ REC PLAY STOP │ OKT− OKT+ CLICK HOLD ALBUM ? │
├──────────────────────────────────────────────────────────────────────┤
│                   Klaviatur – 2 Oktaven, Multitouch                    │
└──────────────────────────────────────────────────────────────────────┘
```

Die vier Encoder (Koralle, Senf, Mint, Flieder) steuern immer die vier gleichfarbigen
Werte im Display. **Ziehen = drehen, antippen = drücken.**

## Funktionen

| Bereich | Inhalt |
|---|---|
| **Synth-Engines** | WAVE (Morph Sinus→Dreieck→Säge→Rechteck, Wavefolder, Detune, Sub) · FM (2-Operator, Ratio, Index, Feedback, Index-Decay) · SWARM (7-fach-Supersaw) · PLUCK (Karplus-Strong-Saite) · PULSE (PWM, Sub, Noise) · BEND (Phase Distortion: Saw/Pulse/Reso) · SAMPLER (Mikrofon oder vom Band, chromatisch, Loop) |
| **Drums** | 12 synthetische Sounds pro Oktave: Kick, Rim, Snare, Clap, 3 Toms, Hats offen/geschlossen (mit Choke), Cowbell, Becken, Zap · Tune, Decay, Tone, Punch |
| **Seiten pro Sound** | ENG (Engine-Parameter) · ENV (ADSR) · FX (Delay, Space-Hall, Multimode-Filter, Drive/Bitcrusher, Chorus) · LFO (5 Wellenformen, Ziele P1–P4, Pitch, Amp, FX) |
| **8 Sound-Slots** | jeder Slot speichert Engine, Hüllkurve, Effekt und LFO (automatisch gesichert) |
| **Tape** | 4 Spuren × 2 Minuten, Overdub, Varispeed −2…+2 (rückwärts!), Band-Anlauf/-Auslauf, Loop In/Out, Lift/Drop (Ausschneiden/Einfügen), Undo, Spur löschen |
| **Mixer** | Level, Pan, Mute je Spur · Master-Effekt auf der Summe · Monitor-Pegel · Soft-Limiter |
| **Sequencer** | PATTERN (16 Steps, Step-Eingabe, Transponieren per Taste, Swing) · ARP (Up/Down/Up-Down/Random/Order, 1–3 Oktaven) · EUCLID (euklidische Rhythmen) · HOLD · Metronom |
| **Album** | Mixdown als Stereo-WAV exportieren und teilen (AirDrop, Dateien, …), Band sichern/laden |
| **Steuerung** | Multitouch-Klaviatur mit Anschlagdynamik · Mac/iPad-Tastatur · MIDI-Keyboards (USB/Bluetooth) |

## Tastatur (Mac / iPad mit Keyboard)

| Taste | Funktion |
|---|---|
| `A W S E D F T G Y/Z H U J K O L P` | Klaviertasten |
| `Y` / `X` | Oktave runter / hoch |
| Leertaste | Play / Stop |
| `R` | Record |
| `1`–`4` | Seite bzw. Spur |
| `5` `6` `7` `8` `9` | Synth · Drum · Tape · Mixer · Seq |
| `M` / `B` | Click / Hold |

## Kurzanleitung: der erste Song

1. **DRUM** wählen, **SEQ** → Modus **PATTERN**, mit Tasten Steps eintragen (oder ZUFALL).
2. **TAPE** → Spur 1 wählen → **REC**: Drums laufen aufs Band. **STOP**.
3. **SYNTH**, Slot 5 (BASS), Spur 2, **REC** und live dazu spielen.
4. **MIXER**: Pegel/Pan einstellen, Master-Effekt wählen.
5. **ALBUM** → „Band als WAV abmischen“ → teilen.

## Code-Struktur

```
web/                       Web-App (GitHub Pages): index.html, app.js, screen.js,
                           dsp.js (Klangerzeugung), worklet.js (Audio-Thread), sw.js
Kassette.swiftpm/
├── Package.swift          App-Paket (Swift Playgrounds / Xcode)
├── DSP/                   Klangerzeugung in purem Swift, echtzeitfähig, ohne Allokationen
│   ├── DSPMath.swift      Oszillator-Helfer, PolyBLEP, SVF-Filter, ADSR
│   ├── Patch.swift        Engines, Effekte, Presets
│   ├── Voice.swift        Stimme mit allen Engines und Drums
│   ├── Instrument.swift   8-stimmige Polyphonie, LFO, Sampler
│   ├── Effects.swift      Delay, Hall, Filter, Drive, Chorus
│   ├── Tape.swift         4-Spur-Band
│   ├── Sequencer.swift    Pattern, Arp, Euclid
│   └── Studio.swift       Signalfluss, Mixer, Metronom, Bounce/WAV
├── App/                   AVAudioEngine, CoreMIDI, App-Zustand
└── UI/                    SwiftUI: Gehäuse, Display, Encoder, Klaviatur, Album
```

## Bekannte Grenzen

- MIDI-Keyboards funktionieren im Browser nur in Chrome/Edge (Safari kennt kein Web MIDI).
- Die Swift-Variante wurde ohne Xcode geschrieben und nur auf Syntax geprüft.
- Das Band liegt im Arbeitsspeicher (ca. 120 MB). Über **ALBUM → Band sichern** wird es dauerhaft gespeichert.
- Kein eingebautes Radio und keine Bewegungssensor-Steuerung.
