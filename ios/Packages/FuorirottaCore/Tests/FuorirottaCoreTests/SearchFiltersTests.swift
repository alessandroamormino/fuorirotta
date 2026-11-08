import Foundation
import Testing
@testable import FuorirottaCore

// Stub proprio (le suite girano in parallelo): registra gli indirizzi e risponde sempre con una pagina vuota.
final class SearchStub: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var sent: [URL] = []
    static func reset() { lock.withLock { sent = [] } }
    static var urls: [URL] { lock.withLock { sent } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.sent.append(request.url!) }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"events": [], "mapEvents": [], "total": 0}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private func at(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

private func ev(_ id: Int, start: String, end: String? = nil) -> Event {
    Event(id: id, title: "e\(id)", dateStart: start, dateEnd: end)
}

private func items(_ f: SearchFilters, category: String? = nil, now: Date) -> [String] {
    f.queryItems(category: category, limit: 30, now: now).map { "\($0.name)=\($0.value ?? "")" }
}

@Suite struct SearchFiltersTests {
    // Domenica 1 novembre 2026, 23:30 UTC = lunedi' 2 novembre 00:30 a Roma (CET, UTC+1).
    private let lateSunday = at("2026-11-01T23:30:00Z")
    // Mercoledi' 4 novembre 2026, mezzogiorno.
    private let wednesday = at("2026-11-04T12:00:00Z")

    @Test func textOnlyKeepsTheOldQuery() {
        #expect(items(SearchFilters(text: "jazz"), now: wednesday) == ["search=jazz", "limit=30"])
    }

    @Test func emptyMeansNoTextAndNoFilters() {
        #expect(SearchFilters().isEmpty)
        #expect(SearchFilters(text: "   ").isEmpty)
        #expect(!SearchFilters(text: "a").isEmpty)
        #expect(!SearchFilters(categories: ["Food & Wine"]).isEmpty)
        #expect(!SearchFilters(when: .today).isEmpty)
        #expect(!SearchFilters(near: .init(lat: 45, lng: 9, radiusKm: 10)).isEmpty)
    }

    @Test func weekendAndQualsiasiDataAreIdleTheRestIsNot() {
        #expect(SearchFilters(when: .weekend).isIdle)
        #expect(SearchFilters().isIdle)
        #expect(!SearchFilters(when: .today).isIdle)
        #expect(!SearchFilters(text: "jazz", when: .weekend).isIdle)
        #expect(!SearchFilters(when: .weekend, categories: ["Food & Wine"]).isIdle)
        #expect(!SearchFilters(when: .weekend, near: .init(lat: 45, lng: 9, radiusKm: 10)).isIdle)
    }

    @Test func onlyTheWeekendIsTheDefaultDate() {
        #expect(!SearchFilters(when: .weekend).hasActiveFilters)
        #expect(SearchFilters(when: .any).hasActiveFilters)
        #expect(SearchFilters(when: .today).hasActiveFilters)
        #expect(SearchFilters(when: .custom(from: "2026-12-01", to: "2026-12-05")).hasActiveFilters)
        #expect(SearchFilters(when: .weekend, categories: ["Food & Wine"]).hasActiveFilters)
        #expect(SearchFilters(when: .weekend, near: .init(lat: 45, lng: 9, radiusKm: 10)).hasActiveFilters)
    }

    @Test func theWeekendDefaultAddsOnlyTheTwoDates() {
        #expect(items(SearchFilters(when: .weekend), now: wednesday) == ["dateFrom=2026-11-06", "dateTo=2026-11-08", "limit=30"])
    }

    @Test func todayIsTheRomeDayNotTheUtcDay() {
        let range = SearchFilters(when: .today).dateRange(now: lateSunday)
        #expect(range?.from == "2026-11-02" && range?.to == "2026-11-02")
    }

    @Test func next7DaysIsTodayThroughSixDaysLater() {
        let range = SearchFilters(when: .next7).dateRange(now: lateSunday)
        #expect(range?.from == "2026-11-02" && range?.to == "2026-11-08")
        // Attraversa il cambio d'ora legale (25 ottobre) senza saltare un giorno.
        let across = SearchFilters(when: .next7).dateRange(now: at("2026-10-22T10:00:00Z"))
        #expect(across?.from == "2026-10-22" && across?.to == "2026-10-28")
    }

    @Test func weekendIsFridayToSundayAndFromTodayWhenAlreadyInIt() {
        let range = SearchFilters(when: .weekend).dateRange(now: wednesday)
        #expect(range?.from == "2026-11-06" && range?.to == "2026-11-08")
        let saturday = SearchFilters(when: .weekend).dateRange(now: at("2026-11-07T10:00:00Z"))
        #expect(saturday?.from == "2026-11-07" && saturday?.to == "2026-11-08")
    }

    @Test func customRangeIsKeptAndAnInvertedOneCollapsesToTheStart() {
        #expect(SearchFilters(when: .custom(from: "2026-12-01", to: "2026-12-05")).dateRange(now: wednesday)?.to == "2026-12-05")
        let inverted = SearchFilters(when: .custom(from: "2026-12-05", to: "2026-12-01")).dateRange(now: wednesday)
        #expect(inverted?.from == "2026-12-05" && inverted?.to == "2026-12-05")
        #expect(SearchFilters().dateRange(now: wednesday) == nil)
    }

    @Test func fullQueryUsesTheNamesTheWebAlreadySends() {
        let f = SearchFilters(
            text: "sagra", when: .weekend, near: .init(lat: 45.4642, lng: 9.19, radiusKm: 25), categories: ["Food & Wine"])
        #expect(items(f, category: "Food & Wine", now: wednesday) == [
            "search=sagra", "category=Food & Wine", "dateFrom=2026-11-06", "dateTo=2026-11-08",
            "lat=45.46", "lng=9.19", "radius=25", "limit=30",
        ])
    }

    @Test func spacesTextIsTrimmedAndBlankTextIsOmitted() {
        #expect(items(SearchFilters(text: "  jazz "), now: wednesday).first == "search=jazz")
        #expect(items(SearchFilters(text: " ", when: .today), now: wednesday).first?.hasPrefix("search") == false)
    }

    @Test func titlesAreItalian() {
        #expect(SearchFilters.When.today.title() == "Oggi")
        #expect(SearchFilters.When.weekend.title() == "Questo weekend")
        #expect(SearchFilters.When.next7.title() == "Prossimi 7 giorni")
        #expect(SearchFilters.When.custom(from: "2026-12-01", to: "2026-12-05").title() == "1-5 dicembre")
        #expect(SearchFilters.When.custom(from: "2026-12-01", to: "2026-12-01").title() == "1 dicembre")
    }

    // MARK: unione di piu' categorie

    @Test func mergeDedupesAndOrdersByFirstDayClampedToToday() {
        let running = ev(1, start: "2026-10-01T00:00:00.000Z", end: "2026-12-31T22:59:00.000Z") // gia' iniziato
        let soon = ev(2, start: "2026-11-05T00:00:00.000Z")
        let later = ev(3, start: "2026-11-20T00:00:00.000Z")
        let merged = mergeEvents([[later, soon], [running, soon]], from: "2026-11-02", limit: 10)
        #expect(merged.map(\.id) == [1, 2, 3])
    }

    @Test func mergeStopsAtTheLimit() {
        let list = (1...5).map { ev($0, start: "2026-11-0\($0)T12:00:00.000Z") }
        #expect(mergeEvents([list], from: "2026-11-01", limit: 3).map(\.id) == [1, 2, 3])
    }

    // MARK: rete

    private func api() -> APIClient {
        APIClient(
            baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
            session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [SearchStub.self]))
    }

    @Test func oneRequestPerCategoryWhenSeveralAreChosen() async throws {
        SearchStub.reset()
        let f = SearchFilters(categories: ["Food & Wine", "Sport e outdoor"])
        _ = try await api().search(f, limit: 30, now: wednesday)
        let categories = SearchStub.urls
            .compactMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "category" }?.value }
        #expect(Set(categories) == ["Food & Wine", "Sport e outdoor"])
        #expect(categories.count == 2)
    }

    @Test func withoutNearThePositionNeverLeaves() async throws {
        SearchStub.reset()
        _ = try await api().search(SearchFilters(text: "jazz", when: .today), limit: 30, now: wednesday)
        let query = SearchStub.urls.first?.query ?? ""
        for forbidden in ["lat", "lng", "radius", "location", "comuneId"] { #expect(!query.contains(forbidden)) }
    }
}
