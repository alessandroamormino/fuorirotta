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
    @State private var location = LocationModel()

    init() {
        let info = Bundle.main
        let base = info.object(forInfoDictionaryKey: "FRAPIBaseURL") as? String ?? "https://fuori-rotta.it"
        let version = info.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
        let client = APIClient(baseURL: URL(string: base)!, appVersion: version)
        api = client
        let savesModel = SavesModel(api: client)
        _saves = State(initialValue: savesModel)
        _session = State(initialValue: Session(api: client, saves: savesModel))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.api, api)
                .environment(session)
                .environment(saves)
                .environment(location)
                .fullScreenCover(isPresented: .constant(!location.explained)) {
                    LocationExplanationView().environment(location)
                }
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
    @Environment(SavesModel.self) private var saves

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
        .overlay(alignment: .bottom) {
            if let toast = saves.toast {
                ToastBanner(toast: toast) { saves.toast = nil }
                    .padding(.horizontal, Spacing.md)
                    .padding(.bottom, Spacing.xxxl)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(Motion.snappy, value: saves.toast?.id)
        .sensoryFeedback(.success, trigger: saves.successCount)
        .sensoryFeedback(.warning, trigger: saves.warningCount)
        .sensoryFeedback(.error, trigger: saves.errorCount)
    }
}
