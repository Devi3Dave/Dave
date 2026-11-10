import SwiftUI
import Observation

enum Mode: Int, CaseIterable {
    case synth, drum, tape, mixer, seq
}

/// Was ein Encoder gerade steuert.
enum Param: Equatable {
    case engine(Int), env(Int), fx(Int), lfo(Int)
    case tapeSpeed, tapeJog, loopStart, loopEnd
    case level(Int), pan(Int), masterFX(Int), masterVolume, liveLevel
    case seqKind, tempo, swing, metronome
    case cursor, gate, length, transpose
    case arpRate, arpMode, arpOctaves
    case euclidSteps, euclidPulses, euclidRotate, euclidRate
    case none
}

struct EncoderInfo {
    var label: String
    var value: Float
    var text: String
}

struct MixerState: Codable, Equatable {
    var levels = SIMD4<Float>(repeating: 0.8)
    var pans = SIMD4<Float>(0.35, 0.65, 0.45, 0.55)
    var mutes = [false, false, false, false]
    var live: Float = 0.9
    var masterVolume: Float = 0.8
    var masterFX: FXKind = .space
    var masterFXParams = SIMD4<Float>(0.5, 0.4, 0.15, 0.1)
}

struct SeqState: Codable, Equatable {
    var kind: SeqKind = .off
    var bpm: Float = 110
    var swing: Float = 0
    var steps: [Int] = [48, -1, 48, -1, 55, -1, 48, 58, -1, 48, -1, 53, 55, -1, 60, -1]
    var length = 16
    var gate: Float = 0.5
    var arpRate = 2
    var arpMode = 0
    var arpOctaves = 1
    var euclidSteps = 16
    var euclidPulses = 5
    var euclidRotate = 0
    var euclidRate = 2
    var metronomeLevel: Float = 0.5
}

struct SavedState: Codable {
    var patches: [Patch]
    var drumPatch: Patch
    var slot: Int
    var mixer: MixerState
    var seq: SeqState
    var tapeSpeed: Float
}

@Observable
final class AppModel {
    var mode: Mode = .synth
    var page = 0
    var slot = 0
    var drumActive = false
    var patches: [Patch]
    var drumPatch: Patch
    var mixer: MixerState
    var seq: SeqState
    var tapeSpeed: Float = 0.75
    var octave = 0
    var armedTrack = 0
    var metronomeOn = false
    var latch = false
    var isPlaying = false
    var isRecording = false
    var loopOn = false
    var isSampling = false
    var showAlbum = false
    var showHelp = false
    var toast: String?
    var pressedNotes: Set<Int> = []

    @ObservationIgnored let audio: AudioHost
    @ObservationIgnored private var midi: MIDIHost?
    @ObservationIgnored private var accum: [Float] = [0, 0, 0, 0]
    @ObservationIgnored private var touchNotes: [Int: Int] = [:]
    @ObservationIgnored private var keyNotes: [String: Int] = [:]
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var pollTimer: Timer?

    var studio: Studio { audio.studio }
    var patch: Patch { drumActive ? drumPatch : patches[slot] }
    var baseNote: Int { 48 + octave * 12 }

