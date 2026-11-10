import CoreMIDI
import Foundation

/// Empfängt Noten von allen angeschlossenen MIDI-Keyboards (USB, Bluetooth, Netzwerk).
final class MIDIHost {
    private var client = MIDIClientRef()
    private var port = MIDIPortRef()
    private var connected: [MIDIEndpointRef] = []
    private let studio: Studio

    init(studio: Studio) {
        self.studio = studio
        let status = MIDIClientCreateWithBlock("Kassette" as CFString, &client) { [weak self] notification in
            if notification.pointee.messageID == .msgSetupChanged {
                DispatchQueue.main.async { self?.connectSources() }
            }
        }
        guard status == noErr else { return }
        MIDIInputPortCreateWithBlock(client, "Kassette In" as CFString, &port) { [weak self] list, _ in
            self?.handle(list)
        }
        connectSources()
    }

    func connectSources() {
        for src in connected { MIDIPortDisconnectSource(port, src) }
        connected.removeAll()
        let count = MIDIGetNumberOfSources()
        for i in 0..<count {
            let src = MIDIGetSource(i)
            if MIDIPortConnectSource(port, src, nil) == noErr { connected.append(src) }
        }
    }

    private func handle(_ list: UnsafePointer<MIDIPacketList>) {
        for packet in list.unsafeSequence() {
            let count = min(Int(packet.pointee.length), 256)
            withUnsafeBytes(of: packet.pointee.data) { raw in
                var i = 0
                while i < count {
                    let status = raw[i]
                    if status < 0x80 {
                        i += 1
                        continue
                    }
                    let type = status & 0xF0
                    switch type {
                    case 0x80, 0x90:
                        guard i + 2 < count else { return }
                        let note = Int(raw[i + 1])
                        let velocity = Int(raw[i + 2])
                        if type == 0x90 && velocity > 0 {
                            studio.noteOn(note, velocity: Float(velocity) / 127)
                        } else {
                            studio.noteOff(note)
                        }
                        i += 3
                    case 0xB0:
                        guard i + 2 < count else { return }
                        if raw[i + 1] == 120 || raw[i + 1] == 123 { studio.send(.allOff) }
                        i += 3
                    case 0xC0, 0xD0:
                        i += 2
                    case 0xF0:
                        i = count
                    default:
                        i += 3
                    }
                }
            }
        }
    }
}
