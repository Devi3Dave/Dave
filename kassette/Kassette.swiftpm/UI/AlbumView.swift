import SwiftUI

/// Album: Mixdown als WAV exportieren, Band sichern/laden, Exporte teilen.
struct AlbumView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var progress: Float?
    @State private var files: [URL] = []
    @State private var message: String?
    @State private var confirmErase = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        bounce()
                    } label: {
                        Label("Band als WAV abmischen", systemImage: "square.and.arrow.down.on.square")
                    }
                    .disabled(progress != nil)
                    if let progress {
                        ProgressView(value: Double(progress)) { Text("Mixdown läuft…") }
                    }
                } header: {
                    Text("Mixdown")
                } footer: {
                    Text("Mischt alle 4 Spuren mit den aktuellen Mixer- und Master-Einstellungen zu einer Stereo-WAV-Datei (16 Bit).")
                }

                Section("Exporte") {
                    if files.isEmpty {
                        Text("Noch keine Exporte").foregroundStyle(.secondary)
                    }
                    ForEach(files, id: \.self) { url in
                        HStack {
                            Image(systemName: "waveform")
                            Text(url.deletingPathExtension().lastPathComponent)
                                .lineLimit(1)
                            Spacer()
                            ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                                .buttonStyle(.borderless)
                        }
                    }
                    .onDelete { idx in
                        for i in idx { try? FileManager.default.removeItem(at: files[i]) }
                        refresh()
                    }
                }

                Section {
                    Button {
                        model.saveTape { ok in message = ok ? "Band gesichert." : "Speichern fehlgeschlagen." }
                    } label: { Label("Band sichern", systemImage: "externaldrive.badge.plus") }
                    Button {
                        model.loadTape { ok in message = ok ? "Band geladen." : "Kein gesichertes Band gefunden." }
                    } label: { Label("Gesichertes Band laden", systemImage: "externaldrive") }
                    Button(role: .destructive) {
                        confirmErase = true
                    } label: { Label("Ganzes Band löschen", systemImage: "trash") }
                } header: {
                    Text("Band")
                } footer: {
                    Text("Das Band ist 2 Minuten lang und liegt im Arbeitsspeicher. Sichere es, bevor du die App beendest.")
                }

                Section("Klänge") {
                    Button("Werksklänge wiederherstellen") { model.resetSounds() }
                }

                if let message {
                    Section { Text(message).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Album")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
            .confirmationDialog("Alle 4 Spuren löschen?", isPresented: $confirmErase, titleVisibility: .visible) {
                Button("Löschen", role: .destructive) { model.eraseTape() }
            }
        }
        .onAppear(perform: refresh)
    }

    private func refresh() {
        files = model.exportedFiles()
    }

    private func bounce() {
        progress = 0
        model.bounce(progress: { p in progress = p }) { url in
            progress = nil
            message = url == nil ? "Export fehlgeschlagen." : "Exportiert: \(url!.lastPathComponent)"
            refresh()
        }
    }
}

struct HelpView: View {
    @Environment(\.dismiss) private var dismiss

    private let sections: [(String, [String])] = [
        ("Grundprinzip", [
            "Die vier farbigen Encoder steuern immer die vier Werte mit derselben Farbe auf dem Display.",
            "Ziehen (hoch/runter oder links/rechts) = drehen. Antippen = drücken (Zusatzfunktion).",
            "Die Tasten 1–4 wählen die Seite: ENG · ENV · FX · LFO bzw. im TAPE-Modus die Spur."
        ]),
        ("Synth & Drum", [
            "SYNTH: 8 Sound-Slots, Engines WAVE, FM, SWARM, PLUCK, PULSE, BEND, SAMPLER.",
            "ENGINE ›, Display oben antippen oder Koralle-Encoder drücken = nächste Engine.",
            "FX-Seite: Encoder 1 drücken wechselt den Effekt (Delay, Space, Filter, Drive, Chorus).",
            "LFO-Seite: Encoder 4 (TARGET) wählt das Ziel – P1–P4, Tonhöhe, Lautstärke oder Effekt.",
            "DRUM: 12 synthetische Drums pro Oktave. Pads auf dem Display sind antippbar.",
            "SAMPLER: ● MIC nimmt bis zu 12 s über das Mikrofon auf, TAPE → SAMPLE holt den Loop der aktiven Spur."
        ]),
        ("Tape", [
            "4 Spuren à 2 Minuten. Spur wählen mit 1–4 oder durch Antippen der Spur.",
            "REC = Overdub auf der gewählten Spur, PLAY/STOP. STOP im Stillstand spult zum Anfang.",
            "Encoder: SPEED (auch rückwärts), POSITION, LOOP IN, LOOP OUT.",
            "Encoder 3/4 drücken setzt Loop-Punkte an der aktuellen Position.",
            "LIFT schneidet den Loop-Bereich aus, DROP fügt ihn am Abspielkopf ein, UNDO macht den letzten Schritt rückgängig."
        ]),
        ("Mixer", [
            "LEVEL / PAN je Spur, Encoder drücken = Mute.",
            "M-FX: Master-Effekt auf der Summe. MASTER: Lautstärke, Monitor, Tempo, Click."
        ]),
        ("Sequencer", [
            "PATTERN: 16 Steps. Im Stillstand schreiben Tasten in den gewählten Step; beim Abspielen transponieren sie.",
            "ARP: gehaltene Tasten werden arpeggiert (UP, DOWN, UP/DN, RANDOM, ORDER, 1–3 Oktaven).",
            "EUCLID: gehaltene Tasten spielen einen euklidischen Rhythmus (Steps, Pulses, Rotate).",
            "HOLD hält Akkorde für ARP und EUCLID fest."
        ]),
        ("Mac- & iPad-Tastatur", [
            "A W S E D F T G Y/Z H U J K O L P = Klaviertasten",
            "C / X = Oktave runter / hoch · Leertaste = Play/Stop · R = Record",
            "1–4 = Seiten · 5 Synth · 6 Drum · 7 Tape · 8 Mixer · 9 Seq · M = Click · B = Hold",
            "MIDI-Keyboards (USB/Bluetooth) werden automatisch erkannt."
        ])
    ]

    var body: some View {
        NavigationStack {
            List {
                ForEach(0..<sections.count, id: \.self) { i in
                    let section = sections[i]
                    Section(section.0) {
                        ForEach(section.1, id: \.self) { line in
                            Text(line).font(.callout)
                        }
                    }
                }
            }
            .navigationTitle("Kassette – Bedienung")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
        }
    }
}
