import Foundation
import Testing
@testable import FuorirottaCore

private func ev(_ id: Int, _ start: String, _ end: String? = nil) -> Event {
    Event(id: id, title: "E\(id)", dateStart: start, dateEnd: end)
}

// Un URLProtocol tutto suo: lo StubProtocol di AuthTests ha stato condiviso e le suite girano in parallelo.
private final class AllEventsStub: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var sentURL: URL?
    static var lastURL: URL? { lock.withLock { sentURL } }
    static func reset() { lock.withLock { sentURL = nil } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.sentURL = request.url }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"events":[],"mapEvents":[],"total":0}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite(.serialized) struct AllEventsTests {
    private func client() -> APIClient {
        APIClient(
            baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
            session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [AllEventsStub.self]))
    }

    @Test func requestCarriesOnlyTheFourParameters() async throws {
        AllEventsStub.reset()
        _ = try await client().allEvents(category: nil, limit: 30, offset: 60)
        let url = try #require(AllEventsStub.lastURL)
        let names = Set(URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map(\.name))
        #expect(names == ["limit", "offset", "mapEvents"])
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        #expect(q.queryItems!.first { $0.name == "offset" }?.value == "60")
        #expect(q.queryItems!.first { $0.name == "mapEvents" }?.value == "0")
    }

    @Test func foodAndWineTravelsWhole() async throws {
        AllEventsStub.reset()
        _ = try await client().allEvents(category: "Food & Wine", limit: 30, offset: 0)
        let url = try #require(AllEventsStub.lastURL)
        #expect(url.query!.contains("Food%20%26%20Wine"))
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(items.first { $0.name == "category" }?.value == "Food & Wine")
        #expect(Set(items.map(\.name)) == ["limit", "offset", "category", "mapEvents"])
    }

    @Test func ongoingEventSitsUnderToday() {
        let days = allEventsTimeline(
            [ev(1, "2026-10-30T10:00:00.000Z", "2026-11-05T10:00:00.000Z"), ev(2, "2026-11-04T10:00:00.000Z")],
            today: "2026-11-03")
        #expect(days.map(\.day) == ["2026-11-03", "2026-11-04"])
        #expect(days[0].items.map(\.id) == [1])
    }

    @Test func monthHeaderOnFirstBlockAndWhenMonthChanges() {
        let days = allEventsTimeline(
            [ev(1, "2026-11-03T10:00:00.000Z"), ev(2, "2026-11-20T10:00:00.000Z"),
             ev(3, "2026-11-20T18:00:00.000Z"), ev(4, "2026-12-01T10:00:00.000Z")],
            today: "2026-11-03")
        #expect(days.map(\.month) == ["Novembre 2026", nil, "Dicembre 2026"])
        #expect(days[1].items.map(\.id) == [2, 3])
    }

    @Test func appendingNewDropsDuplicates() {
        let out = appendingNew([ev(2, "2026-11-04T10:00:00.000Z"), ev(3, "2026-11-05T10:00:00.000Z")],
                               to: [ev(1, "2026-11-03T10:00:00.000Z"), ev(2, "2026-11-04T10:00:00.000Z")])
        #expect(out.map(\.id) == [1, 2, 3])
    }
}
