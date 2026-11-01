import FuorirottaCore
import MapKit
import SwiftUI

/// Aspetto dell'app (REF Omniphile: segmentato Sistema / Chiaro / Scuro). `system` = nessun aspetto imposto (D-07).
enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark

    static let key = "fr.appearance"

    var id: Self { self }
    var title: LocalizedStringKey {
        switch self {
        case .system: "Sistema"
        case .light: "Chiaro"
        case .dark: "Scuro"
        }
    }
    var scheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// Stile della mappa: una sola preferenza (@AppStorage), condivisa dal tasto della mappa e da Impostazioni > Mappa.
/// Predefinito `hybrid`: satellite con strade e nomi dei luoghi. Il satellite puro non ha etichette e su una mappa di
/// eventi i nomi dei paesi servono; e' anche cio' che Apple Mappe chiama "Satellite".
enum MapStyleChoice: String, CaseIterable, Identifiable {
    case standard, hybrid, satellite

    static let key = "fr.mapStyle"

    var id: Self { self }
    var title: LocalizedStringKey {
        switch self {
        case .standard: "Standard"
        case .hybrid: "Ibrida"
        case .satellite: "Satellite"
        }
    }
    var mapType: MKMapType {
        switch self {
        case .standard: .standard
        case .hybrid: .hybrid
        case .satellite: .satellite
        }
    }
}

