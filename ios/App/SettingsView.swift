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
    /// Lo stesso stile per le mappe SwiftUI (la mappa piccola del dettaglio).
    var style: MapStyle {
        switch self {
        case .standard: .standard
        case .hybrid: .hybrid
        case .satellite: .imagery
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

/// La scheda con cui si apre l'app: Mappa o Eventi, la prima della barra (ne dipende anche l'ordine). Una preferenza del
/// dispositivo (@AppStorage), vale anche per l'ospite e non va nell'account; predefinita Mappa. La prima scheda di `order`
/// e' anche quella su cui l'app parte; i link universali scelgono la scheda per valore e non la guardano (D-13).
enum StartTab: String, CaseIterable, Identifiable {
    case map, events

    static let key = "fr.startTab"

    var id: Self { self }
    var title: LocalizedStringKey {
        switch self {
        case .map: "Mappa"
        case .events: "Eventi"
        }
    }
    var order: [AppTab] {
        switch self {
        case .map: [.map, .home]
        case .events: [.home, .map]
        }
    }
}

/// Le schermate che Impostazioni spinge nella pila del Profilo.
enum SettingsRoute: Hashable { case sessions }

/// I gruppi di Impostazioni, identici, dentro il Profilo (F6, 27.1-18): niente pila, niente foglio, li impagina il Profilo.
struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(SavesModel.self) private var saves
    @Environment(PushRegistration.self) private var push
    @Environment(LocationModel.self) private var location
    @Environment(Router.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.api) private var api
    @AppStorage(Appearance.key) private var appearance = Appearance.system
    @AppStorage(MapStyleChoice.key) private var mapStyle = MapStyleChoice.hybrid
    @AppStorage(StartTab.key) private var startTab = StartTab.map

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
    // B3: nome, esportazione.
    @State private var renaming = false
    @State private var newName = ""
    @State private var accountMessage: String?
    @State private var accountFailed = false
    @State private var exporting = false
    @State private var exportFile: ExportFile?

    private var signedIn: Bool {
        if case .signedIn = session.state { return true }
        return false
    }

    var body: some View {
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
        .sheet(isPresented: $showPlaceSheet) { LocationPickerSheet() }
        .sheet(item: $exportFile, onDismiss: removeExport) { file in
            ActivityView(items: [file.url]).presentationDetents([.medium, .large]).ignoresSafeArea()
        }
        .sensoryFeedback(.success, trigger: push.activatedCount)
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

    private var userName: String {
        if case .signedIn(let user) = session.state { return user.name }
        return ""
    }

    private var chevron: some View {
        Image(systemName: "chevron.right").font(.label).foregroundStyle(Color.mutedForeground).accessibilityHidden(true)
    }

    /// B3 (ProfileCard, SessionsList, AccountActions del sito): nome, sessioni attive, esportazione, uscita.
    private var accountGroup: some View {
        group("Account") {
            Button {
                newName = userName
                renaming = true
            } label: {
                row("Nome", symbol: "person.text.rectangle", color: .mutedForeground) {
                    HStack(spacing: Spacing.xs) {
                        Text(verbatim: userName).foregroundStyle(Color.mutedForeground).lineLimit(1)
                        chevron
                    }
                }
            }
            .buttonStyle(.plain)
            .alert("Nome", isPresented: $renaming) {
                TextField("Nome", text: $newName)
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
                Button("Annulla", role: .cancel) {}
                Button("Salva") { Task { await rename() } }
            } message: {
                Text("Da 1 a 50 caratteri.")
            }
            NavigationLink(value: SettingsRoute.sessions) {
                row("Sessioni attive", symbol: "laptopcomputer.and.iphone", color: .mutedForeground) { chevron }
            }
            .buttonStyle(.plain)
            Button { Task { await export() } } label: {
                row("Esporta i miei dati", symbol: "square.and.arrow.down", color: .mutedForeground) {
                    if exporting { ProgressView() }
                }
            }
            .buttonStyle(.plain)
            .disabled(exporting)
            if let accountMessage {
                Text(verbatim: accountMessage).font(.label).foregroundStyle(accountFailed ? Color.destructive : Color.mutedForeground)
            }
            Button { confirmSignOut = true } label: {
                row("Esci", symbol: "rectangle.portrait.and.arrow.right", color: .mutedForeground) { EmptyView() }
            }
            .buttonStyle(.plain)
            .confirmationDialog("Uscire da Fuorirotta?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Esci", role: .destructive) {
                    Task { await session.signOut() }
                }
                Button("Annulla", role: .cancel) {}
            } message: {
                Text("I tuoi salvati restano sull'account; su questo iPhone la lista torna vuota.")
            }
        }
    }

    private func rename() async {
        accountMessage = nil
        if normalizedDisplayName(newName) == userName { return }
        guard let clean = normalizedDisplayName(newName) else {
            return report(String(localized: "Scrivi un nome da 1 a 50 caratteri."), failed: true)
        }
        if await session.rename(clean) {
            report(String(localized: "Nome salvato"), failed: false)
        } else if case .signedIn = session.state {
            report(String(localized: "Non siamo riusciti a salvare il nome. Riprova."), failed: true)
        }
    }

    private func report(_ text: String, failed: Bool) {
        accountMessage = text
        accountFailed = failed
    }

    /// Il JSON dell'esportazione va in un file temporaneo col nome del server e passa al foglio di condivisione;
    /// chiuso il foglio, il file si cancella (sono tutti i dati dell'account).
    private func export() async {
        guard let api, !exporting else { return }
        exporting = true
        accountMessage = nil
        defer { exporting = false }
        do {
            let (data, name) = try await api.exportData()
            let url = URL.temporaryDirectory.appending(path: name)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            exportFile = ExportFile(url: url)
        } catch {
            if case .signedIn = session.state { report(String(localized: "Non siamo riusciti a preparare il file. Riprova."), failed: true) }
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
                            methodMessage = String(localized: "Non siamo riusciti a scollegare \(provider.name). Riprova.")
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
            // Un picker segmentato non mostra l'etichetta: la didascalia dice cosa si sceglie. RootView legge la stessa
            // chiave, quindi la barra si riordina subito e l'utente resta sul Profilo.
            Text("Apri l'app su").font(.label).foregroundStyle(Color.mutedForeground)
            Picker("Apri l'app su", selection: Binding(get: { startTab }, set: { new in withAnimation(Motion.spring) { startTab = new } })) {
                ForEach(StartTab.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            // La lingua si sceglie in iOS (Impostazioni > Fuorirotta > Lingua): e' il modo di Apple, niente selettore interno.
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            } label: {
                row("Lingua", symbol: "globe", color: .mutedForeground) {
                    HStack(spacing: Spacing.xs) {
                        Text(verbatim: Self.languageName).foregroundStyle(Color.mutedForeground)
                        Image(systemName: "arrow.up.right").font(.label).foregroundStyle(Color.mutedForeground).accessibilityHidden(true)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint("Apre le Impostazioni di iOS")
        }
    }

    /// "Italiano" / "English", nella lingua stessa.
    private static var languageName: String {
        let code = Locale.app.language.languageCode?.identifier ?? "it"
        return (Locale(identifier: code).localizedString(forLanguageCode: code) ?? code).localizedCapitalized
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
                        // L'avviso sta sulla Home: si torna li'.
                        router.tab = .home
                        saves.show(String(localized: "Account eliminato."))
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

extension SettingsView {
    private func removeExport() {
        if let url = exportFile?.url { try? FileManager.default.removeItem(at: url) }
    }
}

/// Il file dell'esportazione da passare al foglio di condivisione.
struct ExportFile: Identifiable {
    let url: URL
    var id: URL { url }
}

/// Il foglio di condivisione di sistema per un file (ShareLink vuole il file prima del tocco; qui arriva dopo la rete).
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// "Sessioni attive" (SessionsList.tsx): dispositivo, ultima attivita', "Esci" su ogni altro dispositivo e su tutti
/// insieme. Nessuna conferma per le revoche, come sul sito: si rimedia accedendo di nuovo. IP e luogo non si mostrano.
struct SessionsView: View {
    @Environment(\.api) private var api

    @State private var rows: [SessionInfo]?
    @State private var failed = false
    /// Una revoca alla volta: l'id in volo, "all" per quella di gruppo.
    @State private var pending: String?
    @State private var message: String?

    var body: some View {
        List {
            if let rows {
                Section {
                    ForEach(rows) { row in sessionRow(row) }
                } footer: {
                    if rows.count <= 1 { Text("Questo è l'unico dispositivo collegato.") }
                }
                if rows.count > 1 {
                    Section {
                        Button(role: .destructive) { Task { await revoke("all") } } label: {
                            HStack {
                                Text("Esci da tutti gli altri dispositivi")
                                if pending == "all" { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(pending != nil)
                    }
                }
                if let message {
                    Section { Text(verbatim: message).foregroundStyle(Color.foregroundSecondary) }
                }
            } else if failed {
                ContentUnavailableView {
                    Label("Sessioni non disponibili", systemImage: "wifi.slash")
                } description: {
                    Text("Non riusciamo a caricare le sessioni. Riprova tra poco.")
                } actions: {
                    Button("Riprova") { Task { await load() } }
                }
                .listRowBackground(Color.clear)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 88).listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Sessioni attive")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func sessionRow(_ row: SessionInfo) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: row.kind == "phone" ? "iphone" : row.kind == "tablet" ? "ipad" : "desktopcomputer")
                .foregroundStyle(Color.mutedForeground)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(verbatim: row.device).foregroundStyle(Color.foreground)
                Group {
                    if row.current {
                        Text("Questo dispositivo")
                    } else {
                        Text("Attiva \(Text(row.lastActive, format: .relative(presentation: .named)))")
                    }
                }
                .font(.label)
                .foregroundStyle(Color.mutedForeground)
            }
            Spacer()
            if !row.current {
                if pending == row.id {
                    ProgressView()
                } else {
                    Button("Esci") { Task { await revoke(row.id) } }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(pending != nil)
                        .accessibilityLabel("Esci da \(row.device)")
                }
            }
        }
        .frame(minHeight: 44)
    }

    private func load() async {
        guard let api else { return }
        failed = false
        do { rows = try await api.sessions() } catch { if rows == nil { failed = true } }
    }

    private func revoke(_ target: String) async {
        guard let api, pending == nil else { return }
        pending = target
        message = nil
        defer { pending = nil }
        do {
            if target == "all" {
                try await api.revokeOtherSessions()
                rows = rows?.filter(\.current)
                message = String(localized: "Altri dispositivi scollegati")
            } else {
                try await api.revokeSession(id: target)
                rows = rows?.filter { $0.id != target }
                message = String(localized: "Dispositivo scollegato")
            }
        } catch {
            message = String(localized: "Non siamo riusciti a scollegare il dispositivo. Riprova.")
        }
    }
}
