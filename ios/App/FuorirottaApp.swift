import FuorirottaCore
import GoogleSignIn
import SwiftUI

extension EnvironmentValues {
    @Entry var api: APIClient? = nil
}

@main
struct FuorirottaApp: App {
    // Costruito una volta sola: base URL e versione vengono dall'Info.plist (D-10, configurazione di build).
    private let api: APIClient

    @State private var session: Session
    @State private var saves: SavesModel

    init() {
        let info = Bundle.main
        let base = info.object(forInfoDictionaryKey: "FRAPIBaseURL") as? String ?? "https://fuori-rotta.it"
        let version = info.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
        let client = APIClient(baseURL: URL(string: base)!, appVersion: version)
        api = client
        _saves = State(initialValue: SavesModel(api: client))
        _session = State(initialValue: Session(api: client))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.api, api)
                .environment(session)
                .environment(saves)
                .task {
                    await saves.start()
                    await session.restore()
                }
                .onOpenURL { GIDSignIn.sharedInstance.handle($0) }
                .sheet(isPresented: Bindable(session).presentSignIn) { SignInSheet() }
        }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house") { HomeView() }
            Tab("Mappa", systemImage: "map") { MapScreen() }
            Tab("Salvati", systemImage: "bookmark") { SavedView() }
            Tab("Profilo", systemImage: "person") { ProfileView() }
            Tab(role: .search) { SearchView() }
        }
        // Home e Salvati (le liste che scorrono) fanno ridurre la barra; la mappa non e' uno ScrollView e non la muove.
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}
