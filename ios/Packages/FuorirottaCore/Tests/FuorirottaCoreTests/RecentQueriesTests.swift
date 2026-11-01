import Foundation
import Testing
@testable import FuorirottaCore

private func client() -> APIClient {
    APIClient(
        baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
        session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [HomeStub.self]))
}

@Suite struct RecentQueriesTests {
    @Test func addsTrimmedNewestFirst() {
        #expect(RecentQueries.adding("sagra", to: []) == ["sagra"])
        #expect(RecentQueries.adding("  Sagra ", to: ["sagra", "jazz"]) == ["Sagra", "jazz"])
        #expect(RecentQueries.adding("jazz", to: ["sagra"]) == ["jazz", "sagra"])
    }

    @Test func keepsEightAndDropsTheOldest() {
        let full = (1...8).map { "q\($0)" }  // q1 e' la piu' recente
        let next = RecentQueries.adding("nuova", to: full)
        #expect(next.count == RecentQueries.max)
        #expect(next.first == "nuova")
        #expect(!next.contains("q8"))
    }

    @Test func emptyOrBlankChangesNothing() {
        #expect(RecentQueries.adding("", to: ["a"]) == ["a"])
        #expect(RecentQueries.adding("   \n", to: ["a"]) == ["a"])
    }

    // MARK: la richiesta di ricerca

    @Test func searchIsPlainGetWithoutLocation() async throws {
        HomeStub.reset([.init(body: #"{"events": [], "mapEvents": [], "total": 0}"#)])
        let api = client()
        api.bearer = "b.sig"
        let events = try await api.search(q: "jazz", limit: 30)
        let sent = try #require(HomeStub.requests.first)
        #expect(events.isEmpty)
        #expect(sent.method == "GET")
        #expect(sent.url.path == "/api/events")
        #expect(sent.url.query == "search=jazz&limit=30")
        #expect(sent.headers["Authorization"] == nil)
        let query = sent.url.query ?? ""
        for forbidden in ["lat", "lng", "location", "comuneId"] { #expect(!query.contains(forbidden)) }
    }

    @Test func searchEncodesSpacesAndAccents() async throws {
        HomeStub.reset([.init(body: #"{"events": [], "mapEvents": [], "total": 0}"#)])
        _ = try await client().search(q: "sagra d'autunno è", limit: 30)
        let url = try #require(HomeStub.requests.first?.url)
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        #expect(items?.first { $0.name == "search" }?.value == "sagra d'autunno è")
    }
}
