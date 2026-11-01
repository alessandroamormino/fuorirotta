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
        }
    }
}
