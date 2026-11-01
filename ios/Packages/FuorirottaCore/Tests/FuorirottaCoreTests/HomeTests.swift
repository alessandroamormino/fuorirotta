import Foundation
import Testing
@testable import FuorirottaCore

// Stub proprio: le suite girano in parallelo e lo stato statico non si condivide con le altre.
final class HomeStub: URLProtocol, @unchecked Sendable {
    struct Sent { let method: String; let url: URL; let headers: [String: String]; let body: Data }
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
            Self.sent.append(Sent(method: request.httpMethod ?? "", url: request.url!, headers: request.allHTTPHeaderFields ?? [:], body: body))
            return Self.replies.isEmpty ? Reply() : Self.replies.removeFirst()
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private func client() -> APIClient {
    APIClient(
        baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
        session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [HomeStub.self]))
}

private let feedBody = """
{"items": [{"id": 3, "title": "Sagra", "dateStart": "2026-11-08T00:00:00.000Z", "dateEnd": null, "imageUrl": null,
  "locationName": "Lodi", "address": null, "canonicalCategory": "Sagre e feste", "category": null, "latitude": null,
  "longitude": null, "resolvedLatitude": null, "resolvedLongitude": null, "sourceUrl": null, "description": null}],
 "total": 1, "follows": 2}
"""

@Suite(.serialized) struct HomeTests {
    @Test func feedIsGetWithBearerAndDecodes() async throws {
        HomeStub.reset([.init(body: feedBody)])
        let api = client()
        api.bearer = "b.sig"
        let page = try await api.feed(limit: 16, offset: 0)
        let sent = try #require(HomeStub.requests.first)
        #expect(sent.method == "GET")
        #expect(sent.url.path == "/api/v1/me/feed")
        #expect(sent.url.query == "limit=16&offset=0")
        #expect(sent.headers["Authorization"] == "Bearer b.sig")
        #expect(page.items.map(\.id) == [3])
        #expect(page.total == 1)
        #expect(page.follows == 2)
    }

    @Test func feedNeverCarriesALocation() async throws {
        HomeStub.reset([.init(body: feedBody)])
        let api = client()
        api.bearer = "b.sig"
        _ = try await api.feed(limit: 100, offset: 0)
        let query = HomeStub.requests.first?.url.query ?? ""
        #expect(!query.contains("lat") && !query.contains("lng"))
        #expect(HomeStub.requests.first?.body.isEmpty == true)
    }

