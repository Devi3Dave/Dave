import SwiftUI

/// Das schwarze Display: Grafik je Modus, Kontext-Schaltflächen und Encoder-Legende.
struct ScreenView: View {
    @Environment(AppModel.self) private var model
    static let canvasHeight: CGFloat = 222

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 45.0)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            VStack(spacing: 0) {
                GeometryReader { geo in
                    Canvas { ctx, size in
                        ScreenRenderer(model: model, time: t).draw(&ctx, size)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture(coordinateSpace: .local) { p in
                        tap(p, geo.size)
                    }
                }
                .frame(height: ScreenView.canvasHeight)
                chips
                    .frame(height: 28)
                legend
                    .frame(height: 50)
            }
        }
        .background(Theme.screen)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: Kontext-Schaltflächen

    @ViewBuilder private var chips: some View {
        HStack(spacing: 6) {
            switch model.mode {
            case .tape:
                Chip(title: "LOOP", active: model.loopOn, color: Theme.enc[1]) { model.toggleLoop() }
                Chip(title: "LIFT") { model.lift() }
                Chip(title: "DROP") { model.drop() }
                Chip(title: "UNDO") { model.undo() }
                Chip(title: "SPUR LÖSCHEN", color: Theme.rec) { model.clearTrack() }
            case .synth:
                if model.page == 0 {
                    Chip(title: "ENGINE ›", color: Theme.enc[0]) { model.nextEngine() }
                    if model.patch.engine == .sampler {
                        Chip(title: model.isSampling ? "■ STOP" : "● MIC", active: model.isSampling, color: Theme.rec) {
                            model.toggleSampling()
                        }
                        Chip(title: "TAPE → SAMPLE") { model.sampleFromTape() }
                    }
                } else if model.page == 2 {
                    Chip(title: "FX-TYP ›", color: Theme.enc[0]) { model.pressEncoder(0) }
                } else if model.page == 3 {
                    Chip(title: "ZIEL ›", color: Theme.enc[3]) { model.pressEncoder(3) }
                }
            case .drum:
                if model.page == 2 {
                    Chip(title: "FX-TYP ›", color: Theme.enc[0]) { model.pressEncoder(0) }
                } else if model.page == 3 {
                    Chip(title: "ZIEL ›", color: Theme.enc[3]) { model.pressEncoder(3) }
                }
            case .mixer:
                if model.page == 2 {
                    Chip(title: "MASTER-FX ›", color: Theme.enc[0]) { model.pressEncoder(0) }
                }
            case .seq:
                Chip(title: "MODUS ›", color: Theme.enc[0]) {
                    model.seq.kind = SeqKind(rawValue: (model.seq.kind.rawValue + 1) % SeqKind.allCases.count) ?? .off
                    model.studio.send(.allOff)
                    model.pushSeq()
                }
                if model.seq.kind == .pattern {
                    Chip(title: "PAUSE") { model.setStep(model.studio.seq.cursor, -1) }
                    Chip(title: "ZUFALL") { model.randomPattern() }
                    Chip(title: "LEEREN", color: Theme.rec) { model.clearPattern() }
                }
                if model.seq.kind == .arp || model.seq.kind == .euclid {
                    Chip(title: "HOLD", active: model.latch, color: Theme.enc[2]) { model.toggleLatch() }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
    }

    private var legend: some View {
        HStack(spacing: 0) {
            ForEach(0..<4, id: \.self) { i in
                let info = model.info(i)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        Circle().fill(Theme.enc[i]).frame(width: 7, height: 7)
                        Text(info.label)
                            .font(Theme.label(10))
                            .foregroundStyle(Theme.enc[i])
                            .lineLimit(1)
                    }
                    Text(info.text)
                        .font(Theme.mono(15))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 12)
            }
        }
        .padding(.bottom, 4)
        .background(Color.white.opacity(0.04))
    }

    // MARK: Touch auf dem Display

    private func tap(_ p: CGPoint, _ size: CGSize) {
        switch model.mode {
        case .tape:
            let idx = Int((p.y - ScreenRenderer.laneTop) / ScreenRenderer.laneStride)
            if p.y >= ScreenRenderer.laneTop && idx >= 0 && idx < 4 { model.selectPage(idx) }
        case .seq:
            guard model.seq.kind == .pattern else { return }
            let cw = (size.width - 32) / 16
            let idx = Int((p.x - 16) / cw)
            if idx >= 0 && idx < 16 && p.y > 40 { model.tapStep(idx) }
        case .synth:
            if model.page == 0 && p.y < 80 { model.nextEngine() }
        case .drum:
            guard model.page == 0 else { return }
            let r = ScreenRenderer.padRect(size)
            guard r.contains(p) else { return }
            let col = Int((p.x - r.minX) / (r.width / 6))
            let row = Int((p.y - r.minY) / (r.height / 2))
            let kind = min(11, max(0, row * 6 + col))
            let note = model.baseNote + 12 + kind
            model.studio.noteOn(note, velocity: 0.9)
            model.studio.noteOff(note)
        case .mixer:
            guard model.page <= 1 else { return }
            let idx = Int((p.x - size.width * 0.05) / (size.width * 0.18))
            if idx >= 0 && idx < 4 { model.pressEncoder(idx) }
        }
    }
}

