import Foundation

// "Ci sono stato": chiamate al server. Specchio di Saves.swift, stessi tetti e stessi errori (27.1, D-07).
// Nessun percorso porta una query string: gli id stanno nel percorso o nel corpo (T-27.1-29).

/// Una riga di GET /api/v1/me/visited. `ref` e' l'id della riga (serve a toglierla se l'evento e' sparito);
/// `eventId` e' l'id canonico dell'evento vivo, nil se la riga e' stata purgata.
public struct VisitedItem: Codable, Hashable, Sendable {
    public let ref: Int
    public let eventId: Int?
    public let visitedAt: String
    /// "YYYY-MM-DD" (Roma): il giorno scelto al segno, mai ricalcolato (D-05).
    public let visitDay: String
    public let snap: Snap
    public let imageUrl: String?
}

private struct VisitedItems: Decodable { let items: [VisitedItem] }
private struct VisitedAdded: Decodable { let added: Int }

extension APIClient {
    /// La lista dell'account. Richiede il bearer.
    public func visitedList() async throws -> [VisitedItem] {
        try await get(baseURL.appendingPathComponent("api/v1/me/visited"), as: VisitedItems.self).items
    }

    /// 409 {error:"cap"} al tetto di 500, 409 {error:"too-early"} prima del primo giorno, 404 se l'evento non esiste piu'.
    public func markVisited(id: Int) async throws {
        _ = try await send(method: "PUT", path: "api/v1/me/visited/\(id)")
    }

    public func unmarkVisited(id: Int) async throws {
        _ = try await send(method: "DELETE", path: "api/v1/me/visited/\(id)")
    }

    /// Dalla riga di Salvati: `ref` e' l'id della riga salvata, anche se l'evento e' sparito.
    public func markVisitedFromSaved(ref: Int) async throws {
        _ = try await send(method: "PUT", path: "api/v1/me/visited/saved/\(ref)")
    }

    /// Una riga di sola istantanea: `ref` e' l'id della riga visitata, non dell'evento.
    public func unmarkVisitedGone(ref: Int) async throws {
        _ = try await send(method: "DELETE", path: "api/v1/me/visited/gone/\(ref)")
    }

    /// Unisce i segni del telefono nell'account; idempotente sul server. Ritorna quanti sono entrati davvero.
    public func mergeVisited(_ entries: [DeviceEntry]) async throws -> Int {
        let body = try JSONEncoder().encode(["items": entries])
        let (data, _) = try await send(method: "POST", path: "api/v1/me/visited/merge", body: body)
        do { return try JSONDecoder().decode(VisitedAdded.self, from: data).added } catch { throw APIError.decoding }
    }
}

/// Lo stesso testo del web; nessun avviso se non e' entrato nulla.
public func mergeVisitedMessage(added: Int) -> String? {
    switch added {
    case ..<1: nil
    case 1: String(localized: "1 evento aggiunto ai visitati", bundle: .main)
    default: String(localized: "\(added) eventi aggiunti ai visitati", bundle: .main)
    }
}
