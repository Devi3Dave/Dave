# Kassette – 4-Spur-Synth-Studio für iPad & Mac

Ein tragbares Synthesizer-Studio als App, inspiriert vom Workflow kompakter
Hardware-Synths mit eingebautem Bandgerät (wie dem OP-1): Klang bauen,
auf ein 4-Spur-Band aufnehmen, mischen, exportieren – alles mit vier farbigen
Encodern. Design, Name und Klangerzeugung sind eigenständig; es werden keine
Marken, Logos oder Gehäuseformen eines Herstellers kopiert.

Läuft auf **iPad** (iPadOS 17+) und auf dem **Mac** (Apple Silicon, z. B. MacBook Air M1/M2/M3).

## Starten

**Auf dem Mac (Xcode 15 oder neuer):**
1. `Kassette.swiftpm` doppelklicken – öffnet sich in Xcode.
2. Oben als Ziel **„My Mac (Designed for iPad)“** oder ein angeschlossenes iPad wählen.
3. ▶ Run. Für ein iPad einmal unter *Signing & Capabilities* dein Apple-Team wählen.
4. Tipp: Für die beste Audio-Performance *Product → Scheme → Edit Scheme → Run → Build Configuration: Release*.

**Mit Swift Playgrounds (iPad oder Mac):**
`Kassette.swiftpm` in Swift Playgrounds öffnen (per AirDrop, iCloud Drive oder Dateien-App) und auf ▶ tippen.

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
| `C` / `X` | Oktave runter / hoch |
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

- Der Code wurde ohne Xcode geschrieben und nur auf Syntax geprüft. Sollte der
  Compiler beim ersten Build etwas anmerken (z. B. das Platzhalter-Icon in
  `Package.swift`), lässt sich das meist mit einer Zeile beheben.
- Das Band liegt im Arbeitsspeicher (ca. 120 MB). Über **ALBUM → Band sichern** wird es dauerhaft gespeichert.
- Kein eingebautes Radio und keine Bewegungssensor-Steuerung.
