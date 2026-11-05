import FuorirottaCore
import GoogleSignIn
import SafariServices
import SwiftUI

extension EnvironmentValues {
    @Entry var api: APIClient? = nil
    /// Politica di versione del server; nil = non risposta o non valida (l'app prosegue).
    @Entry var appConfig: AppConfig? = nil
}

extension Locale {
    /// La lingua dell'app: quella che iOS sceglie fra le localizzazioni dichiarate (it, en), cambiabile da
    /// Impostazioni di iOS > Fuorirotta > Lingua. Cambiarla riavvia l'app, quindi basta leggerla una volta.
    static let app = Locale(identifier: Bundle.main.preferredLocalizations.first ?? "it")
}

enum AppTab: Hashable { case home, map, saved, profile, search }

/// Un indirizzo da mostrare in un Safari dentro l'app (foglio).
struct SafariTarget: Identifiable {
    let url: URL
    var id: URL { url }
}

/// Dove sta l'app: la scheda attiva, la pila di Home (i link universali spingono qui) e il foglio Safari.
@MainActor @Observable
final class Router {
    var tab = AppTab.home
    var homePath = NavigationPath()
    var safari: SafariTarget?
    /// L'evento da mostrare nella scheda Mappa (la mappa piccola del dettaglio, UAT7 C2): la mappa lo consuma.
    var mapEvent: Event?

    func showOnMap(_ event: Event) {
        mapEvent = event
        tab = .map
    }

    /// Link universali (T-27-29): le regole sono in `parseUniversalLink`. L'id si verifica con l'API, la pagina della
    /// lista si mostra in Safari: niente viene eseguito o salvato. Altro: ignorato.
    func open(_ url: URL, api: APIClient?) async -> LinkOutcome {
        switch parseUniversalLink(url) {
        case .event(let id)?:
            // Solo un 404 dice "non esiste piu'": un errore di rete o di lettura non deve mai dirlo.
            guard let api, let lookup = try? await api.event(id: id) else { return .ignored }
            tab = .home
            switch lookup {
            case .found(let event):
                homePath.append(EventRoute(event: event, slot: "link"))
                return .opened
            case .gone:
                homePath = NavigationPath()
                return .gone
            }
        case .list?:
            safari = SafariTarget(url: url)
            return .opened
        case nil:
            return .ignored
        }
    }
}

/// Com'e' andata l'apertura di un link universale.
enum LinkOutcome { case opened, gone, ignored }

/// SFSafariViewController non rientra nell'app: il link universale che mostra resta nel foglio.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

/// TestFlight per i tester interni; al rilascio sullo Store qui va il link dell'App Store.
let updateURL = URL(string: "itms-beta://")!

@main
struct FuorirottaApp: App {
    // Costruito una volta sola: base URL e versione vengono dall'Info.plist (D-10, configurazione di build).
    private let api: APIClient
    private let version: String

    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session: Session
    @State private var push: PushRegistration
    @State private var saves: SavesModel
    @State private var visited: VisitedModel
    @State private var follows: FollowsModel
    @State private var location = LocationModel()
    @State private var router = Router()
    @State private var config: AppConfig?
    // Aspetto scelto in Impostazioni: "Sistema" = nil (D-07), la scelta resta salvata.
    @AppStorage(Appearance.key) private var appearance = Appearance.system
    @AppStorage(WelcomeView.seenKey) private var welcomeSeen = false

    init() {
        let info = Bundle.main
        let base = info.object(forInfoDictionaryKey: "FRAPIBaseURL") as? String ?? "https://fuori-rotta.it"
        let version = info.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
        let client = APIClient(baseURL: URL(string: base)!, appVersion: version)
        api = client
        self.version = version
        let savesModel = SavesModel(api: client)
        let pushModel = PushRegistration(api: client)
        AppDelegate.push = pushModel
        _saves = State(initialValue: savesModel)
        // Un solo avviso per l'app: i segni passano dal banner dei salvati, senza che i due modelli si conoscano (D-04).
        let visitedModel = VisitedModel(api: client) { [weak savesModel] in savesModel?.toast = $0 }
        _visited = State(initialValue: visitedModel)
        let followsModel = FollowsModel(api: client)
        followsModel.notify = { [weak savesModel] in savesModel?.show($0) }
        _follows = State(initialValue: followsModel)
        _push = State(initialValue: pushModel)
        _session = State(initialValue: Session(api: client, saves: savesModel, visited: visitedModel, push: pushModel))
        #if DEBUG
        // Test UI (LocalTestCase): "-fr.resetWelcome" riporta il tutorial al primo avvio. Per saltarlo basta
        // "-fr.welcomeSeen YES" (dominio degli argomenti, vince su quello salvato); "-fr.skipInterests YES" salta gli interessi.
        if CommandLine.arguments.contains("-fr.resetWelcome") { UserDefaults.standard.removeObject(forKey: WelcomeView.seenKey) }
        #endif
    }

    #if DEBUG
    private static let skipInterests = UserDefaults.standard.bool(forKey: "fr.skipInterests")
    #else
    private static let skipInterests = false
    #endif