/// Impostazioni (REF Omniphile): foglio a tutta altezza chiuso da una X tonda in alto a sinistra, gruppi in card.
/// Le righe stavano nella pagina Profilo; il Profilo tiene l'intestazione utente e le statistiche.
struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(SavesModel.self) private var saves
    @Environment(PushRegistration.self) private var push
    @Environment(LocationModel.self) private var location
    @Environment(Router.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Appearance.key) private var appearance = Appearance.system
    @AppStorage(MapStyleChoice.key) private var mapStyle = MapStyleChoice.hybrid

    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var showPlaceSheet = false
    @State private var deleteFailed = false
    // Metodi di accesso: nil = non caricati (rete) o in caricamento.
    @State private var methods: SignInMethods?
    @State private var methodsFailed = false
    @State private var linking: SignInProvider?
    @State private var unlinkTarget: SignInProvider?
    @State private var methodMessage: String?

    private var signedIn: Bool {
        if case .signedIn = session.state { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    if signedIn { accountGroup }
                    if signedIn { methodsGroup }
                    appearanceGroup
                    placeGroup
                    mapGroup
                    if signedIn { notificationsGroup }
                    infoGroup
                    if signedIn { dangerZone }
                }
                .padding(Spacing.md)
            }
            .background(Color.background)
            .navigationTitle("Impostazioni")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
            .sheet(isPresented: $showPlaceSheet) { LocationPickerSheet() }
            .sensoryFeedback(.success, trigger: push.activatedCount)
        }
        // L'aspetto si applica anche a questo foglio: un foglio non sempre eredita quello della finestra.
        .preferredColorScheme(appearance.scheme)
    }

    // MARK: gruppi

    /// Un gruppo: titolo piccolo grigio sopra, righe nella card.
    private func group<Content: View>(
        _ title: LocalizedStringKey, fill: Color = .surface, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title)
                .font(.label.weight(.semibold))
                .foregroundStyle(Color.mutedForeground)
                .padding(.horizontal, Spacing.md)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: Spacing.md) { content() }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(fill, in: RoundedRectangle(cornerRadius: Radius.card))
        }
    }

    private func row<Trailing: View>(
        _ title: LocalizedStringKey, symbol: String, color: Color, @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        HStack(spacing: Spacing.md) {
            SettingsTile(symbol: symbol, color: color)
            Text(title).foregroundStyle(Color.foreground)
            Spacer()
            trailing()
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var accountGroup: some View {
        group("Account") {
            Button { confirmSignOut = true } label: {
                row("Esci", symbol: "rectangle.portrait.and.arrow.right", color: .mutedForeground) { EmptyView() }
            }
            .buttonStyle(.plain)
            .confirmationDialog("Uscire da Fuorirotta?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Esci", role: .destructive) {
                    Task {
                        await session.signOut()
                        dismiss()
                    }
                }
                Button("Annulla", role: .cancel) {}
            } message: {
                Text("I tuoi salvati restano sull'account; su questo iPhone la lista torna vuota.")
            }
        }
    }

    // MARK: metodi di accesso

    private var methodsGroup: some View {
        group("Metodi di accesso") {
            if let methods {
                ForEach(SignInProvider.allCases, id: \.self) { provider in methodRow(provider, methods: methods) }
                if methods.accounts.count == 1 {
                    Text("Puoi scollegare un metodo solo se ne resta un altro.").font(.label).foregroundStyle(Color.mutedForeground)
                }
            } else if methodsFailed {
                Text("Non riusciamo a caricare i metodi di accesso.").font(.label).foregroundStyle(Color.mutedForeground)
                Button("Riprova") { Task { await loadMethods() } }.buttonStyle(.bordered).controlSize(.small)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 44)
            }
            if let methodMessage {
                Text(methodMessage).font(.label).foregroundStyle(Color.destructive)
            }
        }
        .task { await loadMethods() }
        .confirmationDialog(
            unlinkTarget.map { "Scollegare \($0.name)?" } ?? "", isPresented: Binding(get: { unlinkTarget != nil }, set: { if !$0 { unlinkTarget = nil } }),
            titleVisibility: .visible
        ) {
            if let provider = unlinkTarget, let current = methods {
                Button("Scollega \(provider.name)", role: .destructive) {
                    Task {
                        methodMessage = nil
                        if await session.unlink(provider, in: current) {
                            await loadMethods()
                        } else {
                            methodMessage = "Non siamo riusciti a scollegare \(provider.name). Riprova."
                        }
                    }
                }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            if let provider = unlinkTarget {
                Text(provider == .apple
                    ? "Non potrai più entrare con Apple. Il tuo profilo e i tuoi dati restano. Revochiamo anche l'autorizzazione data a Fuorirotta nel tuo ID Apple."
                    : "Non potrai più entrare con Google. Il tuo profilo e i tuoi dati restano.")
            }
        }
    }

    private func methodRow(_ provider: SignInProvider, methods: SignInMethods) -> some View {
        let linked = methods.isLinked(provider)
        return HStack(spacing: Spacing.md) {
            Group {
                if provider == .apple {
                    Image(systemName: "apple.logo").font(.title3).foregroundStyle(Color.foreground)
                } else {
                    Image("GoogleG").resizable().scaledToFit().frame(width: 20, height: 20)
                }
            }
            .frame(width: 28, height: 28)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(verbatim: provider.name).foregroundStyle(Color.foreground)
                Text(linked ? "Collegato" : "Non collegato").font(.label).foregroundStyle(Color.mutedForeground)
            }
            Spacer()
            if linking == provider {
                ProgressView()
            } else if !linked {
                Button("Collega") { Task { await link(provider) } }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(linking != nil)
                    .accessibilityLabel("Collega \(provider.name)")
            } else if methods.canUnlink(provider) {
                Button("Scollega") { unlinkTarget = provider }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(linking != nil)
                    .accessibilityLabel("Scollega \(provider.name)")
            }
        }
        .frame(minHeight: 44)
    }

    private func loadMethods() async {
        methodsFailed = false
        if let loaded = await session.signInMethods() {
            methods = loaded
        } else if methods == nil {
            methodsFailed = true
        }
    }

    private func link(_ provider: SignInProvider) async {
        linking = provider
        methodMessage = nil
        defer { linking = nil }
        switch await session.link(provider) {
        case .linked: await loadMethods()
        case .canceled: break
        case .failed(let message): methodMessage = message
        }
    }

    private var appearanceGroup: some View {
        group("Aspetto") {
            // Il cambio e' immediato e animato; la scelta resta salvata (@AppStorage) e la legge l'app intera.
            Picker("Aspetto", selection: Binding(get: { appearance }, set: { new in withAnimation(Motion.spring) { appearance = new } })) {
                ForEach(Appearance.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
        }
    }

    private var placeGroup: some View {
        group("Posizione") {
            Button { showPlaceSheet = true } label: {
                row("Zona", symbol: "location.fill", color: .mutedForeground) {
                    HStack(spacing: Spacing.xs) {
                        Text(verbatim: location.place.name).foregroundStyle(Color.mutedForeground)
                        Image(systemName: "chevron.right").font(.label).foregroundStyle(Color.mutedForeground).accessibilityHidden(true)
                    }
                }
            }
            .buttonStyle(.plain)
        }
    }

    private var mapGroup: some View {
        group("Mappa") {
            Picker("Stile della mappa", selection: $mapStyle) {
                ForEach(MapStyleChoice.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
        }
    }

    private var notificationsGroup: some View {
        group("Notifiche") {
            HStack(spacing: Spacing.md) {
                SettingsTile(symbol: "bell.badge", color: .success)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("Notifiche").foregroundStyle(Color.foreground)
                    if push.failed {
                        Text("Non è andata a buon fine. Riprova tra un momento.").font(.label).foregroundStyle(Color.destructive)
                    } else if push.denied {
                        Text("Sono disattivate nelle Impostazioni di iOS.").font(.label).foregroundStyle(Color.mutedForeground)
                    }
                }
                Spacer()
                if push.registered {
                    Text("Attive").foregroundStyle(Color.mutedForeground)
                } else if push.denied {
                    Button("Apri Impostazioni") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                } else {
                    Button("Attiva notifiche") { Task { await push.enable() } }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                }
            }
            .frame(minHeight: 44)
        }
    }

    private static func info(_ key: String) -> String { Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "?" }

    private static let privacyURL = URL(string: "https://fuori-rotta.it/privacy")!

    private var infoGroup: some View {
        group("Info") {
            row("Versione", symbol: "info.circle", color: .mutedForeground) {
                Text(verbatim: "\(Self.info("CFBundleShortVersionString")) (\(Self.info("CFBundleVersion")))")
                    .font(.label).foregroundStyle(Color.mutedForeground)
            }
            Link(destination: Self.privacyURL) {
                row("Privacy", symbol: "hand.raised", color: .mutedForeground) {
                    Image(systemName: "arrow.up.right").font(.label).foregroundStyle(Color.mutedForeground).accessibilityHidden(true)
                }
            }
            .buttonStyle(.plain)
        }
    }

    /// Zona pericolosa (MOB-05, REF Omniphile): titolo grigio come gli altri gruppi, card rosa tenue senza bordo con una sola
    /// riga, "Elimina account" in rosso e il cestino a destra. Un solo passo di conferma, nessun sondaggio ne' attesa.
    private var dangerZone: some View {
        group("Zona pericolosa", fill: Color.destructive.opacity(0.12)) {
            Button(role: .destructive) { confirmDelete = true } label: {
                HStack(spacing: Spacing.md) {
                    Text("Elimina account")
                    Spacer()
                    if session.isDeleting { ProgressView() } else { Image(systemName: "trash").accessibilityHidden(true) }
                }
                .foregroundStyle(Color.destructive)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(session.isDeleting)
            if deleteFailed {
                Text("Non è andata a buon fine. Riprova tra un momento.").font(.label).foregroundStyle(Color.destructive)
            }
        }
        .confirmationDialog("Elimina account", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Elimina account", role: .destructive) {
                deleteFailed = false
                Task {
                    if await session.deleteAccount() {
                        // Il foglio si chiude: l'avviso sta sulla Home, sotto di lui.
                        dismiss()
                        router.tab = .home
                        saves.show("Account eliminato.")
                    } else if case .signedIn = session.state {
                        deleteFailed = true
                    }
                }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Vuoi eliminare definitivamente il tuo account? L'operazione non si può annullare.")
        }
    }
}
