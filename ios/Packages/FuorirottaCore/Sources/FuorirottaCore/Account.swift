import Foundation

// Account (UAT7 B3), come ProfileCard.tsx, SessionsList.tsx e AccountActions.tsx: nome, sessioni attive, esportazione.

/// La regola del nome di lib/displayName.ts: NFC, spazi tolti ai lati, niente caratteri di controllo ne' override
/// bidirezionali, da 1 a 50 PUNTI DI CODICE (come conta Postgres). nil = non valido; altrimenti il nome da inviare.
public func normalizedDisplayName(_ raw: String) -> String? {
    let text = raw.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
    let forbidden = text.unicodeScalars.contains { s in
        s.properties.generalCategory == .control || (0x202A...0x202E).contains(s.value) || (0x2066...0x2069).contains(s.value)
    }
    guard !forbidden, (1...50).contains(text.unicodeScalars.count) else { return nil }
    return text
}

/// Una riga di GET /api/v1/me/sessions. `device` e' l'etichetta del server ("Safari su Mac", "App iPhone").
public struct SessionInfo: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let device: String
    /// phone | tablet | desktop
    public let kind: String
    public let lastActive: Date
    public let current: Bool

    private enum CodingKeys: String, CodingKey { case id, device, kind, lastActive, current }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        device = try c.decode(String.self, forKey: .device)
        kind = try c.decode(String.self, forKey: .kind)
        current = try c.decode(Bool.self, forKey: .current)
        let raw = try c.decode(String.self, forKey: .lastActive)
        guard let date = parseISO(raw) else {
            throw DecodingError.dataCorruptedError(forKey: .lastActive, in: c, debugDescription: "data illeggibile")
        }
        lastActive = date
    }
}

struct SessionList: Decodable { let sessions: [SessionInfo] }
struct NameReply: Decodable { let name: String }
struct RevokeReply: Decodable { let revoked: Int }

/// Il nome del file dell'esportazione: quello di Content-Disposition se ha la forma attesa, altrimenti lo stesso nome
/// con la data di Roma (come exportFileName del sito). Mai un percorso: solo lettere, cifre, punto, trattino, trattino basso.
public func exportFileName(disposition: String?, now: Date = .now) -> String {
    if let disposition, let match = disposition.firstMatch(of: /filename="?([A-Za-z0-9._-]+)"?/) {
        let name = String(match.1)
        if name != "." && name != ".." { return name }
    }
    return "fuorirotta-dati-\(romeToday(now: now)).json"
}

extension APIClient {
    /// Cambia il nome visualizzato; torna il nome salvato (normalizzato dal server).
    public func renameProfile(_ name: String) async throws -> String {
        let body = try JSONSerialization.data(withJSONObject: ["name": name])
        let reply: NameReply = try decode(try await send(method: "PATCH", path: "api/v1/me/profile", body: body).0)
        return reply.name
    }

    /// Sessioni non scadute: la corrente per prima, poi la piu' recente.
    public func sessions() async throws -> [SessionInfo] {
        try await get(baseURL.appendingPathComponent("api/v1/me/sessions"), as: SessionList.self).sessions
    }

    /// Esce da UN altro dispositivo. L'id va nel percorso (come sul sito): solo se ha la forma di un id di sessione.
    public func revokeSession(id: String) async throws {
        guard id.wholeMatch(of: /[A-Za-z0-9_-]{1,64}/) != nil else { throw APIError.http(status: 404, code: "not-found") }
        _ = try await send(method: "DELETE", path: "api/v1/me/sessions/\(id)")
    }

    /// Esce da tutti gli altri dispositivi: resta solo questo. Torna quante sessioni ha chiuso.
    @discardableResult
    public func revokeOtherSessions() async throws -> Int {
        let reply: RevokeReply = try decode(try await send(method: "DELETE", path: "api/v1/me/sessions").0)
        return reply.revoked
    }

    /// Tutti i dati dell'account (JSON) e il nome del file da dare al foglio di condivisione.
    public func exportData() async throws -> (data: Data, fileName: String) {
        let (data, http) = try await perform(URLRequest(url: baseURL.appendingPathComponent("api/v1/me/export")))
        return (data, exportFileName(disposition: http.value(forHTTPHeaderField: "Content-Disposition")))
    }
}
