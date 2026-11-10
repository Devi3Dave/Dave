// swift-tools-version: 5.9

// Kassette – App-Paket für Swift Playgrounds (iPad / Mac) und Xcode.
// Öffnen: Doppelklick auf "Kassette.swiftpm" (Mac) bzw. in Swift Playgrounds importieren (iPad).

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "Kassette",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "Kassette",
            targets: ["AppModule"],
            bundleIdentifier: "com.example.kassette",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .mic),
            accentColor: .presetColor(.orange),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .landscapeRight,
                .landscapeLeft,
                .portrait
            ],
            capabilities: [
                .microphone(purposeString: "Kassette nimmt über das Mikrofon Samples für die SAMPLER-Engine auf.")
            ],
            appCategory: .music
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: "."
        )
    ]
)
