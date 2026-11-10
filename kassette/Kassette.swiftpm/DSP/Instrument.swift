import Foundation

/// Die aktuell gespielten Klangparameter. Die UI schreibt, der Audio-Thread liest.
final class LivePatch {
    var engine: EngineKind = .wave
    var params = SIMD4<Float>(repeating: 0.5)
    var env = SIMD4<Float>(0, 0.3, 0.7, 0.3)
    var fx: FXKind = .off
    var fxParams = SIMD4<Float>(repeating: 0.5)
    var lfo = SIMD4<Float>(0.4, 0, 0, 0)
    var volume: Float = 0.8

    func load(_ p: Patch) {
        engine = p.engine
        params = p.params
        env = p.env
        fx = p.fx
        fxParams = p.fxParams
        lfo = p.lfo
        volume = p.volume
    }
}

/// 8-stimmiges Instrument mit LFO. Gibt Mono aus.
final class Instrument {
    static let voiceCount = 8

    let sampleRate: Float
    let voices: [Voice]
    let patch = LivePatch()

    private var currentEngine: EngineKind = .wave
    private var rng = FastRandom(state: 0xBEEF_CAFE)

    // LFO
    private(set) var lfoPhase: Float = 0
    private(set) var lfoValue: Float = 0
    private var lfoHold: Float = 0

    // Sampler
    let sampleCapacity: Int
    let sample: UnsafeMutablePointer<Float>
    private(set) var sampleCount = 0
    private(set) var sampleSourceRate: Double
    private(set) var capturing = false
    private var captureWrite = 0

    // Anzeige
    let drumHitClock: UnsafeMutablePointer<Int>
    private(set) var activeVoices = 0
    var clock = 0

    init(sampleRate: Float) {
        self.sampleRate = sampleRate
        voices = (0..<Instrument.voiceCount).map { Voice(seed: UInt32(0x9E37_79B9 &* UInt32($0 + 1))) }
        sampleCapacity = Int(sampleRate) * 12
        sample = UnsafeMutablePointer<Float>.allocate(capacity: sampleCapacity)
        sample.initialize(repeating: 0, count: sampleCapacity)
        sampleSourceRate = Double(sampleRate)
        drumHitClock = UnsafeMutablePointer<Int>.allocate(capacity: 12)
        drumHitClock.initialize(repeating: -1_000_000, count: 12)
        makeDefaultSample()
    }

    deinit {
        sample.deallocate()
        drumHitClock.deallocate()
    }

    // MARK: Noten

    private func checkEngine() {
        let engine = patch.engine
        if engine != currentEngine {
            for v in voices { v.env.kill() }
            currentEngine = engine
        }
    }

    func noteOn(_ note: Int, velocity: Float) {
        checkEngine()
        let engine = patch.engine
        var chosen: Voice?
        if engine == .drum {
            let kind = ((note % 12) + 12) % 12
            drumHitClock[kind] = clock
            if kind == 6 {
                // Geschlossene Hi-Hat würgt die offene ab.
                for v in voices where v.isActive && v.isDrum && v.drumKind == 8 { v.env.kill() }
            }
            for v in voices where v.isActive && v.isDrum && v.note == note { chosen = v; break }
        } else {
            for v in voices where v.isActive && v.note == note { chosen = v; break }
        }
        if chosen == nil {
            for v in voices where !v.isActive { chosen = v; break }
        }
        if chosen == nil {
            chosen = voices.max(by: { $0.age < $1.age })
        }
        guard let voice = chosen else { return }
        voice.env.configure(patch.env, sampleRate)
        voice.start(note: note, velocity: velocity, engine: engine, params: patch.params,
                    sampleRate: sampleRate, sampleCount: sampleCount)
    }

    func noteOff(_ note: Int) {
        if patch.engine == .drum { return }
        for v in voices where v.gate && v.note == note {
            v.gate = false
            v.env.gateOff()
        }
    }

    func allNotesOff() {
        for v in voices {
            v.gate = false
            v.env.gateOff()
        }
    }

    // MARK: Rendering

