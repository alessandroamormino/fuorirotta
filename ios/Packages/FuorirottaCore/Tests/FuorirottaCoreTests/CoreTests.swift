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
    }

    @Test func eventDaysUtcEndOfDay() {
        let d = eventDays(dateStart: "2026-10-29T00:00:00.000Z", dateEnd: "2026-11-01T23:59:59.999Z")
        #expect(d?.from == "2026-10-29" && d?.to == "2026-11-01")
        let one = eventDays(dateStart: "2026-11-07T00:00:00.000Z", dateEnd: nil)
        #expect(one?.from == "2026-11-07" && one?.to == "2026-11-07")
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
