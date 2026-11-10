import Foundation

final class Comb {
    private let buffer: UnsafeMutablePointer<Float>
    private let size: Int
    private var index = 0
    private var store: Float = 0

    init(size: Int) {
        self.size = max(1, size)
        buffer = UnsafeMutablePointer<Float>.allocate(capacity: self.size)
        buffer.initialize(repeating: 0, count: self.size)
    }

    deinit { buffer.deallocate() }

    @inline(__always) func process(_ x: Float, _ feedback: Float, _ damp: Float) -> Float {
        let out = buffer[index]
        store = out * (1 - damp) + store * damp
        buffer[index] = x + store * feedback
        index += 1
        if index >= size { index = 0 }
        return out
    }

    func clear() {
        buffer.update(repeating: 0, count: size)
        store = 0
    }
}

final class Allpass {
    private let buffer: UnsafeMutablePointer<Float>
    private let size: Int
    private var index = 0

    init(size: Int) {
        self.size = max(1, size)
        buffer = UnsafeMutablePointer<Float>.allocate(capacity: self.size)
        buffer.initialize(repeating: 0, count: self.size)
    }

    deinit { buffer.deallocate() }

    @inline(__always) func process(_ x: Float) -> Float {
        let b = buffer[index]
        buffer[index] = x + b * 0.5
        index += 1
        if index >= size { index = 0 }
        return b - x
    }

    func clear() { buffer.update(repeating: 0, count: size) }
}

/// Ein Mono-Effektslot: Delay, Hall, Filter, Verzerrung oder Chorus.
final class FXUnit {
    let sampleRate: Float
    private var lastKind: FXKind = .off

    // Delay
    private let delayCapacity: Int
    private let delayBuffer: UnsafeMutablePointer<Float>
    private var delayWrite = 0
    private var delayTime: Float = 0
    private var delayTone = OnePole()

    // Hall (Freeverb-Topologie)
    private let combs: [Comb]
    private let allpasses: [Allpass]
    private let preCapacity: Int
    private let preBuffer: UnsafeMutablePointer<Float>
    private var preWrite = 0

    // Filter
    private var filter = SVF()

    // Chorus
    private static let chorusCapacity = 8192
    private let chorusBuffer: UnsafeMutablePointer<Float>
    private var chorusWrite = 0
    private var chorusPhase: Float = 0

    // Drive
    private var hold: Float = 0
    private var holdCounter: Float = 0

    init(sampleRate: Float, spread: Int = 0) {
        self.sampleRate = sampleRate
        let scale = sampleRate / 44100
        combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map { Comb(size: Int(Float($0 + spread) * scale)) }
        allpasses = [556, 441, 341, 225].map { Allpass(size: Int(Float($0 + spread) * scale)) }
        delayCapacity = Int(sampleRate * 1.5) + 8
        delayBuffer = UnsafeMutablePointer<Float>.allocate(capacity: delayCapacity)
        delayBuffer.initialize(repeating: 0, count: delayCapacity)
        preCapacity = Int(sampleRate * 0.25) + 2
        preBuffer = UnsafeMutablePointer<Float>.allocate(capacity: preCapacity)
        preBuffer.initialize(repeating: 0, count: preCapacity)
        chorusBuffer = UnsafeMutablePointer<Float>.allocate(capacity: FXUnit.chorusCapacity)
        chorusBuffer.initialize(repeating: 0, count: FXUnit.chorusCapacity)
    }

    deinit {
        delayBuffer.deallocate()
        preBuffer.deallocate()
        chorusBuffer.deallocate()
    }

    func reset() {
        delayBuffer.update(repeating: 0, count: delayCapacity)
        preBuffer.update(repeating: 0, count: preCapacity)
        chorusBuffer.update(repeating: 0, count: FXUnit.chorusCapacity)
        for c in combs { c.clear() }
        for a in allpasses { a.clear() }
        filter = SVF()
        delayTone = OnePole()
        delayTime = 0
        hold = 0
        holdCounter = 0
    }

    func process(_ buf: UnsafeMutablePointer<Float>, _ n: Int, _ kind: FXKind, _ p: SIMD4<Float>) {
        if kind != lastKind {
            reset()
            lastKind = kind
        }
        switch kind {
        case .off: return
        case .delay: processDelay(buf, n, p)
        case .space: processSpace(buf, n, p)
        case .filter: processFilter(buf, n, p)
        case .drive: processDrive(buf, n, p)
        case .chorus: processChorus(buf, n, p)
        }
    }

