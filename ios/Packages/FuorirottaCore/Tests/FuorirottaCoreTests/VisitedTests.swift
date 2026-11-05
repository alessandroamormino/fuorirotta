import Foundation
import Testing
@testable import FuorirottaCore

// Stub proprio (come SavesTests e AuthTests): le suite girano in parallelo e lo stato statico non si condivide.
final class VisitedStub: URLProtocol, @unchecked Sendable {
    struct Sent { let method: String; let path: String; let query: String?; let headers: [String: String]; let body: Data }
    struct Reply { var status = 200; var body = "{}" }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var replies: [Reply] = []
    nonisolated(unsafe) private static var sent: [Sent] = []

    static func reset(_ r: [Reply]) { lock.withLock { replies = r; sent = [] } }
    static var requests: [Sent] { lock.withLock { sent } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                body.append(buf, count: n)
            }
            stream.close()
        }
        let reply: Reply = Self.lock.withLock {
            Self.sent.append(Sent(
                method: request.httpMethod ?? "", path: request.url?.path ?? "", query: request.url?.query,
                headers: request.allHTTPHeaderFields ?? [:], body: body))
            return Self.replies.isEmpty ? Reply() : Self.replies.removeFirst()
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

func visitedClient() -> APIClient {
    APIClient(
        baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
        session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [VisitedStub.self]))
}

@Suite(.serialized) struct VisitedTests {
    private func path(_ i: Int = 0) -> (String, String) {
        let r = VisitedStub.requests[i]
        return (r.method, r.path)
    }

    @Test func markAndUnmarkAreWritesWithoutQueryString() async throws {
        VisitedStub.reset([.init(), .init()])
        let api = visitedClient()
        try await api.markVisited(id: 7)
        try await api.unmarkVisited(id: 7)
        #expect(path(0) == ("PUT", "/api/v1/me/visited/7"))
        #expect(path(1) == ("DELETE", "/api/v1/me/visited/7"))
    }

    @Test func savedRowAndGoneRowCalls() async throws {
        VisitedStub.reset([.init(), .init()])
        let api = visitedClient()
        try await api.markVisitedFromSaved(ref: 3)
        try await api.unmarkVisitedGone(ref: 3)
        #expect(path(0) == ("PUT", "/api/v1/me/visited/saved/3"))
        #expect(path(1) == ("DELETE", "/api/v1/me/visited/gone/3"))
    }

    @Test func noCallCarriesAQueryString() async throws {
        VisitedStub.reset([.init(body: #"{"items":[]}"#), .init(), .init(), .init(), .init(), .init(body: #"{"added":0,"overCap":0}"#)])
        let api = visitedClient()
        _ = try await api.visitedList()
        try await api.markVisited(id: 1)
        try await api.unmarkVisited(id: 1)
        try await api.markVisitedFromSaved(ref: 1)
        try await api.unmarkVisitedGone(ref: 1)
        _ = try await api.mergeVisited([DeviceEntry(id: 1, savedAt: "2026-11-01T10:00:00.000Z", snap: nil, visitDay: "2026-11-01")])
        #expect(VisitedStub.requests.count == 6)
        #expect(VisitedStub.requests.allSatisfy { $0.query == nil })
    }

    @Test func mergeSendsTheVisitDayAndReturnsAdded() async throws {
        VisitedStub.reset([.init(body: #"{"added":2,"overCap":0}"#)])
        let snap = Snap(title: "Sagra", dateStart: "2026-11-01T00:00:00.000Z", dateEnd: nil, place: nil, category: "Altro", source: "s", sourceId: "1", sourceUrl: nil)
        let added = try await visitedClient().mergeVisited([DeviceEntry(id: 1, savedAt: "2026-11-02T10:00:00.000Z", snap: snap, visitDay: "2026-11-01")])
        #expect(added == 2)
        let sent = try #require(VisitedStub.requests.first)
        #expect(sent.method == "POST" && sent.path == "/api/v1/me/visited/merge")
        let items = try #require((try JSONSerialization.jsonObject(with: sent.body) as? [String: Any])?["items"] as? [[String: Any]])
        #expect(Set(items[0].keys) == ["id", "savedAt", "visitDay", "snap"])
        #expect(items[0]["visitDay"] as? String == "2026-11-01")
    }

    @Test func listDecodesExactlyTheContractKeysIncludingAGoneItem() async throws {
        let live = #"{"ref":5,"eventId":2704,"visitedAt":"2026-11-02T10:00:00.000Z","visitDay":"2026-11-01","snap":{"title":"A","dateStart":"2026-11-01T00:00:00.000Z","dateEnd":null,"place":null,"category":"Altro","source":"s","sourceId":"1","sourceUrl":null},"imageUrl":"https://x.test/a.jpg"}"#
        let gone = #"{"ref":6,"eventId":null,"visitedAt":"2026-11-03T10:00:00.000Z","visitDay":"2026-11-02","snap":{"title":"B","dateStart":"2026-11-02T00:00:00.000Z","dateEnd":null,"place":null,"category":"Altro","source":"s","sourceId":"2","sourceUrl":null},"imageUrl":null}"#
        for raw in [live, gone] {
            let keys = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any]).keys
            #expect(Set(keys) == Set(ApiContract.visitedListItemKeys))
        }
        VisitedStub.reset([.init(body: #"{"items":[\#(live),\#(gone)]}"#)])
        let items = try await visitedClient().visitedList()
        #expect(items.count == 2)
        #expect(items[0].eventId == 2704 && items[0].visitDay == "2026-11-01" && items[0].imageUrl == "https://x.test/a.jpg")
        #expect(items[1].eventId == nil && items[1].imageUrl == nil && items[1].snap.title == "B")
        #expect(VisitedStub.requests.first.map { ($0.method, $0.path) } ?? ("", "") == ("GET", "/api/v1/me/visited"))
    }

    @Test func mergeMessageSingularAndPlural() {
        #expect(mergeVisitedMessage(added: 0) == nil)
        #expect(mergeVisitedMessage(added: 1) == "1 evento aggiunto ai visitati")
        #expect(mergeVisitedMessage(added: 4) == "4 eventi aggiunti ai visitati")
    }

    @Test func mergeHelperClearsOnlyTheSentIdsAndKeepsThemOnFailure() async {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("vt-\(UUID().uuidString)/visited.json")
        let store = GuestStore(fileURL: file)
        for i in 1...2 { _ = await store.toggle(id: i, snap: nil, now: Date(timeIntervalSince1970: 1_790_000_000 + Double(i)), visitDay: "2026-11-01") }
        #expect(await mergeGuestSaves(store: store) { _ in throw APIError.network } == .failed)
        #expect(await store.all().count == 2)
        let outcome = await mergeGuestSaves(store: store) { sent in
            #expect(sent.allSatisfy { $0.visitDay == "2026-11-01" })
            _ = await store.toggle(id: 50, snap: nil, now: .now, visitDay: "2026-11-02")
            return 2
        }
        #expect(outcome == .merged(2))
        #expect(await store.all().map(\.id) == [50])
    }
}
