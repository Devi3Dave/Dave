import Foundation

/// Drei Sequencer: Pattern (16 Steps, transponierbar), Arpeggiator und euklidischer Rhythmus.
/// Läuft komplett im Audio-Thread; die UI schreibt nur einfache Werte.
final class Sequencer {
    static let maxSteps = 16
    static let rateMultipliers: [Double] = [4, 2, 1, 0.5]
    static let rateNames = ["1/4", "1/8", "1/16", "1/32"]
    static let arpModes = ["UP", "DOWN", "UP/DN", "RANDOM", "ORDER"]

    let sampleRate: Float

    var kind: SeqKind = .off
    var bpm: Float = 110
    var swing: Float = 0

    // Pattern
    let steps: UnsafeMutablePointer<Int>
    var length = 16
    var gate: Float = 0.5
    var transpose = 0
    var cursor = 0
    var stepInput = false

    // Arp
    var arpRate = 2
    var arpMode = 0
    var arpOctaves = 1

    // Euklid
    var euclidSteps = 16
    var euclidPulses = 5
    var euclidRotate = 0
    var euclidRate = 2

    var latch = false
    private(set) var transportRunning = false

    // Gehaltene Tasten (Arp/Euklid)
    let held: UnsafeMutablePointer<Int>
    private(set) var heldCount = 0
    private var physicalDown = 0
    private let sorted: UnsafeMutablePointer<Int>

    // Laufzeit
    private var counter: Double = 0
    private var tick = 0
    private var position = 0
    private(set) var playingStep = -1
    private var arpIndex = 0
    private var wasActive = false
    private let offNote: UnsafeMutablePointer<Int>
    private let offTime: UnsafeMutablePointer<Double>
    private static let offSlots = 32
    private var rng = FastRandom(state: 0xC0FF_EE11)

    init(sampleRate: Float) {
        self.sampleRate = sampleRate
        steps = .allocate(capacity: Sequencer.maxSteps)
        steps.initialize(repeating: -1, count: Sequencer.maxSteps)
        held = .allocate(capacity: 16)
        held.initialize(repeating: 0, count: 16)
        sorted = .allocate(capacity: 16)
        sorted.initialize(repeating: 0, count: 16)
        offNote = .allocate(capacity: Sequencer.offSlots)
        offNote.initialize(repeating: -1, count: Sequencer.offSlots)
        offTime = .allocate(capacity: Sequencer.offSlots)
        offTime.initialize(repeating: 0, count: Sequencer.offSlots)
    }

    deinit {
        steps.deallocate()
        held.deallocate()
        sorted.deallocate()
        offNote.deallocate()
        offTime.deallocate()
    }

    func stepLength(_ rate: Int) -> Double {
        60.0 / Double(max(20, bpm)) / 4.0 * Double(sampleRate) * Sequencer.rateMultipliers[min(3, max(0, rate))]
    }

    // MARK: Eingaben (Audio-Thread, über die Event-Queue)

    func press(_ note: Int) {
        if latch && physicalDown == 0 { heldCount = 0 }
        physicalDown += 1
        for k in 0..<heldCount where held[k] == note { return }
        if heldCount < 16 {
            held[heldCount] = note
            heldCount += 1
        }
    }

    func release(_ note: Int) {
        physicalDown = max(0, physicalDown - 1)
        if latch { return }
        var k = 0
        while k < heldCount {
            if held[k] == note {
                for j in k..<(heldCount - 1) { held[j] = held[j + 1] }
                heldCount -= 1
            } else {
                k += 1
            }
        }
    }

    func clearHeld() {
        heldCount = 0
        physicalDown = 0
    }

    func writeStep(_ note: Int) {
        let len = max(1, min(Sequencer.maxSteps, length))
        let c = min(max(0, cursor), len - 1)
        steps[c] = note
        cursor = (c + 1) % len
    }

    func start() {
        transportRunning = true
        counter = 0
        position = 0
        tick = 0
    }

    func stop(_ inst: Instrument) {
        transportRunning = false
        playingStep = -1
        for k in 0..<Sequencer.offSlots where offNote[k] >= 0 {
            inst.noteOff(offNote[k])
            offNote[k] = -1
        }
    }

