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
        dateFrom: String, dateTo: String, limit: Int
    ) async throws -> EventsPage {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/events"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radius", value: String(radiusKm)),
            URLQueryItem(name: "dateFrom", value: dateFrom),
            URLQueryItem(name: "dateTo", value: dateTo),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: comps.url!)
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        guard (200..<300).contains(http.statusCode) else {
            let code = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw APIError.http(status: http.statusCode, code: code)
        }
        do {
            return try JSONDecoder().decode(EventsPage.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}
