// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FuorirottaCore",
    platforms: [.iOS("26.0"), .macOS(.v15)],
    products: [.library(name: "FuorirottaCore", targets: ["FuorirottaCore"])],
    targets: [
        .target(name: "FuorirottaCore"),
        .testTarget(
            name: "FuorirottaCoreTests",
            dependencies: ["FuorirottaCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