    // MARK: Takt

    func process(_ n: Int, _ inst: Instrument) {
        for k in 0..<Sequencer.offSlots where offNote[k] >= 0 {
            offTime[k] -= Double(n)
            if offTime[k] <= 0 {
                inst.noteOff(offNote[k])
                offNote[k] = -1
            }
        }

        let active: Bool
        switch kind {
        case .off: active = false
        case .pattern: active = transportRunning
        case .arp, .euclid: active = heldCount > 0
        }

        if !active {
            if wasActive {
                wasActive = false
                playingStep = -1
            }
            counter = 0
            return
        }
        if !wasActive {
            wasActive = true
            counter = 0
            if kind != .pattern {
                position = 0
                arpIndex = 0
                tick = 0
            }
        }

        counter -= Double(n)
        var guardCount = 0
        while counter <= 0 && guardCount < 8 {
            guardCount += 1
            let rate: Int
            switch kind {
            case .arp: rate = arpRate
            case .euclid: rate = euclidRate
            default: rate = 2
            }
            var len = stepLength(rate)
            fire(inst, len)
            if swing > 0 {
                len *= tick % 2 == 0 ? Double(1 + swing * 0.5) : Double(1 - swing * 0.5)
            }
            tick += 1
            counter += len
        }
    }

    var gateFraction: Double { Double(0.05 + gate * 0.9) }

    private func fire(_ inst: Instrument, _ len: Double) {
        switch kind {
        case .pattern:
            let count = max(1, min(Sequencer.maxSteps, length))
            let pos = position % count
            playingStep = pos
            let note = steps[pos]
            if note >= 0 { trigger(inst, note + transpose, len * gateFraction) }
            position = (pos + 1) % count

        case .arp:
            guard heldCount > 0 else { return }
            sortHeld()
            let octaves = max(1, min(3, arpOctaves))
            let total = heldCount * octaves
            var idx: Int
            switch arpMode {
            case 0: idx = arpIndex % total
            case 1: idx = total - 1 - (arpIndex % total)
            case 2:
                let period = max(1, total * 2 - 2)
                let m = arpIndex % period
                idx = m < total ? m : period - m
            case 3: idx = min(total - 1, Int(rng.unit() * Float(total)))
            default: idx = arpIndex % total
            }
            idx = min(max(0, idx), total - 1)
            let base = arpMode == 4 ? held[idx % heldCount] : sorted[idx % heldCount]
            playingStep = idx
            arpIndex += 1
            trigger(inst, base + 12 * (idx / heldCount), len * gateFraction)

        case .euclid:
            let count = max(1, min(32, euclidSteps))
            let pulses = max(0, min(count, euclidPulses))
            let pos = position % count
            playingStep = pos
            if Sequencer.euclidHit(pos, count, pulses, euclidRotate) {
                for k in 0..<heldCount { trigger(inst, held[k], len * gateFraction) }
            }
            position = (pos + 1) % count

        case .off:
            break
        }
    }

    static func euclidHit(_ i: Int, _ n: Int, _ k: Int, _ rotate: Int) -> Bool {
        guard k > 0, n > 0 else { return false }
        let j = ((i + rotate) % n + n) % n
        return (j * k) % n < k
    }

    private func trigger(_ inst: Instrument, _ note: Int, _ duration: Double) {
        let n = max(0, min(127, note))
        for k in 0..<Sequencer.offSlots where offNote[k] == n {
            inst.noteOff(n)
            offNote[k] = -1
        }
        inst.noteOn(n, velocity: 0.85)
        for k in 0..<Sequencer.offSlots where offNote[k] < 0 {
            offNote[k] = n
            offTime[k] = max(64, duration)
            return
        }
    }

    private func sortHeld() {
        for k in 0..<heldCount { sorted[k] = held[k] }
        if heldCount < 2 { return }
        for i in 1..<heldCount {
            let v = sorted[i]
            var j = i - 1
            while j >= 0 && sorted[j] > v {
                sorted[j + 1] = sorted[j]
                j -= 1
            }
            sorted[j + 1] = v
        }
    }
}
