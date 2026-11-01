import AuthenticationServices
import FuorirottaCore
import GoogleSignIn
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
    /// Un'eliminazione alla volta (MOB-05): mentre la richiesta e' in volo un secondo tocco non fa nulla.
    private(set) var isDeleting = false

    private let api: APIClient
    private let saves: SavesModel
    private let push: PushRegistration
    // Un solo accesso alla volta: due tocchi rapidi non devono lanciare due flussi.
    private var busy = false

    init(api: APIClient, saves: SavesModel, push: PushRegistration) {
        self.api = api
        self.saves = saves
        self.push = push
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
                await saves.didSignIn()  // un'unione rimasta a meta' (app chiusa tra il 2xx e lo svuotamento) si ripete qui
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

    func signInWithGoogle() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        guard let presenter = UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first
        else { return fail(APIError.network) }
        let raw = randomNonce()
        do {
            // Il nonce grezzo finisce nell'id token; il server lo confronta uguale (Google non lo fa hashare).
            let result = try await GIDSignIn.sharedInstance.signIn(
                withPresenting: presenter, hint: nil, additionalScopes: nil, nonce: raw)
            guard let idToken = result.user.idToken?.tokenString else { return fail(APIError.decoding) }
            try await open(provider: "google", idToken: idToken, nonce: raw, firstName: nil, lastName: nil)
        } catch {
            fail(error)
        }
    }

    func signOut() async {
        // Prima il telefono esce dalle notifiche (26 D-08/D-10): dopo, il bearer non c'e' piu'.
        await push.unregister()
        do { try await api.signOut() } catch { print("sign-out fallito: \(error)") }
        Keychain.delete()
        api.bearer = nil
        state = .signedOut
        await saves.didSignOut()
    }

    /// Elimina l'account sul server. Solo dopo un 2xx si cancella cio' che resta sul telefono (T-27-32, T-27-33).
    /// true = fatto; false = account e sessione intatti (o sessione scaduta, e allora si torna ospite).
    func deleteAccount() async -> Bool {
        guard !isDeleting else { return false }
        isDeleting = true; defer { isDeleting = false }
        do {
            try await api.deleteUser()
        } catch {
            if case APIError.http(401, _) = error { handleUnauthorized() } else { errorCount += 1 }
            return false
        }
        // Il server ha gia' tolto utente, salvati e dispositivi (cascata): sul telefono non resta nulla di personale.
        Keychain.delete()
        api.bearer = nil
        push.forget()
        await saves.didSignOut()
        URLCache.shared.removeAllCachedResponses()
        try? FileManager.default.removeItem(at: URL.cachesDirectory.appending(path: "fuorirotta"))
        UserDefaults.standard.removeObject(forKey: "fr.recentQueries")
        state = .signedOut
        expiredNotice = false
        return true
    }

    func handleUnauthorized() {
        Keychain.delete()
        api.bearer = nil
        if state != .signedOut {
            expiredNotice = true
            // La sessione e' finita: dell'account non resta nulla sul telefono.
            Task { await saves.didSignOut() }
        }
        state = .signedOut
    }

    /// Chiamata da ProfileView quando mostra il banner di scadenza.
    func consumeExpiredNotice() { expiredNotice = false }

    /// Cancel dell'utente: nessun messaggio e nessun cambiamento. Il resto: il testo documentato.
    func fail(_ error: Error) {
        if (error as? ASAuthorizationError)?.code == .canceled || (error as? GIDSignInError)?.code == .canceled { return }
        errorCount += 1
        switch error {
        case APIError.http(429, _):
            errorMessage = String(localized: "Troppi tentativi. Riprova tra un minuto.")
        case APIError.http(401, let code?) where code.localizedCaseInsensitiveContains("LINK"):
            errorMessage = String(localized: "Questa e-mail è già registrata con un altro metodo. Entra con quello e collega questo da Impostazioni > Metodi di accesso.")
        default:
            errorMessage = String(localized: "Non è andata a buon fine. Riprova tra un momento.")
        }
    }

    func clearError() { errorMessage = nil }

    // MARK: metodi di accesso (UAT 2)
    // Collegare un secondo metodo e' sempre un gesto esplicito dalla sessione aperta (AUTH-07): l'id token lo verifica il
    // server, che rifiuta senza sessione. Nessun collegamento avviene all'accesso.

    enum LinkOutcome: Equatable {
        case linked, canceled
        case failed(String)
    }

    /// Nil se la richiesta non riesce (rete, sessione scaduta): la schermata mostra "non disponibile", non un elenco vuoto.
    func signInMethods() async -> SignInMethods? {
        guard let rows = try? await api.listAccounts() else { return nil }
        return SignInMethods(accounts: rows)
    }

    func link(_ provider: SignInProvider) async -> LinkOutcome {
        guard !busy else { return .canceled }
        busy = true; defer { busy = false }
        let raw = randomNonce()
        do {
            switch provider {
            case .apple:
                let credential = try await AppleCredentialRequester().request(rawNonce: raw)
                guard let tokenData = credential.identityToken, let idToken = String(data: tokenData, encoding: .utf8) else {
                    return .failed(linkFailureMessage(APIError.decoding, provider: provider))
                }
                try await api.linkSocial(provider: "apple", idToken: idToken, nonce: raw)
                // Come all'accesso: il codice serve una volta sola, perche' l'eliminazione dell'account possa revocare Apple.
                if let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8) {
                    do { try await api.appleToken(code: code) } catch { print("apple-token fallito: \(error)") }
                }
            case .google:
                guard let presenter = UIApplication.shared.connectedScenes
                    .compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first
                else { return .failed(linkFailureMessage(APIError.network, provider: provider)) }
                let result = try await GIDSignIn.sharedInstance.signIn(
                    withPresenting: presenter, hint: nil, additionalScopes: nil, nonce: raw)
                guard let idToken = result.user.idToken?.tokenString else {
                    return .failed(linkFailureMessage(APIError.decoding, provider: provider))
                }
                try await api.linkSocial(provider: "google", idToken: idToken, nonce: raw)
            }
            successCount += 1
            return .linked
        } catch {
            if (error as? ASAuthorizationError)?.code == .canceled || (error as? GIDSignInError)?.code == .canceled { return .canceled }
            errorCount += 1
            return .failed(linkFailureMessage(error, provider: provider))
        }
    }

    /// true = scollegato. Il server rifiuta l'ultimo metodo; il Portachiavi e la sessione non si toccano.
    func unlink(_ provider: SignInProvider, in methods: SignInMethods) async -> Bool {
        guard !busy, methods.canUnlink(provider), let id = methods.accountId(provider) else { return false }
        busy = true; defer { busy = false }
        do {
            try await api.unlinkAccount(id: id)
            successCount += 1
            return true
        } catch {
            errorCount += 1
            return false
        }
    }

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
        await saves.didSignIn()
        await push.refreshIfAuthorised()
    }
}

/// "Collega Apple" da un pulsante qualunque (i pulsanti SwiftUI di Apple fanno solo l'accesso). Un uso e via.
@MainActor
final class AppleCredentialRequester: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?
    // Il controller va tenuto vivo finche' Apple non risponde.
    private var controller: ASAuthorizationController?

    func request(rawNonce: String) async throws -> ASAuthorizationAppleIDCredential {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email]
        request.nonce = sha256Hex(rawNonce)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            continuation?.resume(throwing: APIError.decoding)
            continuation = nil
            return
        }
        continuation?.resume(returning: credential)
        continuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }
}
