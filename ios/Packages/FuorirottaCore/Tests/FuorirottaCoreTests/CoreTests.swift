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

@Suite struct ClustersTests {
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
}

@Suite struct PinDeltaTests {
    private func pin(_ id: Int, lat: Double? = 45.0) -> MapPin {
        MapPin(id: id, title: "t", category: nil, imageUrl: nil, dateStart: "2026-11-01T00:00:00.000Z",
               locationName: nil, lat: lat, lng: lat == nil ? nil : 9.0)
    }

    @Test func samePinsChangeNothing() {
        let d = pinDelta(existing: [1, 2, 3], incoming: [pin(3), pin(1), pin(2)])
        #expect(d.add.isEmpty && d.remove.isEmpty)
    }

    @Test func onlyTheDifferenceMoves() {
        let d = pinDelta(existing: [1, 2], incoming: [pin(2), pin(3), pin(4, lat: nil)])
        #expect(d.add.map(\.id) == [3] && d.remove == [1])
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