// MARK: - Zeichnen

struct ScreenRenderer {
    let model: AppModel
    let time: Double
    var studio: Studio { model.studio }

    static let laneTop: CGFloat = 132
    static let laneHeight: CGFloat = 19
    static let laneStride: CGFloat = 22

    static func padRect(_ size: CGSize) -> CGRect {
        CGRect(x: 18, y: 44, width: size.width - 36, height: size.height - 56)
    }

    func draw(_ ctx: inout GraphicsContext, _ size: CGSize) {
        switch model.mode {
        case .synth, .drum: drawInstrument(&ctx, size)
        case .tape: drawTape(&ctx, size)
        case .mixer: drawMixer(&ctx, size)
        case .seq: drawSeq(&ctx, size)
        }
        drawHeader(&ctx, size)
        if let toast = model.toast { drawToast(&ctx, size, toast) }
    }

    // MARK: Helfer

    private func text(_ ctx: inout GraphicsContext, _ s: String, _ p: CGPoint, _ size: CGFloat,
                      _ color: Color = .white, anchor: UnitPoint = .center, mono: Bool = false) {
        let t = Text(s).font(mono ? Theme.mono(size) : Theme.label(size)).foregroundColor(color)
        ctx.draw(t, at: p, anchor: anchor)
    }

    private func line(_ ctx: inout GraphicsContext, _ a: CGPoint, _ b: CGPoint, _ color: Color, _ width: CGFloat = 1) {
        var p = Path()
        p.move(to: a)
        p.addLine(to: b)
        ctx.stroke(p, with: .color(color), lineWidth: width)
    }

    private func gauge(_ ctx: inout GraphicsContext, center: CGPoint, radius: CGFloat, value: Float, color: Color) {
        let start = Angle.degrees(135)
        var track = Path()
        track.addArc(center: center, radius: radius, startAngle: start, endAngle: .degrees(405), clockwise: false)
        ctx.stroke(track, with: .color(Color.white.opacity(0.12)), style: StrokeStyle(lineWidth: 7, lineCap: .round))
        var arc = Path()
        arc.addArc(center: center, radius: radius, startAngle: start,
                   endAngle: .degrees(135 + 270 * Double(clamp01(value))), clockwise: false)
        ctx.stroke(arc, with: .color(color), style: StrokeStyle(lineWidth: 7, lineCap: .round))
    }

    /// Vier Rundinstrumente für die aktuelle Encoder-Belegung.
    private func gauges(_ ctx: inout GraphicsContext, _ size: CGSize, title: String, subtitle: String) {
        text(&ctx, title, CGPoint(x: size.width / 2, y: 62), 30)
        text(&ctx, subtitle, CGPoint(x: size.width / 2, y: 90), 11, Theme.screenDim)
        for i in 0..<4 {
            let info = model.info(i)
            let c = CGPoint(x: size.width * (0.17 + 0.22 * CGFloat(i)), y: 160)
            gauge(&ctx, center: c, radius: 30, value: info.value, color: Theme.enc[i])
            text(&ctx, info.text, c, 10, .white, mono: true)
        }
    }

