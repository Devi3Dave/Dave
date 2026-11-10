import Foundation

let fmRatios: [Float] = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 7, 9, 11]
let swarmOffsets: [Float] = [-1, -0.62, -0.28, 0, 0.3, 0.6, 0.97]
let hatFreqs: [Float] = [410.6, 608.8, 739.2, 1045.4, 1080, 1600]

/// Pro Block (32 Samples) vorberechnete Werte, die alle Stimmen teilen.
struct RenderContext {
    var pitch: Float = 1
    var fmDecay: Float = 1
    var bendDecay: Float = 1
    var swarmCoef: Float = 1
    var ksFeedback: Float = 0.99
    var ksBlend: Float = 0.5
    var samplerCoef: Float = 1
    var sample: UnsafeMutablePointer<Float>? = nil
    var sampleCount = 0
    var sampleRatio: Double = 1
}

/// Eine Stimme. Enthält den Zustand aller Engines, damit nie zur Laufzeit alloziert werden muss.
final class Voice {
    var note = -1
    var velocity: Float = 0
    var gate = false
    var age = 0
    var env = ADSR()
    var isDrum = false

    private var phases = [Float](repeating: 0, count: 8)
    private var freq: Float = 440
    private var modPhase: Float = 0
    private var feedback: Float = 0
    private var modEnv: Float = 1
    private var tone = OnePole()
    private var rng: FastRandom

    static let ksCapacity = 4096
    private let ks: UnsafeMutablePointer<Float>
    private var ksLength = 64
    private var ksPos = 0

    private(set) var drumKind = 0
    private var drumTime: Float = 0
    private var drumLength: Float = 1
    private var drumPhase: Float = 0
    private var svf = SVF()

    private var samplePos: Double = 0
    private var sampleStart: Double = 0

    static let drumBaseLength: [Float] = [1.4, 0.15, 0.6, 0.7, 1.2, 1.1, 0.25, 1.0, 1.2, 0.9, 4.0, 0.6]

    var isActive: Bool { !env.isIdle }

    init(seed: UInt32) {
        rng = FastRandom(state: seed)
        ks = UnsafeMutablePointer<Float>.allocate(capacity: Voice.ksCapacity)
        ks.initialize(repeating: 0, count: Voice.ksCapacity)
    }

    deinit { ks.deallocate() }

    func start(note: Int, velocity: Float, engine: EngineKind, params p: SIMD4<Float>, sampleRate sr: Float, sampleCount: Int) {
        let wasIdle = env.isIdle
        self.note = note
        self.velocity = velocity
        gate = true
        age = 0
        freq = noteToHz(Float(note))
        modEnv = 1
        feedback = 0
        isDrum = engine == .drum

        if wasIdle {
            for k in 0..<8 { phases[k] = rng.unit() }
            modPhase = 0
        }

        switch engine {
        case .pluck:
            let n = max(2, min(Voice.ksCapacity - 1, Int(sr / freq - 0.5)))
            ksLength = n
            ksPos = 0
            var z: Float = 0
            let coef = 0.05 + p.x * 0.95
            for i in 0..<n {
                z += coef * (rng.next() - z)
                ks[i] = z * velocity
            }
        case .drum:
            drumKind = ((note % 12) + 12) % 12
            drumTime = 0
            drumPhase = 0
            svf = SVF()
            for k in 0..<8 { phases[k] = 0 }
            drumLength = Voice.drumBaseLength[drumKind] * expMap(p.y, 0.3, 3)
        case .sampler:
            sampleStart = Double(p.x) * Double(max(0, sampleCount - 1))
            samplePos = sampleStart
            tone = OnePole()
        default:
            break
        }
        env.gateOn()
    }

    @inline(__always)
    func render(_ engine: EngineKind, _ p: SIMD4<Float>, _ sr: Float, _ ctx: RenderContext) -> Float {
        if isDrum { return drum(p, sr) * velocity }
        let e = env.next()
        if env.isIdle { return 0 }
        return oscillator(engine, p, sr, ctx) * e * velocity
    }

    @inline(__always) private func advance(_ k: Int, _ dt: Float) {
        phases[k] = wrapPhase(phases[k] + dt)
    }

