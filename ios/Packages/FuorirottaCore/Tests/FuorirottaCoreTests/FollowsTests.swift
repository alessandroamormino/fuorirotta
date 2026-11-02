import Foundation
import Testing
@testable import FuorirottaCore

// Stub delle rotte /api/v1/me/* del giro UAT7 (B1, B2, B3). Uno solo: le suite che lo usano sono annidate in MeTests,
// che e' serializzata (il tratto vale anche per le suite figlie), quindi lo stato statico non si incrocia.
final class MeStub: URLProtocol, @unchecked Sendable {
    struct Sent { let method: String; let url: URL; let headers: [String: String]; let body: Data }
    struct Reply { var status = 200; var body = "{}"; var headers: [String: String] = [:] }

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
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func client() -> APIClient {
        let api = APIClient(
            baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
            session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [MeStub.self]))
        api.bearer = "b.sig"
        return api
    }

    static func json(_ sent: Sent) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: sent.body)) as? [String: Any] ?? [:]
    }
}

@Suite(.serialized) struct MeTests {}

extension MeTests {
    @Suite struct Follows {
        @Test func listDecodesTheServerShape() async throws {
            MeStub.reset([.init(body: #"{"onboarded":true,"follows":[{"kind":"province","key":"BG","label":"Provincia di Bergamo"},{"kind":"category","key":"Altro","label":"Altro"}]}"#)])
            let list = try await MeStub.client().follows()
            #expect(list.onboarded)
            #expect(list.follows.map(\.id) == ["province:BG", "category:Altro"])
            #expect(list.follows.map(\.isPlace) == [true, false])
            let sent = try #require(MeStub.requests.first)
            #expect(sent.method == "GET" && sent.url.path == "/api/v1/me/follows")
            #expect(sent.headers["Authorization"] == "Bearer b.sig")
        }

        @Test func followReturnsTheServerLabel() async throws {
            MeStub.reset([.init(body: #"{"followed":true,"label":"Bergamo (BG)"}"#)])
            let label = try await MeStub.client().follow(kind: "comune", key: "016024")
            #expect(label == "Bergamo (BG)")
            let sent = try #require(MeStub.requests.first)
            #expect(sent.method == "PUT")
            #expect(MeStub.json(sent) as? [String: String] == ["kind": "comune", "key": "016024"])
        }

        @Test func followAtTheCapIsA409WithCode() async {
            MeStub.reset([.init(status: 409, body: #"{"error":"cap"}"#)])
            await #expect(throws: APIError.http(status: 409, code: "cap")) {
                try await MeStub.client().follow(kind: "comune", key: "016024")
            }
        }

        @Test func unfollowIsDeleteWithTheKeyInTheBodyOnly() async throws {
            MeStub.reset([.init(body: #"{"removed":1}"#)])
            try await MeStub.client().unfollow(kind: "province", key: "BG")
            let sent = try #require(MeStub.requests.first)
            #expect(sent.method == "DELETE")
            #expect(sent.url.path == "/api/v1/me/follows" && sent.url.query == nil)
            #expect(MeStub.json(sent) as? [String: String] == ["kind": "province", "key": "BG"])
        }

        @Test func placeSearchIsPublicAndDecodesChips() async throws {
            MeStub.reset([.init(body: #"{"results":[{"kind":"comune","key":"016024","label":"Bergamo","sublabel":"Comune · provincia di Bergamo","chip":"Bergamo (BG)"}]}"#)])
            let found = try await MeStub.client().searchPlaces(q: "berg")
            #expect(found.first?.item == FollowItem(kind: "comune", key: "016024", label: "Bergamo (BG)"))
            let sent = try #require(MeStub.requests.first)
            #expect(sent.url.path == "/api/places/search" && sent.url.query == "q=berg")
            // Rotta pubblica: niente bearer.
            #expect(sent.headers["Authorization"] == nil)
        }

        @Test func onboardingSendsPicksAndTheMarkInOneRequest() async throws {
            MeStub.reset([.init(body: #"{"onboarded":true,"added":2}"#)])
            try await MeStub.client().onboarding(places: [FollowItem(kind: "comune", key: "016024", label: "Bergamo (BG)")], categories: ["Sagre e feste"])
            let sent = try #require(MeStub.requests.first)
            #expect(sent.method == "POST" && sent.url.path == "/api/v1/me/onboarding")
            #expect(sent.headers["Authorization"] == "Bearer b.sig")
            let body = MeStub.json(sent)
            // Solo kind e key, come il sito: l'etichetta resta sul telefono.
            #expect(body["places"] as? [[String: String]] == [["kind": "comune", "key": "016024"]])
            #expect(body["categories"] as? [String] == ["Sagre e feste"])
        }

        @Test func onboardingSkipIsTwoEmptyLists() async throws {
            MeStub.reset([.init(body: #"{"onboarded":true,"added":0}"#)])
            try await MeStub.client().onboarding(places: [], categories: [])
            let body = MeStub.json(try #require(MeStub.requests.first))
            #expect((body["places"] as? [Any])?.isEmpty == true && (body["categories"] as? [Any])?.isEmpty == true)
        }

        @Test func onboardingOverTheCapIsA409WithCode() async {
            MeStub.reset([.init(status: 409, body: #"{"error":"cap"}"#)])
            await #expect(throws: APIError.http(status: 409, code: "cap")) {
                try await MeStub.client().onboarding(places: [FollowItem(kind: "province", key: "BG", label: "x")], categories: [])
            }
        }

        @Test func sortIsLikeTheSite() {
            let mixed = [
                FollowItem(kind: "category", key: "Musica e spettacolo", label: "Musica e spettacolo"),
                FollowItem(kind: "comune", key: "016024", label: "Bergamo (BG)"),
                FollowItem(kind: "comune", key: "015146", label: "Abbiategrasso (MI)"),
                FollowItem(kind: "category", key: "Sagre e feste", label: "Sagre e feste"),
                FollowItem(kind: "province", key: "BG", label: "Provincia di Bergamo"),
                FollowItem(kind: "region", key: "lombardia", label: "Lombardia"),
            ]
            #expect(sortFollows(mixed).map(\.id) == [
                "region:lombardia", "province:BG", "comune:015146", "comune:016024",
                "category:Sagre e feste", "category:Musica e spettacolo",
            ])
        }

        @Test func detailTargetsUseTheSiteKeys() {
            var event = Event(id: 1, title: "Sagra", dateStart: "2026-11-07T00:00:00.000Z", category: "Sagre e feste")
            event.comune = EventComune(istatCode: "016024", name: "Bergamo", provinceCode: "BG", provinceName: "Bergamo")
            #expect(followTargets(for: event) == [
                FollowItem(kind: "comune", key: "016024", label: "Bergamo (BG)"),
                FollowItem(kind: "province", key: "BG", label: "Provincia di Bergamo"),
                FollowItem(kind: "category", key: "Sagre e feste", label: "Sagre e feste"),
            ])
            // I dati di una card (lista) non hanno istatCode: niente luogo.
            event.comune = EventComune(istatCode: nil, name: "Bergamo", provinceCode: "BG", provinceName: nil)
            #expect(followTargets(for: event).map(\.kind) == ["category"])
            // Senza comune resta la categoria; una categoria fuori tassonomia non si segue (il server darebbe 400).
            event.comune = nil
            #expect(followTargets(for: event).map(\.kind) == ["category"])
            #expect(followTargets(for: Event(id: 2, title: "x", dateStart: "2026-11-07T00:00:00.000Z", category: "Hacker")).isEmpty)
        }

        @Test func eventDetailDecodesComuneWithTheContractKeys() throws {
            #expect(EventComune.CodingKeys.allCases.map(\.rawValue) == ApiContract.eventComuneKeys)
            let json = #"{"id":7,"title":"T","dateStart":"2026-11-07T00:00:00.000Z","dateEnd":null,"imageUrl":null,"locationName":null,"address":null,"canonicalCategory":"Altro","category":"Altro","latitude":null,"longitude":null,"resolvedLatitude":null,"resolvedLongitude":null,"sourceUrl":null,"description":null,"comune":{"istatCode":"021008","name":"Bolzano","provinceCode":"BZ","provinceName":"Bolzano/Bozen"}}"#
            let event = try JSONDecoder().decode(Event.self, from: Data(json.utf8))
            #expect(event.comune?.provinceName == "Bolzano/Bozen")
            let none = try JSONDecoder().decode(Event.self, from: Data(json.replacingOccurrences(of: #"{"istatCode":"021008","name":"Bolzano","provinceCode":"BZ","provinceName":"Bolzano/Bozen"}"#, with: "null").utf8))
            #expect(none.comune == nil)
        }
    }
}