    @Test func eventsIsTheOnlyCallThatCarriesTheLocation() async throws {
        HomeStub.reset([.init(body: #"{"events": [], "mapEvents": [], "total": 0}"#)])
        let api = client()
        api.bearer = "b.sig"
        _ = try await api.events(lat: 45.46, lng: 9.19, radiusKm: 50, limit: 16)
        let sent = try #require(HomeStub.requests.first)
        #expect(sent.url.query?.contains("lat=45.46") == true)
        // La rotta pubblica non porta mai il bearer.
        #expect(sent.headers["Authorization"] == nil)
    }

    @Test func followIsPutWithKindAndKey() async throws {
        HomeStub.reset([.init(body: #"{"followed": true}"#)])
        let api = client()
        api.bearer = "b.sig"
        try await api.follow(kind: "category", key: "Sagre e feste")
        let sent = try #require(HomeStub.requests.first)
        #expect(sent.method == "PUT")
        #expect(sent.url.path == "/api/v1/me/follows")
        #expect(sent.headers["Authorization"] == "Bearer b.sig")
        let json = try #require(JSONSerialization.jsonObject(with: sent.body) as? [String: String])
        #expect(json == ["kind": "category", "key": "Sagre e feste"])
    }

    @Test func followWithoutASessionIsAnError() async {
        HomeStub.reset([.init(status: 401, body: #"{"error": "unauthorized"}"#)])
        await #expect(throws: APIError.http(status: 401, code: "unauthorized")) {
            try await client().follow(kind: "category", key: "Sagre e feste")
        }
    }

    @Test func configIsPublicAndDecodes() async throws {
        HomeStub.reset([.init(body: #"{"minimumVersion": "1.2", "recommendedVersion": null, "status": "update-required"}"#)])
        let api = client()
        api.bearer = "b.sig"
        let config = await api.config(version: "1.0.0")
        let sent = try #require(HomeStub.requests.first)
        #expect(sent.method == "GET")
        #expect(sent.url.path == "/api/v1/config")
        #expect(sent.url.query == "version=1.0.0")
        #expect(sent.headers["Authorization"] == nil)
        #expect(config?.status == .updateRequired)
        #expect(config?.minimumVersion == "1.2")
    }

    @Test func configMissingStatusIsNil() async throws {
        HomeStub.reset([.init(body: #"{"minimumVersion": null, "recommendedVersion": null}"#)])
        let config = await client().config(version: "1.0.0")
        #expect(config != nil)
        #expect(config?.status == nil)
    }

    @Test func configFailsOpen() async {
        HomeStub.reset([.init(body: "not json")])
        #expect(await client().config(version: "1.0.0") == nil)
        HomeStub.reset([.init(status: 500, body: "{}")])
        #expect(await client().config(version: "1.0.0") == nil)
    }

    @Test func unknownStatusDoesNotBlock() async {
        HomeStub.reset([.init(body: #"{"minimumVersion": null, "recommendedVersion": null, "status": "banana"}"#)])
        let config = await client().config(version: "1.0.0")
        #expect(config?.status == nil)
    }

    // MARK: dettaglio (27-08)

    @Test func eventLookupFoundDecodes() async throws {
        HomeStub.reset([.init(body: """
        {"id": 7, "title": "Sagra", "dateStart": "2026-11-08T00:00:00.000Z", "dateEnd": null, "imageUrl": null,
         "locationName": "Lodi", "address": null, "canonicalCategory": null, "category": null, "latitude": null,
         "longitude": null, "resolvedLatitude": 45.3, "resolvedLongitude": 9.5, "sourceUrl": "https://x.it/a", "description": "d"}
        """)])
        let result = try await client().event(id: 7)
        let sent = try #require(HomeStub.requests.first)
        #expect(sent.method == "GET")
        #expect(sent.url.path == "/api/events/7")
        #expect(sent.headers["Authorization"] == nil)
        guard case .found(let e) = result else { Issue.record("atteso found"); return }
        #expect(e.id == 7 && e.resolvedLatitude == 45.3)
    }

    @Test func eventLookup404IsGone() async throws {
        HomeStub.reset([.init(status: 404, body: #"{"error": "Event not found"}"#)])
        let result = try await client().event(id: 99)
        guard case .gone = result else { Issue.record("atteso gone"); return }
    }

    @Test func eventLookupOtherErrorsThrow() async {
        HomeStub.reset([.init(status: 500, body: "{}")])
        await #expect(throws: APIError.http(status: 500, code: nil)) { try await client().event(id: 1) }
    }

    @Test func longDayUsesRomeAndItalianNames() {
        #expect(formatLongDay("2026-11-08") == "domenica 8 novembre")
        #expect(formatLongDay("2026-11-07") == "sabato 7 novembre")
        #expect(formatLongDay("2026-12-31") == "giovedì 31 dicembre")
        #expect(formatLongDay("boh") == "boh")
    }

    @Test func eventTimeHidesAllDayMarkers() {
        // Mezzanotte UTC e mezzanotte di Roma (inverno 23:00Z, estate 22:00Z) sono eventi senza orario.
        #expect(eventTime("2026-11-08T00:00:00.000Z") == nil)
        #expect(eventTime("2026-11-07T23:00:00.000Z") == nil)
        #expect(eventTime("2026-07-07T22:00:00.000Z") == nil)
        #expect(eventTime("2026-11-08T20:00:00.000Z") == "21:00")
        #expect(eventTime("2026-07-08T19:30:00.000Z") == "21:30")
        #expect(eventTime("non una data") == nil)
    }
}
