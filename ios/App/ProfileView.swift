import AuthenticationServices
import FuorirottaCore
import SwiftUI

struct ProfileView: View {
    @Environment(Session.self) private var session
    @Environment(SavesModel.self) private var saves
    @Environment(PushRegistration.self) private var push
    @Environment(LocationModel.self) private var location
    @Environment(Router.self) private var router
    @Environment(\.openURL) private var openURL
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var showPlaceSheet = false
    @State private var deleteFailed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    if session.expiredNotice {
                        Label("La sessione è scaduta. Accedi di nuovo.", systemImage: "exclamationmark.circle")
                            .font(.label)
                            .foregroundStyle(Color.mutedForeground)
                            .task { session.consumeExpiredNotice() }
                    }
                    accountCard
                    StatsSection(items: saves.statItems)
                    settingsCard
                    if case .signedIn = session.state {
                        signOutRow
                        dangerZone
                    }
                }
                .padding(Spacing.md)
            }
            .navigationTitle("Profilo")
            .onAppear { session.clearError() }
            // Account: le statistiche vengono dai salvati sincronizzati; Salvati puo' non essere mai stato aperto.
            .task(id: session.state) { if case .signedIn = session.state, saves.statItems.isEmpty { await saves.reload() } }
            .sensoryFeedback(.success, trigger: session.successCount)
            .sensoryFeedback(.error, trigger: session.errorCount)
            .sensoryFeedback(.success, trigger: push.activatedCount)
            .onChange(of: push.activatedCount) { saves.show("Notifiche attivate") }
            .sheet(isPresented: $showPlaceSheet) { LocationPickerSheet() }
        }
    }

    /// Impostazioni: righe raggruppate con il simbolo in una tessera colorata (UI-SPEC, Profilo 3).
    private var settingsCard: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Impostazioni").font(.heading).accessibilityAddTraits(.isHeader)
            Button { showPlaceSheet = true } label: {
                settingsRow("Posizione", symbol: "location.fill", color: .mutedForeground) {
                    HStack(spacing: Spacing.xs) {
                        Text(verbatim: location.place.name).foregroundStyle(Color.mutedForeground)
                        Image(systemName: "chevron.right").font(.label).foregroundStyle(Color.mutedForeground).accessibilityHidden(true)
                    }
                }
            }
            .buttonStyle(.plain)
            if case .signedIn = session.state { notificationsRow }
            settingsRow("Versione", symbol: "info.circle", color: .mutedForeground) {
                Text(verbatim: "\(Self.info("CFBundleShortVersionString")) (\(Self.info("CFBundleVersion")))")
                    .font(.label).foregroundStyle(Color.mutedForeground)
            }
        }
        .card()
    }

    private static func info(_ key: String) -> String { Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "?" }

    private func settingsRow<Trailing: View>(
        _ title: String, symbol: String, color: Color, @ViewBuilder trailing: () -> Trailing
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

    private var notificationsRow: some View {
        HStack(spacing: Spacing.md) {
            SettingsTile(symbol: "bell.badge", color: .success)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Notifiche")
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

    private var signOutRow: some View {
        Button { confirmSignOut = true } label: {
            settingsRow("Esci", symbol: "rectangle.portrait.and.arrow.right", color: .mutedForeground) { EmptyView() }
        }
        .buttonStyle(.plain)
        .card()
        .confirmationDialog("Uscire da Fuorirotta?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Esci", role: .destructive) { Task { await session.signOut() } }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("I tuoi salvati restano sull'account; su questo iPhone la lista torna vuota.")
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

    @ViewBuilder private var accountCard: some View {
        switch session.state {
        case .signedOut:
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Accedi a Fuorirotta").font(.heading)
                Text("Salva gli eventi e ritrovali su ogni dispositivo.")
                    .foregroundStyle(Color.mutedForeground)
                    .padding(.bottom, Spacing.sm)
                SignInButtons()
                if let message = session.errorMessage {
                    Text(message).font(.label).foregroundStyle(Color.destructive)
                }
            }
            .card()
        case .signedIn(let user):
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(spacing: Spacing.md) {
                    Text(verbatim: String(user.name.first ?? user.email.first ?? "?").uppercased())
                        .font(.heading)
                        .frame(width: 56, height: 56)
                        .background(Color.surfaceStrong, in: Circle())
                    VStack(alignment: .leading) {
                        Text(verbatim: user.name).font(.heading)
                        Text(verbatim: user.email).font(.label).foregroundStyle(Color.mutedForeground)
                    }
                }
            }
            .card()
        }
    }
}

extension View {
    /// Card di gruppo: superficie, raggio card, larghezza piena.
    func card() -> some View {
        padding(Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: Radius.card))
    }
}

/// Tessera 28 pt con il simbolo bianco su un colore del brand.
struct SettingsTile: View {
    let symbol: String
    let color: Color

    var body: some View {
        Image(systemName: symbol)
            .foregroundStyle(.white)
            .frame(width: 28, height: 28)
            .background(color, in: RoundedRectangle(cornerRadius: Radius.sm))
            .accessibilityHidden(true)
    }
}
