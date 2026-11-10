import Foundation

// Gemeinsame Datentypen für Klangerzeugung, Effekte und Sequencer.

enum EngineKind: Int, Codable, CaseIterable {
    case wave, fm, swarm, pluck, pulse, bend, drum, sampler

    static let titles = ["WAVE", "FM", "SWARM", "PLUCK", "PULSE", "BEND", "DRUM", "SAMPLER"]
    static let synthEngines: [EngineKind] = [.wave, .fm, .swarm, .pluck, .pulse, .bend, .sampler]

    var title: String { EngineKind.titles[rawValue] }

    var paramNames: [String] {
        switch self {
        case .wave: return ["SHAPE", "FOLD", "DETUNE", "SUB"]
        case .fm: return ["RATIO", "INDEX", "FEEDBK", "DECAY"]
        case .swarm: return ["SPREAD", "VOICES", "BRIGHT", "SUB"]
        case .pluck: return ["COLOR", "SUSTAIN", "DAMP", "DRIVE"]
        case .pulse: return ["WIDTH", "PWM", "SUB", "NOISE"]
        case .bend: return ["AMOUNT", "SHAPE", "RESO", "ENV"]
        case .drum: return ["TUNE", "DECAY", "TONE", "PUNCH"]
        case .sampler: return ["START", "LENGTH", "LOOP", "TONE"]
        }
    }

    var defaultParams: SIMD4<Float> {
        switch self {
        case .wave: return SIMD4(0.35, 0.1, 0.3, 0.2)
        case .fm: return SIMD4(0.3, 0.45, 0.1, 0.5)
        case .swarm: return SIMD4(0.5, 0.7, 0.6, 0.25)
        case .pluck: return SIMD4(0.7, 0.7, 0.35, 0.1)
        case .pulse: return SIMD4(0.3, 0.3, 0.4, 0)
        case .bend: return SIMD4(0.4, 0.0, 0.3, 0.5)
        case .drum: return SIMD4(0.5, 0.5, 0.5, 0.4)
        case .sampler: return SIMD4(0, 1, 0, 0.85)
        }
    }

    func display(_ index: Int, _ v: Float) -> String {
        switch (self, index) {
        case (.fm, 0):
            let r = fmRatios[quantize(v, fmRatios.count)]
            return r == floorf(r) ? "×\(Int(r))" : "×\(String(format: "%.1f", r))"
        case (.bend, 1):
            return ["SAW", "PULSE", "RESO"][quantize(v, 3)]
        case (.sampler, 2):
            return v > 0.5 ? "LOOP" : "ONCE"
        case (.drum, 0):
            let semis = Int(((v - 0.5) * 24).rounded())
            return semis > 0 ? "+\(semis)" : "\(semis)"
        default:
            return "\(Int((v * 100).rounded()))"
        }
    }
}

enum FXKind: Int, Codable, CaseIterable {
    case off, delay, space, filter, drive, chorus

    static let titles = ["OFF", "DELAY", "SPACE", "FILTER", "DRIVE", "CHORUS"]

    var title: String { FXKind.titles[rawValue] }

    var next: FXKind { FXKind(rawValue: (rawValue + 1) % FXKind.allCases.count) ?? .off }

    var paramNames: [String] {
        switch self {
        case .off: return ["—", "—", "—", "—"]
        case .delay: return ["TIME", "FEEDBK", "MIX", "TONE"]
        case .space: return ["SIZE", "DAMP", "MIX", "PRE"]
        case .filter: return ["CUTOFF", "RESO", "TYPE", "DRIVE"]
        case .drive: return ["GAIN", "BITS", "RATE", "MIX"]
        case .chorus: return ["RATE", "DEPTH", "MIX", "FEEDBK"]
        }
    }

    var defaultParams: SIMD4<Float> {
        switch self {
        case .off: return SIMD4(0.5, 0.5, 0.5, 0.5)
        case .delay: return SIMD4(0.55, 0.45, 0.3, 0.6)
        case .space: return SIMD4(0.6, 0.4, 0.3, 0.1)
        case .filter: return SIMD4(0.55, 0.4, 0, 0.2)
        case .drive: return SIMD4(0.35, 0, 0, 1)
        case .chorus: return SIMD4(0.3, 0.5, 0.5, 0.2)
        }
    }

    func display(_ index: Int, _ v: Float) -> String {
        switch (self, index) {
        case (.off, _):
            return "—"
        case (.delay, 0):
            return "\(Int(expMap(v, 0.03, 1.4) * 1000)) ms"
        case (.space, 3):
            return "\(Int(v * 200)) ms"
        case (.filter, 0):
            let hz = expMap(v, 40, 18000)
            return hz >= 1000 ? String(format: "%.1fk", hz / 1000) : "\(Int(hz))"
        case (.filter, 2):
            if v < 0.2 { return "LP" }
            if v < 0.4 { return "LP/BP" }
            if v < 0.6 { return "BP" }
            if v < 0.8 { return "BP/HP" }
            return "HP"
        case (.drive, 1):
            return v < 0.01 ? "OFF" : "\(Int(16 - v * 14)) BIT"
        case (.drive, 2):
            return v < 0.01 ? "OFF" : "÷\(Int(1 + v * v * 40))"
        case (.chorus, 0):
            return String(format: "%.2f Hz", expMap(v, 0.05, 6))
        default:
            return "\(Int((v * 100).rounded()))"
        }
    }
}

