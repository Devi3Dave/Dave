import SwiftUI

enum Theme {
    static let backdrop = Color(red: 0.13, green: 0.13, blue: 0.14)
    static let body = Color(red: 0.88, green: 0.88, blue: 0.86)
    static let bodyEdge = Color(red: 0.78, green: 0.78, blue: 0.76)
    static let button = Color(red: 0.95, green: 0.95, blue: 0.93)
    static let buttonDark = Color(red: 0.27, green: 0.27, blue: 0.29)
    static let ink = Color(red: 0.16, green: 0.16, blue: 0.18)
    static let screen = Color(red: 0.03, green: 0.03, blue: 0.04)
    static let screenDim = Color(white: 0.32)
    static let rec = Color(red: 0.95, green: 0.25, blue: 0.22)
    static let play = Color(red: 0.20, green: 0.70, blue: 0.45)

    /// Die vier Encoder-Farben – jede Farbe steht überall für "ihren" Regler.
    static let enc: [Color] = [
        Color(red: 0.98, green: 0.42, blue: 0.33),   // Koralle
        Color(red: 0.97, green: 0.77, blue: 0.22),   // Senf
        Color(red: 0.32, green: 0.82, blue: 0.68),   // Mint
        Color(red: 0.62, green: 0.55, blue: 0.98)    // Flieder
    ]

    static func label(_ size: CGFloat) -> Font { .system(size: size, weight: .bold, design: .rounded) }
    static func mono(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold, design: .monospaced) }
}

/// Endlos-Drehgeber: vertikal oder horizontal ziehen = drehen, antippen = drücken.
struct EncoderView: View {
    let index: Int
    var size: CGFloat = 76
    @Environment(AppModel.self) private var model
    @State private var angle: Double = 0
    @State private var last: CGSize = .zero

    var body: some View {
        let color = Theme.enc[index]
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(Color.black.opacity(0.22))
                    .blur(radius: 3)
                    .offset(y: 4)
                Circle()
                    .fill(Theme.bodyEdge)
                    .padding(-6)
                ZStack {
                    Circle().fill(
                        RadialGradient(colors: [color.opacity(0.85), color], center: .init(x: 0.35, y: 0.3),
                                       startRadius: 2, endRadius: size * 0.7)
                    )
                    ForEach(0..<20, id: \.self) { k in
                        Capsule()
                            .fill(Color.black.opacity(0.1))
                            .frame(width: 2, height: 7)
                            .offset(y: -size / 2 + 6)
                            .rotationEffect(.degrees(Double(k) * 18))
                    }
                    Capsule()
                        .fill(Color.white.opacity(0.95))
                        .frame(width: 5, height: size * 0.22)
                        .offset(y: -size / 2 + size * 0.17)
                }
                .rotationEffect(.degrees(angle))
            }
            .frame(width: size, height: size)
            .contentShape(Circle().inset(by: -8))
            .gesture(drag)
            .simultaneousGesture(TapGesture().onEnded { model.pressEncoder(index) })

            Text(model.info(index).label)
                .font(Theme.label(11))
                .foregroundStyle(Theme.ink.opacity(0.75))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: size)
        }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 3)
            .onChanged { v in
                let dx = v.translation.width - last.width
                let dy = v.translation.height - last.height
                last = v.translation
                let amount = Double(dx - dy)
                angle += amount * 1.4
                model.turn(index, Float(amount / 240))
            }
            .onEnded { _ in last = .zero }
    }
}

/// Kleiner Lautstärkeregler (Master).
struct VolumeKnob: View {
    @Environment(AppModel.self) private var model
    @State private var last: CGFloat = 0

    var body: some View {
        let v = model.mixer.masterVolume
        VStack(spacing: 6) {
            ZStack {
                Circle().fill(Theme.bodyEdge).padding(-4)
                Circle().fill(Theme.buttonDark)
                Capsule()
                    .fill(Color.white)
                    .frame(width: 3, height: 12)
                    .offset(y: -14)
                    .rotationEffect(.degrees(Double(v) * 270 - 135))
            }
            .frame(width: 44, height: 44)
            .gesture(
                DragGesture(minimumDistance: 2)
                    .onChanged { g in
                        let d = g.translation.height - last
                        last = g.translation.height
                        model.mixer.masterVolume = clamp01(model.mixer.masterVolume - Float(d / 200))
                        model.pushMixer()
                    }
                    .onEnded { _ in last = 0 }
            )
            Text("VOL").font(Theme.label(9)).foregroundStyle(Theme.ink.opacity(0.6))
        }
    }
}

/// Lautsprechergitter aus Punkten, die mit dem Ausgangspegel pulsieren.
struct SpeakerGrill: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { _ in
            Canvas { ctx, size in
                let peak = CGFloat(min(1, model.studio.outPeak))
                let cols = 9
                let rows = 9
                let step = min(size.width / CGFloat(cols), size.height / CGFloat(rows))
                let cx = size.width / 2
                let cy = size.height / 2
                for r in 0..<rows {
                    for c in 0..<cols {
                        let x = (CGFloat(c) - CGFloat(cols - 1) / 2) * step
                        let y = (CGFloat(r) - CGFloat(rows - 1) / 2) * step
                        let d = sqrt(x * x + y * y)
                        guard d < step * 4.4 else { continue }
                        let rad = step * 0.2 + step * 0.12 * peak * (1 - d / (step * 4.4))
                        let rect = CGRect(x: cx + x - rad, y: cy + y - rad, width: rad * 2, height: rad * 2)
                        ctx.fill(Path(ellipseIn: rect), with: .color(Theme.ink.opacity(0.7)))
                    }
                }
            }
        }
    }
}

struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .brightness(configuration.isPressed ? -0.05 : 0)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

/// Hardware-Taste mit Symbol, Beschriftung und LED-Strich.
struct HWButton: View {
    var title: String
    var icon: String? = nil
    var active = false
    var tint: Color = Theme.ink
    var width: CGFloat = 54
    var height: CGFloat = 58
    var enabled = true
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 17, weight: .semibold))
                }
                if !title.isEmpty {
                    Text(title).font(Theme.label(icon == nil ? 12 : 9)).lineLimit(1).minimumScaleFactor(0.6)
                }
            }
            .foregroundStyle(active ? tint : Theme.ink.opacity(enabled ? 0.82 : 0.25))
            .frame(width: width, height: height)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(Theme.button)
                    .shadow(color: .black.opacity(active ? 0.08 : 0.22), radius: active ? 0.6 : 1.6, y: active ? 0.6 : 2)
            )
            .overlay(alignment: .top) {
                Capsule()
                    .fill(active ? tint : Color.black.opacity(0.08))
                    .frame(width: 18, height: 3)
                    .padding(.top, 5)
            }
        }
        .buttonStyle(PressStyle())
        .disabled(!enabled)
    }
}

/// Kleine Bildschirm-Schaltfläche.
struct Chip: View {
    var title: String
    var active = false
    var color: Color = .white
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.label(10))
                .foregroundStyle(active ? Color.black : color)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(Capsule().fill(active ? color : Color.white.opacity(0.1)))
        }
        .buttonStyle(PressStyle())
    }
}
