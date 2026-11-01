import AuthenticationServices
import FuorirottaCore
import SwiftUI

struct ProfileView: View {
    @Environment(Session.self) private var session
    @Environment(SavesModel.self) private var saves
    @State private var showSettings = false

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
                }
                .padding(Spacing.md)
            }
            .navigationTitle("Profilo")
            .onAppear { session.clearError() }
            // Account: le statistiche vengono dai salvati sincronizzati; Salvati puo' non essere mai stato aperto.
            .task(id: session.state) { if case .signedIn = session.state, saves.statItems.isEmpty { await saves.reload() } }
            .sensoryFeedback(.success, trigger: session.successCount)
            .sensoryFeedback(.error, trigger: session.errorCount)
            .toolbar {
                // Vetro di sistema attorno al pulsante: tondo in alto a destra (REF Omniphile).
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Impostazioni")
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
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
            // Come "Community" nel video: avatar tondo grande, nome in grassetto, e-mail grigia; senza scheda.
            HStack(spacing: Spacing.md) {
                ProfileAvatar(user: user)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(verbatim: user.name).font(.heading).foregroundStyle(Color.foreground).lineLimit(2)
                    Text(verbatim: user.email).font(.label).foregroundStyle(Color.mutedForeground).lineLimit(1).truncationMode(.middle)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// La foto dell'account se il provider la da' (Google: `user.image`, gia' filtrata dal server), altrimenti le iniziali
/// su un cerchio colorato. La foto e' una miniatura alla misura del cerchio, come le card.
struct ProfileAvatar: View {
    static let size: CGFloat = 72

    let user: MeUser
    @State private var photo: UIImage?

    var body: some View {
        ZStack {
            if let photo {
                Image(uiImage: photo).resizable().scaledToFill()
            } else {
                Color.avatarPalette[stableIndex(user.email, count: Color.avatarPalette.count)]
                Text(verbatim: initials(name: user.name, email: user.email))
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .padding(Spacing.xs)
            }
        }
        .frame(width: Self.size, height: Self.size)
        .clipShape(Circle())
        .accessibilityHidden(true)
        .task(id: user.image) {
            photo = nil
            guard let url = user.image else { return }
            photo = await ImageLoader.image(url: url, size: CGSize(width: Self.size, height: Self.size))
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
