import AuthenticationServices
import FuorirottaCore
import SwiftUI

struct ProfileView: View {
    @Environment(Session.self) private var session
    @Environment(SavesModel.self) private var saves
    @Environment(PushRegistration.self) private var push
    @Environment(\.openURL) private var openURL
    @State private var confirmSignOut = false

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
                    if case .signedIn = session.state { settingsCard }
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
        }
    }

    /// Impostazioni: righe raggruppate con il simbolo in una tessera colorata (UI-SPEC, Profilo 3).
    private var settingsCard: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Impostazioni").font(.heading).accessibilityAddTraits(.isHeader)
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
        }
        .card()
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
                Button("Esci", role: .destructive) { confirmSignOut = true }
            }
            .card()
            .confirmationDialog("Uscire da Fuorirotta?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Esci", role: .destructive) { Task { await session.signOut() } }
                Button("Annulla", role: .cancel) {}
            } message: {
                Text("I tuoi salvati restano sull'account; su questo iPhone la lista torna vuota.")
            }
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
