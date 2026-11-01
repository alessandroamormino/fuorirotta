import FuorirottaCore
import SwiftUI

extension EnvironmentValues {
    @Entry var api: APIClient? = nil
}

@main
struct FuorirottaApp: App {
    // Costruito una volta sola: base URL e versione vengono dall'Info.plist (D-10, configurazione di build).
    private let api: APIClient

    @State private var session: Session

    init() {
        let info = Bundle.main
        let base = info.object(forInfoDictionaryKey: "FRAPIBaseURL") as? String ?? "https://fuori-rotta.it"
        let version = info.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
        let client = APIClient(baseURL: URL(string: base)!, appVersion: version)
        api = client
        _session = State(initialValue: Session(api: client))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.api, api)
                .environment(session)
                .task { await session.restore() }
        }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house") { HomeView() }
            Tab("Mappa", systemImage: "map") { MapScreen() }
            Tab("Salvati", systemImage: "bookmark") { Placeholder(title: "Salvati", symbol: "bookmark") }
            Tab("Profilo", systemImage: "person") { ProfileView() }
            Tab(role: .search) { SearchView() }
        }
        // Home e Salvati (le liste che scorrono) fanno ridurre la barra; la mappa non e' uno ScrollView e non la muove.
        .tabBarMinimizeBehavior(.onScrollDown)
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