enum SeqKind: Int, Codable, CaseIterable {
    case off, pattern, arp, euclid
    static let titles = ["OFF", "PATTERN", "ARP", "EUCLID"]
    var title: String { SeqKind.titles[rawValue] }
}

enum LFOInfo {
    static let shapes = ["SINE", "TRI", "SAW", "SQUARE", "S&H"]
    static let targets = ["OFF", "P1", "P2", "P3", "P4", "PITCH", "AMP", "FX"]
    static func rate(_ v: Float) -> Float { expMap(v, 0.05, 20) }
    static func target(_ n: Int) -> Float { (Float(n) + 0.5) / 8 }
}

/// Ein kompletter Klang: Engine + Hüllkurve + Effekt + LFO.
struct Patch: Codable, Equatable {
    var name: String
    var engine: EngineKind
    var params: SIMD4<Float>
    var env: SIMD4<Float>
    var fx: FXKind
    var fxParams: SIMD4<Float>
    var lfo: SIMD4<Float>
    var volume: Float

    init(_ name: String, _ engine: EngineKind, _ params: SIMD4<Float>,
         env: SIMD4<Float> = SIMD4(0.02, 0.4, 0.7, 0.35),
         fx: FXKind = .off, fxParams: SIMD4<Float>? = nil,
         lfo: SIMD4<Float> = SIMD4(0.4, 0, 0, 0), volume: Float = 0.8) {
        self.name = name
        self.engine = engine
        self.params = params
        self.env = env
        self.fx = fx
        self.fxParams = fxParams ?? fx.defaultParams
        self.lfo = lfo
        self.volume = volume
    }

    static let factory: [Patch] = [
        Patch("GLAS", .wave, SIMD4(0.15, 0.2, 0.35, 0.2), env: SIMD4(0.1, 0.45, 0.6, 0.45),
              fx: .space, fxParams: SIMD4(0.65, 0.35, 0.3, 0.1), lfo: SIMD4(0.3, 0.35, 0, LFOInfo.target(2))),
        Patch("GLOCKE", .fm, SIMD4(0.55, 0.5, 0.1, 0.45), env: SIMD4(0, 0.55, 0.15, 0.5),
              fx: .delay, fxParams: SIMD4(0.5, 0.4, 0.3, 0.6)),
        Patch("WOLKE", .swarm, SIMD4(0.5, 0.75, 0.6, 0.3), env: SIMD4(0.35, 0.5, 0.8, 0.6),
              fx: .chorus, fxParams: SIMD4(0.25, 0.5, 0.45, 0.2)),
        Patch("SAITE", .pluck, SIMD4(0.75, 0.75, 0.35, 0.1), env: SIMD4(0, 0.5, 1, 0.3),
              fx: .space, fxParams: SIMD4(0.45, 0.5, 0.25, 0.05)),
        Patch("BASS", .pulse, SIMD4(0.2, 0.2, 0.7, 0), env: SIMD4(0, 0.3, 0.5, 0.15),
              fx: .filter, fxParams: SIMD4(0.42, 0.55, 0, 0.3), lfo: SIMD4(0.35, 0.4, 0, LFOInfo.target(7))),
        Patch("KRISTALL", .bend, SIMD4(0.35, 0.9, 0.4, 0.5), env: SIMD4(0, 0.45, 0.4, 0.4),
              fx: .delay, fxParams: SIMD4(0.62, 0.5, 0.25, 0.4)),
        Patch("E-PIANO", .fm, SIMD4(0.1, 0.3, 0.05, 0.4), env: SIMD4(0, 0.6, 0.3, 0.4),
              fx: .chorus, fxParams: SIMD4(0.35, 0.3, 0.35, 0), lfo: SIMD4(0.5, 0.15, 0, LFOInfo.target(6))),
        Patch("SAMPLER", .sampler, EngineKind.sampler.defaultParams, env: SIMD4(0, 0.5, 1, 0.3),
              fx: .space, fxParams: SIMD4(0.5, 0.4, 0.2, 0.1))
    ]

    static let drumKit = Patch("KIT", .drum, EngineKind.drum.defaultParams, env: SIMD4(0, 0, 1, 0.2),
                               fx: .drive, fxParams: SIMD4(0.15, 0, 0, 1), volume: 0.85)
}

/// Namen der 12 Drum-Sounds pro Oktave (C = Kick …).
let drumNames = ["KICK", "RIM", "SNARE", "CLAP", "TOM L", "TOM M", "HAT C", "TOM H", "HAT O", "BELL", "CYMBAL", "ZAP"]
