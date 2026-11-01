import FuorirottaCore
import GoogleSignIn
import SwiftUI

extension EnvironmentValues {
    @Entry var api: APIClient? = nil
    /// Politica di versione del server; nil = non risposta o non valida (l'app prosegue).
    @Entry var appConfig: AppConfig? = nil
}

/// TestFlight per i tester interni; al rilascio sullo Store qui va il link dell'App Store.
let updateURL = URL(string: "itms-beta://")!

@main
struct FuorirottaApp: App {
    // Costruito una volta sola: base URL e versione vengono dall'Info.plist (D-10, configurazione di build).
    private let api: APIClient
    private let version: String

    @State private var session: Session
    @State private var saves: SavesModel
    @State private var location = LocationModel()
    @State private var config: AppConfig?

    init() {
        let info = Bundle.main
        let base = info.object(forInfoDictionaryKey: "FRAPIBaseURL") as? String ?? "https://fuori-rotta.it"
        let version = info.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
        let client = APIClient(baseURL: URL(string: base)!, appVersion: version)
        api = client
        self.version = version
        let savesModel = SavesModel(api: client)
        _saves = State(initialValue: savesModel)
        _session = State(initialValue: Session(api: client, saves: savesModel))
    }

    private enum Gate: Identifiable {
        case updateRequired, location
        var id: Self { self }
    }

    // Solo un "update-required" (status del server) esplicito blocca (T-27-26): senza risposta o con una risposta malformata si prosegue.
    private var gate: Gate? {
        if config?.status == .updateRequired { return .updateRequired }
        return location.explained ? nil : .location
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.api, api)
                .environment(session)
                .environment(saves)
                .environment(location)
                .environment(\.appConfig, config)
                // Un solo schermo intero alla volta: la versione non piu' supportata vince sulla spiegazione.
                .fullScreenCover(item: .constant(gate)) { gate in
                    switch gate {
                    case .updateRequired: UpdateRequiredView()
                    case .location: LocationExplanationView().environment(location)
                    }
                }
                .task { config = await api.config(version: version) }
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

/// Versione non piu' supportata: schermo intero, senza chiusura. "Aggiorna" apre TestFlight (il link dell'App Store verra' dopo).
struct UpdateRequiredView: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Spacer()
            Image(systemName: "arrow.down.app").font(.symbolHero).foregroundStyle(Color.foreground).accessibilityHidden(true)
            Text("Aggiorna Fuorirotta").font(.heading).foregroundStyle(Color.foreground).multilineTextAlignment(.center)
            Text("Questa versione non è più supportata. Aggiornala per continuare.")
                .font(.body)
                .foregroundStyle(Color.foregroundSecondary)
                .multilineTextAlignment(.center)
            Spacer()
            Button {
                openURL(updateURL)
            } label: {
                Text("Aggiorna").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.background)
        .interactiveDismissDisabled()
    }
}
