import Foundation

enum StudioEvent {
    case noteOn(Int, Float)
    case noteOff(Int)
    case allOff
    case play
    case stop
}

/// Das komplette Gerät ohne Oberfläche:
/// Instrument → Effekt → (Live + 4 Bandspuren) → Mixer → Master-Effekt → Limiter.
final class Studio {
    static let blockSize = 32
    static let scopeSize = 1024

    let sampleRate: Float
    let instrument: Instrument
    let fx: FXUnit
    let tape: Tape
    let seq: Sequencer
    private let masterL: FXUnit
    private let masterR: FXUnit

    // Mixer (UI schreibt)
    var levels = SIMD4<Float>(repeating: 0.8)
    var pans = SIMD4<Float>(repeating: 0.5)
    var mutes = SIMD4<Float>(repeating: 1)
    var liveLevel: Float = 0.9
    var masterVolume: Float = 0.8
    var masterFX: FXKind = .space
    var masterFXParams = SIMD4<Float>(0.5, 0.4, 0.15, 0.1)
    var metronomeOn = false
    var metronomeLevel: Float = 0.5

    // Anzeige (Audio schreibt)
    private(set) var trackPeaks = SIMD4<Float>.zero
    private(set) var livePeak: Float = 0
    private(set) var outPeak: Float = 0
    private(set) var clock = 0
    private(set) var transportRunning = false
    private(set) var beatIndex = 0
    let scope: UnsafeMutablePointer<Float>
    private(set) var scopeWrite = 0

    // Event-Queue (UI/MIDI → Audio)
    private let lock = NSLock()
    private var queue = [StudioEvent](repeating: .allOff, count: 512)
    private var qHead = 0
    private var qTail = 0

    private let mono: UnsafeMutablePointer<Float>
    private var beatCounter: Double = 0
    private var clickEnv: Float = 0
    private var clickPhase: Float = 0
    private var clickFreq: Float = 1000

    init(sampleRate: Float) {
        self.sampleRate = sampleRate
        instrument = Instrument(sampleRate: sampleRate)
        fx = FXUnit(sampleRate: sampleRate)
        tape = Tape(sampleRate: sampleRate)
        seq = Sequencer(sampleRate: sampleRate)
        masterL = FXUnit(sampleRate: sampleRate, spread: 0)
        masterR = FXUnit(sampleRate: sampleRate, spread: 23)
        scope = .allocate(capacity: Studio.scopeSize)
        scope.initialize(repeating: 0, count: Studio.scopeSize)
        mono = .allocate(capacity: Studio.blockSize)
        mono.initialize(repeating: 0, count: Studio.blockSize)
    }

    deinit {
        scope.deallocate()
        mono.deallocate()
    }

    // MARK: API für UI und MIDI (beliebiger Thread)

    func send(_ event: StudioEvent) {
        lock.lock()
        let next = (qTail + 1) % queue.count
        if next != qHead {
            queue[qTail] = event
            qTail = next
        }
        lock.unlock()
    }

    func noteOn(_ note: Int, velocity: Float = 0.8) { send(.noteOn(note, velocity)) }
    func noteOff(_ note: Int) { send(.noteOff(note)) }

    func load(_ patch: Patch) { instrument.patch.load(patch) }

    func setRecording(_ on: Bool) {
        if on && !tape.recording { tape.snapshot(tape.armed) }
        tape.recording = on
    }

    func sampleFromTape() -> Bool {
        var start = Int(tape.playhead)
        var end = start + Int(sampleRate * 3)
        if tape.loopOn && tape.hasLoop {
            start = tape.loopStart
            end = tape.loopEnd
        }
        end = min(end, tape.length - 1)
        guard end - start > 256 else { return false }
        instrument.loadSample(from: tape.tracks[tape.armed] + start, count: end - start, rate: Double(sampleRate))
        return instrument.sampleCount > 0
    }

    // MARK: Audio-Thread

    private func drain() {
        guard lock.try() else { return }
        while qHead != qTail {
            let e = queue[qHead]
            qHead = (qHead + 1) % queue.count
            handle(e)
        }
        lock.unlock()
    }

    private func handle(_ event: StudioEvent) {
        switch event {
        case let .noteOn(n, v):
            switch seq.kind {
            case .arp, .euclid:
                seq.press(n)
            case .pattern:
                if seq.transportRunning {
                    seq.transpose = n - 60
                } else {
                    instrument.noteOn(n, velocity: v)
                    if seq.stepInput { seq.writeStep(n) }
                }
            case .off:
                instrument.noteOn(n, velocity: v)
            }
        case let .noteOff(n):
            switch seq.kind {
            case .arp, .euclid: seq.release(n)
            default: instrument.noteOff(n)
            }
        case .allOff:
            instrument.allNotesOff()
            seq.clearHeld()
        case .play:
            transportRunning = true
            tape.running = true
            seq.start()
            beatCounter = 0
            beatIndex = 0
        case .stop:
            transportRunning = false
            tape.running = false
            tape.recording = false
            seq.stop(instrument)
        }
    }

    func render(_ left: UnsafeMutablePointer<Float>, _ right: UnsafeMutablePointer<Float>, _ frames: Int) {
        drain()
        var offset = 0
        while offset < frames {
            let n = min(Studio.blockSize, frames - offset)
            renderBlock(left + offset, right + offset, n)
            offset += n
        }
    }