    @inline(__always)
    private func oscillator(_ engine: EngineKind, _ p: SIMD4<Float>, _ sr: Float, _ ctx: RenderContext) -> Float {
        let f = freq * ctx.pitch
        let dt = f / sr

        switch engine {
        case .wave:
            let dt2 = dt * (1 + p.z * 0.02)
            let o1 = morphOsc(phases[0], dt, p.x)
            let o2 = morphOsc(phases[1], dt2, p.x)
            let det = min(1, p.z * 4)
            var s = (o1 + o2 * det) / (1 + det)
            if p.y > 0.01 { s = sinf(s * (1 + p.y * 5) * 1.5707964) }
            let sub: Float = phases[2] < 0.5 ? 1 : -1
            s = s * (1 - p.w * 0.4) + sub * p.w * 0.45
            advance(0, dt)
            advance(1, dt2)
            advance(2, dt * 0.5)
            return s

        case .fm:
            let ratio = fmRatios[quantize(p.x, fmRatios.count)]
            let mod = sinf(kTwoPi * modPhase + feedback * p.z * 2.5)
            feedback = mod
            let index = p.y * p.y * 10 * modEnv
            let s = sinf(kTwoPi * phases[0] + index * mod)
            modPhase = wrapPhase(modPhase + dt * ratio)
            advance(0, dt)
            modEnv *= ctx.fmDecay
            return s

        case .swarm:
            var sum: Float = 0
            for k in 0..<7 {
                let d = dt * (1 + swarmOffsets[k] * p.x * 0.05)
                let t = phases[k]
                let saw = 2 * t - 1 - polyBlep(t, d)
                sum += (k == 3 ? 1 : p.y) * saw
                advance(k, d)
            }
            sum *= 1 / sqrtf(1 + 6 * p.y * p.y)
            var s = tone.lp(sum, ctx.swarmCoef)
            s += sinf(kTwoPi * phases[7]) * p.w * 0.6
            advance(7, dt * 0.5)
            return s

        case .pluck:
            let n = ksLength
            let i0 = ksPos
            let i1 = i0 + 1 >= n ? 0 : i0 + 1
            let a = ks[i0]
            let b = ks[i1]
            ks[i0] = ctx.ksFeedback * (a + (b - a) * ctx.ksBlend)
            ksPos = i1
            var out = a * 1.4
            if p.w > 0.01 { out = tanhf(out * (1 + p.w * 6)) * (1 - p.w * 0.3) }
            return out

        case .pulse:
            let lfo = sinf(kTwoPi * phases[3])
            let w = clamp(0.5 - p.x * 0.45 + lfo * p.y * 0.4, 0.03, 0.97)
            let t = phases[0]
            var s: Float = t < w ? 1 : -1
            s += polyBlep(t, dt)
            s -= polyBlep(frac(t + 1 - w), dt)
            let sub: Float = phases[1] < 0.5 ? 1 : -1
            s = s * 0.7 + sub * p.z * 0.5 + rng.next() * p.w * 0.4
            advance(0, dt)
            advance(1, dt * 0.5)
            advance(3, 0.7 / sr)
            return s

        case .bend:
            let t = phases[0]
            let amount = clamp(p.x + p.w * modEnv * 0.6, 0, 0.98)
            var s: Float
            switch quantize(p.y, 3) {
            case 0:
                let k = 0.5 - amount * 0.48
                let ph = t < k ? 0.5 * t / k : 0.5 + 0.5 * (t - k) / (1 - k)
                s = -cosf(kTwoPi * ph)
            case 1:
                let half = t < 0.5 ? t * 2 : (t - 0.5) * 2
                let q = min(1, half / max(0.02, 1 - amount))
                let sign: Float = t < 0.5 ? 1 : -1
                s = cosf(Float.pi * q) * sign
            default:
                let r = 1 + amount * 12 + p.z * 6
                s = (1 - t) * sinf(kTwoPi * frac(t * r)) * 1.3
            }
            modEnv *= ctx.bendDecay
            advance(0, dt)
            return s

        case .sampler:
            guard let data = ctx.sample, ctx.sampleCount > 2 else { return 0 }
            let last = Double(ctx.sampleCount - 2)
            let end = min(last, sampleStart + max(256, Double(p.y) * (last - sampleStart)))
            if samplePos >= end || samplePos < 0 {
                if p.z > 0.5 && end - sampleStart > 16 {
                    samplePos = sampleStart
                } else {
                    env.kill()
                    return 0
                }
            }
            let i = Int(samplePos)
            let fr = Float(samplePos - Double(i))
            let a = data[i]
            let b = data[i + 1]
            samplePos += Double(powf(2, (Float(note) - 60) / 12) * ctx.pitch) * ctx.sampleRatio
            return tone.lp(a + (b - a) * fr, ctx.samplerCoef)

        case .drum:
            return 0
        }
    }