    /// Rendert `n` Samples in `out`. Gibt die LFO-Modulation für den Effekt zurück.
    func render(_ out: UnsafeMutablePointer<Float>, _ n: Int) -> Float {
        checkEngine()
        let engine = currentEngine
        let lfo = patch.lfo

        lfoPhase += LFOInfo.rate(lfo.x) * Float(n) / sampleRate
        if lfoPhase >= 1 {
            lfoPhase -= floorf(lfoPhase)
            lfoHold = rng.next()
        }
        let lv = lfoShape(quantize(lfo.z, 5), lfoPhase)
        lfoValue = lv
        let depth = lfo.y

        var p = patch.params
        var ctx = RenderContext()
        var amp: Float = 1
        var fxMod: Float = 0
        let target = quantize(lfo.w, 8)
        switch target {
        case 1...4: p[target - 1] = clamp01(p[target - 1] + lv * depth * 0.5)
        case 5: ctx.pitch = powf(2, lv * depth * depth)
        case 6: amp = 1 - depth * 0.5 * (1 - lv)
        case 7: fxMod = lv * depth * 0.5
        default: break
        }

        switch engine {
        case .fm:
            ctx.fmDecay = p.w > 0.97 ? 1 : expf(-1 / (sampleRate * expMap(p.w, 0.02, 5)))
        case .bend:
            ctx.bendDecay = expf(-1 / (sampleRate * 0.35))
        case .swarm:
            ctx.swarmCoef = onePoleCoef(expMap(p.z, 300, 18000), sampleRate)
        case .pluck:
            ctx.ksFeedback = 0.97 + p.y * 0.0299
            ctx.ksBlend = 0.08 + p.z * 0.42
        case .sampler:
            ctx.samplerCoef = onePoleCoef(expMap(p.w, 200, 20000), sampleRate)
            ctx.sample = sample
            ctx.sampleCount = sampleCount
            ctx.sampleRatio = sampleSourceRate / Double(sampleRate)
        default:
            break
        }

        for i in 0..<n { out[i] = 0 }
        var count = 0
        let envParams = patch.env
        for v in voices where v.isActive {
            count += 1
            if !v.isDrum { v.env.configure(envParams, sampleRate) }
            for i in 0..<n { out[i] += v.render(engine, p, sampleRate, ctx) }
            v.age += n
        }
        activeVoices = count

        let gain = patch.volume * patch.volume * amp * 0.5
        for i in 0..<n { out[i] *= gain }
        return fxMod
    }

    private func lfoShape(_ shape: Int, _ t: Float) -> Float {
        switch shape {
        case 0: return sinf(kTwoPi * t)
        case 1: return triangle(t)
        case 2: return 2 * t - 1
        case 3: return t < 0.5 ? 1 : -1
        default: return lfoHold
        }
    }

    // MARK: Sampler

    func beginCapture(sourceRate: Double) {
        sampleCount = 0
        captureWrite = 0
        sampleSourceRate = sourceRate
        capturing = true
    }

    /// Wird vom Mikrofon-Tap aufgerufen (Hintergrund-Thread).
    func capture(_ src: UnsafePointer<Float>, _ n: Int) {
        guard capturing else { return }
        let m = min(sampleCapacity - captureWrite, n)
        if m <= 0 {
            capturing = false
            return
        }
        (sample + captureWrite).update(from: src, count: m)
        captureWrite += m
    }

    var captureProgress: Float { Float(captureWrite) / Float(sampleCapacity) }

    func endCapture() {
        capturing = false
        finishSample(captureWrite)
    }

    func loadSample(from src: UnsafePointer<Float>, count: Int, rate: Double) {
        sampleCount = 0
        let n = min(count, sampleCapacity)
        sample.update(from: src, count: n)
        sampleSourceRate = rate
        finishSample(n)
    }

    /// Stille am Anfang abschneiden und normalisieren.
    private func finishSample(_ n: Int) {
        guard n > 16 else { sampleCount = 0; return }
        var peak: Float = 0
        for i in 0..<n { peak = max(peak, abs(sample[i])) }
        guard peak > 0.0001 else { sampleCount = 0; return }
        var first = 0
        while first < n - 1 && abs(sample[first]) < peak * 0.03 { first += 1 }
        let length = n - first
        if first > 0 { memmove(sample, sample + first, length * MemoryLayout<Float>.size) }
        let gain = 0.9 / peak
        for i in 0..<length { sample[i] *= gain }
        let fade = min(length, 256)
        for i in 0..<fade { sample[length - 1 - i] *= Float(i) / Float(fade) }
        sampleCount = length
    }

    /// Ein synthetischer "Aah"-Chor als Start-Sample.
    private func makeDefaultSample() {
        let sr = Double(sampleRate)
        let length = Int(sr * 1.6)
        let f0 = 261.6256
        func formant(_ f: Double, _ center: Double, _ bw: Double) -> Double {
            let x = (f - center) / bw
            return 1 / (1 + x * x)
        }
        var weights = [Double](repeating: 0, count: 24)
        for h in 1...24 {
            let fh = f0 * Double(h)
            weights[h - 1] = formant(fh, 730, 90) + 0.6 * formant(fh, 1090, 110) + 0.3 * formant(fh, 2440, 160)
        }
        for i in 0..<length {
            let t = Double(i) / sr
            var s = 0.0
            for h in 1...24 {
                s += sin(2 * Double.pi * f0 * Double(h) * t) * weights[h - 1]
            }
            let e = min(1, t / 0.06) * exp(-t * 1.2)
            sample[i] = Float(s * e)
        }
        finishSample(length)
    }
}
