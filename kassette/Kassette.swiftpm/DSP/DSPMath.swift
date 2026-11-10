import Foundation

// Kleine, echtzeitfähige DSP-Bausteine (keine Allokationen, keine Locks).

let kTwoPi: Float = 2 * Float.pi

@inline(__always) func clamp(_ x: Float, _ lo: Float, _ hi: Float) -> Float { min(max(x, lo), hi) }
@inline(__always) func clamp01(_ x: Float) -> Float { min(max(x, 0), 1) }
@inline(__always) func lerp(_ a: Float, _ b: Float, _ t: Float) -> Float { a + (b - a) * t }
@inline(__always) func noteToHz(_ note: Float) -> Float { 440 * powf(2, (note - 69) / 12) }
@inline(__always) func expMap(_ x: Float, _ lo: Float, _ hi: Float) -> Float { lo * powf(hi / lo, clamp01(x)) }
@inline(__always) func frac(_ x: Float) -> Float { x - floorf(x) }
@inline(__always) func wrapPhase(_ x: Float) -> Float { x >= 1 ? x - floorf(x) : x }

/// Teilt 0…1 in `n` gleich große Stufen und liefert den Index.
@inline(__always) func quantize(_ x: Float, _ n: Int) -> Int { min(n - 1, max(0, Int(x * Float(n)))) }

@inline(__always) func onePoleCoef(_ hz: Float, _ sr: Float) -> Float { 1 - expf(-kTwoPi * hz / sr) }

/// Filterkoeffizient für das TPT-SVF.
@inline(__always) func svfG(_ hz: Float, _ sr: Float) -> Float { tanf(Float.pi * min(max(hz, 10), sr * 0.45) / sr) }

/// PolyBLEP-Korrektur gegen Aliasing an Sprungstellen.
@inline(__always) func polyBlep(_ t: Float, _ dt: Float) -> Float {
    if t < dt {
        let x = t / dt
        return x + x - x * x - 1
    } else if t > 1 - dt {
        let x = (t - 1) / dt
        return x * x + x + x + 1
    }
    return 0
}

/// Dreieck mit derselben Phasenlage wie ein Sinus.
@inline(__always) func triangle(_ t: Float) -> Float {
    if t < 0.25 { return 4 * t }
    if t < 0.75 { return 2 - 4 * t }
    return 4 * t - 4
}

/// Morph Sinus → Dreieck → Sägezahn → Rechteck (m = 0…1).
@inline(__always) func morphOsc(_ t: Float, _ dt: Float, _ m: Float) -> Float {
    let pos = clamp01(m) * 3
    if pos <= 1 {
        return lerp(sinf(kTwoPi * t), triangle(t), pos)
    }
    let ts = frac(t + 0.5)
    let saw = 2 * ts - 1 - polyBlep(ts, dt)
    if pos <= 2 {
        return lerp(triangle(t), saw, pos - 1)
    }
    var square: Float = t < 0.5 ? 1 : -1
    square += polyBlep(t, dt)
    square -= polyBlep(frac(t + 0.5), dt)
    return lerp(saw, square * 0.8, pos - 2)
}

struct FastRandom {
    var state: UInt32 = 0x1234_5678

    /// Gleichverteilt in -1…1.
    @inline(__always) mutating func next() -> Float {
        state ^= state << 13
        state ^= state >> 17
        state ^= state << 5
        return Float(state) / Float(UInt32.max) * 2 - 1
    }

    /// Gleichverteilt in 0…1.
    @inline(__always) mutating func unit() -> Float { (next() + 1) * 0.5 }
}

struct OnePole {
    var z: Float = 0
    @inline(__always) mutating func lp(_ x: Float, _ coef: Float) -> Float {
        z += coef * (x - z)
        return z
    }
}

/// Zustandsvariablen-Filter (Topology Preserving Transform).
struct SVF {
    var ic1: Float = 0
    var ic2: Float = 0

    @inline(__always)
    mutating func process(_ x: Float, _ g: Float, _ k: Float) -> (lp: Float, bp: Float, hp: Float) {
        let a1 = 1 / (1 + g * (g + k))
        let a2 = g * a1
        let a3 = g * a2
        let v3 = x - ic2
        let v1 = a1 * ic1 + a2 * v3
        let v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        return (v2, v1, x - k * v1 - v2)
    }
}

/// ADSR-Hüllkurve: lineare Attack-Phase, exponentielle Decay- und Release-Phase.
struct ADSR {
    enum Stage { case idle, attack, decay, sustain, release }

    var stage: Stage = .idle
    var level: Float = 0
    private var attackInc: Float = 0.01
    private var decayCoef: Float = 0.999
    private var sustain: Float = 0.7
    private var releaseCoef: Float = 0.999

    var isIdle: Bool { stage == .idle }

    static func attackTime(_ v: Float) -> Float { 0.001 + v * v * 4 }
    static func decayTime(_ v: Float) -> Float { 0.005 + v * v * 6 }
    static func releaseTime(_ v: Float) -> Float { 0.005 + v * v * 8 }

    mutating func configure(_ env: SIMD4<Float>, _ sr: Float) {
        attackInc = 1 / (ADSR.attackTime(env.x) * sr)
        decayCoef = expf(-4.6 / (ADSR.decayTime(env.y) * sr))
        sustain = env.z
        releaseCoef = expf(-4.6 / (ADSR.releaseTime(env.w) * sr))
    }

    mutating func gateOn() { stage = .attack }
    mutating func gateOff() { if stage != .idle { stage = .release } }
    mutating func kill() { stage = .idle; level = 0 }

    @inline(__always) mutating func next() -> Float {
        switch stage {
        case .idle:
            return 0
        case .attack:
            level += attackInc
            if level >= 1 { level = 1; stage = .decay }
        case .decay:
            level = sustain + (level - sustain) * decayCoef
            if level - sustain < 0.0005 { level = sustain; stage = .sustain }
        case .sustain:
            level = sustain
        case .release:
            level *= releaseCoef
            if level < 0.0002 { level = 0; stage = .idle }
        }
        return level
    }
}