    func mixGains() -> (SIMD4<Float>, SIMD4<Float>) {
        let lv = levels * levels * mutes
        var gl = SIMD4<Float>.zero
        var gr = SIMD4<Float>.zero
        for t in 0..<4 {
            let a = clamp01(pans[t]) * Float.pi * 0.5
            gl[t] = cosf(a) * lv[t] * 1.414
            gr[t] = sinf(a) * lv[t] * 1.414
        }
        return (gl, gr)
    }

    private func renderBlock(_ l: UnsafeMutablePointer<Float>, _ r: UnsafeMutablePointer<Float>, _ n: Int) {
        instrument.clock = clock
        seq.process(n, instrument)
        let fxMod = instrument.render(mono, n)
        var fp = instrument.patch.fxParams
        fp.x = clamp01(fp.x + fxMod)
        fx.process(mono, n, instrument.patch.fx, fp)

        let (gl, gr) = mixGains()
        let live = liveLevel * liveLevel
        var peaks = trackPeaks
        var lp = livePeak
        var sw = scopeWrite
        for i in 0..<n {
            let x = mono[i]
            let t = tape.tick(x)
            l[i] = x * live + (t * gl).sum()
            r[i] = x * live + (t * gr).sum()
            peaks = pointwiseMax(peaks * 0.9997, SIMD4(abs(t.x), abs(t.y), abs(t.z), abs(t.w)))
            lp = max(lp * 0.9997, abs(x))
            scope[sw] = x
            sw = (sw + 1) & (Studio.scopeSize - 1)
        }
        scopeWrite = sw
        trackPeaks = peaks
        livePeak = lp

        let mfx = masterFX
        let mp = masterFXParams
        masterL.process(l, n, mfx, mp)
        masterR.process(r, n, mfx, mp)

        let vol = masterVolume * masterVolume * 1.4
        let beatLength = 60.0 / Double(max(20, seq.bpm)) * Double(sampleRate)
        let click = metronomeOn ? metronomeLevel * 0.45 : 0
        var op = outPeak
        for i in 0..<n {
            var a = tanhf(l[i] * vol)
            var b = tanhf(r[i] * vol)
            if transportRunning {
                beatCounter -= 1
                if beatCounter <= 0 {
                    beatCounter += beatLength
                    clickEnv = 1
                    clickPhase = 0
                    clickFreq = beatIndex % 4 == 0 ? 1760 : 1180
                    beatIndex += 1
                }
            }
            if clickEnv > 0.001 {
                clickPhase = wrapPhase(clickPhase + clickFreq / sampleRate)
                let c = sinf(kTwoPi * clickPhase) * clickEnv * click
                a += c
                b += c
                clickEnv *= 0.9985
            }
            l[i] = a
            r[i] = b
            op = max(op * 0.9998, max(abs(a), abs(b)))
        }
        outPeak = op
        clock += n
    }

    // MARK: Bounce (Hintergrund-Thread)

    /// Mischt das Band mit den aktuellen Mixer-Einstellungen zu einer Stereo-WAV-Datei.
    func bounce(progress: (Float) -> Void) -> Data {
        let frames = min(tape.length - 2, tape.recordedEnd + Int(sampleRate * 2))
        guard frames > 0 else { return WAV.encode([], channels: 2, sampleRate: Int(sampleRate)) }
        let fl = FXUnit(sampleRate: sampleRate, spread: 0)
        let fr = FXUnit(sampleRate: sampleRate, spread: 23)
        let (gl, gr) = mixGains()
        let kind = masterFX
        let params = masterFXParams
        let vol = masterVolume * masterVolume * 1.4

        var pcm = [Int16](repeating: 0, count: frames * 2)
        let block = 1024
        let bl = UnsafeMutablePointer<Float>.allocate(capacity: block)
        let br = UnsafeMutablePointer<Float>.allocate(capacity: block)
        defer {
            bl.deallocate()
            br.deallocate()
        }
        var pos = 0
        var blocks = 0
        while pos < frames {
            let n = min(block, frames - pos)
            for i in 0..<n {
                let s = tape.frame(pos + i)
                bl[i] = (s * gl).sum()
                br[i] = (s * gr).sum()
            }
            fl.process(bl, n, kind, params)
            fr.process(br, n, kind, params)
            for i in 0..<n {
                pcm[(pos + i) * 2] = Int16(clamp(tanhf(bl[i] * vol), -1, 1) * 32767)
                pcm[(pos + i) * 2 + 1] = Int16(clamp(tanhf(br[i] * vol), -1, 1) * 32767)
            }
            pos += n
            blocks += 1
            if blocks % 64 == 0 { progress(Float(pos) / Float(frames)) }
        }
        progress(1)
        return WAV.encode(pcm, channels: 2, sampleRate: Int(sampleRate))
    }
}

enum WAV {
    static func encode(_ pcm: [Int16], channels: Int, sampleRate: Int) -> Data {
        let dataSize = pcm.count * 2
        var d = Data(capacity: 44 + dataSize)
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        d.append(contentsOf: Array("RIFF".utf8))
        u32(36 + dataSize)
        d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8))
        u32(16)
        u16(1)
        u16(channels)
        u32(sampleRate)
        u32(sampleRate * channels * 2)
        u16(channels * 2)
        u16(16)
        d.append(contentsOf: Array("data".utf8))
        u32(dataSize)
        pcm.withUnsafeBytes { d.append(contentsOf: $0) }
        return d
    }
}