    // MARK: Drums – alles synthetisch, 12 Sounds pro Oktave

    private func drum(_ p: SIMD4<Float>, _ sr: Float) -> Float {
        let t = drumTime
        drumTime += 1 / sr
        if t > drumLength {
            env.kill()
            return 0
        }
        let tune = powf(2, (p.x - 0.5) * 2)
        let dec = expMap(p.y, 0.3, 3)
        let tone = p.z
        let punch = p.w
        var out: Float = 0

        switch drumKind {
        case 0: // Kick
            let f = 46 * tune + 240 * expf(-t * (18 + punch * 50))
            drumPhase = wrapPhase(drumPhase + f / sr)
            out = sinf(kTwoPi * drumPhase) * expf(-t / (0.3 * dec))
            out += rng.next() * expf(-t * 300) * 0.25 * (0.3 + tone)
            out = tanhf(out * (1 + punch * 3))

        case 1: // Rimshot
            drumPhase = wrapPhase(drumPhase + 470 * tune / sr)
            let n = svf.process(rng.next(), svfG(3200 * tune, sr), 0.4).bp
            out = (sinf(kTwoPi * drumPhase) * 0.7 + n * (0.5 + tone)) * expf(-t * 70 / dec)

        case 2: // Snare
            let f = 180 * tune * (1 + 0.4 * expf(-t * 50))
            drumPhase = wrapPhase(drumPhase + f / sr)
            let body = sinf(kTwoPi * drumPhase) * expf(-t * 20 / dec)
            let n = svf.process(rng.next(), svfG(4500 * tune, sr), 1.0)
            let noise = (n.hp * 0.6 + n.bp * 0.6) * expf(-t * 12 / dec)
            out = tanhf((body * (1 - tone * 0.5) + noise * (0.5 + tone)) * (1 + punch * 2))

        case 3: // Clap
            let n = svf.process(rng.next(), svfG(1200 * tune, sr), 0.5).bp * 2.2
            var e = expf(-t * 8 / dec) * 0.7
            for b in 0..<3 {
                let tb = t - Float(b) * 0.0105
                if tb >= 0 { e += expf(-tb * 160) }
            }
            out = tanhf(n * e * (0.8 + tone * 0.6) * (1 + punch))

        case 4, 5, 7: // Toms
            let base: Float = drumKind == 4 ? 85 : (drumKind == 5 ? 125 : 175)
            let f = base * tune * (1 + 0.7 * expf(-t * 16))
            drumPhase = wrapPhase(drumPhase + f / sr)
            out = sinf(kTwoPi * drumPhase) * expf(-t * 5 / dec)
            out += rng.next() * expf(-t * 120) * 0.2 * tone
            out = tanhf(out * (1 + punch * 2))

        case 6, 8, 10: // Hats & Becken: metallische Rechteck-Cluster + Rauschen
            var m: Float = 0
            for k in 0..<6 {
                let ph = wrapPhase(phases[k] + hatFreqs[k] * tune / sr)
                phases[k] = ph
                m += ph < 0.5 ? 1 : -1
            }
            let mix = m * 0.16 * (1.2 - tone) + rng.next() * (0.25 + tone * 0.5)
            let cutoff: Float = drumKind == 10 ? 5500 : 7500
            let h = svf.process(mix, svfG(cutoff * tune, sr), 0.9).hp
            let len: Float = drumKind == 6 ? 0.04 : (drumKind == 8 ? 0.3 : 1.1)
            out = h * expf(-t / (len * dec)) * 1.3

        case 9: // Cowbell
            phases[0] = wrapPhase(phases[0] + 540 * tune / sr)
            phases[1] = wrapPhase(phases[1] + 800 * tune / sr)
            let a: Float = phases[0] < 0.5 ? 1 : -1
            let b: Float = phases[1] < 0.5 ? 1 : -1
            let bp = svf.process((a + b) * 0.5, svfG(2600 * tune, sr), 0.7).bp
            out = bp * (expf(-t * 40) * 0.5 + expf(-t * 7 / dec) * 0.5) * 1.6

        default: // Zap
            let f = 110 * tune + 2600 * expf(-t * (25 + tone * 60))
            drumPhase = wrapPhase(drumPhase + f / sr)
            out = sinf(kTwoPi * drumPhase) * expf(-t * 9 / dec)
        }
        return out
    }
}
