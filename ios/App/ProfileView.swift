import AuthenticationServices
import FuorirottaCore
import SwiftUI

/// Le schermate che il Profilo spinge nella sua pila.
enum ProfileRoute: Hashable { case stats, follows }

/// Profilo (UAT7 B6, REF Omniphile): l'intestazione dell'account e cosa segue. Le statistiche hanno una schermata
/// loro (icona grafico in alto a destra); le Impostazioni stanno nella pagina, sotto l'account e gli interessi (F6, 27.1-18).
struct ProfileView: View {
    @Environment(Session.self) private var session
    @Environment(FollowsModel.self) private var follows

    private var signedIn: Bool {
        if case .signedIn = session.state { return true }
        return false
    }

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
                    if signedIn { interests }
                    SettingsView()
                }
                .padding(Spacing.md)
            }
            .navigationTitle("Profilo")
            .navigationDestination(for: ProfileRoute.self) { route in
                switch route {
                case .stats: StatsView()
                case .follows: FollowsView()
                }
            }
            .navigationDestination(for: SettingsRoute.self) { route in
                switch route {
                case .sessions: SessionsView()
                }
            }
            .onAppear { session.clearError() }
            .sensoryFeedback(.success, trigger: session.successCount)
            .sensoryFeedback(.error, trigger: session.errorCount)
            .toolbar {
                // In alto a destra solo le statistiche: le Impostazioni stanno nella pagina.
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: ProfileRoute.stats) { Image(systemName: "chart.bar") }
                        .accessibilityLabel("Statistiche")
                }
            }
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

/// B1/B6: cosa segue l'account, la gestione delle preferenze sta nel Profilo. Sotto il titolo, i nomi gia' seguiti.
private extension ProfileView {
    var interests: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("I tuoi interessi")
                .font(.label.weight(.semibold))
                .foregroundStyle(Color.mutedForeground)
                .padding(.horizontal, Spacing.md)
                .accessibilityAddTraits(.isHeader)
            NavigationLink(value: ProfileRoute.follows) {
                HStack(spacing: Spacing.md) {
                    SettingsTile(symbol: "sparkles", color: .mutedForeground)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text("Cosa segui").foregroundStyle(Color.foreground)
                        Text(verbatim: followedSummary).font(.label).foregroundStyle(Color.mutedForeground).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.label).foregroundStyle(Color.mutedForeground).accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .card()
        }
    }

    /// "Lombardia, Bergamo (BG), Sagre e feste" oppure, senza nulla, l'invito: categorie nella lingua dell'app.
    var followedSummary: String {
        let names = (follows.items ?? []).map { $0.isPlace ? $0.label : categoryLabel($0.key) }
        return names.isEmpty ? String(localized: "Luoghi e categorie per «Per te»") : names.joined(separator: ", ")
    }
}

/// Le statistiche dei salvati (MOB-07), in una schermata loro. Il contenuto non cambia: verra' rifatto con "Ci sono stato".
struct StatsView: View {
    @Environment(Session.self) private var session
    @Environment(SavesModel.self) private var saves
    @Environment(VisitedModel.self) private var visited

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                StatsSection(visited: visited.statItems, saved: saves.statItems)
            }
            .padding(Spacing.md)
        }
        .background(Color.background)
        .navigationTitle("Statistiche")
        // Account: le statistiche vengono dai salvati sincronizzati; Salvati puo' non essere mai stato aperto.
        .task(id: session.state) {
            guard case .signedIn = session.state else { return }
            if saves.statItems.isEmpty { await saves.reload() }
            if visited.statItems.isEmpty { await visited.reload() }
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