    private enum Gate: Identifiable {
        case updateRequired, welcome, location, interests
        var id: Self { self }
    }

    // Solo un "update-required" (status del server) esplicito blocca (T-27-26): senza risposta o con una risposta malformata si prosegue.
    // Poi, una alla volta: il tutorial (una volta per installazione), la spiegazione della posizione, gli interessi
    // (una volta per account). Gli interessi aspettano che il foglio di accesso sia chiuso: due presentazioni insieme no.
    private var gate: Gate? {
        if config?.status == .updateRequired { return .updateRequired }
        if !welcomeSeen { return .welcome }
        if !location.explained { return .location }
        if follows.onboarded == false, !session.presentSignIn, !Self.skipInterests { return .interests }
        return nil
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(appearance.scheme)
                .environment(\.api, api)
                .environment(session)
                .environment(push)
                .environment(saves)
                .environment(visited)
                .environment(follows)
                .environment(location)
                .environment(router)
                .environment(\.appConfig, config)
                // Un solo schermo intero alla volta: la versione non piu' supportata vince sulla spiegazione.
                .fullScreenCover(item: .constant(gate)) { gate in
                    switch gate {
                    case .updateRequired: UpdateRequiredView()
                    case .welcome: WelcomeView()
                    case .location: LocationExplanationView().environment(location)
                    case .interests: InterestsView().environment(follows).environment(saves).environment(\.api, api)
                    }
                }
                .task { config = await api.config(version: version) }
                .task {
                    await saves.start()
                    await visited.start()
                    await session.restore()
                    await push.refreshIfAuthorised()
                }
                // Il ritorno di Google resta il primo; il resto sono i link di fuori-rotta.it.
                .onOpenURL { url in
                    if GIDSignIn.sharedInstance.handle(url) { return }
                    Task {
                        if await router.open(url, api: api) == .gone { saves.show(String(localized: "Evento non più disponibile")) }
                    }
                }
                .sheet(item: Bindable(router).safari) { SafariView(url: $0.url).ignoresSafeArea() }
        }
    }
}

struct RootView: View {
    @Environment(SavesModel.self) private var saves
    @Environment(FollowsModel.self) private var follows
    @Environment(Router.self) private var router
    @Environment(Session.self) private var session
    /// La foto dell'account come icona della scheda Profilo (REF Omniphile), gia' tonda e a colori originali.
    @State private var profileIcon: UIImage?

    private var photoURL: String? {
        if case .signedIn(let user) = session.state { return user.image }
        return nil
    }

    var body: some View {
        TabView(selection: Bindable(router).tab) {
            Tab("Home", systemImage: "house", value: AppTab.home) { HomeView() }
            Tab("Mappa", systemImage: "map", value: AppTab.map) { MapScreen() }
            Tab("Salvati", systemImage: "heart", value: AppTab.saved) { SavedView() }
            Tab(value: AppTab.profile) {
                ProfileView()
            } label: {
                Label {
                    Text("Profilo")
                } icon: {
                    // La barra non applica ritagli SwiftUI: l'immagine arriva gia' tonda; senza foto, il simbolo.
                    if let profileIcon { Image(uiImage: profileIcon) } else { Image(systemName: "person") }
                }
            }
            Tab(value: AppTab.search, role: .search) { SearchView() }
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
        // Cosa segue l'account: caricato all'accesso, dimenticato all'uscita (anche per un 401).
        .task(id: session.state == .signedOut) {
            if session.state == .signedOut { follows.reset() } else { await follows.load() }
        }
        .task(id: photoURL) {
            profileIcon = nil
            guard let url = photoURL, let photo = await ImageLoader.image(url: url, size: CGSize(width: 30, height: 30)) else { return }
            profileIcon = Self.roundIcon(photo)
        }
        .animation(Motion.snappy, value: saves.toast?.id)
        .sensoryFeedback(.success, trigger: saves.successCount)
        .sensoryFeedback(.warning, trigger: saves.warningCount)
        .sensoryFeedback(.error, trigger: saves.errorCount)
        // Qui e non nella scena: il contenuto di un foglio eredita l'ambiente della vista a cui e' attaccato, e i
        // `.environment(...)` della scena stanno SOTTO il foglio. Attaccato alla scena, SignInSheet non trovava la
        // Session e l'app si chiudeva (UAT 4, crash EnvironmentValues.subscript).
        // Chiuso senza accedere: il "Segui" dell'ospite si scarta (C4, come il sito).
        .sheet(isPresented: Bindable(session).presentSignIn, onDismiss: { if session.state == .signedOut { follows.forgetIntent() } }) {
            SignInSheet()
        }
    }
}

extension RootView {
    /// Cerchio di 30 pt (aspect fill) con i colori originali: un'immagine "template" in una barra verrebbe tinta in una macchia.
    static func roundIcon(_ image: UIImage) -> UIImage {
        let side: CGFloat = 30
        let scale = max(side / image.size.width, side / image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let rect = CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height)
        let drawn = UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
            UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: side, height: side)).addClip()
            image.draw(in: rect)
        }
        return drawn.withRenderingMode(.alwaysOriginal)
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
