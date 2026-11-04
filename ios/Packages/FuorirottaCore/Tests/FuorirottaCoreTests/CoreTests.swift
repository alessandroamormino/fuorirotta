import Foundation
import Testing
@testable import FuorirottaCore

private func rome(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12, _ min: Int = 0) -> Date {
    Rome.calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
}

@Suite struct DecodingTests {
    @Test func decodesSample() throws {
        let url = Bundle.module.url(forResource: "events-sample", withExtension: "json", subdirectory: "Fixtures")!
        let page = try JSONDecoder().decode(EventsPage.self, from: Data(contentsOf: url))
        #expect(page.events.count == 3)
        #expect(page.mapEvents.count == 3)
        #expect(page.events[2].imageUrl == nil)
        #expect(page.events[2].dateEnd == nil)
        #expect(page.mapEvents[0].lat != nil)
    }
}

@Suite(.serialized) struct ClustersTests {
    @Test func decodesSample() throws {
        let url = Bundle.module.url(forResource: "clusters-sample", withExtension: "json", subdirectory: "Fixtures")!
        let env = try JSONDecoder().decode(ClusterEnvelope.self, from: Data(contentsOf: url))
        let set = ClusterSet(env)
        #expect(set.pins.count == 3)
        // GeoJSON: coordinates sono [lon, lat], la latitudine sta all'indice 1 (Lombardia: lat ~45, lon ~9).
        #expect(set.pins.allSatisfy { ($0.lat ?? 0) > 44 && ($0.lat ?? 0) < 47 && ($0.lng ?? 0) > 8 && ($0.lng ?? 0) < 12 })
        #expect(!set.computedAt.isEmpty)
    }

    @Test func skipsFeaturesWithoutTwoCoordinates() throws {
        let json = #"{"computedAt":"x","eventCount":1,"geojson":{"features":[{"geometry":{"coordinates":[9.1]},"properties":{"id":1,"title":"t","dateStart":"2026-11-01T00:00:00.000Z"}}]}}"#
        let env = try JSONDecoder().decode(ClusterEnvelope.self, from: Data(json.utf8))
        #expect(ClusterSet(env).pins.isEmpty)
    }

    private func load() throws -> ClusterSet {
        let url = Bundle.module.url(forResource: "clusters-production-shape", withExtension: "json", subdirectory: "Fixtures")!
        return ClusterSet(try JSONDecoder().decode(ClusterEnvelope.self, from: Data(contentsOf: url)))
    }

    @Test func emptyStringsAreMissingAndSingleCoordinateIsSkipped() throws {
        let set = try load()
        #expect(set.pins.map(\.id) == [2001, 2002])
        #expect(set.pins[0].category == "Sagre e feste" && set.pins[0].imageUrl != nil && set.pins[0].locationName == "Parco delle Cascine")
        #expect(set.pins[1].category == "Altro")
        #expect(set.pins[1].imageUrl == nil && set.pins[1].locationName == nil)
        #expect(set.computedAt == "2026-11-02T11:10:47.000Z")
    }

    @Test func nullEnvelopeIsNoDataNotAnError() throws {
        let json = #"{"geojson":null,"eventCount":0,"computedAt":null}"#
        let set = ClusterSet(try JSONDecoder().decode(ClusterEnvelope.self, from: Data(json.utf8)))
        #expect(set.pins.isEmpty && set.computedAt.isEmpty)
    }

    private let etag = "\"2026-11-02T11:10:47.000Z\""
    private let body = #"{"geojson":{"features":[{"geometry":{"coordinates":[9.1,45.4]},"properties":{"id":1,"title":"t","dateStart":"2026-11-01T00:00:00.000Z"}}]},"eventCount":1,"computedAt":"2026-11-02T11:10:47.000Z"}"#