    init() {
        let saved = AppModel.loadState()
        var p = saved?.patches ?? Patch.factory
        if p.count != 8 { p = Patch.factory }
        patches = p
        drumPatch = saved?.drumPatch ?? Patch.drumKit
        slot = min(7, max(0, saved?.slot ?? 0))
        mixer = saved?.mixer ?? MixerState()
        seq = saved?.seq ?? SeqState()
        tapeSpeed = saved?.tapeSpeed ?? 0.75
        audio = AudioHost()
        pushAll()
        midi = MIDIHost(studio: audio.studio)
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    // MARK: Zustand an die Engine übergeben

    func pushAll() {
        studio.load(patch)
        pushMixer()
        pushSeq()
        studio.tape.targetSpeed = AppModel.speed(from: tapeSpeed)
    }

    func pushMixer() {
        studio.levels = mixer.levels
        studio.pans = mixer.pans
        studio.mutes = SIMD4<Float>(mixer.mutes.map { $0 ? Float(0) : Float(1) })
        studio.liveLevel = mixer.live
        studio.masterVolume = mixer.masterVolume
        studio.masterFX = mixer.masterFX
        studio.masterFXParams = mixer.masterFXParams
    }

    func pushSeq() {
        let s = studio.seq
        s.kind = seq.kind
        s.bpm = seq.bpm
        s.swing = seq.swing
        for i in 0..<Sequencer.maxSteps { s.steps[i] = i < seq.steps.count ? seq.steps[i] : -1 }
        s.length = seq.length
        s.gate = seq.gate
        s.arpRate = seq.arpRate
        s.arpMode = seq.arpMode
        s.arpOctaves = seq.arpOctaves
        s.euclidSteps = seq.euclidSteps
        s.euclidPulses = seq.euclidPulses
        s.euclidRotate = seq.euclidRotate
        s.euclidRate = seq.euclidRate
        s.latch = latch
        s.stepInput = mode == .seq && seq.kind == .pattern
        studio.metronomeOn = metronomeOn
        studio.metronomeLevel = seq.metronomeLevel
    }

    /// Steps, die im Audio-Thread per Step-Eingabe geschrieben wurden, zurück ins Modell holen.
    private func pullSteps() {
        let s = studio.seq
        var changed = false
        var steps = seq.steps
        for i in 0..<min(steps.count, Sequencer.maxSteps) where steps[i] != s.steps[i] {
            steps[i] = s.steps[i]
            changed = true
        }
        if changed { seq.steps = steps }
    }

    private func poll() {
        let tape = studio.tape
        if isPlaying && studio.transportRunning && !tape.running && tape.playhead >= Double(tape.length - 3) {
            stop()
        }
        if isRecording && !studio.tape.recording { isRecording = false }
        if isSampling && !studio.instrument.capturing {
            audio.stopSampling()
            isSampling = false
            flash("SAMPLE FERTIG")
        }
        if mode == .seq { pullSteps() }
    }

    func editPatch(_ change: (inout Patch) -> Void) {
        if drumActive {
            change(&drumPatch)
            studio.load(drumPatch)
        } else {
            change(&patches[slot])
            studio.load(patches[slot])
        }
    }

    func flash(_ text: String) {
        toast = text
        toastTask?.cancel()
        toastTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            if !Task.isCancelled { self?.toast = nil }
        }
    }

    // MARK: Modi und Seiten

    func select(_ m: Mode) {
        if m == .synth {
            if mode == .synth { page = 0 }
            drumActive = false
            studio.load(patch)
        } else if m == .drum {
            if mode == .drum { page = 0 }
            drumActive = true
            studio.load(patch)
        }
        if m != mode && (m == .tape || m == .mixer || m == .seq || mode == .tape || mode == .mixer || mode == .seq) {
            page = 0
        }
        mode = m
        pushSeq()
    }

    func selectPage(_ i: Int) {
        if mode == .tape {
            armedTrack = i
            studio.tape.armed = i
            if isRecording { studio.tape.snapshot(i) }
            return
        }
        if mode == .seq && i > 1 { return }
        page = i
    }

    func pageTitles() -> [String] {
        switch mode {
        case .synth, .drum: return ["ENG", "ENV", "FX", "LFO"]
        case .tape: return ["T1", "T2", "T3", "T4"]
        case .mixer: return ["LEVEL", "PAN", "M-FX", "MASTER"]
        case .seq: return ["SEQ", "EDIT", "", ""]
        }
    }

    func isPageActive(_ i: Int) -> Bool {
        mode == .tape ? armedTrack == i : page == i
    }

    func selectSlot(_ i: Int) {
        slot = i
        drumActive = false
        if mode == .drum { mode = .synth }
        studio.load(patch)
        flash("\(i + 1) · \(patch.name)")
    }

    // MARK: Encoder

