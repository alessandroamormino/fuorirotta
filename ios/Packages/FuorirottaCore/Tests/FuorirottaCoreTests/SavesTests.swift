import Foundation
import Testing
@testable import FuorirottaCore

// Stub proprio (non quello di AuthTests): le suite girano in parallelo e lo stato statico non si condivide.
final class SavesStub: URLProtocol, @unchecked Sendable {
    struct Sent { let method: String; let path: String; let headers: [String: String]; let body: Data }
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
                method: request.httpMethod ?? "", path: request.url?.path ?? "",
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

func savesClient() -> APIClient {
    APIClient(
        baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
        session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [SavesStub.self]))
}

private func fixture(_ name: String) -> Data {
    try! Data(contentsOf: Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")!)
}

private func event(sourceUrl: String? = "https://example.test/e/1", source: String? = "src", sourceId: String? = "1") -> Event {
    func lit(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
    let json = """
    {"id": 7, "title": "Sagra", "dateStart": "2026-11-08T00:00:00.000Z", "dateEnd": null, "locationName": "Lodi",
     "canonicalCategory": null, "category": null, "sourceUrl": \(lit(sourceUrl)), "source": \(lit(source)), "sourceId": \(lit(sourceId))}
    """
    return try! JSONDecoder().decode(Event.self, from: Data(json.utf8))
}

@Suite(.serialized) struct SavesTests {
    @Test func resolvePostsIdsInTheBodyAndNeverInTheUrl() async throws {
        SavesStub.reset([.init(body: String(decoding: fixture("resolve-sample"), as: UTF8.self))])
        let api = savesClient()
        api.bearer = "b.sig"
        let items = try await api.resolve(ids: [2704, 99999])
        let sent = try #require(SavesStub.requests.first)
        #expect(sent.method == "POST" && sent.path == "/api/v1/saved/resolve")
        #expect((try JSONSerialization.jsonObject(with: sent.body) as? [String: [Int]])?["ids"] == [2704, 99999])
        #expect(sent.headers.keys.allSatisfy { $0.lowercased() != "authorization" })  // pubblica: nessuna identita'
        #expect(items.count == 2)
        #expect(items[0].eventId == 2704 && items[0].live?.title == "SOCAFEST 2026" && items[0].live?.place == "PALAZZAGO")
        #expect(items[1].ref == 99999 && items[1].eventId == nil && items[1].live == nil)
    }

    @Test func snapFromEventUsesTheFallbacks() throws {
        let snap = try #require(Snap(event: event()))
        #expect(snap.title == "Sagra" && snap.place == "Lodi" && snap.category == "Altro")
        #expect(snap.source == "src" && snap.sourceId == "1" && snap.dateEnd == nil)
        #expect(snap.sourceUrl == "https://example.test/e/1")
    }

    @Test func snapDropsNonHttpSourceUrl() throws {
        #expect(try #require(Snap(event: event(sourceUrl: "javascript:alert(1)"))).sourceUrl == nil)
        #expect(try #require(Snap(event: event(sourceUrl: "HTTP://example.test"))).sourceUrl == "HTTP://example.test")
    }

    @Test func snapNeedsTheNaturalKey() {
        #expect(Snap(event: event(source: nil)) == nil)
        #expect(Snap(event: event(sourceId: "")) == nil)
    }

    // MARK: unione, tetti e chiamate dell'account

    private func tempStore() -> GuestStore {
        GuestStore(fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("sv-\(UUID().uuidString)/saves.json"))
    }

    private func fill(_ store: GuestStore, _ n: Int) async {
        for i in 1...n { _ = await store.toggle(id: i, snap: nil, now: Date(timeIntervalSince1970: 1_790_000_000 + Double(i))) }
    }

    @Test func mergeWithAnEmptyStoreDoesNotCallSend() async {
        let calls = Counter()
        let outcome = await mergeGuestSaves(store: tempStore()) { _ in calls.bump(); return 0 }
        #expect(outcome == .nothing && calls.value == 0)
    }

    @Test func mergeSuccessClearsTheStore() async {
        let store = tempStore()
        await fill(store, 3)
        let outcome = await mergeGuestSaves(store: store) { entries in #expect(entries.count == 3); return 3 }
        #expect(outcome == .merged(3))
        #expect(await store.all().isEmpty)
    }

    @Test func mergeFailureKeepsEveryEntry() async {
        let store = tempStore()
        await fill(store, 3)
        let outcome = await mergeGuestSaves(store: store) { _ in throw APIError.network }
        #expect(outcome == .failed)
        #expect(await store.all().count == 3)
    }

    @Test func repeatedMergeAfterALostClearAddsNothingAndClears() async {
        // Il server aveva gia' accettato la lista, l'app e' morta prima di svuotare: stesso corpo, risposta added 0.
        let store = tempStore()
        await fill(store, 2)
        let outcome = await mergeGuestSaves(store: store) { _ in 0 }
        #expect(outcome == .merged(0))
        #expect(await store.all().isEmpty)
        #expect(mergeMessage(added: 0) == nil)  // nessun avviso
    }

    @Test func aSaveMadeWhileTheMergeIsInFlightSurvivesTheClear() async {
        let store = tempStore()
        await fill(store, 2)
        let outcome = await mergeGuestSaves(store: store) { _ in
            _ = await store.toggle(id: 50, snap: nil, now: .now)
            return 2
        }
        #expect(outcome == .merged(2))
        #expect(await store.all().map(\.id) == [50])
    }

    @Test func mergeMessageSingularAndPlural() {
        #expect(mergeMessage(added: 0) == nil)
        #expect(mergeMessage(added: 1) == "1 evento aggiunto ai salvati")
        #expect(mergeMessage(added: 4) == "4 eventi aggiunti ai salvati")
    }

    @Test func restoreKeepsTheOriginalPositionAndTimestamp() async {
        let store = tempStore()
        await fill(store, 3)  // ordine: 3, 2, 1
        let middle = await store.all()[1]
        await store.remove(middle.id)
        await store.restore(middle)
        #expect(await store.all().map(\.id) == [3, 2, 1])
        #expect(await store.all()[1].savedAt == middle.savedAt)
    }

    @Test func accountCallsUseTheDocumentedMethodsPathsAndBearer() async throws {
        SavesStub.reset([
            .init(body: #"{"saved":true}"#), .init(body: #"{"removed":1}"#), .init(body: #"{"removed":1}"#),
            .init(body: #"{"added":2,"overCap":0}"#), .init(body: #"{"ids":[4,5]}"#),
            .init(body: #"{"items":[{"ref":11,"eventId":null,"savedAt":"2026-11-01T10:00:00.000Z","snap":{"title":"X","dateStart":"2026-10-01T00:00:00.000Z","dateEnd":null,"place":null,"category":"Altro","source":"s","sourceId":"1","sourceUrl":null},"live":null,"siblings":[]}]}"#),
        ])
        let api = savesClient()
        api.bearer = "b.sig"
        try await api.save(id: 5)
        try await api.unsave(id: 5)
        try await api.removeGone(ref: 11)
        let entries = [DeviceEntry(id: 7, savedAt: "2026-11-01T10:00:00.000Z", snap: nil)]
        #expect(try await api.merge(entries) == 2)
        #expect(try await api.savedIds() == [4, 5])
        let list = try await api.savedList()
        #expect(list.first?.ref == 11 && list.first?.eventId == nil && list.first?.snap?.title == "X")
        let sent = SavesStub.requests
        #expect(sent.map(\.method) == ["PUT", "DELETE", "DELETE", "POST", "GET", "GET"])
        #expect(sent.map(\.path) == [
            "/api/v1/me/saved/5", "/api/v1/me/saved/5", "/api/v1/me/saved/gone/11",
            "/api/v1/me/saved/merge", "/api/v1/me/saved/ids", "/api/v1/me/saved",
        ])
        #expect(sent.allSatisfy { $0.headers.first { $0.key.lowercased() == "authorization" }?.value == "Bearer b.sig" })
        let body = try #require(try JSONSerialization.jsonObject(with: sent[3].body) as? [String: Any])
        let item = try #require((body["items"] as? [[String: Any]])?.first)
        #expect(Set(item.keys) == ["id", "savedAt"])  // snap assente = chiave assente
    }

    @Test func capAnswerIsA409WithCodeCap() async {
        SavesStub.reset([.init(status: 409, body: #"{"error":"cap"}"#)])
        await #expect(throws: APIError.http(status: 409, code: "cap")) { try await savesClient().save(id: 1) }
    }
}