    private func client() -> APIClient {
        APIClient(
            baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
            session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [ClusterStub.self]))
    }

    @Test func firstLoadSendsNoValidatorAndKeepsTheEtag() async throws {
        ClusterStub.reset([.init(headers: ["ETag": etag], body: body)])
        let fetch = try await client().clusters(ifNoneMatch: nil)
        let sent = try #require(ClusterStub.requests.first)
        #expect(sent.value(forHTTPHeaderField: "If-None-Match") == nil)
        #expect(sent.cachePolicy == .reloadIgnoringLocalCacheData)
        guard case .fresh(let set, let tag) = fetch else { Issue.record("expected .fresh"); return }
        #expect(set.pins.map(\.id) == [1] && tag == etag)
    }

    @Test func notModifiedIsNotAnError() async throws {
        ClusterStub.reset([.init(status: 304, headers: ["ETag": etag], body: "")])
        let fetch = try await client().clusters(ifNoneMatch: etag)
        #expect(ClusterStub.requests.first?.value(forHTTPHeaderField: "If-None-Match") == etag)
        guard case .notModified = fetch else { Issue.record("expected .notModified"); return }
    }

    @Test func nullGeojsonIsEmpty() async throws {
        ClusterStub.reset([.init(body: #"{"geojson":null,"eventCount":0,"computedAt":null}"#)])
        guard case .empty = try await client().clusters(ifNoneMatch: nil) else { Issue.record("expected .empty"); return }
    }
}

private struct SplitMix64: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

@Suite struct GridClustersTests {
    private func pin(_ id: Int, _ lat: Double?, _ lng: Double?) -> MapPin {
        MapPin(id: id, title: "t", category: nil, imageUrl: nil, dateStart: "2026-11-01T00:00:00.000Z",
               locationName: nil, lat: lat, lng: lng)
    }

    /// 9.000 pin come quelli di produzione: quattro citta', un fondo uniforme e 150 sullo stesso centro di comune.
    private func italy() -> [MapPin] {
        var rng = SplitMix64(state: 27)
        var pins: [MapPin] = []
        func add(_ lat: Double, _ lng: Double, spread: Double) {
            pins.append(pin(pins.count, lat + Double.random(in: -spread...spread, using: &rng),
                            lng + Double.random(in: -spread...spread, using: &rng)))
        }
        for (lat, lng) in [(45.4642, 9.19), (41.9, 12.5), (43.77, 11.25), (40.85, 14.27)] {
            for _ in 0..<1_250 { add(lat, lng, spread: 0.3) }
        }
        for _ in 0..<3_850 {
            pins.append(pin(pins.count, Double.random(in: 37...46.5, using: &rng), Double.random(in: 7...18, using: &rng)))
        }
        for _ in 0..<150 { add(45.6983, 9.6773, spread: 0) }
        return pins
    }

    private func check(_ groups: [PinGroup], atMost: Int) {
        #expect(groups.count <= atMost)
        #expect(groups.reduce(0) { $0 + $1.pins.count } == 9_000)
        #expect(Set(groups.flatMap { $0.pins.map(\.id) }).count == 9_000)
    }

    @Test func italyAndTheWorldStayBounded() {
        let pins = italy()
        check(gridClusters(pins, minLat: 36, maxLat: 47.2, minLng: 6.5, maxLng: 18.6, widthPoints: 390), atMost: 200)
        check(gridClusters(pins, minLat: -85, maxLat: 85, minLng: -180, maxLng: 180, widthPoints: 390), atMost: 200)
    }

    @Test func farApartPinsStaySingle() {
        let g = gridClusters([pin(1, 45.42, 9.19), pin(2, 45.465, 9.19), pin(3, 45.51, 9.19)],
                             minLat: 45.40, maxLat: 45.53, minLng: 9.13, maxLng: 9.257, widthPoints: 390)
        #expect(Set(g.map(\.id)) == ["p1", "p2", "p3"])
    }

    @Test func samePlaceAtMaxZoomIsOneGroup() {
        let pins = (0..<150).map { pin($0, 45.6983, 9.6773) }
        let g = gridClusters(pins, minLat: 45.6970, maxLat: 45.6996, minLng: 9.6755, maxLng: 9.6791, widthPoints: 390)
        #expect(g.count == 1 && g[0].pins.count == 150 && !g[0].id.hasPrefix("p"))
    }

    @Test func panningDoesNotReshuffleGroups() {
        let pins = italy()
        let a = gridClusters(pins, minLat: 45.0, maxLat: 45.9, minLng: 8.7, maxLng: 9.7, widthPoints: 390)
        let b = gridClusters(pins, minLat: 45.0, maxLat: 45.9, minLng: 8.8, maxLng: 9.8, widthPoints: 390)
        let members = { (g: [PinGroup]) in Dictionary(uniqueKeysWithValues: g.map { ($0.id, $0.pins.map(\.id)) }) }
        let (ma, mb) = (members(a), members(b))
        #expect(!ma.isEmpty)
        for (id, ids) in ma { if let other = mb[id] { #expect(other == ids) } }
    }

    @Test func pinsWithoutCoordinatesAreInNoGroup() {
        let g = gridClusters([pin(1, nil, nil), pin(2, 45, nil), pin(3, 45, 9)],
                             minLat: 44, maxLat: 46, minLng: 8, maxLng: 10, widthPoints: 390)
        #expect(g.flatMap { $0.pins.map(\.id) } == [3])
    }

    @Test func deltaMovesOnlyTheDifference() {
        let a = PinGroup(id: "7/1/2", pins: [pin(1, 45, 9), pin(2, 45, 9)], lat: 45, lng: 9)
        let same = groupDelta(shown: ["7/1/2": [1, 2]], incoming: [a])
        #expect(same.add.isEmpty && same.remove.isEmpty)
        // stesso id, altri eventi (cambio di filtro): si toglie e si rimette
        let changed = groupDelta(shown: ["7/1/2": [1, 2, 3]], incoming: [a])
        #expect(changed.add.map(\.id) == ["7/1/2"] && changed.remove == ["7/1/2"])
        let moved = groupDelta(shown: ["p9": [9], "p3": [3], "7/1/2": [1, 2]], incoming: [a, PinGroup(id: "p4", pins: [pin(4, 45, 9)], lat: 45, lng: 9)])
        #expect(moved.add.map(\.id) == ["p4"] && moved.remove == ["p3", "p9"])
    }
}

@Suite struct WeekendTests {
    @Test(arguments: [
        (rome(2026, 11, 2), "2026-11-06", "2026-11-08"),        // lunedi'
        (rome(2026, 11, 5, 23, 59), "2026-11-06", "2026-11-08"), // giovedi' 23:59
        (rome(2026, 11, 6, 0, 0), "2026-11-06", "2026-11-08"),   // venerdi' 00:00
        (rome(2026, 11, 7), "2026-11-07", "2026-11-08"),         // sabato
        (rome(2026, 11, 8, 23, 59), "2026-11-08", "2026-11-08"), // domenica 23:59
        (rome(2026, 11, 9, 0, 0), "2026-11-13", "2026-11-15"),   // lunedi' 00:00
        (rome(2026, 10, 22), "2026-10-23", "2026-10-25"),        // a cavallo del cambio d'ora
    ])
    func window(now: Date, from: String, to: String) {
        let w = weekendWindow(now: now)
        #expect(w.from == from && w.to == to)
    }

    @Test func formatting() {
        #expect(formatDayRange(from: "2026-11-06", to: "2026-11-08") == "6-8 novembre")
        #expect(formatDayRange(from: "2026-10-30", to: "2026-11-01") == "30 ottobre - 1 novembre")
        #expect(formatDayRange(from: "2026-11-08", to: "2026-11-08") == "8 novembre")
        #expect(formatDayRange(from: "2025-12-27", to: "2026-12-06") == "27 dicembre 2025 - 6 dicembre 2026")
        #expect(formatDayRange(from: "2026-12-27", to: "2027-01-06") == "27 dicembre 2026 - 6 gennaio 2027")
    }

    @Test func eventDaysUtcEndOfDay() {
        let d = eventDays(dateStart: "2026-10-29T00:00:00.000Z", dateEnd: "2026-11-01T23:59:59.999Z")
        #expect(d?.startDay == "2026-10-29" && d?.endDay == "2026-11-01")
        let one = eventDays(dateStart: "2026-11-07T00:00:00.000Z", dateEnd: nil)
        #expect(one?.startDay == "2026-11-07" && one?.endDay == "2026-11-07")
    }
}

@Suite struct ContractTests {
    private func matches(_ pattern: String, _ s: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }

    @Test func userAgentMatchesContract() {
        #expect(matches(ApiContract.userAgentPattern, APIClient.userAgent(version: "1.0.0")))
        #expect(!matches(ApiContract.userAgentPattern, "FuoriRotta/1 CFNetwork/1494"))
    }

    @Test func sessionIsCookieless() {
        let c = APIClient.makeSession(appVersion: "1.0.0").configuration
        #expect(c.httpCookieStorage == nil)
        #expect(c.httpShouldSetCookies == false)
        #expect(c.httpCookieAcceptPolicy == .never)
        #expect(c.httpAdditionalHeaders?["User-Agent"] as? String == "FuoriRotta/1.0.0 (iOS; iPhone)")
    }

    @Test func constants() {
        #expect(ApiContract.categories.count == 7)
        #expect(ApiContract.categories.last == "Altro")
        #expect(ApiContract.guestCap == 100)
        #expect(ApiContract.accountCap == 500)
    }
}

@Suite struct SourceGuardTests {
    // T-27-03: l'app non manda mai i parametri che avviano lo scraping in background.
    @Test func apiSwiftNeverBuildsScrapeParams() throws {
        let api = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/FuorirottaCore/API.swift")
        let text = try String(contentsOf: api, encoding: .utf8)
        #expect(!text.contains("comuneId"))
        #expect(!text.contains("location="))
        #expect(!text.contains("\"location\""))
    }
}

@Suite(.enabled(if: ProcessInfo.processInfo.environment["FUORIROTTA_LIVE"] == "1"))
struct LiveAPITests {
    @Test func weekendFromProduction() async throws {
        let client = APIClient(baseURL: URL(string: "https://fuori-rotta.it")!, appVersion: "1.0.0")
        let w = weekendWindow()
        let page = try await client.events(lat: 45.4642, lng: 9.19, radiusKm: 50, dateFrom: w.from, dateTo: w.to, limit: 16)
        #expect(!page.events.isEmpty)
        #expect(page.total >= page.events.count)
    }
}

// Stub proprio (le suite girano in parallelo): risponde con stato, intestazioni e corpo scelti e ricorda le richieste.
final class ClusterStub: URLProtocol, @unchecked Sendable {
    struct Reply { var status = 200; var headers: [String: String] = [:]; var body = "{}" }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var replies: [Reply] = []
    nonisolated(unsafe) private static var sent: [URLRequest] = []

    static func reset(_ r: [Reply]) { lock.withLock { replies = r; sent = [] } }
    static var requests: [URLRequest] { lock.withLock { sent } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let reply: Reply = Self.lock.withLock {
            Self.sent.append(request)
            return Self.replies.isEmpty ? Reply() : Self.replies.removeFirst()
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