    func params() -> [Param] {
        switch mode {
        case .synth, .drum:
            switch page {
            case 0: return (0..<4).map { Param.engine($0) }
            case 1: return (0..<4).map { Param.env($0) }
            case 2: return (0..<4).map { Param.fx($0) }
            default: return (0..<4).map { Param.lfo($0) }
            }
        case .tape:
            return [.tapeSpeed, .tapeJog, .loopStart, .loopEnd]
        case .mixer:
            switch page {
            case 0: return (0..<4).map { Param.level($0) }
            case 1: return (0..<4).map { Param.pan($0) }
            case 2: return (0..<4).map { Param.masterFX($0) }
            default: return [.masterVolume, .liveLevel, .tempo, .metronome]
            }
        case .seq:
            if page == 0 { return [.seqKind, .tempo, .swing, .metronome] }
            switch seq.kind {
            case .pattern: return [.cursor, .gate, .length, .transpose]
            case .arp: return [.arpRate, .arpMode, .arpOctaves, .gate]
            case .euclid: return [.euclidSteps, .euclidPulses, .euclidRotate, .euclidRate]
            case .off: return [.none, .none, .none, .none]
            }
        }
    }

    func info(_ i: Int) -> EncoderInfo {
        let p = params()[i]
        return EncoderInfo(label: label(p), value: value(p), text: text(p))
    }

    func turn(_ i: Int, _ delta: Float) {
        let p = params()[i]
        if let step = discreteStep(p) {
            accum[i] += delta
            let s = Int(accum[i] / step)
            if s != 0 {
                accum[i] -= Float(s) * step
                stepParam(p, s)
            }
            return
        }
        setValue(p, clamp01(value(p) + delta))
    }

    private func discreteStep(_ p: Param) -> Float? {
        switch p {
        case .seqKind, .arpRate, .arpMode, .arpOctaves, .euclidRate: return 0.06
        case .cursor, .length, .transpose, .euclidSteps, .euclidPulses, .euclidRotate: return 0.035
        case .tempo: return 0.012
        case .tapeJog, .loopStart, .loopEnd: return 0.01
        default: return nil
        }
    }

    private func stepParam(_ p: Param, _ s: Int) {
        let tape = studio.tape
        let sr = Double(studio.sampleRate)
        switch p {
        case .seqKind:
            let n = SeqKind.allCases.count
            seq.kind = SeqKind(rawValue: ((seq.kind.rawValue + s) % n + n) % n) ?? .off
            studio.send(.allOff)
        case .tempo: seq.bpm = clamp(seq.bpm + Float(s), 40, 240)
        case .cursor: studio.seq.cursor = ((studio.seq.cursor + s) % seq.length + seq.length) % seq.length
        case .length:
            seq.length = min(16, max(1, seq.length + s))
            studio.seq.cursor = min(studio.seq.cursor, seq.length - 1)
        case .transpose: studio.seq.transpose = min(24, max(-24, studio.seq.transpose + s))
        case .arpRate: seq.arpRate = min(3, max(0, seq.arpRate + s))
        case .arpMode: seq.arpMode = min(4, max(0, seq.arpMode + s))
        case .arpOctaves: seq.arpOctaves = min(3, max(1, seq.arpOctaves + s))
        case .euclidSteps:
            seq.euclidSteps = min(32, max(2, seq.euclidSteps + s))
            seq.euclidPulses = min(seq.euclidPulses, seq.euclidSteps)
        case .euclidPulses: seq.euclidPulses = min(seq.euclidSteps, max(0, seq.euclidPulses + s))
        case .euclidRotate: seq.euclidRotate = ((seq.euclidRotate + s) % seq.euclidSteps + seq.euclidSteps) % seq.euclidSteps
        case .euclidRate: seq.euclidRate = min(3, max(0, seq.euclidRate + s))
        case .tapeJog:
            tape.playhead = min(Double(tape.length - 2), max(0, tape.playhead + Double(s) * 0.1 * sr))
        case .loopStart:
            tape.loopStart = min(tape.length - 2, max(0, tape.loopStart + Int(Double(s) * 0.05 * sr)))
            loopOn = tape.loopOn
        case .loopEnd:
            tape.loopEnd = min(tape.length - 2, max(0, tape.loopEnd + Int(Double(s) * 0.05 * sr)))
        default:
            break
        }
        pushSeq()
    }

