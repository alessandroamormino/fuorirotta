import AuthenticationServices
import FuorirottaCore
import Observation
import Security
import SwiftUI

// Sessione dell'utente: il bearer sta SOLO nel Portachiavi (mai nelle preferenze, mai nei log).

enum SessionState: Equatable {
    case signedOut
    case signedIn(MeUser)
}

/// Il bearer a riposo. ThisDeviceOnly: non entra nei backup ne' passa a un altro telefono.
/// Servizio e account non si rinominano: farebbe uscire tutti i tester a ogni aggiornamento.
enum Keychain {
    private static var base: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "it.fuorirotta.app.session",
            kSecAttrAccount as String: "bearer",
        ]
    }

    static func read() -> String? {
        var q = base
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String) {
        delete()
        var q = base
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete() { SecItemDelete(base as CFDictionary) }
}

@MainActor @Observable
final class Session {
    private(set) var state = SessionState.signedOut
    /// Messaggio di errore dell'ultimo accesso fallito; nil dopo un annullamento (silenzioso).
    private(set) var errorMessage: String?
    /// Vero dopo un 401: la prossima apertura di Profilo mostra "La sessione è scaduta".
    var expiredNotice = false
    /// 27-06/27-07 lo accendono dal banner dei Salvati e dalla card ospite.
    var presentSignIn = false
    /// Contatori per .sensoryFeedback: cambiano a ogni esito, anche uguale al precedente.
    private(set) var successCount = 0
    private(set) var errorCount = 0

    private let api: APIClient
    // Un solo accesso alla volta: due tocchi rapidi non devono lanciare due flussi.
    private var busy = false

    init(api: APIClient) {
        self.api = api
        api.onUnauthorized = { [weak self] in Task { @MainActor in self?.handleUnauthorized() } }
    }

    /// All'avvio. Dopo una reinstallazione il Portachiavi sopravvive ma non il resto: marker nelle preferenze (Pitfall 4).
    func restore() async {
        if !UserDefaults.standard.bool(forKey: "fr.installMarker") {
            Keychain.delete()
            UserDefaults.standard.set(true, forKey: "fr.installMarker")
        }
        guard let bearer = Keychain.read() else { return }
        api.bearer = bearer
        do {
            if let user = try await api.meState().user {
                state = .signedIn(user)
            } else {
                handleUnauthorized()
            }
        } catch APIError.http(401, _) {
            // gia' gestito da onUnauthorized
        } catch {
            // Rete assente: il bearer resta, si riprova al prossimo avvio. Si mostra come ospite.
        }
    }

    func signInWithApple(_ credential: ASAuthorizationAppleIDCredential, rawNonce: String) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        guard let tokenData = credential.identityToken, let idToken = String(data: tokenData, encoding: .utf8) else {
            return fail(APIError.decoding)
        }
        do {
            try await open(
                provider: "apple", idToken: idToken, nonce: rawNonce,
                firstName: credential.fullName?.givenName, lastName: credential.fullName?.familyName)
            // Una volta sola, subito: il codice vale pochi minuti. Se fallisce, solo l'eliminazione non revochera' Apple.
            if let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8) {
                do { try await api.appleToken(code: code) } catch { print("apple-token fallito: \(error)") }
            }
        } catch {
            fail(error)
        }
    }

    func signOut() async {
        do { try await api.signOut() } catch { print("sign-out fallito: \(error)") }
        Keychain.delete()
        api.bearer = nil
        state = .signedOut
    }

    func handleUnauthorized() {
        Keychain.delete()
        api.bearer = nil
        if state != .signedOut { expiredNotice = true }
        state = .signedOut
    }

    /// Chiamata da ProfileView quando mostra il banner di scadenza.
    func consumeExpiredNotice() { expiredNotice = false }

    /// Cancel dell'utente: nessun messaggio e nessun cambiamento. Il resto: il testo documentato.
    func fail(_ error: Error) {
        if (error as? ASAuthorizationError)?.code == .canceled { return }
        errorCount += 1
        switch error {
        case APIError.http(429, _):
            errorMessage = "Troppi tentativi. Riprova tra un minuto."
        case APIError.http(401, let code?) where code.localizedCaseInsensitiveContains("LINK"):
            errorMessage = "Questa e-mail è già registrata con un altro metodo di accesso. Usa quello con cui ti eri registrato."
        default:
            errorMessage = "Non è andata a buon fine. Riprova tra un momento."
        }
    }

    func clearError() { errorMessage = nil }

    private func open(provider: String, idToken: String, nonce: String, firstName: String?, lastName: String?) async throws {
        errorMessage = nil
        let bearer = try await api.signInSocial(
            provider: provider, idToken: idToken, nonce: nonce, firstName: firstName, lastName: lastName)
        Keychain.write(bearer)
        api.bearer = bearer
        guard let user = try await api.meState().user else { throw APIError.http(status: 401, code: nil) }
        state = .signedIn(user)
        expiredNotice = false
        presentSignIn = false
        successCount += 1
    }
}
