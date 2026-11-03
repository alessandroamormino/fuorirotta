import CryptoKit
import Foundation
import Security

// Client dell'API pubblica di Fuorirotta. Solo Foundation, cosi' `swift test` gira anche sul Mac.
// Regole del contratto (lib/api-contract.ts): sessione senza cookie, User-Agent dell'app.

public enum APIError: Error, Sendable, Equatable {
    case http(status: Int, code: String?)
    case network
    case decoding
}

public struct Event: Codable, Identifiable, Hashable, Sendable {
    public let id: Int
    public let title: String
    public let dateStart: String
    public let dateEnd: String?
    public let imageUrl: String?
    public let locationName: String?
    public let address: String?
    public let canonicalCategory: String?
    public let category: String?
    public let latitude: Double?
    public let longitude: Double?
    public let resolvedLatitude: Double?
    public let resolvedLongitude: Double?
    public let sourceUrl: String?
    public let description: String?
    // Servono a Snap(event:) (Salvati): la chiave naturale dell'evento, come sul web.
    public var source: String? = nil
    public var sourceId: String? = nil
    /// Solo da GET /api/events/{id} (UAT7 B1): il comune agganciato, null per gli eventi senza. Serve a "Segui".
    public var comune: EventComune? = nil
    /// Il telefono della fonte, com'e' (UAT7 C1): il sito lo mostra cosi'. `$.phone` e' gia' nei golden dell'evento.
    public var phone: String? = nil
}

/// Il comune di un evento, con le chiavi dei follow (ISTAT e sigla). Chiavi = ApiContract.eventComuneKeys.
/// La lista (GET /api/events) ne manda solo `name` e `provinceCode`: gli altri due arrivano solo dal dettaglio.
public struct EventComune: Codable, Hashable, Sendable {
    public let istatCode: String?
    public let name: String
    public let provinceCode: String
    public let provinceName: String?

    enum CodingKeys: String, CodingKey, CaseIterable { case istatCode, name, provinceCode, provinceName }

    public init(istatCode: String?, name: String, provinceCode: String, provinceName: String?) {
        self.istatCode = istatCode; self.name = name; self.provinceCode = provinceCode; self.provinceName = provinceName
    }
}

extension Event {
    /// Un evento con i soli campi che un pin o una riga di Salvati conoscono; il resto arriva da `event(id:)`.
    public init(
        id: Int, title: String, dateStart: String, dateEnd: String? = nil, imageUrl: String? = nil,
        locationName: String? = nil, category: String? = nil, latitude: Double? = nil, longitude: Double? = nil
    ) {
        self.init(
            id: id, title: title, dateStart: dateStart, dateEnd: dateEnd, imageUrl: imageUrl, locationName: locationName,
            address: nil, canonicalCategory: category, category: category, latitude: nil, longitude: nil,
            resolvedLatitude: latitude, resolvedLongitude: longitude, sourceUrl: nil, description: nil)
    }
}

public struct MapPin: Codable, Identifiable, Hashable, Sendable {
    public let id: Int
    public let title: String
    public let category: String?
    public let imageUrl: String?
    public let dateStart: String
    public let locationName: String?
    public let lat: Double?
    public let lng: Double?

    private enum CodingKeys: String, CodingKey {
        case id, title, category, imageUrl, dateStart, locationName
        case latitude, longitude, resolvedLatitude, resolvedLongitude
    }

    public init(
        id: Int, title: String, category: String?, imageUrl: String?, dateStart: String,
        locationName: String?, lat: Double?, lng: Double?
    ) {
        self.id = id; self.title = title; self.category = category; self.imageUrl = imageUrl
        self.dateStart = dateStart; self.locationName = locationName; self.lat = lat; self.lng = lng
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        dateStart = try c.decode(String.self, forKey: .dateStart)
        locationName = try c.decodeIfPresent(String.self, forKey: .locationName)
        // Le coordinate risolte (comune) vincono su quelle della fonte.
        lat = try c.decodeIfPresent(Double.self, forKey: .resolvedLatitude)
            ?? c.decodeIfPresent(Double.self, forKey: .latitude)
        lng = try c.decodeIfPresent(Double.self, forKey: .resolvedLongitude)
            ?? c.decodeIfPresent(Double.self, forKey: .longitude)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encodeIfPresent(category, forKey: .category)
        try c.encodeIfPresent(imageUrl, forKey: .imageUrl)
        try c.encode(dateStart, forKey: .dateStart)
        try c.encodeIfPresent(locationName, forKey: .locationName)
        try c.encodeIfPresent(lat, forKey: .resolvedLatitude)
        try c.encodeIfPresent(lng, forKey: .resolvedLongitude)
    }
}

