import AuthenticationServices
import FuorirottaCore
import SwiftUI

struct ProfileView: View {
    @Environment(Session.self) private var session
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
                }
                .padding(Spacing.md)
            }
            .navigationTitle("Profilo")
            .sensoryFeedback(.success, trigger: session.successCount)
            .sensoryFeedback(.error, trigger: session.errorCount)
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