    func value(_ p: Param) -> Float {
        let tape = studio.tape
        let len = Float(tape.length)
        switch p {
        case .engine(let i): return patch.params[i]
        case .env(let i): return patch.env[i]
        case .fx(let i): return patch.fxParams[i]
        case .lfo(let i): return patch.lfo[i]
        case .tapeSpeed: return tapeSpeed
        case .tapeJog: return Float(tape.playhead) / len
        case .loopStart: return Float(tape.loopStart) / len
        case .loopEnd: return Float(tape.loopEnd) / len
        case .level(let i): return mixer.levels[i]
        case .pan(let i): return mixer.pans[i]
        case .masterFX(let i): return mixer.masterFXParams[i]
        case .masterVolume: return mixer.masterVolume
        case .liveLevel: return mixer.live
        case .seqKind: return Float(seq.kind.rawValue) / 3
        case .tempo: return (seq.bpm - 40) / 200
        case .swing: return seq.swing
        case .metronome: return seq.metronomeLevel
        case .cursor: return Float(studio.seq.cursor) / Float(max(1, seq.length - 1))
        case .gate: return seq.gate
        case .length: return Float(seq.length - 1) / 15
        case .transpose: return Float(studio.seq.transpose + 24) / 48
        case .arpRate: return Float(seq.arpRate) / 3
        case .arpMode: return Float(seq.arpMode) / 4
        case .arpOctaves: return Float(seq.arpOctaves - 1) / 2
        case .euclidSteps: return Float(seq.euclidSteps - 2) / 30
        case .euclidPulses: return Float(seq.euclidPulses) / Float(max(1, seq.euclidSteps))
        case .euclidRotate: return Float(seq.euclidRotate) / Float(max(1, seq.euclidSteps - 1))
        case .euclidRate: return Float(seq.euclidRate) / 3
        case .none: return 0
        }
    }

    func setValue(_ p: Param, _ v: Float) {
        switch p {
        case .engine(let i): editPatch { $0.params[i] = v }
        case .env(let i): editPatch { $0.env[i] = v }
        case .fx(let i): editPatch { $0.fxParams[i] = v }
        case .lfo(let i): editPatch { $0.lfo[i] = v }
        case .tapeSpeed:
            tapeSpeed = v
            studio.tape.targetSpeed = AppModel.speed(from: v)
        case .level(let i): mixer.levels[i] = v; pushMixer()
        case .pan(let i): mixer.pans[i] = v; pushMixer()
        case .masterFX(let i): mixer.masterFXParams[i] = v; pushMixer()
        case .masterVolume: mixer.masterVolume = v; pushMixer()
        case .liveLevel: mixer.live = v; pushMixer()
        case .swing: seq.swing = v; pushSeq()
        case .metronome: seq.metronomeLevel = v; pushSeq()
        case .gate: seq.gate = v; pushSeq()
        default: break
        }
    }

    func label(_ p: Param) -> String {
        switch p {
        case .engine(let i): return patch.engine.paramNames[i]
        case .env(let i): return ["ATTACK", "DECAY", "SUSTAIN", "RELEASE"][i]
        case .fx(let i): return patch.fx.paramNames[i]
        case .lfo(let i): return ["RATE", "DEPTH", "SHAPE", "TARGET"][i]
        case .tapeSpeed: return "SPEED"
        case .tapeJog: return "POSITION"
        case .loopStart: return "LOOP IN"
        case .loopEnd: return "LOOP OUT"
        case .level(let i): return "TRACK \(i + 1)"
        case .pan(let i): return "PAN \(i + 1)"
        case .masterFX(let i): return mixer.masterFX.paramNames[i]
        case .masterVolume: return "MASTER"
        case .liveLevel: return "MONITOR"
        case .seqKind: return "MODE"
        case .tempo: return "TEMPO"
        case .swing: return "SWING"
        case .metronome: return "CLICK"
        case .cursor: return "STEP"
        case .gate: return "GATE"
        case .length: return "LENGTH"
        case .transpose: return "TRANSP"
        case .arpRate, .euclidRate: return "RATE"
        case .arpMode: return "MODE"
        case .arpOctaves: return "OCTAVES"
        case .euclidSteps: return "STEPS"
        case .euclidPulses: return "PULSES"
        case .euclidRotate: return "ROTATE"
        case .none: return "—"
        }
    }

