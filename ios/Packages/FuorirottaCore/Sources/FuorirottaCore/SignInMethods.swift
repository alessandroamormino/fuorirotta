import Foundation

/// I due metodi di accesso (Apple prima di Google, come sul sito).
public enum SignInProvider: String, CaseIterable, Sendable {
    case apple, google

    public var name: String { self == .apple ? "Apple" : "Google" }
}

/// Una riga di `GET /api/auth/list-accounts` (nessun token: il server non li restituisce). `id` e' quello della RIGA,
/// che serve a scollegare (non il `sub` del provider).
public struct LinkedAccount: Decodable, Equatable, Sendable {
    public let id: String
    public let providerId: String

    public init(id: String, providerId: String) {
        self.id = id
        self.providerId = providerId
    }
}

/// Quali metodi sono collegati e quali si possono scollegare: come SignInMethods del sito, ma la regola dell'ultimo
/// metodo e' quella del server (una riga qualunque basta perche' un'altra non sia l'ultima).
public struct SignInMethods: Equatable, Sendable {
    public let accounts: [LinkedAccount]

    public init(accounts: [LinkedAccount] = []) { self.accounts = accounts }

    public func accountId(_ provider: SignInProvider) -> String? {
        accounts.first { $0.providerId == provider.rawValue }?.id
    }

    public func isLinked(_ provider: SignInProvider) -> Bool { accountId(provider) != nil }

    public func canUnlink(_ provider: SignInProvider) -> Bool { isLinked(provider) && accounts.count >= 2 }
}

/// Il messaggio per un collegamento riuscito male. Il provider ha gia' fatto il suo passo: qui conta cosa ha detto il server.
public func linkFailureMessage(_ error: Error, provider: SignInProvider) -> String {
    if case APIError.http(let status, let code) = error {
        if status == 409 || code?.localizedCaseInsensitiveContains("ALREADY_LINKED") == true {
            return String(localized: "Questo account \(provider.name) è già collegato a un altro profilo di Fuorirotta.", bundle: .main)
        }
        if code == "LINKING_NOT_ALLOWED" { return String(localized: "\(provider.name) non ha confermato l'e-mail: non possiamo collegarlo.", bundle: .main) }
        if status == 429 { return String(localized: "Troppi tentativi. Riprova tra un minuto.", bundle: .main) }
    }
    return String(localized: "Non è andata a buon fine. Riprova tra un momento.", bundle: .main)
}
