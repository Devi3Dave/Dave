import AVFoundation

/// Verbindet die DSP-Engine mit AVAudioEngine (Lautsprecher, Kopfhörer, Mikrofon).
final class AudioHost {
    let engine = AVAudioEngine()
    let studio: Studio
    private var source: AVAudioSourceNode?
    private var observers: [NSObjectProtocol] = []
    private(set) var isSampling = false

    init() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? session.setPreferredIOBufferDuration(0.005)
        try? session.setActive(true)
        #endif

        let hwRate = engine.outputNode.outputFormat(forBus: 0).sampleRate
        let rate = hwRate > 0 ? hwRate : 48000
        studio = Studio(sampleRate: Float(rate))

        let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
        let studio = self.studio
        let node = AVAudioSourceNode(format: format) { _, _, frameCount, bufferList -> OSStatus in
            let abl = UnsafeMutableAudioBufferListPointer(bufferList)
            guard abl.count >= 2,
                  let l = abl[0].mData?.assumingMemoryBound(to: Float.self),
                  let r = abl[1].mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            studio.render(l, r, Int(frameCount))
            return noErr
        }
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        source = node
        start()

        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            self?.start()
        })
        #if os(iOS)
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
            try? AVAudioSession.sharedInstance().setActive(true)
            self?.start()
        })
        #endif
    }

    deinit {
        for o in observers { NotificationCenter.default.removeObserver(o) }
    }

    func start() {
        guard !engine.isRunning else { return }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            print("Kassette: Audio konnte nicht gestartet werden: \(error)")
        }
    }

    // MARK: Sampling über das Mikrofon

    func startSampling(_ completion: @escaping (Bool) -> Void) {
        #if os(iOS)
        AVAudioApplication.requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else { completion(false); return }
                completion(self.beginInput())
            }
        }
        #else
        completion(beginInput())
        #endif
    }

    private func beginInput() -> Bool {
        engine.stop()
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default,
                                    options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            start()
            return false
        }
        #endif
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            start()
            return false
        }
        studio.instrument.beginCapture(sourceRate: format.sampleRate)
        let instrument = studio.instrument
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            guard let channels = buffer.floatChannelData else { return }
            instrument.capture(channels[0], Int(buffer.frameLength))
        }
        isSampling = true
        start()
        return true
    }

    func stopSampling() {
        guard isSampling else { return }
        engine.inputNode.removeTap(onBus: 0)
        studio.instrument.endCapture()
        isSampling = false
    }
}
