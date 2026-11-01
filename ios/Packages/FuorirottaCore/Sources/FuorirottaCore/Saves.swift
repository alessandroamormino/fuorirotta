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

extension APIClient {
    /// La lista dell'account: istantanea salvata + istantanea viva. Richiede il bearer.
    public func savedList() async throws -> [SavedItem] {
        try await get(baseURL.appendingPathComponent("api/v1/me/saved"), as: Items.self).items
    }

    /// Id canonici salvati dall'account, per accendere i segnalibri.
    public func savedIds() async throws -> [Int] {
        try await get(baseURL.appendingPathComponent("api/v1/me/saved/ids"), as: Ids.self).ids
    }

    /// 409 {error:"cap"} al tetto di 500, 404 se l'evento non esiste piu'.
    public func save(id: Int) async throws {
        _ = try await send(method: "PUT", path: "api/v1/me/saved/\(id)")
    }

    public func unsave(id: Int) async throws {
        _ = try await send(method: "DELETE", path: "api/v1/me/saved/\(id)")
    }

    /// Una riga di sola istantanea (l'evento e' stato eliminato): `ref` e' l'id della riga, non dell'evento.
    public func removeGone(ref: Int) async throws {
        _ = try await send(method: "DELETE", path: "api/v1/me/saved/gone/\(ref)")
    }

    /// Unisce la lista del telefono nell'account; idempotente sul server. Ritorna quante righe sono entrate davvero.
    public func merge(_ entries: [DeviceEntry]) async throws -> Int {
        let body = try JSONEncoder().encode(["items": entries])
        let (data, _) = try await send(method: "POST", path: "api/v1/me/saved/merge", body: body)
        do { return try JSONDecoder().decode(Added.self, from: data).added } catch { throw APIError.decoding }
    }
}

public enum MergeOutcome: Equatable, Sendable {
    case nothing
    case merged(Int)
    case failed
}

/// L'unione dell'ospite: la lista del telefono parte UNA volta, si svuota solo dopo un 2xx (T-27-22).
/// Se l'app muore tra il 2xx e lo svuotamento, la prossima volta il corpo e' lo stesso e il server risponde added 0.
/// Si tolgono solo gli id inviati: un salvataggio fatto mentre la richiesta era in volo resta.
public func mergeGuestSaves(store: GuestStore, send: @Sendable ([DeviceEntry]) async throws -> Int) async -> MergeOutcome {
    let payload = await store.mergePayload()
    guard !payload.isEmpty else { return .nothing }
    do {
        let added = try await send(payload)
        await store.remove(ids: Set(payload.map(\.id)))
        return .merged(added)
    } catch {
        return .failed
    }
}

/// Lo stesso testo del web; nessun avviso se non e' entrato nulla.
public func mergeMessage(added: Int) -> String? {
    switch added {
    case ..<1: nil
    case 1: "1 evento aggiunto ai salvati"
    default: "\(added) eventi aggiunti ai salvati"
    }
}
