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

    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var showPlaceSheet = false
    @State private var deleteFailed = false

    private var signedIn: Bool {
        if case .signedIn = session.state { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    if signedIn { accountGroup }
                    appearanceGroup
                    placeGroup
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
    private func group<Content: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title)
                .font(.label.weight(.semibold))
                .foregroundStyle(Color.mutedForeground)
                .padding(.horizontal, Spacing.md)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: Spacing.md) { content() }.card()
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

    private var appearanceGroup: some View {
        group("Aspetto") {
            // Il cambio e' immediato e animato; la scelta resta salvata (@AppStorage) e la legge l'app intera.
            Picker("Aspetto", selection: Binding(get: { appearance }, set: { new in withAnimation(Motion.spring) { appearance = new } })) {
                ForEach(Appearance.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            // Liquid Glass non e' una scelta dell'app: lo regola iOS, qui non c'e' un interruttore.
            Text("Il Liquid Glass lo regola iOS: Impostazioni > Schermo e luminosità > Liquid Glass (Chiaro o Colorato).")
                .font(.label)
                .foregroundStyle(Color.mutedForeground)
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

    /// Danger Zone (MOB-05): un solo passo di conferma, nessun sondaggio ne' attesa. Successo solo dopo il 2xx del server.
    private var dangerZone: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Zona pericolosa").font(.heading).foregroundStyle(Color.destructive).accessibilityAddTraits(.isHeader)
            Text("Eliminando l'account cancelli per sempre salvati, preferenze e dati del profilo. Se hai usato Apple, revochiamo anche l'accesso.")
                .font(.label)
                .foregroundStyle(Color.foreground)
            if deleteFailed {
                Text("Non è andata a buon fine. Riprova tra un momento.").font(.label).foregroundStyle(Color.destructive)
            }
            Button(role: .destructive) { confirmDelete = true } label: {
                HStack(spacing: Spacing.sm) {
                    if session.isDeleting { ProgressView() }
                    Text("Elimina account")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(session.isDeleting)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.destructive.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Color.destructive.opacity(0.4), lineWidth: 1))
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
