import Foundation

/// 4-Spur-Bandmaschine mit Varispeed, Rückwärtslauf, Loop, Overdub, Lift/Drop und Undo.
final class Tape {
    static let trackCount = 4
    static let seconds = 120
    static let overviewShift = 10

    let sampleRate: Float
    let length: Int
    let tracks: [UnsafeMutablePointer<Float>]
    let overviewCount: Int
    let overviews: [UnsafeMutablePointer<Float>]

    private let undoBuffer: UnsafeMutablePointer<Float>
    private(set) var undoTrack = -1

    var playhead: Double = 0
    private(set) var speed: Float = 0
    var targetSpeed: Float = 1
    var running = false
    var recording = false
    var armed = 0
    var loopOn = false
    var loopStart = 0
    var loopEnd = 0
    var recordedEnd = 0

    /// Zwischenablage für Lift/Drop (nur Main-Thread).
    private(set) var clipboard: [Float] = []

    private var lastWrite = -1
    private let speedCoef: Float

    init(sampleRate: Float) {
        self.sampleRate = sampleRate
        let len = Int(sampleRate) * Tape.seconds
        length = len
        tracks = (0..<Tape.trackCount).map { _ -> UnsafeMutablePointer<Float> in
            let p = UnsafeMutablePointer<Float>.allocate(capacity: len)
            p.initialize(repeating: 0, count: len)
            return p
        }
        let ovCount = (len >> Tape.overviewShift) + 1
        overviewCount = ovCount
        overviews = (0..<Tape.trackCount).map { _ -> UnsafeMutablePointer<Float> in
            let p = UnsafeMutablePointer<Float>.allocate(capacity: ovCount)
            p.initialize(repeating: 0, count: ovCount)
            return p
        }
        undoBuffer = UnsafeMutablePointer<Float>.allocate(capacity: len)
        undoBuffer.initialize(repeating: 0, count: len)
        // Hoch- und Herunterlaufen des Bandes in ca. 0,3 s
        speedCoef = 1 - expf(-1 / (0.09 * sampleRate))
    }

    deinit {
        for t in tracks { t.deallocate() }
        for o in overviews { o.deallocate() }
        undoBuffer.deallocate()
    }

    var currentSpeed: Float { speed }
    var time: Double { playhead / Double(sampleRate) }
    var hasLoop: Bool { loopEnd > loopStart + 256 }

    /// Ein Sample-Schritt: liest alle vier Spuren und nimmt `input` auf der scharfen Spur auf.
    @inline(__always) func tick(_ input: Float) -> SIMD4<Float> {
        let goal: Float = running ? targetSpeed : 0
        speed += (goal - speed) * speedCoef
        if !running && abs(speed) < 0.0005 {
            speed = 0
            return .zero
        }
        var out = SIMD4<Float>.zero
        let i = Int(playhead)
        if i >= 0 && i < length - 1 {
            let f = Float(playhead - Double(i))
            for t in 0..<Tape.trackCount {
                let d = tracks[t]
                out[t] = d[i] + (d[i + 1] - d[i]) * f
            }
            if recording && running && i != lastWrite {
                lastWrite = i
                let d = tracks[armed]
                let v = clamp(d[i] + input, -4, 4)
                d[i] = v
                let o = i >> Tape.overviewShift
                let a = abs(v)
                if a > overviews[armed][o] { overviews[armed][o] = a }
                if i > recordedEnd { recordedEnd = i }
            }
        }
        playhead += Double(speed)
        if loopOn && hasLoop {
            let len = Double(loopEnd - loopStart)
            if speed > 0 && playhead >= Double(loopEnd) { playhead -= len }
            if speed < 0 && playhead < Double(loopStart) { playhead += len }
        }
        if playhead < 0 {
            playhead = 0
        }
        if playhead >= Double(length - 2) {
            playhead = Double(length - 2)
            running = false
            recording = false
        }
        return out
    }

    @inline(__always) func frame(_ i: Int) -> SIMD4<Float> {
        guard i >= 0 && i < length else { return .zero }
        return SIMD4(tracks[0][i], tracks[1][i], tracks[2][i], tracks[3][i])
    }

    // MARK: Bearbeitung (Main-Thread)

    func snapshot(_ t: Int) {
        undoBuffer.update(from: tracks[t], count: length)
        undoTrack = t
    }

    @discardableResult func undo() -> Bool {
        guard undoTrack >= 0 else { return false }
        let t = undoTrack
        tracks[t].update(from: undoBuffer, count: length)
        rebuildOverview(t)
        undoTrack = -1
        return true
    }

    @discardableResult func lift() -> Bool {
        guard hasLoop else { return false }
        snapshot(armed)
        let n = loopEnd - loopStart
        let src = tracks[armed] + loopStart
        clipboard = Array(UnsafeBufferPointer(start: src, count: n))
        src.update(repeating: 0, count: n)
        rebuildOverview(armed, from: loopStart, to: loopEnd)
        return true
    }

    @discardableResult func drop() -> Bool {
        guard !clipboard.isEmpty else { return false }
        let start = Int(playhead)
        let n = min(clipboard.count, length - 2 - start)
        guard n > 0 else { return false }
        snapshot(armed)
        let dst = tracks[armed] + start
        for i in 0..<n { dst[i] += clipboard[i] }
        recordedEnd = max(recordedEnd, start + n)
        rebuildOverview(armed, from: start, to: start + n)
        return true
    }

    func clear(_ t: Int) {
        snapshot(t)
        tracks[t].update(repeating: 0, count: length)
        overviews[t].update(repeating: 0, count: overviewCount)
    }

    func rebuildOverview(_ t: Int, from: Int = 0, to: Int? = nil) {
        let end = min(length, to ?? length)
        let d = tracks[t]
        let block = 1 << Tape.overviewShift
        var b = max(0, from) >> Tape.overviewShift
        while b < overviewCount && b * block < end {
            let s = b * block
            let e = min(length, s + block)
            var m: Float = 0
            for i in s..<e { m = max(m, abs(d[i])) }
            overviews[t][b] = m
            b += 1
        }
    }

    func recomputeRecordedEnd() {
        var end = 0
        for t in 0..<Tape.trackCount {
            var b = overviewCount - 1
            while b > 0 && overviews[t][b] < 0.0001 { b -= 1 }
            end = max(end, min(length - 1, (b + 1) << Tape.overviewShift))
        }
        recordedEnd = end
    }

    // MARK: Speichern / Laden

    func data(track t: Int) -> Data {
        let n = max(0, min(length, recordedEnd + 1))
        return Data(bytes: tracks[t], count: n * MemoryLayout<Float>.size)
    }

    func load(track t: Int, data: Data) {
        let n = min(length, data.count / MemoryLayout<Float>.size)
        let dst = tracks[t]
        dst.update(repeating: 0, count: length)
        data.withUnsafeBytes { raw in
            if let base = raw.baseAddress, n > 0 {
                memcpy(dst, base, n * MemoryLayout<Float>.size)
            }
        }
        rebuildOverview(t)
    }
}
