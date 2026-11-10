import SwiftUI

/// Das ganze Gerät. Wird in einer festen Designgröße gebaut und passend skaliert,
/// damit es auf jedem iPad (quer/hoch) und im Mac-Fenster gleich aussieht.
struct DeviceView: View {
    @Environment(AppModel.self) private var model
    @FocusState private var focused: Bool
    static let design = CGSize(width: 1200, height: 700)

    var body: some View {
        @Bindable var model = model
        GeometryReader { geo in
            let s = min(geo.size.width / DeviceView.design.width, geo.size.height / DeviceView.design.height)
            DevicePanel()
                .frame(width: DeviceView.design.width, height: DeviceView.design.height)
                .scaleEffect(s)
                .frame(width: geo.size.width, height: geo.size.height)
        }
        .background(Theme.backdrop.ignoresSafeArea())
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: .all) { press in model.handleKey(press) }
        .onAppear { focused = true }
        .sheet(isPresented: $model.showAlbum) { AlbumView().environment(model) }
        .sheet(isPresented: $model.showHelp) { HelpView() }
        .persistentSystemOverlays(.hidden)
        .statusBarHidden()
    }
}

private struct DevicePanel: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 18) {
            topRow
            buttonRow
            keyboardRow
        }
        .padding(24)
        .background(
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .fill(LinearGradient(colors: [Theme.body, Theme.bodyEdge.opacity(0.9)], startPoint: .top, endPoint: .bottom))
                .shadow(color: .black.opacity(0.5), radius: 24, y: 14)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .strokeBorder(Color.white.opacity(0.6), lineWidth: 1)
        )
    }

    // MARK: Obere Reihe: Lautsprecher · Display · Encoder

    private var topRow: some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(spacing: 14) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("KASSETTE")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .tracking(2)
                        Text("4-TRACK SYNTH STUDIO")
                            .font(Theme.label(7))
                            .foregroundStyle(Theme.ink.opacity(0.5))
                    }
                    .foregroundStyle(Theme.ink)
                    Spacer()
                    VolumeKnob()
                }
                SpeakerGrill()
                    .frame(width: 150, height: 150)
                LevelLEDs()
            }
            .frame(width: 170, height: 300)

            ScreenView()
                .frame(width: 600, height: 300)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.ink))

            VStack(spacing: 22) {
                HStack(spacing: 10) {
                    ForEach(0..<4, id: \.self) { i in EncoderView(index: i) }
                }
                .padding(.top, 34)
                slotRow
                Spacer(minLength: 0)
            }
            .frame(width: 334, height: 312)
        }
        .frame(height: 312)
    }

    private var slotRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.drumActive ? "DRUM KIT" : "SOUNDS")
                .font(Theme.label(9))
                .foregroundStyle(Theme.ink.opacity(0.55))
            HStack(spacing: 6) {
                ForEach(0..<8, id: \.self) { i in
                    let active = !model.drumActive && model.slot == i
                    Button { model.selectSlot(i) } label: {
                        VStack(spacing: 3) {
                            Text("\(i + 1)").font(Theme.label(13))
                            Text(model.patches[i].engine.title.prefix(4))
                                .font(Theme.label(7))
                                .opacity(0.7)
                        }
                        .foregroundStyle(active ? .white : Theme.ink.opacity(0.8))
                        .frame(width: 35, height: 42)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(active ? Theme.enc[i % 4] : Theme.button)
                                .shadow(color: .black.opacity(active ? 0.05 : 0.2), radius: 1.2, y: 1.5)
                        )
                    }
                    .buttonStyle(PressStyle())
                }
            }
        }
    }

    // MARK: Tastenreihe

    private var buttonRow: some View {
        HStack(spacing: 6) {
            HWButton(title: "SYNTH", icon: "waveform", active: model.mode == .synth, tint: Theme.enc[0]) { model.select(.synth) }
            HWButton(title: "DRUM", icon: "square.grid.3x3.fill", active: model.mode == .drum, tint: Theme.enc[1]) { model.select(.drum) }
            HWButton(title: "TAPE", icon: "recordingtape", active: model.mode == .tape, tint: Theme.enc[2]) { model.select(.tape) }
            HWButton(title: "MIXER", icon: "slider.vertical.3", active: model.mode == .mixer, tint: Theme.enc[3]) { model.select(.mixer) }
            HWButton(title: "SEQ", icon: "square.grid.4x3.fill", active: model.mode == .seq, tint: Theme.enc[0]) { model.select(.seq) }

            Spacer(minLength: 14)

            let titles = model.pageTitles()
            ForEach(0..<4, id: \.self) { i in
                HWButton(title: titles[i].isEmpty ? "—" : titles[i], active: model.isPageActive(i), tint: Theme.enc[i],
                         enabled: !titles[i].isEmpty) { model.selectPage(i) }
            }

            Spacer(minLength: 14)

            HWButton(title: "REC", icon: "circle.fill", active: model.isRecording, tint: Theme.rec) { model.toggleRecord() }
            HWButton(title: "PLAY", icon: "play.fill", active: model.isPlaying, tint: Theme.play) { model.play() }
            HWButton(title: "STOP", icon: "stop.fill") { model.stop() }

            Spacer(minLength: 14)

            HWButton(title: "OKT −", icon: "chevron.down") { model.shiftOctave(-1) }
            HWButton(title: "OKT +", icon: "chevron.up") { model.shiftOctave(1) }
            HWButton(title: "CLICK", icon: "metronome", active: model.metronomeOn, tint: Theme.enc[1]) { model.toggleMetronome() }
            HWButton(title: "HOLD", icon: "hand.raised.fill", active: model.latch, tint: Theme.enc[2]) { model.toggleLatch() }
            HWButton(title: "ALBUM", icon: "opticaldisc") { model.showAlbum = true }
            HWButton(title: "HILFE", icon: "questionmark") { model.showHelp = true }
        }
        .frame(height: 62)
    }

    // MARK: Klaviatur

    private var keyboardRow: some View {
        HStack(spacing: 14) {
            VStack(spacing: 6) {
                Text("OKTAVE")
                    .font(Theme.label(8))
                    .foregroundStyle(Theme.ink.opacity(0.5))
                Text(model.octave > 0 ? "+\(model.octave)" : "\(model.octave)")
                    .font(Theme.mono(22))
                    .foregroundStyle(Theme.ink)
                Text(AppModel.noteName(model.baseNote))
                    .font(Theme.label(9))
                    .foregroundStyle(Theme.ink.opacity(0.5))
            }
            .frame(width: 58)
            KeyboardView()
        }
        .frame(maxHeight: .infinity)
    }
}

/// Vier kleine Pegel-LEDs für die Bandspuren.
private struct LevelLEDs: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 20)) { _ in
            let peaks = model.studio.trackPeaks
            HStack(spacing: 10) {
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .fill(Theme.enc[i].opacity(0.25 + 0.75 * Double(min(1, peaks[i] * 2))))
                        .frame(width: 10, height: 10)
                        .overlay(Circle().strokeBorder(Color.black.opacity(0.15)))
                }
            }
        }
    }
}
