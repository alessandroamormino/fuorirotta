import FuorirottaCore
import SwiftUI

extension EnvironmentValues {
    @Entry var api: APIClient? = nil
}

@main
struct FuorirottaApp: App {
    // Costruito una volta sola: base URL e versione vengono dall'Info.plist (D-10, configurazione di build).
    private let api: APIClient = {
        let info = Bundle.main
        let base = info.object(forInfoDictionaryKey: "FRAPIBaseURL") as? String ?? "https://fuori-rotta.it"
        let version = info.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
        return APIClient(baseURL: URL(string: base)!, appVersion: version)
    }()

    var body: some Scene {
        WindowGroup {
            RootView().environment(\.api, api)
        }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house") { HomeView() }
            Tab("Mappa", systemImage: "map") { MapScreen() }
            Tab("Salvati", systemImage: "bookmark") { Placeholder(title: "Salvati", symbol: "bookmark") }
            Tab("Profilo", systemImage: "person") { Placeholder(title: "Profilo", symbol: "person") }
            Tab(role: .search) { Placeholder(title: "Cerca", symbol: "magnifyingglass") }
        }
    }
}

// Segnaposto finche' i piani successivi riempiono le altre schede.
private struct Placeholder: View {
    let title: String
    let symbol: String

    var body: some View {
        ContentUnavailableView(title, systemImage: symbol, description: Text("In arrivo."))
    }
}