public struct EventsPage: Codable, Sendable {
    public let events: [Event]
    public let mapEvents: [MapPin]
    public let total: Int
}

/// Differenza tra i pin gia' sulla mappa e quelli in arrivo: la mappa aggiunge e toglie solo questa, mai tutto.
/// I pin senza coordinate non si possono mostrare e vengono ignorati.
public func pinDelta(existing: Set<Int>, incoming: [MapPin]) -> (add: [MapPin], remove: [Int]) {
    let shown = incoming.filter { $0.lat != nil && $0.lng != nil }
    let ids = Set(shown.map(\.id))
    return (shown.filter { !existing.contains($0.id) }, existing.filter { !ids.contains($0) }.sorted())
}

/// /api/events/clusters: tutti i pin (GeoJSON) con l'istante di calcolo, usato anche come chiave di cache.
/// Un file non ancora calcolato risponde `geojson: null`: e' "nessun dato" (set vuoto, `computedAt` vuoto), non un errore.
public struct ClusterSet: Sendable {
    public let computedAt: String
    public let pins: [MapPin]

    public init(computedAt: String, pins: [MapPin]) {
        self.computedAt = computedAt
        self.pins = pins
    }

    init(_ env: ClusterEnvelope) {
        computedAt = env.computedAt ?? ""
        // Il file scrive "" per i campi mancanti (lib/clusterCache.ts): per l'app sono assenti, la categoria e' "Altro".
        func present(_ s: String?) -> String? { s.flatMap { $0.isEmpty ? nil : $0 } }
        pins = (env.geojson?.features ?? []).compactMap { f -> MapPin? in
            guard f.geometry.coordinates.count >= 2 else { return nil }
            let p = f.properties
            return MapPin(
                id: p.id, title: p.title, category: present(p.category) ?? "Altro", imageUrl: present(p.imageUrl),
                dateStart: p.dateStart, locationName: present(p.locationName),
                lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0]
            )
        }
    }
}

/// Esito di GET /api/events/clusters.
public enum ClusterFetch: Sendable {
    case fresh(ClusterSet, etag: String?)
    case notModified
    /// Risposta valida ma senza dati (`geojson: null`): non e' un errore.
    case empty
}

struct ClusterEnvelope: Decodable {
    struct Feature: Decodable {
        struct Geometry: Decodable { let coordinates: [Double] }
        struct Props: Decodable {
            let id: Int
            let title: String
            let category: String?
            let imageUrl: String?
            let dateStart: String
            let locationName: String?
        }
        let geometry: Geometry
        let properties: Props
    }
    struct Collection: Decodable { let features: [Feature] }
    let computedAt: String?
    let geojson: Collection?
}

/// Esito di GET /api/events/{id}: l'evento, oppure 404 (cancellato). Gli altri errori sono eccezioni.
public enum EventLookup: Sendable {
    case found(Event)
    case gone
}

/// GET /api/v1/me/feed.
public struct FeedPage: Decodable, Sendable {
    public let items: [Event]
    public let total: Int
    public let follows: Int
}

/// GET /api/v1/config. Una soglia mancante o malformata e' nil; uno `status` sconosciuto vale come assente.
public struct AppConfig: Decodable, Equatable, Sendable {
    public enum Status: String, Sendable { case ok, updateRecommended = "update-recommended", updateRequired = "update-required" }

    public let minimumVersion: String?
    public let recommendedVersion: String?
    public let status: Status?