    private func drawHeader(_ ctx: inout GraphicsContext, _ size: CGSize) {
        let title: String
        switch model.mode {
        case .synth: title = "SYNTH \(model.slot + 1) · \(model.patch.name)"
        case .drum: title = "DRUM · \(model.drumPatch.name)"
        case .tape: title = "TAPE · SPUR \(model.armedTrack + 1)"
        case .mixer: title = ["MIXER · LEVEL", "MIXER · PAN", "MIXER · MASTER-FX", "MIXER · MASTER"][model.page]
        case .seq: title = "SEQ · \(model.seq.kind.title)"
        }
        text(&ctx, title, CGPoint(x: 14, y: 16), 12, Theme.screenDim, anchor: .leading)

        var x = size.width - 14
        text(&ctx, "\(Int(model.seq.bpm))", CGPoint(x: x, y: 16), 12, Theme.screenDim, anchor: .trailing, mono: true)
        x -= 34
        if studio.tape.recording {
            let blink = Int(time * 2.5) % 2 == 0
            ctx.fill(Path(ellipseIn: CGRect(x: x - 10, y: 11, width: 10, height: 10)),
                     with: .color(Theme.rec.opacity(blink ? 1 : 0.35)))
            x -= 18
        }
        if studio.transportRunning {
            var tri = Path()
            tri.move(to: CGPoint(x: x - 9, y: 10))
            tri.addLine(to: CGPoint(x: x, y: 16))
            tri.addLine(to: CGPoint(x: x - 9, y: 22))
            tri.closeSubpath()
            ctx.fill(tri, with: .color(Theme.play))
        } else {
            ctx.fill(Path(CGRect(x: x - 9, y: 11, width: 9, height: 10)), with: .color(Theme.screenDim))
        }
        x -= 22
        if model.metronomeOn {
            text(&ctx, "♩", CGPoint(x: x, y: 16), 13, studio.beatIndex % 4 == 1 ? Theme.enc[1] : Theme.screenDim,
                 anchor: .trailing)
            x -= 18
        }
        if model.latch {
            text(&ctx, "HOLD", CGPoint(x: x, y: 16), 10, Theme.enc[2], anchor: .trailing)
        }
    }

    private func drawToast(_ ctx: inout GraphicsContext, _ size: CGSize, _ s: String) {
        let w = CGFloat(s.count) * 9 + 36
        let rect = CGRect(x: size.width / 2 - w / 2, y: size.height - 42, width: w, height: 30)
        ctx.fill(Path(roundedRect: rect, cornerRadius: 15), with: .color(Color.white))
        text(&ctx, s, CGPoint(x: rect.midX, y: rect.midY), 13, .black)
    }

    // MARK: Synth / Drum

    private func drawInstrument(_ ctx: inout GraphicsContext, _ size: CGSize) {
        let patch = model.patch
        switch model.page {
        case 0:
            if model.drumActive { drawPads(&ctx, size) } else { drawEngine(&ctx, size, patch) }
        case 1:
            drawEnvelope(&ctx, size, patch.env)
        case 2:
            gauges(&ctx, size, title: patch.fx.title,
                   subtitle: patch.fx == .off ? "KEIN EFFEKT – ORANGEN REGLER ANTIPPEN" : "EFFEKT")
        default:
            drawLFO(&ctx, size, patch)
        }
    }