    func text(_ p: Param) -> String {
        let tape = studio.tape
        let sr = Double(studio.sampleRate)
        switch p {
        case .engine(let i):
            return patch.engine.display(i, patch.params[i])
        case .env(let i):
            let v = patch.env[i]
            switch i {
            case 0: return AppModel.seconds(ADSR.attackTime(v))
            case 1: return AppModel.seconds(ADSR.decayTime(v))
            case 2: return AppModel.percent(v)
            default: return AppModel.seconds(ADSR.releaseTime(v))
            }
        case .fx(let i):
            return patch.fx.display(i, patch.fxParams[i])
        case .lfo(let i):
            let v = patch.lfo[i]
            switch i {
            case 0: return String(format: "%.2f Hz", LFOInfo.rate(v))
            case 1: return AppModel.percent(v)
            case 2: return LFOInfo.shapes[quantize(v, 5)]
            default:
                let t = quantize(v, 8)
                if t >= 1 && t <= 4 { return patch.engine.paramNames[t - 1] }
                return LFOInfo.targets[t]
            }
        case .tapeSpeed:
            let s = AppModel.speed(from: tapeSpeed)
            return String(format: "%@×%.2f", s < 0 ? "◀ " : "", abs(s))
        case .tapeJog: return AppModel.clock(tape.playhead / sr)
        case .loopStart: return AppModel.clock(Double(tape.loopStart) / sr)
        case .loopEnd: return AppModel.clock(Double(tape.loopEnd) / sr)
        case .level(let i): return mixer.mutes[i] ? "MUTE" : AppModel.percent(mixer.levels[i])
        case .pan(let i): return AppModel.pan(mixer.pans[i])
        case .masterFX(let i): return mixer.masterFX.display(i, mixer.masterFXParams[i])
        case .masterVolume: return AppModel.percent(mixer.masterVolume)
        case .liveLevel: return AppModel.percent(mixer.live)
        case .seqKind: return seq.kind.title
        case .tempo: return "\(Int(seq.bpm)) BPM"
        case .swing: return AppModel.percent(seq.swing)
        case .metronome: return metronomeOn ? AppModel.percent(seq.metronomeLevel) : "AUS"
        case .cursor: return "\(studio.seq.cursor + 1)/\(seq.length)"
        case .gate: return AppModel.percent(seq.gate)
        case .length: return "\(seq.length)"
        case .transpose:
            let t = studio.seq.transpose
            return t > 0 ? "+\(t)" : "\(t)"
        case .arpRate: return Sequencer.rateNames[seq.arpRate]
        case .arpMode: return Sequencer.arpModes[seq.arpMode]
        case .arpOctaves: return "\(seq.arpOctaves)"
        case .euclidSteps: return "\(seq.euclidSteps)"
        case .euclidPulses: return "\(seq.euclidPulses)"
        case .euclidRotate: return "\(seq.euclidRotate)"
        case .euclidRate: return Sequencer.rateNames[seq.euclidRate]
        case .none: return ""
        }
    }

