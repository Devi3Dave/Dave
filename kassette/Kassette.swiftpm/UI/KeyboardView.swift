import SwiftUI

/// Zwei Oktaven (25 Tasten), mehrstimmig per Multitouch.
/// Anschlagstärke: je weiter unten auf der Taste, desto lauter.
struct KeyboardView: View {
    @Environment(AppModel.self) private var model

    private static let whiteOffsets = [0, 2, 4, 5, 7, 9, 11]
    private static let blackOffsets: [(Int, Int)] = [(1, 0), (3, 1), (6, 3), (8, 4), (10, 5)]

    var body: some View {
        GeometryReader { geo in
            let whiteCount = 15
            let w = geo.size.width / CGFloat(whiteCount)
            let h = geo.size.height
            ZStack(alignment: .topLeading) {
                ForEach(0..<whiteCount, id: \.self) { k in
                    let index = (k / 7) * 12 + KeyboardView.whiteOffsets[k % 7]
                    KeyView(index: index, isBlack: false, height: h)
                        .frame(width: w - 5, height: h)
                        .offset(x: CGFloat(k) * w + 2.5)
                }
                ForEach(0..<10, id: \.self) { k in
                    let octave = k / 5
                    let pair = KeyboardView.blackOffsets[k % 5]
                    let index = octave * 12 + pair.0
                    let x = (CGFloat(octave * 7 + pair.1) + 1) * w - w * 0.31
                    KeyView(index: index, isBlack: true, height: h * 0.58)
                        .frame(width: w * 0.62, height: h * 0.58)
                        .offset(x: x)
                }
            }
        }
    }
}

private struct KeyView: View {
    let index: Int
    let isBlack: Bool
    let height: CGFloat
    @Environment(AppModel.self) private var model
    @State private var down = false

    var body: some View {
        let note = model.baseNote + index
        let lit = model.pressedNotes.contains(note) || down
        let accent = Theme.enc[(index / 3) % 4]
        RoundedRectangle(cornerRadius: isBlack ? 7 : 9, style: .continuous)
            .fill(isBlack ? (lit ? Theme.ink.opacity(0.75) : Theme.ink) : (lit ? Color(white: 0.84) : Theme.button))
            .shadow(color: .black.opacity(lit ? 0.05 : 0.25), radius: lit ? 0.5 : 2, y: lit ? 0.5 : 2.5)
            .overlay(alignment: .bottom) {
                VStack(spacing: 4) {
                    if model.drumActive {
                        Text(drumNames[((note % 12) + 12) % 12])
                            .font(Theme.label(isBlack ? 7 : 9))
                            .foregroundStyle(isBlack ? Color.white.opacity(0.7) : Theme.ink.opacity(0.55))
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                    } else if index % 12 == 0 {
                        Text(AppModel.noteName(note))
                            .font(Theme.label(9))
                            .foregroundStyle(Theme.ink.opacity(0.45))
                    }
                    Capsule()
                        .fill(lit ? accent : Color.clear)
                        .frame(width: 14, height: 3)
                }
                .padding(.bottom, 10)
                .padding(.horizontal, 3)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { v in
                        guard !down else { return }
                        down = true
                        let velocity = Float(min(1, max(0.25, v.startLocation.y / height * 0.85 + 0.25)))
                        model.keyDown(id: index, index: index, velocity: velocity)
                    }
                    .onEnded { _ in
                        down = false
                        model.keyUp(id: index)
                    }
            )
    }
}