    private func drawEngine(_ ctx: inout GraphicsContext, _ size: CGSize, _ patch: Patch) {
        text(&ctx, patch.engine.title, CGPoint(x: 16, y: 50), 30, .white, anchor: .leading)
        text(&ctx, "\(studio.instrument.activeVoices)/\(Instrument.voiceCount) STIMMEN",
             CGPoint(x: size.width - 16, y: 50), 10, Theme.screenDim, anchor: .trailing)

        let p = patch.params
        let pulse = CGFloat(min(1, studio.livePeak * 2.5))
        let cy = size.height * 0.62
        let lfo = Double(studio.instrument.lfoValue)
        for i in 0..<4 {
            let cx = size.width * (0.2 + 0.2 * CGFloat(i))
            let r = 14 + CGFloat(p[i]) * 24 + pulse * 6
            let color = Theme.enc[i].opacity(0.9)
            let rect = CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)
            switch i {
            case 0:
                ctx.fill(Path(ellipseIn: rect), with: .color(color))
            case 1:
                var c = ctx
                c.translateBy(x: cx, y: cy)
                c.rotate(by: .radians(time * 0.5 + lfo * 0.4))
                let sq = CGRect(x: -r * 0.85, y: -r * 0.85, width: r * 1.7, height: r * 1.7)
                c.stroke(Path(roundedRect: sq, cornerRadius: 6), with: .color(color), lineWidth: 5)
            case 2:
                var tri = Path()
                tri.move(to: CGPoint(x: cx, y: cy - r))
                tri.addLine(to: CGPoint(x: cx + r * 0.95, y: cy + r * 0.7))
                tri.addLine(to: CGPoint(x: cx - r * 0.95, y: cy + r * 0.7))
                tri.closeSubpath()
                ctx.fill(tri, with: .color(color))
            default:
                ctx.stroke(Path(ellipseIn: rect.insetBy(dx: 4, dy: 4)), with: .color(color),
                           lineWidth: 3 + CGFloat(p[i]) * 8)
            }
        }
        drawScope(&ctx, CGRect(x: 0, y: cy - 60, width: size.width, height: 120))
    }

    private func drawScope(_ ctx: inout GraphicsContext, _ rect: CGRect) {
        let n = Studio.scopeSize
        let mask = n - 1
        let scope = studio.scope
        let w = studio.scopeWrite
        let start = (w - 700 + n * 2) & mask
        var s = start
        for k in 0..<300 {
            let a = scope[(start + k) & mask]
            let b = scope[(start + k + 1) & mask]
            if a <= 0 && b > 0 {
                s = (start + k) & mask
                break
            }
        }
        let count = 380
        let amp = rect.height * 0.45 / CGFloat(max(0.12, studio.livePeak))
        var path = Path()
        for k in 0..<count {
            let v = CGFloat(scope[(s + k) & mask])
            let pt = CGPoint(x: rect.minX + rect.width * CGFloat(k) / CGFloat(count - 1),
                             y: rect.midY - max(-rect.height / 2, min(rect.height / 2, v * amp)))
            if k == 0 { path.move(to: pt) } else { path.addLine(to: pt) }
        }
        ctx.stroke(path, with: .color(Color.white.opacity(0.9)), lineWidth: 1.6)
    }

    private func drawPads(_ ctx: inout GraphicsContext, _ size: CGSize) {
        let r = ScreenRenderer.padRect(size)
        let cw = r.width / 6
        let ch = r.height / 2
        let clock = studio.clock
        let sr = Double(studio.sampleRate)
        for k in 0..<12 {
            let col = k % 6
            let row = k / 6
            let cell = CGRect(x: r.minX + CGFloat(col) * cw + 3, y: r.minY + CGFloat(row) * ch + 3,
                              width: cw - 6, height: ch - 6)
            let age = Double(clock - studio.instrument.drumHitClock[k]) / sr
            let glow = max(0, 1 - age / 0.25)
            let color = Theme.enc[k % 4]
            ctx.fill(Path(roundedRect: cell, cornerRadius: 9), with: .color(color.opacity(0.12 + 0.75 * glow)))
            ctx.stroke(Path(roundedRect: cell, cornerRadius: 9), with: .color(color.opacity(0.6)), lineWidth: 1.5)
            text(&ctx, drumNames[k], CGPoint(x: cell.midX, y: cell.midY - 6), 13, glow > 0.5 ? .black : .white)
            text(&ctx, AppModel.noteName(model.baseNote + 12 + k), CGPoint(x: cell.midX, y: cell.midY + 12), 9,
                 glow > 0.5 ? .black.opacity(0.6) : Theme.screenDim)
        }
    }

    private func drawEnvelope(_ ctx: inout GraphicsContext, _ size: CGSize, _ env: SIMD4<Float>) {
        let left: CGFloat = 24
        let top: CGFloat = 52
        let bottom = size.height - 24
        let seg = (size.width - 2 * left) / 4.2
        let a = CGPoint(x: left, y: bottom)
        let b = CGPoint(x: a.x + (0.08 + CGFloat(env.x)) * seg, y: top)
        let sustainY = bottom - CGFloat(env.z) * (bottom - top)
        let c = CGPoint(x: b.x + (0.08 + CGFloat(env.y)) * seg, y: sustainY)
        let d = CGPoint(x: c.x + seg * 1.0, y: sustainY)
        let e = CGPoint(x: d.x + (0.08 + CGFloat(env.w)) * seg, y: bottom)
        line(&ctx, CGPoint(x: left, y: bottom), CGPoint(x: size.width - left, y: bottom), Color.white.opacity(0.15))
        let pts = [a, b, c, d, e]
        for i in 0..<4 {
            var path = Path()
            path.move(to: pts[i])
            if i == 1 || i == 3 {
                path.addQuadCurve(to: pts[i + 1], control: CGPoint(x: pts[i].x + 4, y: pts[i + 1].y))
            } else {
                path.addLine(to: pts[i + 1])
            }
            ctx.stroke(path, with: .color(Theme.enc[i]), style: StrokeStyle(lineWidth: 4, lineCap: .round))
        }
        for i in 1..<5 {
            let pt = pts[i]
            ctx.fill(Path(ellipseIn: CGRect(x: pt.x - 5, y: pt.y - 5, width: 10, height: 10)),
                     with: .color(Theme.enc[i - 1]))
        }
        text(&ctx, "HÜLLKURVE", CGPoint(x: size.width - 16, y: 44), 11, Theme.screenDim, anchor: .trailing)
    }

    private func drawLFO(_ ctx: inout GraphicsContext, _ size: CGSize, _ patch: Patch) {
        let lfo = patch.lfo
        let shape = quantize(lfo.z, 5)
        let depth = CGFloat(max(0.08, lfo.y))
        let mid = size.height * 0.58
        let amp = size.height * 0.28 * depth
        let left: CGFloat = 20
        let width = size.width - 40
        var path = Path()
        let steps = 200
        var hold: CGFloat = 0.6
        for k in 0...steps {
            let t = Float(k) / Float(steps) * 2
            let ph = frac(t)
            var v: Float
            switch shape {
            case 0: v = sinf(kTwoPi * ph)
            case 1: v = triangle(ph)
            case 2: v = 2 * ph - 1
            case 3: v = ph < 0.5 ? 1 : -1
            default:
                if k % (steps / 8) == 0 { hold = CGFloat(sin(Double(k) * 12.9898) * 0.9) }
                v = Float(hold)
            }
            let pt = CGPoint(x: left + width * CGFloat(k) / CGFloat(steps), y: mid - CGFloat(v) * amp)
            if k == 0 { path.move(to: pt) } else { path.addLine(to: pt) }
        }
        ctx.stroke(path, with: .color(Theme.enc[2]), lineWidth: 3)
        let phase = CGFloat(studio.instrument.lfoPhase)
        let dot = CGPoint(x: left + width * phase / 2, y: mid - CGFloat(studio.instrument.lfoValue) * amp)
        ctx.fill(Path(ellipseIn: CGRect(x: dot.x - 7, y: dot.y - 7, width: 14, height: 14)), with: .color(.white))
        let target = model.text(.lfo(3))
        text(&ctx, "LFO → \(target)", CGPoint(x: 16, y: 50), 22, .white, anchor: .leading)
    }

    // MARK: Tape

    private func drawTape(_ ctx: inout GraphicsContext, _ size: CGSize) {
        let tape = studio.tape
        let sr = Double(studio.sampleRate)
        let progress = CGFloat(tape.playhead / Double(tape.length))
        let angle = tape.playhead / sr * 2.2
        let reelY: CGFloat = 78
        let leftReel = CGPoint(x: size.width * 0.22, y: reelY)
        let rightReel = CGPoint(x: size.width * 0.78, y: reelY)
        let rl = 22 + 22 * (1 - progress)
        let rr = 22 + 22 * progress
        drawReel(&ctx, leftReel, rl, angle)
        drawReel(&ctx, rightReel, rr, angle)
        var band = Path()
        band.move(to: CGPoint(x: leftReel.x, y: leftReel.y + rl))
        band.addLine(to: CGPoint(x: size.width / 2 - 20, y: 118))
        band.addLine(to: CGPoint(x: size.width / 2 + 20, y: 118))
        band.addLine(to: CGPoint(x: rightReel.x, y: rightReel.y + rr))
        ctx.stroke(band, with: .color(Color.white.opacity(0.35)), lineWidth: 1.5)

        let timeColor: Color = tape.recording ? Theme.rec : .white
        text(&ctx, AppModel.clock(tape.time), CGPoint(x: size.width / 2, y: 66), 26, timeColor, mono: true)
        let status = tape.recording ? "● REC" : (tape.running ? "▶ PLAY" : "■ STOP")
        let speed = tape.currentSpeed
        let speedText = abs(speed) < 0.01 ? "" : String(format: "  ×%.2f", speed)
        text(&ctx, status + speedText, CGPoint(x: size.width / 2, y: 94), 11,
             tape.recording ? Theme.rec : Theme.screenDim)

        // Spuren
        let window = 12.0 * sr
        let startPos = tape.playhead - window / 2
        let left: CGFloat = 26
        let width = size.width - left - 10
        for t in 0..<4 {
            let y = ScreenRenderer.laneTop + CGFloat(t) * ScreenRenderer.laneStride
            let h = ScreenRenderer.laneHeight
            let armed = model.armedTrack == t
            let muted = model.mixer.mutes[t]
            ctx.fill(Path(roundedRect: CGRect(x: left, y: y, width: width, height: h), cornerRadius: 4),
                     with: .color(armed ? Theme.enc[t].opacity(0.16) : Color.white.opacity(0.05)))
            text(&ctx, "\(t + 1)", CGPoint(x: 13, y: y + h / 2), 11, armed ? Theme.enc[t] : Theme.screenDim)
            var wave = Path()
            let ov = tape.overviews[t]
            var x: CGFloat = 0
            while x < width {
                let pos = startPos + Double(x / width) * window
                if pos >= 0 && pos < Double(tape.length) {
                    let bin = Int(pos) >> Tape.overviewShift
                    let v = CGFloat(min(1, ov[min(bin, tape.overviewCount - 1)]))
                    if v > 0.004 {
                        let hh = max(0.6, v * h * 0.5)
                        wave.move(to: CGPoint(x: left + x, y: y + h / 2 - hh))
                        wave.addLine(to: CGPoint(x: left + x, y: y + h / 2 + hh))
                    }
                }
                x += 2
            }
            let color = muted ? Theme.screenDim : (armed ? Theme.enc[t] : Color.white.opacity(0.7))
            ctx.stroke(wave, with: .color(color), lineWidth: 1.4)
        }

        let lanesBottom = ScreenRenderer.laneTop + 4 * ScreenRenderer.laneStride
        if tape.hasLoop {
            let x1 = left + CGFloat((Double(tape.loopStart) - startPos) / window) * width
            let x2 = left + CGFloat((Double(tape.loopEnd) - startPos) / window) * width
            let a = max(left, x1)
            let b = min(left + width, x2)
            if b > a {
                ctx.fill(Path(CGRect(x: a, y: ScreenRenderer.laneTop - 4, width: b - a,
                                     height: lanesBottom - ScreenRenderer.laneTop + 2)),
                         with: .color(Theme.enc[1].opacity(tape.loopOn ? 0.16 : 0.06)))
            }
            for lx in [x1, x2] where lx >= left && lx <= left + width {
                line(&ctx, CGPoint(x: lx, y: ScreenRenderer.laneTop - 6), CGPoint(x: lx, y: lanesBottom),
                     Theme.enc[1].opacity(tape.loopOn ? 1 : 0.4), 2)
            }
        }
        let px = left + width / 2
        line(&ctx, CGPoint(x: px, y: ScreenRenderer.laneTop - 8), CGPoint(x: px, y: lanesBottom + 2),
             tape.recording ? Theme.rec : .white, 2)
    }

    private func drawReel(_ ctx: inout GraphicsContext, _ c: CGPoint, _ r: CGFloat, _ angle: Double) {
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                 with: .color(Color.white.opacity(0.1)))
        ctx.stroke(Path(ellipseIn: CGRect(x: c.x - 15, y: c.y - 15, width: 30, height: 30)),
                   with: .color(.white), lineWidth: 2.5)
        for k in 0..<3 {
            let a = angle + Double(k) * 2 * Double.pi / 3
            line(&ctx, c, CGPoint(x: c.x + CGFloat(cos(a)) * 15, y: c.y + CGFloat(sin(a)) * 15), .white, 2.5)
        }
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - 3, y: c.y - 3, width: 6, height: 6)), with: .color(Theme.screen))
    }

    // MARK: Mixer

    private func drawMixer(_ ctx: inout GraphicsContext, _ size: CGSize) {
        if model.page == 2 {
            gauges(&ctx, size, title: model.mixer.masterFX.title, subtitle: "MASTER-EFFEKT AUF DER SUMME")
            return
        }
        if model.page == 3 {
            gauges(&ctx, size, title: "MASTER", subtitle: "LAUTSTÄRKE · MONITOR · TEMPO · CLICK")
            return
        }
        let top: CGFloat = 46
        let bottom = size.height - 34
        let peaks = studio.trackPeaks
        for i in 0..<4 {
            let x = size.width * (0.05 + 0.18 * CGFloat(i)) + size.width * 0.09
            let muted = model.mixer.mutes[i]
            let color = muted ? Theme.screenDim : Theme.enc[i]
            let barW: CGFloat = 30
            let full = bottom - top
            ctx.fill(Path(roundedRect: CGRect(x: x - barW / 2, y: top, width: barW, height: full), cornerRadius: 5),
                     with: .color(Color.white.opacity(0.06)))
            let lv = CGFloat(model.mixer.levels[i])
            ctx.fill(Path(roundedRect: CGRect(x: x - barW / 2, y: bottom - full * lv, width: barW, height: full * lv),
                          cornerRadius: 5), with: .color(color.opacity(model.page == 0 ? 0.85 : 0.35)))
            let pk = CGFloat(min(1, peaks[i]))
            ctx.fill(Path(CGRect(x: x + barW / 2 + 4, y: bottom - full * pk, width: 4, height: full * pk)),
                     with: .color(.white))
            let pan = CGFloat(model.mixer.pans[i])
            line(&ctx, CGPoint(x: x - 24, y: bottom + 14), CGPoint(x: x + 24, y: bottom + 14), Color.white.opacity(0.2), 2)
            let panX = x - 24 + 48 * pan
            ctx.fill(Path(ellipseIn: CGRect(x: panX - 5, y: bottom + 9, width: 10, height: 10)),
                     with: .color(model.page == 1 ? color : Color.white.opacity(0.6)))
            text(&ctx, muted ? "M" : "\(i + 1)", CGPoint(x: x, y: top + 14), 13, muted ? Theme.rec : .black)
        }
        let ox = size.width * 0.9
        let full = bottom - top
        let out = CGFloat(min(1, studio.outPeak))
        let live = CGFloat(min(1, studio.livePeak * 2))
        ctx.fill(Path(CGRect(x: ox - 10, y: bottom - full * out, width: 8, height: full * out)), with: .color(.white))
        ctx.fill(Path(CGRect(x: ox + 2, y: bottom - full * live, width: 8, height: full * live)),
                 with: .color(Theme.enc[2]))
        text(&ctx, "OUT", CGPoint(x: ox, y: bottom + 14), 9, Theme.screenDim)
    }

    // MARK: Sequencer

    private func drawSeq(_ ctx: inout GraphicsContext, _ size: CGSize) {
        let seqState = model.seq
        let live = studio.seq
        switch seqState.kind {
        case .off:
            text(&ctx, "SEQUENCER AUS", CGPoint(x: size.width / 2, y: 100), 26)
            text(&ctx, "MODUS ›  ODER KORALLEN REGLER DREHEN: PATTERN · ARP · EUCLID",
                 CGPoint(x: size.width / 2, y: 136), 10, Theme.screenDim)

        case .pattern:
            let left: CGFloat = 16
            let cw = (size.width - 32) / 16
            let top: CGFloat = 46
            let bottom = size.height - 16
            for i in 0..<16 {
                let x = left + CGFloat(i) * cw
                let cell = CGRect(x: x + 2, y: top, width: cw - 4, height: bottom - top)
                let inRange = i < seqState.length
                let playing = live.playingStep == i && studio.transportRunning
                ctx.fill(Path(roundedRect: cell, cornerRadius: 5),
                         with: .color(Color.white.opacity(playing ? 0.28 : (inRange ? 0.07 : 0.02))))
                let note = i < seqState.steps.count ? seqState.steps[i] : -1
                if note >= 0 && inRange {
                    let rel = CGFloat(min(max(note - 24, 0), 72)) / 72
                    let h = 14 + rel * (cell.height - 40)
                    let bar = CGRect(x: cell.minX + 4, y: cell.maxY - h - 4, width: cell.width - 8, height: h)
                    ctx.fill(Path(roundedRect: bar, cornerRadius: 3), with: .color(Theme.enc[(i / 4) % 4]))
                    text(&ctx, AppModel.noteName(note + live.transpose), CGPoint(x: cell.midX, y: cell.minY + 11), 8,
                         .white)
                }
                if live.cursor == i && !studio.transportRunning {
                    ctx.stroke(Path(roundedRect: cell, cornerRadius: 5), with: .color(.white), lineWidth: 2)
                }
            }
            if model.page == 1 && !studio.transportRunning {
                text(&ctx, "TASTEN SCHREIBEN IN STEP \(live.cursor + 1)", CGPoint(x: size.width / 2, y: 36), 9,
                     Theme.enc[0])
            } else if studio.transportRunning {
                text(&ctx, "TASTE = TRANSPONIEREN", CGPoint(x: size.width / 2, y: 36), 9, Theme.screenDim)
            }

        case .arp:
            text(&ctx, "ARP · \(Sequencer.arpModes[seqState.arpMode]) · \(Sequencer.rateNames[seqState.arpRate])",
                 CGPoint(x: 16, y: 50), 20, .white, anchor: .leading)
            let count = live.heldCount
            if count == 0 {
                text(&ctx, "AKKORD AUF DER TASTATUR HALTEN", CGPoint(x: size.width / 2, y: 140), 12, Theme.screenDim)
            }
            let octaves = max(1, seqState.arpOctaves)
            let total = max(1, count * octaves)
            let w = (size.width - 40) / CGFloat(max(total, 1))
            for k in 0..<(count * octaves) {
                let note = live.held[k % max(1, count)] + 12 * (k / max(1, count))
                let rel = CGFloat(min(max(note - 24, 0), 84)) / 84
                let x = 20 + CGFloat(k) * w + w / 2
                let y = size.height - 30 - rel * 120
                let isOn = live.playingStep == k
                let r: CGFloat = isOn ? 11 : 7
                ctx.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)),
                         with: .color(isOn ? .white : Theme.enc[k % 4]))
            }

        case .euclid:
            let c = CGPoint(x: size.width * 0.36, y: size.height * 0.58)
            let radius: CGFloat = 72
            let n = max(1, seqState.euclidSteps)
            for i in 0..<n {
                let a = Double(i) / Double(n) * 2 * Double.pi - Double.pi / 2
                let p = CGPoint(x: c.x + CGFloat(cos(a)) * radius, y: c.y + CGFloat(sin(a)) * radius)
                let hit = Sequencer.euclidHit(i, n, seqState.euclidPulses, seqState.euclidRotate)
                let on = live.playingStep == i && live.heldCount > 0
                let r: CGFloat = on ? 9 : (hit ? 7 : 3)
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)),
                         with: .color(on ? .white : (hit ? Theme.enc[2] : Theme.screenDim)))
            }
            text(&ctx, "\(seqState.euclidPulses)/\(n)", c, 22, .white, mono: true)
            text(&ctx, "EUKLIDISCH", CGPoint(x: size.width * 0.72, y: 90), 18)
            text(&ctx, live.heldCount > 0 ? "\(live.heldCount) TASTE(N)" : "TASTEN HALTEN",
                 CGPoint(x: size.width * 0.72, y: 118), 11, Theme.screenDim)
        }
    }
}