    /// Encoder antippen = Zusatzfunktion (wie das Drücken eines Drehgebers).
    func pressEncoder(_ i: Int) {
        let tape = studio.tape
        switch mode {
        case .synth, .drum:
            if page == 0 && i == 0 && !drumActive {
                nextEngine()
            } else if page == 2 {
                editPatch {
                    $0.fx = $0.fx.next
                    $0.fxParams = $0.fx.defaultParams
                }
                flash("FX: \(patch.fx.title)")
            } else if page == 3 && i == 3 {
                editPatch { $0.lfo.w = LFOInfo.target((quantize($0.lfo.w, 8) + 1) % 8) }
            }
        case .tape:
            switch i {
            case 0:
                tapeSpeed = 0.75
                tape.targetSpeed = 1
                flash("SPEED ×1")
            case 1:
                tape.playhead = loopOn && tape.hasLoop ? Double(tape.loopStart) : 0
            case 2:
                tape.loopStart = Int(tape.playhead)
                flash("LOOP IN")
            default:
                tape.loopEnd = Int(tape.playhead)
                if tape.hasLoop {
                    tape.loopOn = true
                    loopOn = true
                    flash("LOOP AN")
                }
            }
        case .mixer:
            if page <= 1 {
                mixer.mutes[i].toggle()
                pushMixer()
            } else if page == 2 {
                mixer.masterFX = mixer.masterFX.next
                mixer.masterFXParams = mixer.masterFX.defaultParams
                pushMixer()
                flash("MASTER FX: \(mixer.masterFX.title)")
            } else if i == 3 {
                toggleMetronome()
            }
        case .seq:
            if page == 0 {
                if i == 0 {
                    seq.kind = SeqKind(rawValue: (seq.kind.rawValue + 1) % SeqKind.allCases.count) ?? .off
                    studio.send(.allOff)
                } else if i == 3 {
                    toggleMetronome()
                }
                pushSeq()
            } else if seq.kind == .pattern {
                switch i {
                case 0: setStep(studio.seq.cursor, -1)
                case 3: studio.seq.transpose = 0
                default: break
                }
            }
        }
    }

    func nextEngine() {
        let list = EngineKind.synthEngines
        let idx = list.firstIndex(of: patch.engine) ?? 0
        let e = list[(idx + 1) % list.count]
        editPatch {
            $0.engine = e
            $0.params = e.defaultParams
        }
        flash(e.title)
    }

    // MARK: Pattern bearbeiten

    func setStep(_ i: Int, _ note: Int) {
        guard i >= 0 && i < seq.steps.count else { return }
        seq.steps[i] = note
        pushSeq()
    }

    func clearPattern() {
        seq.steps = Array(repeating: -1, count: 16)
        pushSeq()
        flash("PATTERN LEER")
    }

    func randomPattern() {
        let scale = [0, 3, 5, 7, 10, 12, 15]
        seq.steps = (0..<16).map { _ in Int.random(in: 0..<10) < 6 ? 48 + scale.randomElement()! : -1 }
        pushSeq()
        flash("ZUFALL")
    }

    func tapStep(_ i: Int) {
        studio.seq.cursor = min(max(0, i), seq.length - 1)
    }

    // MARK: Transport

    func togglePlay() {
        if isPlaying { stop() } else { play() }
    }

    func play() {
        studio.send(.play)
        isPlaying = true
    }

    func stop() {
        if isPlaying {
            studio.send(.stop)
            isPlaying = false
            isRecording = false
        } else {
            let tape = studio.tape
            tape.playhead = loopOn && tape.hasLoop ? Double(tape.loopStart) : 0
        }
    }

    func toggleRecord() {
        if isRecording {
            studio.setRecording(false)
            isRecording = false
        } else {
            studio.tape.armed = armedTrack
            studio.setRecording(true)
            isRecording = true
            if !isPlaying { play() }
        }
    }

    func toggleLoop() {
        let tape = studio.tape
        if !tape.hasLoop {
            let start = Int(tape.playhead)
            let bar = Int(60 / Double(seq.bpm) * 4 * Double(studio.sampleRate))
            tape.loopStart = start
            tape.loopEnd = min(tape.length - 2, start + bar)
        }
        tape.loopOn.toggle()
        loopOn = tape.loopOn
        flash(loopOn ? "LOOP AN" : "LOOP AUS")
    }

