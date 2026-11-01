import Foundation

// Salvati: chiamate al server e istantanee. Specchio di lib/saved/* (22 D-02/D-05/D-06/D-07).

/// Una riga di POST /api/v1/saved/resolve o di GET /api/v1/me/saved. `siblings` (serie) e' ignorato di proposito.
public struct SavedItem: Codable, Hashable, Sendable {
    /// Ospite: l'id salvato sul telefono. Account: l'id della riga salvata (serve a toglierla se l'evento e' sparito).
    public let ref: Int
    /// Id canonico dell'evento vivo; nil se la riga non esiste piu'.
    public let eventId: Int?
    public let savedAt: String?
    public let snap: Snap?
    public let live: Snap?
}

private struct Items: Decodable { let items: [SavedItem] }
private struct Ids: Decodable { let ids: [Int] }
private struct Added: Decodable { let added: Int }

extension Snap {
    /// Come snapFromEvent del server, ma dall'evento che l'utente ha davanti. nil senza la chiave (source, sourceId):
    /// una istantanea senza chiave non si puo' ne' unire ne' riconoscere. L'URL della fonte solo se http(s).
    public init?(event: Event) {
        guard let source = event.source, let sourceId = event.sourceId, !source.isEmpty, !sourceId.isEmpty else { return nil }
        let url = event.sourceUrl.flatMap { u -> String? in
            let l = u.lowercased()
            return (l.hasPrefix("http://") || l.hasPrefix("https://")) ? u : nil
        }
        self.init(
            title: event.title, dateStart: event.dateStart, dateEnd: event.dateEnd, place: event.locationName,
            category: event.canonicalCategory ?? event.category ?? "Altro",
            source: source, sourceId: sourceId, sourceUrl: url)
    }
}

extension APIClient {
    /// Pubblica e senza identita': gli id vanno nel CORPO (una query string finirebbe nel log di nginx per 14 giorni).
    /// Da 1 a 100 id per chiamata; il bearer non parte mai (percorso non personale).
    public func resolve(ids: [Int]) async throws -> [SavedItem] {
        let (data, _) = try await send(post: "api/v1/saved/resolve", json: ["ids": ids])
        do { return try JSONDecoder().decode(Items.self, from: data).items } catch { throw APIError.decoding }
    }
}