    private enum CodingKeys: String, CodingKey { case minimumVersion, recommendedVersion, status }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        minimumVersion = try c.decodeIfPresent(String.self, forKey: .minimumVersion)
        recommendedVersion = try c.decodeIfPresent(String.self, forKey: .recommendedVersion)
        status = (try? c.decodeIfPresent(String.self, forKey: .status)).flatMap(Status.init(rawValue:))
    }
}

/// Utente dell'account, da GET /api/v1/me/state. `plan` e `features` non condizionano nulla (D-04) e non si leggono.
public struct MeUser: Codable, Equatable, Sendable {
    public let name: String
    public let email: String
    public let image: String?

    /// Lo stesso utente col nome appena salvato (B3): la sessione si aggiorna senza rileggere /me/state.
    public func renamed(_ name: String) -> MeUser { MeUser(name: name, email: email, image: image) }
}

public struct MeState: Decodable, Sendable {
    public let enabled: Bool
    public let user: MeUser?
}

/// Nonce di un tentativo di accesso: 32 byte casuali, base64url senza padding. Mai riusato.
public func randomNonce() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
        fatalError("SecRandomCopyBytes ha fallito")  // ponytail: succede solo con il sistema compromesso
    }
    return Data(bytes).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

/// Apple riceve questo; il server riceve il valore grezzo (controllo "esatto o sha256").
public func sha256Hex(_ s: String) -> String {
    SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
}

/// Bearer e gestore del 401 condivisi da tutte le copie del client (e' una struct passata per valore).
private final class AuthBox: @unchecked Sendable {
    private let lock = NSLock()
    private var _bearer: String?
    private var _onUnauthorized: (@Sendable () -> Void)?
    var bearer: String? {
        get { lock.withLock { _bearer } }
        set { lock.withLock { _bearer = newValue } }
    }
    var onUnauthorized: (@Sendable () -> Void)? {
        get { lock.withLock { _onUnauthorized } }
        set { lock.withLock { _onUnauthorized = newValue } }
    }
}

public struct APIClient: Sendable {
    public let baseURL: URL
    private let session: URLSession
    private let auth = AuthBox()

    public init(baseURL: URL, appVersion: String, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.session = session ?? Self.makeSession(appVersion: appVersion)
    }

    /// Il bearer (valore di `set-auth-token`). Va solo su /api/v1/me/**, sign-out/delete-user e i metodi di accesso, mai su una rotta pubblica.
    public var bearer: String? {
        get { auth.bearer }
        nonmutating set { auth.bearer = newValue }
    }

    /// Chiamato quando una rotta con bearer risponde 401: la sessione e' finita, chi ascolta torna ospite.
    public var onUnauthorized: (@Sendable () -> Void)? {
        get { auth.onUnauthorized }
        nonmutating set { auth.onUnauthorized = newValue }
    }

    /// "FuoriRotta/<versione> (iOS; iPhone)": deve esistere prima del primo accesso (APP_USER_AGENT_RE).
    public static func userAgent(version: String) -> String {
        "FuoriRotta/\(version) (iOS; iPhone)"
    }

