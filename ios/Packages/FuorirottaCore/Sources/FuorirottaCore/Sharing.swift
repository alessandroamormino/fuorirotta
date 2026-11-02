import Foundation

// Salvati: il link pubblico della lista e il feed del calendario (UAT7 B2), come ShareListDialog.tsx e
// CalendarFeedDialog.tsx. Il server da' solo il percorso (/l/<codice>, /cal/<codice>.ics): l'indirizzo intero
// si compone qui sulla base dell'API, e un percorso con un'altra forma non diventa mai un indirizzo.

/// Il link della lista: `path` /l/<codice>, `showName` = la pagina pubblica mostra il nome del proprietario.
public struct ShareLinkInfo: Decodable, Equatable, Sendable {
    public let path: String
    public let showName: Bool

    public init(path: String, showName: Bool) { self.path = path; self.showName = showName }
}

/// GET /api/v1/me/share: il link (nil = non ancora creato o disattivato) e quanti eventi in arrivo vedrebbe chi lo apre.
public struct ShareState: Decodable, Equatable, Sendable {
    public var link: ShareLinkInfo?
    public let upcoming: Int

    public init(link: ShareLinkInfo?, upcoming: Int) { self.link = link; self.upcoming = upcoming }
}

struct FeedPath: Decodable { let path: String }
struct ShowName: Decodable { let showName: Bool }

/// https://<sito>/l/<codice>. nil se il percorso non e' quello di una lista (come parseLink del sito).
public func shareURL(base: URL, path: String) -> URL? {
    guard path.hasPrefix("/l/"), path.count > 3, !path.contains("?"), !path.contains("#") else { return nil }
    return URL(string: base.absoluteString.trimmingSuffix("/") + path)
}

/// L'indirizzo del feed da copiare (Google Calendar lo vuole http/https). nil se non e' un /cal/.
public func feedURL(base: URL, path: String) -> URL? {
    guard path.hasPrefix("/cal/"), path.count > 5, !path.contains("?"), !path.contains("#") else { return nil }
    return URL(string: base.absoluteString.trimmingSuffix("/") + path)
}

/// webcal://<host[:porta]>/cal/<codice>.ics: aperto da iOS propone l'iscrizione in Calendario (come il sito).
public func webcalURL(base: URL, path: String) -> URL? {
    guard let feed = feedURL(base: base, path: path), var comps = URLComponents(url: feed, resolvingAgainstBaseURL: false) else { return nil }
    comps.scheme = "webcal"
    return comps.url
}

extension String {
    fileprivate func trimmingSuffix(_ suffix: String) -> String { hasSuffix(suffix) ? String(dropLast(suffix.count)) : self }
}

extension APIClient {
    /// Legge soltanto: aprire la condivisione non crea nulla (D-02).
    public func shareState() async throws -> ShareState {
        try await get(baseURL.appendingPathComponent("api/v1/me/share"), as: ShareState.self)
    }

    /// Crea il link (o restituisce quello che c'e').
    public func createShareLink() async throws -> ShareLinkInfo {
        try await decode(send(post: "api/v1/me/share", body: Data("{}".utf8)).0)
    }

    /// Nuovo codice: il vecchio indirizzo smette subito di funzionare. 404 = nessun link da rigenerare.
    public func rotateShareLink() async throws -> ShareLinkInfo {
        try await decode(send(post: "api/v1/me/share/rotate", body: Data("{}".utf8)).0)
    }

    /// Disattiva il link: chi lo aveva trova la stessa pagina di un codice mai esistito.
    public func deleteShareLink() async throws {
        _ = try await send(method: "DELETE", path: "api/v1/me/share")
    }

    /// Mostra o nasconde il nome sulla pagina pubblica; 404 = il link non c'e' piu'.
    public func setShareShowsName(_ on: Bool) async throws -> Bool {
        let body = try JSONSerialization.data(withJSONObject: ["showName": on])
        let reply: ShowName = try decode(try await send(method: "PATCH", path: "api/v1/me/share", body: body).0)
        return reply.showName
    }

    /// Il percorso del feed dell'account, lo stesso a ogni apertura finche' non si rigenera (si crea alla prima).
    public func calendarFeed() async throws -> String {
        let reply: FeedPath = try decode(try await send(post: "api/v1/me/calendar-feed", body: Data("{}".utf8)).0)
        return reply.path
    }

    /// Nuovo codice del feed: i calendari iscritti col vecchio smettono di aggiornarsi.
    public func rotateCalendarFeed() async throws -> String {
        let reply: FeedPath = try decode(try await send(post: "api/v1/me/calendar-feed/rotate", body: Data("{}".utf8)).0)
        return reply.path
    }

    func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw APIError.decoding }
    }
}