    func lift() { flash(studio.tape.lift() ? "LIFT ✓" : "ERST LOOP SETZEN") }
    func drop() { flash(studio.tape.drop() ? "DROP ✓" : "NICHTS GELIFTET") }
    func undo() { flash(studio.tape.undo() ? "UNDO ✓" : "KEIN UNDO") }

    func clearTrack() {
        studio.tape.clear(armedTrack)
        flash("SPUR \(armedTrack + 1) GELÖSCHT")
    }

    func toggleMetronome() {
        metronomeOn.toggle()
        pushSeq()
        flash(metronomeOn ? "CLICK AN" : "CLICK AUS")
    }

    func toggleLatch() {
        latch.toggle()
        if !latch { studio.send(.allOff) }
        pushSeq()
        flash(latch ? "HOLD AN" : "HOLD AUS")
    }

    func shiftOctave(_ d: Int) {
        octave = min(3, max(-3, octave + d))
        flash("OKTAVE \(octave > 0 ? "+" : "")\(octave)")
    }

    // MARK: Sampling

    func toggleSampling() {
        if isSampling {
            audio.stopSampling()
            isSampling = false
            flash("SAMPLE FERTIG")
            return
        }
        audio.startSampling { [weak self] ok in
            guard let self else { return }
            if ok {
                self.isSampling = true
                self.flash("AUFNAHME…")
            } else {
                self.flash("KEIN MIKROFON")
            }
        }
    }

    func sampleFromTape() {
        flash(studio.sampleFromTape() ? "TAPE → SAMPLER ✓" : "BAND LEER")
    }

    // MARK: Tastatur & Touch

    func keyDown(id: Int, index: Int, velocity: Float) {
        guard touchNotes[id] == nil else { return }
        let note = baseNote + index
        touchNotes[id] = note
        pressedNotes.insert(note)
        studio.noteOn(note, velocity: velocity)
    }

    func keyUp(id: Int) {
        guard let note = touchNotes.removeValue(forKey: id) else { return }
        if !touchNotes.values.contains(note) && !keyNotes.values.contains(note) { pressedNotes.remove(note) }
        studio.noteOff(note)
    }

    static let computerKeys: [String: Int] = [
        "a": 0, "w": 1, "s": 2, "e": 3, "d": 4, "f": 5, "t": 6, "g": 7, "y": 8, "z": 8,
        "h": 9, "u": 10, "j": 11, "k": 12, "o": 13, "l": 14, "p": 15, ";": 16, "ö": 16
    ]

    func handleKey(_ press: KeyPress) -> KeyPress.Result {
        let ch = press.characters.lowercased()
        if let offset = AppModel.computerKeys[ch] {
            switch press.phase {
            case .down:
                guard keyNotes[ch] == nil else { return .handled }
                let note = baseNote + 12 + offset
                keyNotes[ch] = note
                pressedNotes.insert(note)
                studio.noteOn(note, velocity: 0.8)
            case .up:
                if let note = keyNotes.removeValue(forKey: ch) {
                    if !touchNotes.values.contains(note) && !keyNotes.values.contains(note) { pressedNotes.remove(note) }
                    studio.noteOff(note)
                }
            default:
                break
            }
            return .handled
        }
        guard press.phase == .down else { return .ignored }
        switch ch {
        case " ": togglePlay()
        case "r": toggleRecord()
        case "x": shiftOctave(1)
        case "c": shiftOctave(-1)
        case "1", "2", "3", "4": selectPage(Int(ch)! - 1)
        case "5": select(.synth)
        case "6": select(.drum)
        case "7": select(.tape)
        case "8": select(.mixer)
        case "9": select(.seq)
        case "m": toggleMetronome()
        case "b": toggleLatch()
        default: return .ignored
        }
        return .handled
    }

    // MARK: Album / Dateien

    static var documents: URL { URL.documentsDirectory }
    static var tapeFolder: URL { documents.appendingPathComponent("Band", isDirectory: true) }

