import AuthenticationServices
import FuorirottaCore
import SwiftUI

/// I pulsanti di accesso: gli stessi nella card di Profilo e nel foglio di accesso.
struct SignInButtons: View {
    @Environment(Session.self) private var session
    @Environment(\.colorScheme) private var scheme
    // Nonce nuovo a ogni tentativo: Apple riceve lo sha256, il server il valore grezzo.
    @State private var rawNonce = ""

    var body: some View {
        VStack(spacing: Spacing.sm) {
            SignInWithAppleButton(.continue) { request in
                rawNonce = randomNonce()
                request.requestedScopes = [.fullName, .email]
                request.nonce = sha256Hex(rawNonce)
            } onCompletion: { result in
                switch result {
                case .success(let auth):
                    guard let credential = auth.credential as? ASAuthorizationAppleIDCredential else { return }
                    let nonce = rawNonce
                    Task { await session.signInWithApple(credential, rawNonce: nonce) }
                case .failure(let error):
                    session.fail(error)
                }
            }
            .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
            .frame(height: 48)
            .clipShape(Capsule())

            // Marchio Google: colori imposti (Tokens/Assets), stessa altezza e forma del pulsante Apple.
            Button {
                Task { await session.signInWithGoogle() }
            } label: {
                HStack(spacing: Spacing.sm) {
                    Image("GoogleG").resizable().scaledToFit().frame(width: 18, height: 18)
                    Text("Continua con Google").fontWeight(.medium)
                }
                .foregroundStyle(Color.googleText)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(Color.googleFill, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.googleBorder, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }
}

/// Il foglio di accesso: gli stessi due pulsanti della card di Profilo, aperto dagli inviti (card ospite, banner Salvati).
struct SignInSheet: View {
    @Environment(Session.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Accedi a Fuorirotta").font(.heading)
            Text("Salva gli eventi e ritrovali su ogni dispositivo.").foregroundStyle(Color.mutedForeground)
            SignInButtons()
            if let message = session.errorMessage {
                Text(message).font(.label).foregroundStyle(Color.destructive)
            }
            Text("Continuando accetti l'[informativa privacy](https://fuori-rotta.it/privacy)")
                .font(.label)
                .foregroundStyle(Color.mutedForeground)
        }
        .padding(Spacing.lg)
        .frame(maxHeight: .infinity, alignment: .top)
        .presentationDetents([.medium, .large])
        .onAppear { session.clearError() }
        .sensoryFeedback(.success, trigger: session.successCount)
        .sensoryFeedback(.error, trigger: session.errorCount)
    }
}