    private func processDelay(_ buf: UnsafeMutablePointer<Float>, _ n: Int, _ p: SIMD4<Float>) {
        let target = expMap(p.x, 0.03, 1.4) * sampleRate
        if delayTime <= 0 { delayTime = target }
        let fb = p.y * 0.92
        let mix = p.z
        let coef = onePoleCoef(expMap(p.w, 500, 16000), sampleRate)
        let cap = delayCapacity
        for i in 0..<n {
            // Sanftes Gleiten der Delayzeit klingt wie ein Bandecho.
            delayTime += (target - delayTime) * 0.0007
            var rp = Float(delayWrite) - delayTime
            if rp < 0 { rp += Float(cap) }
            var i0 = Int(rp)
            if i0 >= cap { i0 -= cap }
            let fr = rp - floorf(rp)
            let i1 = i0 + 1 >= cap ? 0 : i0 + 1
            let y = delayBuffer[i0] + (delayBuffer[i1] - delayBuffer[i0]) * fr
            let x = buf[i]
            delayBuffer[delayWrite] = x + tanhf(delayTone.lp(y, coef) * fb)
            delayWrite += 1
            if delayWrite >= cap { delayWrite = 0 }
            buf[i] = x + y * mix
        }
    }

    private func processSpace(_ buf: UnsafeMutablePointer<Float>, _ n: Int, _ p: SIMD4<Float>) {
        let feedback = 0.7 + p.x * 0.28
        let damp = p.y * 0.7
        let mix = p.z
        let pre = min(preCapacity - 1, Int(p.w * 0.2 * sampleRate))
        for i in 0..<n {
            let x = buf[i]
            preBuffer[preWrite] = x
            var rp = preWrite - pre
            if rp < 0 { rp += preCapacity }
            let input = preBuffer[rp] * 0.015
            preWrite += 1
            if preWrite >= preCapacity { preWrite = 0 }
            var acc: Float = 0
            for c in combs { acc += c.process(input, feedback, damp) }
            for a in allpasses { acc = a.process(acc) }
            buf[i] = x * (1 - mix * 0.5) + acc * 3 * mix
        }
    }

    private func processFilter(_ buf: UnsafeMutablePointer<Float>, _ n: Int, _ p: SIMD4<Float>) {
        let g = svfG(expMap(p.x, 40, 18000), sampleRate)
        let k = 2 - p.y * 1.92
        let drive = 1 + p.w * 5
        let makeup = 1 / sqrtf(drive)
        let type = p.z
        for i in 0..<n {
            let x = p.w > 0.01 ? tanhf(buf[i] * drive) * makeup : buf[i]
            let o = filter.process(x, g, k)
            buf[i] = type < 0.5 ? lerp(o.lp, o.bp, type * 2) : lerp(o.bp, o.hp, (type - 0.5) * 2)
        }
    }

    private func processDrive(_ buf: UnsafeMutablePointer<Float>, _ n: Int, _ p: SIMD4<Float>) {
        let gain = 1 + p.x * p.x * 30
        let levels = powf(2, 15 - p.y * 14)
        let holdLength = 1 + p.z * p.z * 40
        let mix = p.w
        let makeup = 1 / (1 + p.x * 1.5)
        for i in 0..<n {
            let x = buf[i]
            var y = tanhf(x * gain)
            if p.y > 0.01 { y = (y * levels).rounded() / levels }
            if p.z > 0.01 {
                holdCounter += 1
                if holdCounter >= holdLength {
                    holdCounter -= holdLength
                    hold = y
                }
                y = hold
            }
            buf[i] = lerp(x, y * makeup, mix)
        }
    }

    private func processChorus(_ buf: UnsafeMutablePointer<Float>, _ n: Int, _ p: SIMD4<Float>) {
        let rate = expMap(p.x, 0.05, 6)
        let depthMs = 0.3 + p.y * 7
        let mix = p.z
        let fb = p.w * 0.7
        let mask = FXUnit.chorusCapacity - 1
        let msToSamples = sampleRate / 1000
        let inc = rate / sampleRate
        for i in 0..<n {
            chorusPhase = wrapPhase(chorusPhase + inc)
            let mod = (sinf(kTwoPi * chorusPhase) + 1) * 0.5
            let d = (8 + depthMs * mod) * msToSamples
            var rp = Float(chorusWrite) - d
            if rp < 0 { rp += Float(FXUnit.chorusCapacity) }
            let i0 = Int(rp) & mask
            let fr = rp - floorf(rp)
            let i1 = (i0 + 1) & mask
            let y = chorusBuffer[i0] + (chorusBuffer[i1] - chorusBuffer[i0]) * fr
            let x = buf[i]
            chorusBuffer[chorusWrite] = x + y * fb
            chorusWrite = (chorusWrite + 1) & mask
            buf[i] = x * (1 - mix * 0.4) + y * mix * 0.8
        }
    }
}