    func bounce(progress: @escaping (Float) -> Void, done: @escaping (URL?) -> Void) {
        let studio = self.studio
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH-mm-ss"
        let url = AppModel.documents.appendingPathComponent("Kassette \(formatter.string(from: Date())).wav")
        DispatchQueue.global(qos: .userInitiated).async {
            let data = studio.bounce { p in DispatchQueue.main.async { progress(p) } }
            let ok = (try? data.write(to: url)) != nil
            DispatchQueue.main.async { done(ok ? url : nil) }
        }
    }

    func saveTape(done: @escaping (Bool) -> Void) {
        let tape = studio.tape
        let rate = studio.sampleRate
        let folder = AppModel.tapeFolder
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                for t in 0..<Tape.trackCount {
                    try tape.data(track: t).write(to: folder.appendingPathComponent("spur\(t + 1).raw"))
                }
                let meta = ["sampleRate": Double(rate), "end": Double(tape.recordedEnd)]
                try JSONEncoder().encode(meta).write(to: folder.appendingPathComponent("band.json"))
                DispatchQueue.main.async { done(true) }
            } catch {
                DispatchQueue.main.async { done(false) }
            }
        }
    }

    func loadTape(done: @escaping (Bool) -> Void) {
        let tape = studio.tape
        let folder = AppModel.tapeFolder
        if isPlaying { stop() }
        DispatchQueue.global(qos: .userInitiated).async {
            var any = false
            for t in 0..<Tape.trackCount {
                if let d = try? Data(contentsOf: folder.appendingPathComponent("spur\(t + 1).raw")) {
                    tape.load(track: t, data: d)
                    any = true
                }
            }
            tape.recomputeRecordedEnd()
            tape.playhead = 0
            DispatchQueue.main.async { done(any) }
        }
    }

    func eraseTape() {
        if isPlaying { stop() }
        for t in 0..<Tape.trackCount { studio.tape.clear(t) }
        studio.tape.recordedEnd = 0
        studio.tape.playhead = 0
        flash("BAND GELÖSCHT")
    }

    func exportedFiles() -> [URL] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: AppModel.documents,
                                                                 includingPropertiesForKeys: [.creationDateKey])) ?? []
        return urls.filter { $0.pathExtension.lowercased() == "wav" }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    // MARK: Persistenz

    private static let stateKey = "kassette.state.v1"

    static func loadState() -> SavedState? {
        guard let data = UserDefaults.standard.data(forKey: stateKey) else { return nil }
        return try? JSONDecoder().decode(SavedState.self, from: data)
    }

    func save() {
        let s = SavedState(patches: patches, drumPatch: drumPatch, slot: slot, mixer: mixer, seq: seq, tapeSpeed: tapeSpeed)
        if let data = try? JSONEncoder().encode(s) {
            UserDefaults.standard.set(data, forKey: AppModel.stateKey)
        }
    }

    func resetSounds() {
        patches = Patch.factory
        drumPatch = Patch.drumKit
        studio.load(patch)
        flash("WERKSKLÄNGE")
    }

    // MARK: Formatierung

    static func speed(from v: Float) -> Float {
        let s = (v - 0.5) * 4
        if abs(s - 1) < 0.05 { return 1 }
        if abs(s + 1) < 0.05 { return -1 }
        return s
    }

    static func percent(_ v: Float) -> String { "\(Int((v * 100).rounded()))" }

    static func seconds(_ s: Float) -> String {
        s < 1 ? "\(Int(s * 1000)) ms" : String(format: "%.2f s", s)
    }

    static func clock(_ s: Double) -> String {
        let total = max(0, s)
        let m = Int(total) / 60
        let sec = total - Double(m * 60)
        return String(format: "%d:%04.1f", m, sec)
    }

    static func pan(_ v: Float) -> String {
        let x = Int(((v - 0.5) * 200).rounded())
        if x == 0 { return "C" }
        return x < 0 ? "L\(-x)" : "R\(x)"
    }

    static let noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    static func noteName(_ n: Int) -> String { "\(noteNames[((n % 12) + 12) % 12])\(n / 12 - 1)" }
}
