import Foundation

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
public struct ClusterSet: Sendable {
    public let computedAt: String
    public let pins: [MapPin]

    init(_ env: ClusterEnvelope) {
        computedAt = env.computedAt
        pins = env.geojson.features.compactMap { f -> MapPin? in
            guard f.geometry.coordinates.count >= 2 else { return nil }
            let p = f.properties
            return MapPin(
                id: p.id, title: p.title, category: p.category, imageUrl: p.imageUrl, dateStart: p.dateStart,
                locationName: p.locationName, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0]
            )
        }
    }
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
    let computedAt: String
    let geojson: Collection
}

public struct APIClient: Sendable {
    public let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, appVersion: String) {
        self.baseURL = baseURL
        self.session = Self.makeSession(appVersion: appVersion)
    }

    /// "FuoriRotta/<versione> (iOS; iPhone)": deve esistere prima del primo accesso (APP_USER_AGENT_RE).
    public static func userAgent(version: String) -> String {
        "FuoriRotta/\(version) (iOS; iPhone)"
    }

    /// Sessione effimera SENZA cookie: con un Cookie il server tratta la richiesta come un browser.
    public static func makeSession(appVersion: String) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.httpAdditionalHeaders = ["User-Agent": userAgent(version: appVersion)]
        return URLSession(configuration: config)
    }

    /// Solo lat, lng, radius, dateFrom, dateTo, limit: mai i parametri che avviano uno scraping in background.
    public func events(
        lat: Double, lng: Double, radiusKm: Int,
        dateFrom: String? = nil, dateTo: String? = nil, limit: Int
    ) async throws -> EventsPage {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/events"), resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
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
    public func clusters() async throws -> ClusterSet {
        ClusterSet(try await get(baseURL.appendingPathComponent("api/events/clusters"), as: ClusterEnvelope.self))
    }

    private func get<T: Decodable>(_ url: URL, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: url)
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        guard (200..<300).contains(http.statusCode) else {
            let code = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw APIError.http(status: http.statusCode, code: code)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}
