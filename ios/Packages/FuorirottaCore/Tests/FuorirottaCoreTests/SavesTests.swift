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
}