    /// Sessione effimera SENZA cookie: con un Cookie il server tratta la richiesta come un browser.
    /// `protocolClasses` serve solo ai test.
    public static func makeSession(appVersion: String, protocolClasses: [AnyClass]? = nil) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.httpAdditionalHeaders = ["User-Agent": userAgent(version: appVersion)]
        if let protocolClasses { config.protocolClasses = protocolClasses }
        return URLSession(configuration: config)
    }

    /// Solo lat, lng, radius, dateFrom, dateTo, limit: mai i parametri che avviano uno scraping in background.
    public func events(
        lat: Double, lng: Double, radiusKm: Int,
        dateFrom: String? = nil, dateTo: String? = nil, limit: Int
    ) async throws -> EventsPage {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/events"), resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "lat", value: coarseCoordinate(lat)),
            URLQueryItem(name: "lng", value: coarseCoordinate(lng)),
            URLQueryItem(name: "radius", value: String(radiusKm)),
        ]
        if let dateFrom { items.append(URLQueryItem(name: "dateFrom", value: dateFrom)) }
        if let dateTo { items.append(URLQueryItem(name: "dateTo", value: dateTo)) }
        items.append(URLQueryItem(name: "limit", value: String(limit)))
        comps.queryItems = items
        return try await get(comps.url!, as: EventsPage.self)
    }

    /// Solo i pin attorno a un punto: la stessa chiamata con limit 1 e nessuna data (i pin non sono limitati).
    public func mapPins(lat: Double, lng: Double, radiusKm: Int) async throws -> [MapPin] {
        try await events(lat: lat, lng: lng, radiusKm: radiusKm, limit: 1).mapEvents
    }

    /// Tutti i pin (circa 9.000, 2,6 MB senza compressione). Le feature senza due coordinate si saltano.
    /// `ifNoneMatch` e' l'ETag della copia che l'app ha su disco: il server risponde 304 e il file non si scarica.
    /// La cache di URLSession e' spenta: la copia buona e' quella su disco, non una che decide il sistema.
    public func clusters(ifNoneMatch: String?) async throws -> ClusterFetch {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/events/clusters"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let ifNoneMatch { request.setValue(ifNoneMatch, forHTTPHeaderField: "If-None-Match") }
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await perform(request)
        } catch APIError.http(status: 304, _) {
            return .notModified
        }
        guard let env = try? JSONDecoder().decode(ClusterEnvelope.self, from: data) else { throw APIError.decoding }
        guard env.geojson != nil else { return .empty }
        return .fresh(ClusterSet(env), etag: http.value(forHTTPHeaderField: "ETag"))
    }

    /// Un evento con tutti i campi. Un membro fuso risponde 307 verso l'id canonico: URLSession lo segue da solo.
    public func event(id: Int) async throws -> EventLookup {
        do {
            return .found(try await get(baseURL.appendingPathComponent("api/events/\(id)"), as: Event.self))
        } catch APIError.http(status: 404, _) {
            return .gone
        }
    }

    /// Ricerca libera su tutto il catalogo: nessuna posizione e nessun filtro di zona (T-27-30). Nessun bearer.
    public func search(q: String, limit: Int) async throws -> [Event] {
        try await search(SearchFilters(text: q), limit: limit)
    }

    /// Ricerca con filtri (testo, date, raggio, categorie). La posizione parte solo se `near` e' acceso, e solo qui.
    /// Piu' categorie = una richiesta ciascuna, in parallelo, poi l'unione (il server ne accetta una per volta).
    public func search(_ filters: SearchFilters, limit: Int, now: Date = .now) async throws -> [Event] {
        func page(_ category: String?) async throws -> [Event] {
            var comps = URLComponents(url: baseURL.appendingPathComponent("api/events"), resolvingAgainstBaseURL: false)!
            comps.queryItems = filters.queryItems(category: category, limit: limit, now: now)
            return try await get(comps.url!, as: EventsPage.self).events
        }
        guard filters.categories.count > 1 else { return try await page(filters.categories.first) }
        let lists = try await withThrowingTaskGroup(of: [Event].self) { group in
            for category in filters.categories { group.addTask { try await page(category) } }
            return try await group.reduce(into: [[Event]]()) { $0.append($1) }
        }
        return mergeEvents(lists, from: filters.dateRange(now: now)?.from ?? romeToday(now: now), limit: limit)
    }

    /// Accesso nativo: il server verifica l'id token del provider e risponde col bearer nell'header `set-auth-token`.
    /// `user` (nome) parte solo se Apple l'ha dato, cioe' al primo accesso.
    public func signInSocial(
        provider: String, idToken: String, nonce: String, firstName: String?, lastName: String?
    ) async throws -> String {
        var token: [String: Any] = ["token": idToken, "nonce": nonce]
        if firstName != nil || lastName != nil {
            token["user"] = ["name": ["firstName": firstName ?? "", "lastName": lastName ?? ""]]
        }
        let (_, http) = try await send(post: "api/auth/sign-in/social", json: ["provider": provider, "idToken": token])
        guard let bearer = http.value(forHTTPHeaderField: "set-auth-token"), !bearer.isEmpty else {
            throw APIError.http(status: http.statusCode, code: "no-token")
        }
        return bearer
    }

    /// "Per te": gli eventi di cio' che l'utente segue. `follows == 0` = nessun seguito (Home mostra le categorie).
    /// Solo con il bearer, mai una posizione: la posizione parte solo come lat/lng di `events` (T-27-25).
    public func feed(limit: Int, offset: Int) async throws -> FeedPage {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/v1/me/feed"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "offset", value: String(offset))]
        return try await get(comps.url!, as: FeedPage.self)
    }

    /// Segue una categoria o un luogo; il server controlla ogni chiave (404 = non esiste, 409 `cap` = 50 luoghi).
    /// Torna l'etichetta che il server ha costruito (nil se la risposta non la porta).
    @discardableResult
    public func follow(kind: String, key: String) async throws -> String? {
        let (data, _) = try await send(method: "PUT", path: "api/v1/me/follows", body: JSONSerialization.data(withJSONObject: ["kind": kind, "key": key]))
        return (try? JSONDecoder().decode([String: AnyLabel].self, from: data))?["label"]?.text
    }

    /// Smette di seguire: (kind, key) solo nel corpo, mai nell'indirizzo (T-23-05). 200 anche se non c'era.
    public func unfollow(kind: String, key: String) async throws {
        _ = try await send(method: "DELETE", path: "api/v1/me/follows", body: JSONSerialization.data(withJSONObject: ["kind": kind, "key": key]))
    }

    /// Cosa segue l'utente, gia' ordinato e con le etichette del server.
    public func follows() async throws -> FollowList {
        try await get(baseURL.appendingPathComponent("api/v1/me/follows"), as: FollowList.self)
    }

    /// Scelta degli interessi (OnboardingDialog.tsx): luoghi e categorie insieme al segno "vista", in una richiesta
    /// sola. Liste vuote = Salta (solo il segno). 400 = una chiave non esiste, 409 `cap` = oltre 50 luoghi.
    public func onboarding(places: [FollowItem], categories: [String]) async throws {
        let body: [String: Any] = ["places": places.map { ["kind": $0.kind, "key": $0.key] }, "categories": categories]
        _ = try await send(post: "api/v1/me/onboarding", json: body)
    }

    /// Luoghi da seguire (regioni, province, comuni): la stessa ricerca pubblica del sito, senza bearer.
    public func searchPlaces(q: String) async throws -> [PlaceOption] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/places/search"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "q", value: q)]
        return try await get(comps.url!, as: PlaceResults.self).results
    }

    /// Comuni per la zona (UAT7 C3): la stessa ricerca pubblica del campo "Dove" del sito, senza bearer. Il comune scelto
    /// parte poi solo come lat/lng arrotondati di `events` (mai il filtro per comune, che puo' avviare uno scraping).
    public func searchComuni(q: String) async throws -> [ComuneOption] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/comuni/search"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "q", value: q)]
        return try await get(comps.url!, as: ComuneResults.self).results.filter { $0.latitude != nil && $0.longitude != nil }
    }

    /// Politica di versione (pubblica, niente bearer). nil se il server non risponde o risponde male:
    /// l'app prosegue (fail open, T-27-26). Solo un "update-required" esplicito blocca.
    public func config(version: String) async -> AppConfig? {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/v1/config"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "version", value: version)]
        return try? await get(comps.url!, as: AppConfig.self)
    }

    public func meState() async throws -> MeState {
        try await get(baseURL.appendingPathComponent("api/v1/me/state"), as: MeState.self)
    }

    /// Una volta, subito dopo l'accesso con Apple: il codice vale pochi minuti. Un errore non e' fatale.
    public func appleToken(code: String) async throws {
        _ = try await send(post: "api/v1/me/apple-token", json: ["authorizationCode": code])
    }

    /// I metodi di accesso collegati all'account (solo id di riga e provider).
    public func listAccounts() async throws -> [LinkedAccount] {
        try await get(baseURL.appendingPathComponent("api/auth/list-accounts"), as: [LinkedAccount].self)
    }

    /// Collega un secondo metodo all'account della sessione aperta: l'id token e' verificato dal server (AUTH-07: mai
    /// un collegamento implicito, serve la sessione). Senza `callbackURL` il server non prepara nessun giro nel browser.
    public func linkSocial(provider: String, idToken: String, nonce: String) async throws {
        _ = try await send(post: "api/auth/link-social", json: ["provider": provider, "idToken": ["token": idToken, "nonce": nonce]])
    }

    /// Scollega una riga (il server rifiuta l'ultima). Il corpo e' l'id della RIGA, non il sub del provider.
    public func unlinkAccount(id: String) async throws {
        _ = try await send(post: "api/auth/unlink-account", json: ["accountId": id])
    }

    /// Corpo `{}`: un corpo vuoto con Content-Type JSON e' un 400 di Better Auth.
    public func signOut() async throws {
        _ = try await send(post: "api/auth/sign-out", body: Data("{}".utf8))
    }

    /// Registra (o aggiorna) il telefono per le notifiche. Il token va SOLO nel corpo: mai nell'indirizzo.
    public func registerDevice(token: String, environment: String, appVersion: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["token": token, "environment": environment, "appVersion": appVersion])
        _ = try await send(method: "PUT", path: "api/v1/me/devices", body: body)
    }

    /// Toglie il telefono dalle notifiche; va chiamata prima di scartare il bearer.
    public func unregisterDevice(token: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["token": token])
        _ = try await send(method: "DELETE", path: "api/v1/me/devices", body: body)
    }

    /// Elimina l'account (e a cascata i suoi dati). Solo bearer; corpo `{}` come per sign-out.
    public func deleteUser() async throws {
        _ = try await send(post: "api/auth/delete-user", body: Data("{}".utf8))
    }

    func get<T: Decodable>(_ url: URL, as type: T.Type) async throws -> T {
        let (data, _) = try await perform(URLRequest(url: url))
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    func send(post path: String, json: [String: Any]) async throws -> (Data, HTTPURLResponse) {
        try await send(post: path, body: JSONSerialization.data(withJSONObject: json))
    }

    func send(post path: String, body: Data) async throws -> (Data, HTTPURLResponse) {
        try await send(method: "POST", path: path, body: body)
    }

    func send(method: String, path: String, body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }
        return try await perform(req)
    }

    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var request = request
        let path = request.url?.path ?? ""
        // Le rotte dei metodi di accesso rispondono 401 anche per un id token rifiutato: li' la sessione e' finita solo
        // con il codice UNAUTHORIZED di Better Auth.
        let accountRoute = ["/api/auth/list-accounts", "/api/auth/link-social", "/api/auth/unlink-account"].contains(path)
        let personal = path.hasPrefix("/api/v1/me/") || path == "/api/auth/sign-out" || path == "/api/auth/delete-user" || accountRoute
        if personal, let bearer = auth.bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        guard (200..<300).contains(http.statusCode) else {
            // Better Auth risponde {code, message}, le nostre rotte {error}.
            let body = try? JSONDecoder().decode([String: String].self, from: data)
            let sessionEnded = !accountRoute || body?["code"] == nil || body?["code"] == "UNAUTHORIZED"
            if http.statusCode == 401, personal, sessionEnded, auth.bearer != nil { auth.onUnauthorized?() }
            throw APIError.http(status: http.statusCode, code: body?["code"] ?? body?["error"])
        }
        return (data, http)
    }
}

/// Un valore JSON di cui interessa solo il testo: `{"followed": true, "label": "..."}` non si decodifica come [String: String].
struct AnyLabel: Decodable {
    let text: String?
    init(from decoder: Decoder) throws { text = try? decoder.singleValueContainer().decode(String.self) }
}

/// Il token APNs come lo vuole il server: esadecimale minuscolo, due cifre per byte.
public func apnsHex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

/// Al server basta cercare entro qualche decina di km: le coordinate partono arrotondate a 2 decimali
/// (circa 1 km), la posizione precisa resta sul telefono (distanze, tempo di percorrenza, pallino).
public func coarseCoordinate(_ value: Double) -> String {
    String((value * 100).rounded() / 100)
}
